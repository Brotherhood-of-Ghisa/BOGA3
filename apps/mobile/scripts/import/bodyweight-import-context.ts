import { parseSetWeight } from '../../src/exercise-calculations';
import { isWeightUnit, weightToKg, type ExternalLoadMode, type WeightUnit } from '../../src/exercise-calculations/effective-load';
import { validateExerciseLoadRules, type ExerciseLoadRules } from '../../src/exercise-core/load-rules';
import { isSessionSetType, type SessionSetTypeValue } from '../../src/data/set-types';

export const BOGA_SESSION_IMPORT_SCHEMA_V3 = 'boga.session-import.v3' as const;
export const supportsLoadMetadata = (schema: unknown) => schema === BOGA_SESSION_IMPORT_SCHEMA_V2 || schema === BOGA_SESSION_IMPORT_SCHEMA_V3;
export const BOGA_SESSION_IMPORT_SCHEMA_V2 = 'boga.session-import.v2' as const;
export type ImportedSessionWeight = {
  bodyWeightKg: number | null;
  bodyWeightSource: 'reading' | 'manual' | 'historical_estimate' | null;
  bodyWeightMeasurementId: string | null;
  bodyWeightMeasuredAt: string | null;
};
export type ImportedSetMeaning = {
  weightUnit: WeightUnit;
  externalLoadMode: ExternalLoadMode | null;
  plannedWeightValue: string | null;
  plannedWeightUnit: WeightUnit | null;
  plannedExternalLoadMode: ExternalLoadMode | null;
  plannedRepsValue: string | null;
  plannedSetType: SessionSetTypeValue;
  performanceStatus: 'planned' | 'unperformed' | null;
};
export type ImportedWeightReading = {
  id: string;
  weightValue: string;
  weightUnit: WeightUnit;
  weightKg: number;
  measuredAt: string;
};
export type ImportedExerciseRules = { loadInputMode: 'total_load' | 'per_side_load'; loadRules: ExerciseLoadRules };

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(new Date(value).getTime()) &&
  new Date(value).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'));
const mode = (value: unknown) => value === null || value === 'added' || value === 'assistance' || value === 'unquantified_assistance';

export const validateImportedSetMeaning = (value: Record<string, unknown>): boolean => {
  if (!isWeightUnit(value.weightUnit) || !mode(value.externalLoadMode)) return false;
  if (value.performanceStatus !== null && value.performanceStatus !== 'planned' && value.performanceStatus !== 'unperformed') return false;
  if (value.plannedSetType !== null && !isSessionSetType(value.plannedSetType)) return false;
  if (value.plannedWeightValue === null && value.plannedRepsValue === null) {
    return value.plannedWeightUnit === null && value.plannedExternalLoadMode === null && value.plannedSetType === null;
  }
  return (value.plannedWeightValue === null || typeof value.plannedWeightValue === 'string') &&
    (value.plannedRepsValue === null || typeof value.plannedRepsValue === 'string') && mode(value.plannedExternalLoadMode) &&
    (isWeightUnit(value.plannedWeightUnit) || (value.plannedWeightUnit === null && value.plannedExternalLoadMode === null));
};

export const validateImportedWeightReading = (value: unknown): value is ImportedWeightReading => {
  if (!record(value) || typeof value.id !== 'string' || !value.id.trim() || !isWeightUnit(value.weightUnit) || !date(value.measuredAt)) return false;
  if (typeof value.weightValue !== 'string') return false;
  const amount = parseSetWeight(value.weightValue);
  if (amount === null || amount <= 0) return false;
  const kg = weightToKg(amount, value.weightUnit);
  return kg !== null && typeof value.weightKg === 'number' && Number.isFinite(value.weightKg) && value.weightKg > 0 &&
    Math.abs(value.weightKg - kg) <= Number.EPSILON * 16 * Math.max(1, kg);
};

export const validateImportedExerciseRules = (value: Record<string, unknown>): boolean => {
  if (value.loadInputMode !== 'total_load' && value.loadInputMode !== 'per_side_load') return false;
  if (!record(value.loadRules)) return false;
  return validateExerciseLoadRules({ bodyweightCoefficient: value.loadRules.bodyweightCoefficient,
    movementStandard: value.loadRules.movementStandard, loadingMethod: value.loadRules.loadingMethod }).ok;
};

export const importedSetMeaning = (schema: string, value: Partial<ImportedSetMeaning>) =>
  supportsLoadMetadata(schema) ? {
    weightUnit: value.weightUnit!, externalLoadMode: value.externalLoadMode!,
    plannedWeightValue: value.plannedWeightValue!, plannedWeightUnit: value.plannedWeightUnit!,
    plannedExternalLoadMode: value.plannedExternalLoadMode!, plannedRepsValue: value.plannedRepsValue!,
    plannedSetType: value.plannedSetType!, performanceStatus: value.performanceStatus!,
  } : {};
