// Decode a comparison's versioned rules; private calculation fields never pass.
import { validateGroupExerciseRules } from './metric-contract.ts';
import type { GroupMetricExerciseWire, GroupMetricRulesWire } from './metric-wire.ts';

export const isMetricRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const PRIVATE_CALCULATION_FIELDS = new Set([
  'body_weight_kg',
  'body_weight_source',
  'body_weight_measurement_id',
  'body_weight_measured_at',
  'body_weight_measured_at_ms',
  'body_weight_dependency_digest',
  'observed_set_pin',
  'reading_pin',
  'current_fingerprint',
  'legacy_certification_id',
  'rule_rescore_baseline',
  'source_rules_only',
]);
const hasPrivateCalculationField = (value: Record<string, unknown>): boolean =>
  Object.keys(value).some(key => PRIVATE_CALCULATION_FIELDS.has(key));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value);
const nullableString = (value: unknown) => value === null || typeof value === 'string';
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
