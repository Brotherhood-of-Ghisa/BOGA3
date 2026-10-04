// Closed protocol-4 schemas prevent cache/history fields from smuggling kg/B.
import { isCompetitionMetric, isCompetitionValue, validateCompetitionRules } from './competition-contract.ts';
import type { CompetitionBoardWire, CompetitionContractWire, CompetitionPerformanceWire,
  CompetitionRulesWire, CompetitionCertificationWire } from './competition-wire.ts';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: unknown, fields: readonly string[]): value is Record<string, unknown> =>
  record(value) && Object.keys(value).length === fields.length && fields.every(field => Object.prototype.hasOwnProperty.call(value,field));
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const nullableString = (value: unknown) => value === null || typeof value === 'string';
const member = (value: unknown) => exact(value, ['user_id','username']) && id(value.user_id) && nullableString(value.username);
const RULES = ['bodyweight_calculations_enabled','bodyweight_contribution','load_input_mode','default_metric','rules_revision'];
const PERFORMANCE = ['visibility','session_id','session_exercise_id','exercise_definition_id','set_id','reps',
  'performance_status','source_load_input_mode','achieved_at_ms','exercise_order_index','set_order_index'];
const CERTIFICATION = ['certification_id','metric','certified_by','certified_at_ms','observed_rules_revision','ended_at_ms','end_reason'];

export function isCompetitionContractWire(value: unknown): value is CompetitionContractWire {
  if (!exact(value, ['contract_version','activation_state','cache_version','metrics','ordinary_units','normalized_units','default_metric'])) return false;
  return value.contract_version === 4 && value.cache_version === 5 && value.default_metric === 'e1rm' &&
    ['pending','active'].includes(String(value.activation_state)) && Array.isArray(value.metrics) &&
    value.metrics.length === 2 && value.metrics[0] === 'volume' && value.metrics[1] === 'e1rm' &&
    exact(value.ordinary_units, ['volume','e1rm']) && value.ordinary_units.volume === 'kg_reps' && value.ordinary_units.e1rm === 'kg' &&
    exact(value.normalized_units, ['volume','e1rm']) && value.normalized_units.volume === 'percent_bw_reps' && value.normalized_units.e1rm === 'percent_bw';
}

export function isCompetitionRulesWire(value: unknown): value is CompetitionRulesWire {
  return exact(value, RULES) && integer(value.rules_revision) && value.rules_revision > 0 &&
    validateCompetitionRules({ name: 'Comparison', loadInputMode: value.load_input_mode,
      bodyweightCalculationsEnabled: value.bodyweight_calculations_enabled,
      bodyweightContribution: value.bodyweight_contribution, defaultMetric: value.default_metric }).ok;
}
export function isCompetitionPerformanceWire(value: unknown, normalized: boolean): value is CompetitionPerformanceWire {
  const fields = normalized ? PERFORMANCE : [...PERFORMANCE, 'weight_value'];
  if (!exact(value, fields) || value.visibility !== (normalized ? 'normalized' : 'ordinary')) return false;
  return ['session_id','session_exercise_id','exercise_definition_id','set_id'].every(field => id(value[field])) &&
    integer(value.reps) && value.reps > 0 && value.performance_status === null &&
    ['total_load','per_side_load'].includes(String(value.source_load_input_mode)) && integer(value.achieved_at_ms) &&
    integer(value.exercise_order_index) && value.exercise_order_index >= 0 &&
    integer(value.set_order_index) && value.set_order_index >= 0 && (normalized || typeof value.weight_value === 'string');
}
export function isCompetitionCertificationWire(value: unknown): value is CompetitionCertificationWire {
  if (!exact(value, CERTIFICATION)) return false;
  return id(value.certification_id) && isCompetitionMetric(value.metric) &&
    (value.certified_by === null || member(value.certified_by)) && integer(value.certified_at_ms) &&
    integer(value.observed_rules_revision) && value.observed_rules_revision > 0 &&
    (value.ended_at_ms === null ? value.end_reason === null : integer(value.ended_at_ms) &&
      value.ended_at_ms >= value.certified_at_ms && ['withdrawn','cancelled','voided'].includes(String(value.end_reason)));
}
function row(value: unknown, board: CompetitionBoardWire, normalized: boolean): boolean {
  if (!exact(value, ['metric','value','unit','rank','member','former','performance','write_token','certification'])) return false;
  const score = { metric: value.metric, value: value.value, unit: value.unit };
  return value.metric === board.metric && isCompetitionValue(score, normalized) && integer(value.rank) && value.rank > 0 &&
    member(value.member) && typeof value.former === 'boolean' && id(value.write_token) &&
    isCompetitionPerformanceWire(value.performance, normalized) &&
    (value.certification === null ? !board.certified : isCompetitionCertificationWire(value.certification) &&
      value.certification.metric === board.metric && value.certification.ended_at_ms === null);
}
export function isCompetitionBoardWire(value: unknown): value is CompetitionBoardWire {
  if (!exact(value, ['contract_version','group_exercise_id','rules','metric','certified','state','entries','entry_count','me','next_cursor']) ||
    value.contract_version !== 4 || !id(value.group_exercise_id) || !isCompetitionRulesWire(value.rules) ||
    !isCompetitionMetric(value.metric) || typeof value.certified !== 'boolean' ||
    !['ready','rebuilding','archived'].includes(String(value.state)) || !Array.isArray(value.entries) ||
    !integer(value.entry_count) || value.entry_count < value.entries.length || !nullableString(value.next_cursor)) return false;
  const board = value as unknown as CompetitionBoardWire;
  const normalized = board.rules.bodyweight_calculations_enabled && board.rules.bodyweight_contribution > 0;
  if (board.state === 'rebuilding') return board.entries.length === 0 && board.entry_count === 0 && board.me === null && board.next_cursor === null;
  return board.entries.every(entry => row(entry, board, normalized)) && (board.me === null || row(board.me, board, normalized));
}
