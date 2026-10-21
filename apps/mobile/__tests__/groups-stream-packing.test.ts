/**
 * The stream as drawn (`buildCompetitionStreamModels`): a session carries the
 * group records it took, so one session is one card; linking is left out
 * until the debug drawer asks for it.
 */
import {
  buildCompetitionStreamModels,
  DEFAULT_HIDDEN_STREAM_EVENT_KINDS,
  type CompetitionSessionCard,
} from '@/src/groups/competition-stream-view-model';
import type { CompetitionEventWire, CompetitionStreamItemWire } from '@/src/groups/competition-wire';

import { competitionEvent } from './helpers/competition-fixtures';

const member = { user_id: 'friend-1', username: 'alex' };

const sessionItem = (sessionId: string): CompetitionStreamItemWire => ({
  kind: 'session',
  key: `friend-1:${sessionId}`,
  sort_at_ms: 1000,
  groups: [{ group_id: 'g1', name: 'Crew' }],
  session: {
    member,
    session_id: sessionId,
    gym_name: null,
    status: 'completed',
    started_at_ms: 1000,
    completed_at_ms: 2000,
    duration_sec: 1000,
    exercises: [],
  },
});

const eventItem = (
  key: string,
  overrides: Partial<CompetitionEventWire> = {},
): CompetitionStreamItemWire => ({
  kind: 'competition',
  key,
  sort_at_ms: 1500,
  event: { ...competitionEvent, event_id: key, ...overrides },
});

const sessions = (models: ReturnType<typeof buildCompetitionStreamModels>): CompetitionSessionCard[] =>
  models.filter((model): model is CompetitionSessionCard => model.kind === 'session');

describe('the stream as drawn', () => {
  it('packs a session\'s records into its card instead of a card each', () => {
    const models = buildCompetitionStreamModels([
      eventItem('r-1', { session_id: 's-1', group_exercise: { group_exercise_id: 'ge1', name: 'Deadlift' } }),
      eventItem('r-2', { session_id: 's-1', group_exercise: { group_exercise_id: 'ge2', name: 'Pull-up' } }),
      sessionItem('s-1'),
    ], undefined, 'DD-MM-YYYY');

    expect(models).toHaveLength(1);
    const [card] = sessions(models);
    expect(card?.records.map((line) => line.exercise)).toEqual(['Deadlift', 'Pull-up']);
    // The line's key is the stream item's, so tapping it opens that record.
    expect(card?.records[0]?.key).toBe('r-1');
    expect(card?.records[0]?.value).toContain('%');
  });

  it('keeps a record whose session is not in the page on its own card', () => {
    const models = buildCompetitionStreamModels([eventItem('r-1', { session_id: 's-missing' }), sessionItem('s-1')], undefined, 'DD-MM-YYYY');

    expect(models.map((model) => model.kind)).toEqual(['competition', 'session']);
    expect(sessions(models)[0]?.records).toEqual([]);
  });

  it('leaves linking out by default and draws it once the drawer asks', () => {
    const items = [eventItem('l-1', { kind: 'link', session_id: null }), eventItem('u-1', { kind: 'unlink', session_id: null })];

    expect(buildCompetitionStreamModels(items, undefined, 'DD-MM-YYYY')).toEqual([]);
    expect(DEFAULT_HIDDEN_STREAM_EVENT_KINDS).toEqual(['link', 'unlink']);
    expect(buildCompetitionStreamModels(items, [], 'DD-MM-YYYY').map((model) => model.key)).toEqual(['l-1', 'u-1']);
  });

  it('hides any kind the drawer switches off, nested records included', () => {
    const models = buildCompetitionStreamModels(
      [eventItem('r-1', { session_id: 's-1' }), sessionItem('s-1')],
      ['record'], 'DD-MM-YYYY'
    );

    expect(sessions(models)[0]?.records).toEqual([]);
    expect(models).toHaveLength(1);
  });

  it('marks a certified record, and reads a voided one as its own card', () => {
    const certified = eventItem('r-1', {
      session_id: 's-1',
      record_context: {
        ...competitionEvent.record_context!,
        metrics: [{ metric: 'e1rm', write_token: 't', eligible: true,
          certification: { certification_id: 'c1', metric: 'e1rm', certified_by: null, certified_at_ms: 1,
            observed_rules_revision: 2, ended_at_ms: null, end_reason: null } }],
      },
    });
    const voided = eventItem('r-2', { session_id: 's-1', voided: true });

    const models = buildCompetitionStreamModels([certified, voided, sessionItem('s-1')], undefined, 'DD-MM-YYYY');

    expect(sessions(models)[0]?.records.map((line) => line.certified)).toEqual([true]);
    expect(models.map((model) => model.kind)).toEqual(['competition', 'session']);
  });
});
