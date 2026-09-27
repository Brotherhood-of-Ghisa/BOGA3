// Decode the version/unit boundary before a metric payload reaches UI or cache.
import { isGroupMetric, isGroupMetricValue, validateGroupExerciseRules, type GroupMetricValue } from './metric-contract.ts';
import type {
  GroupMetricBoardWire, GroupMetricCertificationWire, GroupMetricExerciseWire,
  GroupMetricPodiumWire, GroupMetricRulesWire, GroupPerformanceSnapshotWire, GroupMetricRevisionWire,
} from './metric-wire.ts';

export const isMetricRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const metricValueRecord = (value: unknown): value is GroupMetricValue & Record<string, unknown> =>
  isMetricRecord(value) && isGroupMetricValue(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value);
const nullableString = (value: unknown) => value === null || typeof value === 'string';
const member = (value: unknown) => isMetricRecord(value) && typeof value.user_id === 'string' && nullableString(value.username);
const nullableFinite = (value: unknown) => value === null || finite(value);

export function isGroupMetricRulesWire(value: unknown): value is GroupMetricRulesWire & Record<string, unknown> {
  if (!isMetricRecord(value) || !integer(value.rules_revision) || value.rules_revision < 1) return false;
  return validateGroupExerciseRules({ name: typeof value.name === 'string' ? value.name : 'Comparison',
    loadInputMode: value.load_input_mode, bodyweightCoefficient: value.bodyweight_coefficient,
    movementStandard: value.movement_standard, loadingMethod: value.loading_method,
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
  if (!['session_id','session_exercise_id','exercise_definition_id','set_id','weight_value','reps_value']
    .every(key => typeof value[key] === 'string') || !integer(value.reps) || value.reps < 1 ||
    !integer(value.achieved_at_ms) || !integer(value.exercise_order_index) || !integer(value.set_order_index) ||
    !nullableString(value.performance_status) || !nullableString(value.movement_standard) || !nullableString(value.loading_method) ||
    !['kg','lb'].includes(String(value.weight_unit)) ||
    ![null,'added','assistance','unquantified_assistance'].includes(value.external_load_mode as string | null) ||
    !['total_load','per_side_load'].includes(String(value.source_load_input_mode))) return false;
  const empty = [value.body_weight_kg,value.body_weight_source,value.body_weight_measurement_id,value.body_weight_measured_at_ms]
    .every(field => field === null);
  if (value.body_weight_status === 'missing' || value.body_weight_status === 'invalid') return empty;
  // Historical record/certification evidence retains its original provenance.
  // This decoder only displays server scores; live scoring accepts dated readings.
  if (value.body_weight_status !== 'known' || !finite(value.body_weight_kg) || value.body_weight_kg <= 0) return false;
  if (value.body_weight_source === 'manual') return value.body_weight_measurement_id === null && value.body_weight_measured_at_ms === null;
  return ['reading', 'historical_estimate'].includes(String(value.body_weight_source)) &&
    typeof value.body_weight_measurement_id === 'string' && value.body_weight_measurement_id.trim().length > 0 &&
    integer(value.body_weight_measured_at_ms) && Number.isFinite(new Date(value.body_weight_measured_at_ms).getTime());
}
const isRow = (value: unknown, metric: unknown, revision: unknown) =>
  metricValueRecord(value) && value.metric === metric && value.rules_revision === revision &&
  integer(value.rank) && value.rank > 0 && member(value.member) && typeof value.former === 'boolean' &&
  integer(value.achieved_at_ms) && typeof value.set_id === 'string' && isGroupPerformanceWire(value.performance) &&
  value.performance.set_id === value.set_id && value.performance.achieved_at_ms === value.achieved_at_ms &&
  value.performance.performance_status === null &&
  (!['relative_strength','absolute_strength'].includes(String(metric)) || value.performance.body_weight_status === 'known') &&
  nullableFinite(value.effective_resistance_kg) && nullableFinite(value.external_adjustment_kg) &&
  nullableFinite(value.added_percent_bodyweight) && typeof value.fingerprint === 'string' && value.fingerprint.length > 0 &&
  typeof value.certified === 'boolean' && nullableString(value.certification_id) &&
  value.certified === (value.certification_id !== null);

export function isGroupMetricBoardWire(value: unknown): value is GroupMetricBoardWire {
  if (!isMetricRecord(value) || value.contract_version !== 2 || !isGroupMetricExerciseWire(value.exercise) ||
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
  if (!isMetricRecord(value) || value.contract_version !== 2 || !Array.isArray(value.exercises)) return false;
  return value.exercises.every(card => {
    if (!isMetricRecord(card) || !isGroupMetricExerciseWire(card.exercise)) return false;
    if (card.legacy === true) return card.exercise.legacy && isMetricRecord(card.board) && Array.isArray(card.board.podium);
    return card.legacy === false && !card.exercise.legacy && isGroupMetricBoardWire({
      ...card, contract_version: 2, entries: card.podium, next_cursor: null,
    }) && integer(card.all_entry_count) && card.all_entry_count >= 0;
  });
}
export function isGroupMetricCertificationWire(value: unknown): value is GroupMetricCertificationWire {
  if (!metricValueRecord(value)) return false;
  return typeof value.certification_id === 'string' && integer(value.rules_revision) && value.rules_revision > 0 &&
    (value.certified_by === null || member(value.certified_by)) && integer(value.certified_at_ms) &&
    isGroupPerformanceWire(value.performance) &&
    (!['relative_strength','absolute_strength'].includes(value.metric) || value.performance.body_weight_status === 'known') &&
    value.includes_body_weight === ['absolute_strength','relative_strength'].includes(value.metric) &&
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
  if (!isMetricRecord(value) || value.contract_version !== 2 || !isGroupMetricExerciseWire(value.exercise) ||
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
      nullableFinite(context.effective_resistance_kg) && nullableFinite(context.external_adjustment_kg) &&
      nullableFinite(context.added_percent_bodyweight) &&
      (!context.eligible || (isGroupMetricExerciseWire(value.exercise) && !value.former && !event.voided &&
        value.exercise.archived_at_ms === null && !value.exercise.rebuilding && value.exercise.rules_revision === event.rules_revision)) &&
      (context.certification === null || (isGroupMetricCertificationWire(context.certification) &&
        context.certification.metric === context.metric && context.certification.performance.set_id === event.set_id &&
        context.certification.ended_at_ms === null));
  });
};

export function isGroupMetricStreamItem(value: unknown): boolean {
  if (!isMetricRecord(value) || typeof value.key !== 'string' || !integer(value.sort_at_ms)) return false;
  if (value.kind === 'session') return member(value.member) && typeof value.session_id === 'string' &&
    Array.isArray(value.groups) && Array.isArray(value.exercises);
  if (!isMetricRecord(value.group) || typeof value.group.group_id !== 'string' || typeof value.group.name !== 'string') return false;
  if (value.kind === 'membership') return member(value.member) && ['joined','left','removed'].includes(String(value.event));
  if (!isMetricRecord(value.group_exercise) || typeof value.group_exercise.group_exercise_id !== 'string') return false;
  if (value.legacy === true) return integer(value.rules_revision) && ['record','record_voided','link'].includes(String(value.kind)) &&
    (value.kind !== 'record' || (Array.isArray(value.boards) && value.boards.every(board =>
      isMetricRecord(board) && ['weight','e1rm'].includes(String(board.metric)) && finite(board.value_kg) && board.value_kg > 0)));
  if (value.metric_event !== true || !isEventBase(value) || !isGroupMetricRulesWire(value.group_exercise) ||
    value.group_exercise.rules_revision !== value.rules_revision ||
    value.group_exercise.group_exercise_id !== value.group_exercise_id) return false;
  switch (value.kind) {
    case 'record': return member(value.member) && isRecordContext(value.record_context, value) && typeof value.session_id === 'string' && typeof value.set_id === 'string' &&
      typeof value.provisional === 'boolean' && typeof value.voided === 'boolean' && isGroupPerformanceWire(value.performance) &&
      value.performance.set_id === value.set_id && value.performance.session_id === value.session_id &&
      Array.isArray(value.boards) && value.boards.length > 0 && value.boards.every(board => metricValueRecord(board) &&
        nullableFinite(board.previous_value) && typeof board.group_record === 'boolean' && typeof board.fingerprint === 'string');
    case 'record_voided': return typeof value.related_event_id === 'string' && ['deleted','edited'].includes(String(value.reason)) &&
      isGroupPerformanceWire(value.performance) && Array.isArray(value.leaders) && value.leaders.every(entry =>
        isMetricRecord(entry) && isGroupMetric(entry.metric) && isHolder(entry.leader,entry.metric,value.rules_revision));
    case 'link': return ['link','unlink'].includes(String(value.event)) && Array.isArray(value.exercise_definition_ids) &&
      value.exercise_definition_ids.every(id => typeof id === 'string') && Array.isArray(value.effects) && value.effects.every(effect =>
        isMetricRecord(effect) && isGroupMetric(effect.metric) && [effect.before,effect.after].every(rank => rank === null ||
          (metricValueRecord(rank) && rank.metric === effect.metric && rank.rules_revision === value.rules_revision && integer(rank.rank) && rank.rank > 0)));
    case 'rules_change': return integer(value.previous_revision) && value.previous_revision < value.rules_revision &&
      isGroupMetricRulesWire(value.rules) && value.rules.rules_revision === value.rules_revision;
    default: return false;
  }
}
export const isRenderedGroupMetricStreamKind = (kind: unknown) => streamKinds.includes(String(kind));
