// Decode the version/unit boundary before a metric payload reaches UI or cache.
import { isGroupMetric, isGroupMetricValue, validateGroupExerciseRules, type GroupMetricValue } from './metric-contract.ts';
import type {
  GroupMetricBoardWire, GroupMetricCertificationWire, GroupMetricExerciseWire,
  GroupMetricPodiumWire, GroupMetricRulesWire, GroupPerformanceSnapshotWire, GroupMetricRevisionWire,
} from './metric-wire.ts';

export const isMetricRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const PRIVATE_CALCULATION_FIELDS = new Set([
  'body_weight_kg',
  'body_weight_source',
  'body_weight_measurement_id',
  'body_weight_measured_at',
  'body_weight_measured_at_ms',
  'body_weight_dependency_digest',
]);
const hasPrivateCalculationField = (value: Record<string, unknown>): boolean =>
  Object.keys(value).some(key => PRIVATE_CALCULATION_FIELDS.has(key));
const PERFORMANCE_FIELDS = new Set([
  'session_id', 'session_exercise_id', 'exercise_definition_id', 'set_id',
  'weight_value', 'reps_value', 'reps', 'performance_status',
  'source_load_input_mode', 'achieved_at_ms', 'exercise_order_index', 'set_order_index',
]);
const metricValueRecord = (value: unknown): value is GroupMetricValue & Record<string, unknown> =>
  isMetricRecord(value) && !hasPrivateCalculationField(value) && isGroupMetricValue(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value);
const nullableString = (value: unknown) => value === null || typeof value === 'string';
const member = (value: unknown) => isMetricRecord(value) && typeof value.user_id === 'string' && nullableString(value.username);
const nullableFinite = (value: unknown) => value === null || finite(value);

export function isGroupMetricRulesWire(value: unknown): value is GroupMetricRulesWire & Record<string, unknown> {
  if (!isMetricRecord(value) || hasPrivateCalculationField(value) ||
    !integer(value.rules_revision) || value.rules_revision < 1) return false;
  return validateGroupExerciseRules({ name: typeof value.name === 'string' ? value.name : 'Comparison',
    loadInputMode: value.load_input_mode, bodyweightCalculationsEnabled: value.bodyweight_calculations_enabled,
    bodyweightContribution: value.bodyweight_contribution,
    defaultMetric: value.default_metric }).ok;
}
export function isGroupMetricExerciseWire(value: unknown): value is GroupMetricExerciseWire {
  if (!isMetricRecord(value) || !isGroupMetricRulesWire(value)) return false;
  return typeof value.group_exercise_id === 'string' && typeof value.name === 'string' &&
    nullableString(value.source_exercise_id) && nullableFinite(value.archived_at_ms) &&
    (value.published_revision === null || (integer(value.published_revision) && value.published_revision > 0 &&
      value.published_revision <= value.rules_revision)) &&
    typeof value.rebuilding === 'boolean' && typeof value.legacy === 'boolean';
}
export function isGroupPerformanceWire(value: unknown): value is GroupPerformanceSnapshotWire {
  if (!isMetricRecord(value)) return false;
  if (Object.keys(value).some(key => !PERFORMANCE_FIELDS.has(key))) return false;
  if (!['session_id','session_exercise_id','exercise_definition_id','set_id','weight_value','reps_value']
    .every(key => typeof value[key] === 'string') || !integer(value.reps) || value.reps < 1 ||
    !integer(value.achieved_at_ms) || !integer(value.exercise_order_index) || !integer(value.set_order_index) ||
    !nullableString(value.performance_status) ||
    !['total_load','per_side_load'].includes(String(value.source_load_input_mode))) return false;
  return true;
}
const isRow = (value: unknown, metric: unknown, revision: unknown) =>
  metricValueRecord(value) && value.metric === metric && value.rules_revision === revision &&
  integer(value.rank) && value.rank > 0 && member(value.member) && typeof value.former === 'boolean' &&
  integer(value.achieved_at_ms) && typeof value.set_id === 'string' && isGroupPerformanceWire(value.performance) &&
  value.performance.set_id === value.set_id && value.performance.achieved_at_ms === value.achieved_at_ms &&
  value.performance.performance_status === null &&
  typeof value.fingerprint === 'string' && value.fingerprint.length > 0 &&
  typeof value.certified === 'boolean' && nullableString(value.certification_id) &&
  value.certified === (value.certification_id !== null);

export function isGroupMetricBoardWire(value: unknown): value is GroupMetricBoardWire {
  if (!isMetricRecord(value) || value.contract_version !== 3 || !isGroupMetricExerciseWire(value.exercise) ||
    !isGroupMetric(value.metric) || typeof value.certified !== 'boolean' ||
    value.exercise.legacy || value.rules_revision !== value.exercise.rules_revision ||
    !['ready','rebuilding','archived'].includes(String(value.state)) || !Array.isArray(value.entries) ||
    !integer(value.entry_count) || value.entry_count < 0 || !nullableString(value.next_cursor)) return false;
  return value.entries.length <= value.entry_count &&
    value.entries.every(row => isRow(row,value.metric,value.rules_revision) && (!value.certified || row.certified)) &&
    (value.me === null || (isRow(value.me,value.metric,value.rules_revision) && (!value.certified || (isMetricRecord(value.me) && value.me.certified === true)))) &&
    (value.state !== 'rebuilding' || (value.entries.length === 0 && value.me === null && value.entry_count === 0 && value.next_cursor === null)) &&
    (value.state === 'rebuilding') === value.exercise.rebuilding;
}
export function isGroupMetricPodiumWire(value: unknown): value is GroupMetricPodiumWire {
  if (!isMetricRecord(value) || value.contract_version !== 3 || !Array.isArray(value.exercises)) return false;
  return value.exercises.every(card => {
    if (!isMetricRecord(card) || !isGroupMetricExerciseWire(card.exercise)) return false;
    if (card.legacy === true) return card.exercise.legacy && isMetricRecord(card.board) && Array.isArray(card.board.podium);
    return card.legacy === false && !card.exercise.legacy && isGroupMetricBoardWire({
      ...card, contract_version: 3, entries: card.podium, next_cursor: null,
    }) && integer(card.all_entry_count) && card.all_entry_count >= 0;
  });
}
export function isGroupMetricCertificationWire(value: unknown): value is GroupMetricCertificationWire {
  if (!metricValueRecord(value)) return false;
  return typeof value.certification_id === 'string' && integer(value.rules_revision) && value.rules_revision > 0 &&
    (value.certified_by === null || member(value.certified_by)) && integer(value.certified_at_ms) &&
    isGroupPerformanceWire(value.performance) &&
    (value.ended_at_ms === null ? value.end_reason === null : integer(value.ended_at_ms) &&
      ['withdrawn','cancelled','voided'].includes(String(value.end_reason)));
}

export function isGroupMetricRevisionWire(value: unknown): value is GroupMetricRevisionWire & Record<string, unknown> {
  if (!isMetricRecord(value) || !isGroupMetricRulesWire(value.rules)) return false;
  const rules = value.rules;
  return typeof value.legacy === 'boolean' &&
    nullableFinite(value.published_at_ms) && nullableFinite(value.retired_at_ms) &&
    ['initial','activation','rules_change'].includes(String(value.reason)) &&
    (value.legacy_entries === undefined || value.legacy_entries === null ||
      (Array.isArray(value.legacy_entries) && value.legacy_entries.every(entry =>
        isMetricRecord(entry) && entry.unit === 'kg' && ['weight','e1rm'].includes(String(entry.metric)) &&
        finite(entry.value_kg) && entry.value_kg > 0 && entry.rules_revision === rules.rules_revision && member(entry.member))));
}
const isHolder = (value: unknown, metric: unknown, revision: unknown) =>
  value === null || (metricValueRecord(value) && value.metric === metric && value.rules_revision === revision &&
    member(value.member) && typeof value.former === 'boolean' && integer(value.achieved_at_ms) && typeof value.set_id === 'string');
const isEventBase = (value: Record<string, unknown>) => typeof value.event_id === 'string' && integer(value.sequence) &&
  integer(value.sort_at_ms) && typeof value.group_exercise_id === 'string' &&
  integer(value.rules_revision) && value.rules_revision > 0 && (value.member === null || member(value.member));

export function isGroupMetricHistoryWire(value: unknown): boolean {
  if (!isMetricRecord(value) || value.contract_version !== 3 || !isGroupMetricExerciseWire(value.exercise) ||
    !isGroupMetricRevisionWire(value.revision) || !isGroupMetric(value.metric) ||
    typeof value.certified !== 'boolean' || !nullableString(value.next_cursor) || !Array.isArray(value.events)) return false;
  const revision = value.revision;
  const exercise = value.exercise;
  if (revision.rules.rules_revision !== value.exercise.rules_revision || revision.legacy !== value.exercise.legacy) return false;
  return value.events.every(event => {
    if (!isMetricRecord(event) || typeof event.event_id !== 'string' || !integer(event.sequence) || !integer(event.sort_at_ms)) return false;
    if (event.legacy === true) return revision.legacy && event.unit === 'kg' && event.metric === value.metric &&
      ['weight','e1rm'].includes(String(event.metric)) && isMetricRecord(event.payload);
    if (revision.legacy || !isEventBase(event) || event.rules_revision !== revision.rules.rules_revision ||
      event.group_exercise_id !== exercise.group_exercise_id) return false;
    if (event.kind === 'rules_change') return isGroupMetricRulesWire(event.rules) &&
      event.rules.rules_revision === event.rules_revision && integer(event.previous_revision) && event.previous_revision < event.rules_revision;
    return event.kind === 'lead_change' && event.metric === value.metric && event.certified === value.certified &&
      ['record','void','link','certification'].includes(String(event.reason)) &&
      [event.leader,event.previous].every(holder => isHolder(holder,value.metric,event.rules_revision));
  });
}

const streamKinds = ['session','membership','record','record_voided','link','rules_change'];
export function isGroupMetricStreamCursor(value: unknown): boolean {
  return value === null || (isMetricRecord(value) && integer(value.sort_at_ms) &&
    typeof value.kind === 'string' && value.kind.length > 0 && typeof value.key === 'string' && value.key.length > 0);
}
/** Unknown future kinds are removed by the API while retaining the server cursor. */
const isRecordContext = (value: unknown, event: Record<string, unknown>): boolean => {
  if (value === undefined) return true; // Old cache: never enables an attestation write.
  if (!isMetricRecord(value) || !isGroupMetricExerciseWire(value.exercise) || value.exercise.legacy ||
    value.exercise.group_exercise_id !== event.group_exercise_id || value.exercise.rules_revision < Number(event.rules_revision) ||
    typeof value.former !== 'boolean' || !Array.isArray(value.metrics) || !Array.isArray(event.boards) || value.metrics.length !== event.boards.length) return false;
  const seen = new Set<string>();
  return value.metrics.every(context => {
    if (!isMetricRecord(context) || !isGroupMetric(context.metric) || seen.has(context.metric)) return false;
    seen.add(context.metric);
    const board = (event.boards as unknown[]).find(item => isMetricRecord(item) && item.metric === context.metric);
    return isMetricRecord(board) && board.fingerprint === context.fingerprint && typeof context.eligible === 'boolean' &&
      (!context.eligible || (isGroupMetricExerciseWire(value.exercise) && !value.former && !event.voided &&
        value.exercise.archived_at_ms === null && !value.exercise.rebuilding && value.exercise.rules_revision === event.rules_revision)) &&
      (context.certification === null || (isGroupMetricCertificationWire(context.certification) &&
        context.certification.metric === context.metric && context.certification.performance.set_id === event.set_id &&
        context.certification.ended_at_ms === null));
  });
};

type WireRecord = Record<string, unknown>;

const hasStreamEnvelope = (value: unknown): value is WireRecord =>
  isMetricRecord(value) && typeof value.key === 'string' && integer(value.sort_at_ms);
const hasGroupRef = (value: WireRecord) =>
  isMetricRecord(value.group) && typeof value.group.group_id === 'string' && typeof value.group.name === 'string';
const hasGroupExerciseRef = (value: WireRecord) =>
  isMetricRecord(value.group_exercise) && typeof value.group_exercise.group_exercise_id === 'string';
const isStringArray = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string');

const isSessionItem = (value: WireRecord) =>
  member(value.member) && typeof value.session_id === 'string' && Array.isArray(value.groups) && Array.isArray(value.exercises);
const isMembershipItem = (value: WireRecord) =>
  member(value.member) && ['joined','left','removed'].includes(String(value.event));

/** Original kg-only items: only their kind, revision and (for records) positive kg boards are checked. */
const isLegacyBoard = (board: unknown) =>
  isMetricRecord(board) && ['weight','e1rm'].includes(String(board.metric)) && finite(board.value_kg) && board.value_kg > 0;
const isLegacyItem = (value: WireRecord) =>
  integer(value.rules_revision) && ['record','record_voided','link'].includes(String(value.kind)) &&
  (value.kind !== 'record' || (Array.isArray(value.boards) && value.boards.every(isLegacyBoard)));

type MetricEventRecord = WireRecord & { rules_revision: number };

/** A metric event carries its exercise's current rules at the event's revision. */
const hasMetricEventEnvelope = (value: WireRecord): value is MetricEventRecord =>
  value.metric_event === true && isEventBase(value) && isGroupMetricRulesWire(value.group_exercise) &&
  value.group_exercise.rules_revision === value.rules_revision &&
  value.group_exercise.group_exercise_id === value.group_exercise_id;

/** The performance snapshot is the event's own set in the event's own session. */
const hasOwnPerformance = (value: WireRecord) =>
  isGroupPerformanceWire(value.performance) &&
  value.performance.set_id === value.set_id && value.performance.session_id === value.session_id;
const isRecordBoard = (board: unknown) =>
  metricValueRecord(board) && nullableFinite(board.previous_value) &&
  typeof board.group_record === 'boolean' && typeof board.fingerprint === 'string';
const isRecordEvent = (value: MetricEventRecord) =>
  member(value.member) && isRecordContext(value.record_context, value) &&
  typeof value.session_id === 'string' && typeof value.set_id === 'string' &&
  typeof value.provisional === 'boolean' && typeof value.voided === 'boolean' && hasOwnPerformance(value) &&
  Array.isArray(value.boards) && value.boards.length > 0 && value.boards.every(isRecordBoard);

const isLeaderEntry = (entry: unknown, revision: unknown) =>
  isMetricRecord(entry) && isGroupMetric(entry.metric) && isHolder(entry.leader, entry.metric, revision);
const isRecordVoidedEvent = (value: MetricEventRecord) =>
  typeof value.related_event_id === 'string' && ['deleted','edited'].includes(String(value.reason)) &&
  isGroupPerformanceWire(value.performance) &&
  Array.isArray(value.leaders) && value.leaders.every(entry => isLeaderEntry(entry, value.rules_revision));

/** A board rank before or after a link change; null when the member had none. */
const isRankAt = (rank: unknown, metric: unknown, revision: unknown) =>
  rank === null || (metricValueRecord(rank) && rank.metric === metric && rank.rules_revision === revision &&
    integer(rank.rank) && rank.rank > 0);
const isLinkEffect = (effect: unknown, revision: unknown) =>
  isMetricRecord(effect) && isGroupMetric(effect.metric) &&
  isRankAt(effect.before, effect.metric, revision) && isRankAt(effect.after, effect.metric, revision);
const isLinkEvent = (value: MetricEventRecord) =>
  ['link','unlink'].includes(String(value.event)) && isStringArray(value.exercise_definition_ids) &&
  Array.isArray(value.effects) && value.effects.every(effect => isLinkEffect(effect, value.rules_revision));

const isRulesChangeEvent = (value: MetricEventRecord) =>
  integer(value.previous_revision) && value.previous_revision < value.rules_revision &&
  isGroupMetricRulesWire(value.rules) && value.rules.rules_revision === value.rules_revision;

/** A Map, so an inherited name such as `toString` is never a kind. */
const METRIC_EVENT_GUARDS = new Map<string, (value: MetricEventRecord) => boolean>([
  ['record', isRecordEvent],
  ['record_voided', isRecordVoidedEvent],
  ['link', isLinkEvent],
  ['rules_change', isRulesChangeEvent],
]);

/** Checks are layered: envelope, then group, then group exercise, then the legacy or metric-event payload. */
export function isGroupMetricStreamItem(value: unknown): boolean {
  if (!hasStreamEnvelope(value)) return false;
  if (value.kind === 'session') return isSessionItem(value);
  if (!hasGroupRef(value)) return false;
  if (value.kind === 'membership') return isMembershipItem(value);
  if (!hasGroupExerciseRef(value)) return false;
  if (value.legacy === true) return isLegacyItem(value);
  if (!hasMetricEventEnvelope(value)) return false;
  const guard = typeof value.kind === 'string' ? METRIC_EVENT_GUARDS.get(value.kind) : undefined;
  return guard !== undefined && guard(value);
}
export const isRenderedGroupMetricStreamKind = (kind: unknown) => streamKinds.includes(String(kind));
