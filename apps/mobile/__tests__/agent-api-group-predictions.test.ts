/**
 * Outcome: a coach's prediction request is refused before any database call
 * when its shape is wrong (unknown field, bad price, stake or date, too many
 * metrics), each prediction route has one method and one audit name, the RPCs'
 * refusals become the wire errors the contract lists (a non-member and a group
 * with the setting off stay identical), a receipt hash ignores the order a
 * caller wrote its keys in, and no response carries a note.
 *
 * The Edge Function (`supabase/functions/agent-api`) applies these pure rules;
 * the backend `agent-api` lane proves the RPCs, receipts, gate and rate limit.
 */

import {
  canonicalJson,
  GroupPredictionError,
  groupPredictionError,
  groupRouteFor,
  groupToolName,
  groupToolNameForPath,
  isWriteRoute,
  normalizeCowSchedule,
  normalizePostOffer,
  normalizeWithdraw,
  withoutNotes,
} from '../../../supabase/functions/agent-api/group-predictions.ts';

const GROUP = '3f2a1b9c-0d4e-4c6a-8b7f-1234567890ab';
const OFFER = '7a1c2d3e-4f50-4a6b-8c7d-0123456789ef';
const MEMBER = '11111111-2222-4333-8444-555555555555';
const EXERCISE = '99999999-8888-4777-8666-555555555555';

const rejection = (read: () => unknown): GroupPredictionError => {
  try {
    read();
  } catch (error) {
    if (error instanceof GroupPredictionError) return error;
    throw error;
  }
  throw new Error('expected a GroupPredictionError');
};

const offer = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  week_start: '2026-12-07',
  template: 'sets_line',
  parameters: { member_user_id: MEMBER, line: 20 },
  side: 'yes',
  price: 60,
  stake: 12.5,
  ...overrides,
});

describe('groupRouteFor', () => {
  it.each([
    ['/v1/agent/groups', 'GET', { kind: 'groups' }],
    [`/v1/agent/groups/${GROUP}/form`, 'GET', { kind: 'form', groupId: GROUP }],
    [`/v1/agent/groups/${GROUP}/board`, 'GET', { kind: 'board', groupId: GROUP }],
    [`/v1/agent/groups/${GROUP}/offers`, 'POST', { kind: 'post', groupId: GROUP }],
    [`/v1/agent/groups/${GROUP}/cow`, 'POST', { kind: 'cow', groupId: GROUP }],
    [`/v1/agent/groups/${GROUP}/offers/${OFFER}/withdraw`, 'POST', { kind: 'withdraw', groupId: GROUP, offerId: OFFER }],
  ])('%s %s names its route', (path, method, route) => {
    expect(groupRouteFor(path, method)).toEqual(route);
  });

  it('leaves every other family to the rest of the API', () => {
    expect(groupRouteFor('/v1/agent/notes', 'GET')).toBeNull();
    expect(groupRouteFor('/v1/agent/groupsx', 'GET')).toBeNull();
  });

  it('lower-cases ids so one group has one route', () => {
    expect(groupRouteFor(`/v1/agent/groups/${GROUP.toUpperCase()}/board`, 'GET')).toEqual({ kind: 'board', groupId: GROUP });
  });

  it.each([
    '/v1/agent/groups/',
    '/v1/agent/groups/not-an-id/board',
    `/v1/agent/groups/${GROUP}`,
    `/v1/agent/groups/${GROUP}/notes`,
    `/v1/agent/groups/${GROUP}/offers/${OFFER}`,
    `/v1/agent/groups/${GROUP}/offers/not-an-id/withdraw`,
  ])('answers 404 for %s', (path) => {
    expect(rejection(() => groupRouteFor(path, 'GET'))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it.each([
    ['/v1/agent/groups', 'POST', 'GET'],
    [`/v1/agent/groups/${GROUP}/board`, 'POST', 'GET'],
    [`/v1/agent/groups/${GROUP}/offers`, 'GET', 'POST'],
    [`/v1/agent/groups/${GROUP}/cow`, 'PATCH', 'POST'],
  ])('answers 405 for %s with %s', (path, method, allowed) => {
    expect(rejection(() => groupRouteFor(path, method))).toMatchObject({
      status: 405, code: 'METHOD_NOT_ALLOWED', message: `Use ${allowed}.`,
    });
  });

  it('names one audit tool per route and counts the three writes', () => {
    const routes = [
      groupRouteFor('/v1/agent/groups', 'GET'),
      groupRouteFor(`/v1/agent/groups/${GROUP}/form`, 'GET'),
      groupRouteFor(`/v1/agent/groups/${GROUP}/board`, 'GET'),
      groupRouteFor(`/v1/agent/groups/${GROUP}/offers`, 'POST'),
      groupRouteFor(`/v1/agent/groups/${GROUP}/offers/${OFFER}/withdraw`, 'POST'),
      groupRouteFor(`/v1/agent/groups/${GROUP}/cow`, 'POST'),
    ].map((route) => route!);
    expect(routes.map(groupToolName)).toEqual([
      'list_prediction_groups', 'get_group_form', 'get_prediction_board',
      'post_prediction_offer', 'withdraw_prediction_offer', 'schedule_group_cow',
    ]);
    expect(routes.map(isWriteRoute)).toEqual([false, false, false, true, true, true]);
  });

  it('audits a bad path or method as an unknown route and another family as none', () => {
    expect(groupToolNameForPath(`/v1/agent/groups/${GROUP}/board`, 'GET')).toBe('get_prediction_board');
    expect(groupToolNameForPath(`/v1/agent/groups/${GROUP}/board`, 'POST')).toBe('unknown_agent_route');
    expect(groupToolNameForPath('/v1/agent/groups/x', 'GET')).toBe('unknown_agent_route');
    expect(groupToolNameForPath('/v1/agent/profile', 'GET')).toBeNull();
  });
});

describe('normalizePostOffer', () => {
  it('keeps a complete offer and fills the optional fields with null', () => {
    expect(normalizePostOffer(offer())).toEqual({
      ...offer(), walk_away_price: null, note: null, answers_offer_id: null,
    });
  });

  it('keeps a walk-away price, a trimmed note and the offer it counters', () => {
    expect(normalizePostOffer(offer({ walk_away_price: 70, note: '  my read  ', answers_offer_id: OFFER.toUpperCase(), side: 'no' })))
      .toMatchObject({ walk_away_price: 70, note: 'my read', answers_offer_id: OFFER, side: 'no' });
  });

  it('treats a blank note as none', () => {
    expect(normalizePostOffer(offer({ note: '   ' })).note).toBeNull();
  });

  it.each([
    ['an unknown field', { user_id: MEMBER }, 'Unsupported field: user_id'],
    ['a template that is not one of the five', { template: 'free_text' }, 'template must be one of'],
    ['a side that is not yes or no', { side: 'maybe' }, 'side must be yes or no.'],
    ['a price with a fraction', { price: 60.5 }, 'price must be a whole number.'],
    ['a price as text', { price: '60' }, 'price must be a whole number.'],
    ['a stake of zero', { stake: 0 }, 'stake must be a number from 0.01 to 100.'],
    ['a stake over 100', { stake: 100.01 }, 'stake must be a number from 0.01 to 100.'],
    ['a stake as text', { stake: '5' }, 'stake must be a number from 0.01 to 100.'],
    ['a stake with three decimals', { stake: 1.005 }, 'stake has at most two decimals.'],
    ['a week that is not a date', { week_start: 'next week' }, 'week_start must be a date written YYYY-MM-DD.'],
    ['a week that is not real', { week_start: '2026-02-30' }, 'week_start must be a real date.'],
    ['a walk-away price with a fraction', { walk_away_price: 70.5 }, 'walk_away_price must be a whole number.'],
    ['a note that is not text', { note: 5 }, 'note must be text.'],
    ['a note over 140 characters', { note: 'x'.repeat(141) }, 'note must be at most 140 characters.'],
    ['parameters as a list', { parameters: [] }, 'parameters must be an object.'],
    ['no parameters', { parameters: undefined }, 'parameters must be an object.'],
    ['an offer id that is not an id', { answers_offer_id: 'abc' }, 'answers_offer_id must be an id.'],
  ])('refuses %s with 400', (_label, change, message) => {
    expect(rejection(() => normalizePostOffer(offer(change)))).toMatchObject({
      status: 400, code: 'INVALID_ARGUMENT', message: expect.stringContaining(message),
    });
  });

  it('accepts the stake edges and a note of exactly 140 characters', () => {
    expect(normalizePostOffer(offer({ stake: 0.01 })).stake).toBe(0.01);
    expect(normalizePostOffer(offer({ stake: 100 })).stake).toBe(100);
    expect(normalizePostOffer(offer({ stake: 0.07 })).stake).toBe(0.07);
    expect(normalizePostOffer(offer({ note: 'x'.repeat(140) })).note).toHaveLength(140);
  });

  it('leaves the market parameters and the price rules to the database', () => {
    expect(normalizePostOffer(offer({ price: 150, parameters: { anything: 1 } }))).toMatchObject({
      price: 150, parameters: { anything: 1 },
    });
  });
});

describe('normalizeWithdraw and normalizeCowSchedule', () => {
  it('takes an empty withdraw body only', () => {
    expect(normalizeWithdraw({})).toEqual({});
    expect(rejection(() => normalizeWithdraw({ offer_id: OFFER }))).toMatchObject({ status: 400 });
  });

  it('keeps a CoW pick of one to three distinct metrics', () => {
    const pick = { week_start: '2026-12-07', group_exercise_id: EXERCISE.toUpperCase(), metrics: ['e1rm', 'volume', 'improvement'] };
    expect(normalizeCowSchedule(pick)).toEqual({ ...pick, group_exercise_id: EXERCISE });
  });

  it.each([
    ['no metrics', { metrics: [] }],
    ['four metrics', { metrics: ['a', 'b', 'c', 'd'] }],
    ['a repeated metric', { metrics: ['e1rm', 'e1rm'] }],
    ['a metric that is not text', { metrics: [1] }],
    ['metrics as text', { metrics: 'e1rm' }],
    ['an exercise that is not an id', { group_exercise_id: 'bench' }],
    ['a week that is not a date', { week_start: '12/07/2026' }],
    ['an unknown field', { created_by: MEMBER }],
  ])('refuses %s', (_label, change) => {
    const pick = { week_start: '2026-12-07', group_exercise_id: EXERCISE, metrics: ['e1rm'], ...change };
    expect(rejection(() => normalizeCowSchedule(pick))).toMatchObject({ status: 400, code: 'INVALID_ARGUMENT' });
  });
});

describe('groupPredictionError', () => {
  it.each([
    ['NOT_FOUND: group not found', 404, 'NOT_FOUND', 'Group or offer not found.'],
    ['NOT_FOUND: offer not found', 404, 'NOT_FOUND', 'Group or offer not found.'],
    ['VALIDATION: price is a whole number from 1 to 99', 400, 'INVALID_ARGUMENT', 'price is a whole number from 1 to 99'],
    ['CONFLICT: this board has closed', 409, 'CONFLICT', 'this board has closed'],
    ['DUPLICATE: this AI already countered that offer', 409, 'DUPLICATE', 'this AI already countered that offer'],
    ['FORBIDDEN: this AI picked last week\'s CoW; another AI picks this one', 403, 'FORBIDDEN',
      'this AI picked last week\'s CoW; another AI picks this one'],
    ['IDEMPOTENCY_CONFLICT', 409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was used with a different payload.'],
    ['INVALID_ARGUMENT', 400, 'INVALID_ARGUMENT', 'The request could not be accepted.'],
  ])('turns %j into %i %s', (message, status, code, text) => {
    expect(groupPredictionError(message)).toMatchObject({ status, code, message: text });
  });

  it('gives a non-member and a group with the setting off the same refusal', () => {
    const missing = groupPredictionError('NOT_FOUND: group not found');
    expect(groupPredictionError('NOT_FOUND: offer not found')).toEqual(missing);
    expect(groupPredictionError('NOT_FOUND')).toEqual(missing);
  });

  it.each([
    undefined,
    '',
    'AGENT_FORBIDDEN: OAuth clients cannot call prediction writes',
    'SERVICE_ROLE_REQUIRED: prediction writes are server-only',
    'group_prediction_match: offers 1 and 2 cannot match',
    'connection refused',
  ])('leaves %j to the route as an internal error', (message) => {
    expect(groupPredictionError(message)).toBeNull();
  });
});

describe('canonicalJson and withoutNotes', () => {
  it('writes the same text however the keys were ordered', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [2, { y: 2, z: 1 }] }, b: 1 }));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
    expect(canonicalJson([1, 'x', null])).toBe('[1,"x",null]');
  });

  it('drops a note wherever a reader returned one', () => {
    expect(withoutNotes({
      offer: { price: 60, note: 'mine' },
      open: [{ price: 40, note: 'theirs', walk_away_price: null }],
      note: 'top',
      count: 2,
      none: null,
    })).toEqual({ offer: { price: 60 }, open: [{ price: 40, walk_away_price: null }], count: 2, none: null });
  });
});
