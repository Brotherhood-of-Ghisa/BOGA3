// Group predictions for the coach: `v1/agent/groups…`. Pure: the routes in
// `index.ts` call the service-role `agent_group_prediction_*` RPCs, and these
// rules match the paths, parse the caller's input strictly and turn the RPCs'
// errors into wire errors. The market rules themselves (templates, prices,
// stake limit, gates) are the RPCs'; see
// docs/specs/tech/group-predictions-agent-contract.md.

type JsonObject = Record<string, unknown>;

/** A caller's bad input or a refused write, as the status and code the route answers. */
export class GroupPredictionError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export type GroupRoute =
  | { kind: 'groups' }
  | { kind: 'form'; groupId: string }
  | { kind: 'board'; groupId: string }
  | { kind: 'post'; groupId: string }
  | { kind: 'withdraw'; groupId: string; offerId: string }
  | { kind: 'cow'; groupId: string };

export const GROUP_READ_RATE_LIMIT_REQUESTS = 60;
export const GROUP_WRITE_RATE_LIMIT_REQUESTS = 30;
export const NOTE_MAX_LENGTH = 140;

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const UUID_ONLY = new RegExp(`^${UUID}$`);
const GROUPS_PATH = /^\/v1\/agent\/groups(\/.*)?$/;
const GROUP_PATH = new RegExp(`^/v1/agent/groups/(${UUID})/(form|board|offers|cow)$`);
const WITHDRAW_PATH = new RegExp(`^/v1/agent/groups/(${UUID})/offers/(${UUID})/withdraw$`);
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TEMPLATES = new Set(['e1rm_line', 'sets_line', 'records_line', 'cow_top', 'lead_change']);

const invalid = (message: string): never => {
  throw new GroupPredictionError(400, 'INVALID_ARGUMENT', message);
};

const allowedMethods = (kind: GroupRoute['kind']): string => (
  kind === 'groups' || kind === 'form' || kind === 'board' ? 'GET' : 'POST'
);

const routeFor = (path: string): GroupRoute | null => {
  if (path === '/v1/agent/groups') return { kind: 'groups' };
  const withdraw = WITHDRAW_PATH.exec(path);
  if (withdraw) return { kind: 'withdraw', groupId: withdraw[1].toLowerCase(), offerId: withdraw[2].toLowerCase() };
  const group = GROUP_PATH.exec(path);
  if (!group) return null;
  const groupId = group[1].toLowerCase();
  if (group[2] === 'form') return { kind: 'form', groupId };
  if (group[2] === 'board') return { kind: 'board', groupId };
  return group[2] === 'offers' ? { kind: 'post', groupId } : { kind: 'cow', groupId };
};

/**
 * The prediction route a canonical path names, or null for another family. A
 * path under `/v1/agent/groups` that names no route is a 404, and a route
 * used with the wrong method a 405.
 */
export const groupRouteFor = (path: string, method: string): GroupRoute | null => {
  if (!GROUPS_PATH.test(path)) return null;
  const route = routeFor(path);
  if (!route) throw new GroupPredictionError(404, 'NOT_FOUND', 'Agent route not found.');
  const allowed = allowedMethods(route.kind);
  if (method !== allowed) throw new GroupPredictionError(405, 'METHOD_NOT_ALLOWED', `Use ${allowed}.`);
  return route;
};

const TOOL_NAMES: Record<GroupRoute['kind'], string> = {
  groups: 'list_prediction_groups',
  form: 'get_group_form',
  board: 'get_prediction_board',
  post: 'post_prediction_offer',
  withdraw: 'withdraw_prediction_offer',
  cow: 'schedule_group_cow',
};

/** The audit name of a route. */
export const groupToolName = (route: GroupRoute): string => TOOL_NAMES[route.kind];

/** The tool name for a path in the family, `unknown_agent_route` when it names no route. */
export const groupToolNameForPath = (path: string, method: string): string | null => {
  if (!GROUPS_PATH.test(path)) return null;
  const route = routeFor(path);
  return route && method === allowedMethods(route.kind) ? TOOL_NAMES[route.kind] : 'unknown_agent_route';
};

export const isWriteRoute = (route: GroupRoute): boolean =>
  route.kind === 'post' || route.kind === 'withdraw' || route.kind === 'cow';

const checkKeys = (input: JsonObject, allowed: readonly string[]): void => {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) invalid(`Unsupported field: ${key}`);
  }
};

const readUuid = (value: unknown, key: string): string => {
  if (typeof value !== 'string' || !UUID_ONLY.test(value)) return invalid(`${key} must be an id.`);
  return value.toLowerCase();
};

const readOptionalUuid = (value: unknown, key: string): string | null =>
  value === undefined || value === null ? null : readUuid(value, key);

/** A real calendar date written `YYYY-MM-DD`. */
const readDate = (value: unknown, key: string): string => {
  const match = typeof value === 'string' ? DATE.exec(value) : null;
  if (!match) return invalid(`${key} must be a date written YYYY-MM-DD.`);
  const [year, month, day] = match.slice(1).map(Number);
  const real = new Date(Date.UTC(year, month - 1, day));
  if (real.getUTCFullYear() !== year || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) {
    return invalid(`${key} must be a real date.`);
  }
  return value as string;
};

const readWholeNumber = (value: unknown, key: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value)) return invalid(`${key} must be a whole number.`);
  return value;
};

const readOptionalWholeNumber = (value: unknown, key: string): number | null =>
  value === undefined || value === null ? null : readWholeNumber(value, key);

const readNote = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return invalid('note must be text.');
  const note = value.trim();
  if (note.length > NOTE_MAX_LENGTH) return invalid(`note must be at most ${NOTE_MAX_LENGTH} characters.`);
  return note.length === 0 ? null : note;
};

const readStake = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100) {
    return invalid('stake must be a number from 0.01 to 100.');
  }
  if (Math.round(value * 100) / 100 !== value) return invalid('stake has at most two decimals.');
  return value;
};

const readParameters = (value: unknown): JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid('parameters must be an object.');
  }
  return value as JsonObject;
};

export type PostOffer = {
  week_start: string; template: string; parameters: JsonObject; side: 'yes' | 'no'; price: number; stake: number;
  walk_away_price: number | null; note: string | null; answers_offer_id: string | null;
};

const POST_KEYS = ['week_start', 'template', 'parameters', 'side', 'price', 'stake', 'walk_away_price', 'note',
  'answers_offer_id'] as const;

/** An offer's shape. The template's parameters and every price rule are the RPC's. */
export const normalizePostOffer = (input: JsonObject): PostOffer => {
  checkKeys(input, POST_KEYS);
  const template = input.template;
  if (typeof template !== 'string' || !TEMPLATES.has(template)) {
    return invalid(`template must be one of ${[...TEMPLATES].join(', ')}.`);
  }
  if (input.side !== 'yes' && input.side !== 'no') return invalid('side must be yes or no.');
  return {
    week_start: readDate(input.week_start, 'week_start'),
    template,
    parameters: readParameters(input.parameters),
    side: input.side,
    price: readWholeNumber(input.price, 'price'),
    stake: readStake(input.stake),
    walk_away_price: readOptionalWholeNumber(input.walk_away_price, 'walk_away_price'),
    note: readNote(input.note),
    answers_offer_id: readOptionalUuid(input.answers_offer_id, 'answers_offer_id'),
  };
};

/** Withdrawing names its offer in the path; the body is empty. */
export const normalizeWithdraw = (input: JsonObject): Record<string, never> => {
  checkKeys(input, []);
  return {};
};

export type CowSchedule = { week_start: string; group_exercise_id: string; metrics: string[] };

/** A CoW pick's shape: one to three distinct metric names. The RPC checks them against the exercise. */
export const normalizeCowSchedule = (input: JsonObject): CowSchedule => {
  checkKeys(input, ['week_start', 'group_exercise_id', 'metrics']);
  const metrics = input.metrics;
  if (!Array.isArray(metrics) || metrics.length < 1 || metrics.length > 3
    || !metrics.every((metric) => typeof metric === 'string' && metric.length >= 1 && metric.length <= 40)
    || new Set(metrics).size !== metrics.length) {
    return invalid('metrics must be one to three distinct metric names.');
  }
  return {
    week_start: readDate(input.week_start, 'week_start'),
    group_exercise_id: readUuid(input.group_exercise_id, 'group_exercise_id'),
    metrics: metrics as string[],
  };
};

const ERROR_TOKEN = /^([A-Z_]+)(?::\s*(.*))?$/s;

const WIRE_ERRORS: Record<string, { status: number; code: string }> = {
  NOT_FOUND: { status: 404, code: 'NOT_FOUND' },
  VALIDATION: { status: 400, code: 'INVALID_ARGUMENT' },
  INVALID_ARGUMENT: { status: 400, code: 'INVALID_ARGUMENT' },
  CONFLICT: { status: 409, code: 'CONFLICT' },
  DUPLICATE: { status: 409, code: 'DUPLICATE' },
  FORBIDDEN: { status: 403, code: 'FORBIDDEN' },
  IDEMPOTENCY_CONFLICT: { status: 409, code: 'IDEMPOTENCY_CONFLICT' },
};

const FALLBACK_MESSAGES: Record<string, string> = {
  NOT_FOUND: 'Group or offer not found.',
  INVALID_ARGUMENT: 'The request could not be accepted.',
  IDEMPOTENCY_CONFLICT: 'This idempotency key was used with a different payload.',
};

/**
 * The wire error for a prediction RPC's message (`TOKEN: reason`), or null for
 * anything else (a database failure the route reports as an internal error).
 * `NOT_FOUND` carries no reason, so a non-member and a group with the setting
 * off look the same.
 */
export const groupPredictionError = (message: string | undefined): GroupPredictionError | null => {
  const match = ERROR_TOKEN.exec((message ?? '').trim());
  const wire = match ? WIRE_ERRORS[match[1]] : undefined;
  if (!match || !wire) return null;
  const reason = match[1] === 'NOT_FOUND' ? '' : (match[2] ?? '').trim();
  return new GroupPredictionError(wire.status, wire.code, reason || FALLBACK_MESSAGES[match[1]] || 'The request was refused.');
};

/** JSON with object keys sorted, so a receipt hash ignores the order a caller wrote them in. */
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);
  const entries = Object.entries(value as JsonObject).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonicalJson(inner)}`).join(',')}}`;
};

/** Notes are for members only: no agent response carries one, whatever a reader returned. */
export const withoutNotes = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutNotes);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value as JsonObject)
    .filter(([key]) => key !== 'note')
    .map(([key, inner]) => [key, withoutNotes(inner)]));
};
