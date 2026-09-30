import { parseSetWeight } from '../../src/exercise-calculations';
import { validateBodyweightContribution } from '../../src/exercise-core/bodyweight-contribution';
import { isSessionSetType, type SessionSetTypeValue } from '../../src/data/set-types';

export const BOGA_SESSION_IMPORT_SCHEMA_V4 = 'boga.session-import.v4' as const;

export type ImportedSetMeaning = {
  plannedWeightValue: string | null;
  plannedRepsValue: string | null;
  plannedSetType: SessionSetTypeValue;
  performanceStatus: 'planned' | 'unperformed' | null;
};
export type ImportedWeightReading = {
  id: string;
  weightKg: number;
  measuredAt: string;
};
export type ImportedExerciseDefinition = {
  loadInputMode: 'total_load' | 'per_side_load';
  bodyweightContribution: number;
};

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(new Date(value).getTime()) &&
  new Date(value).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'));

export const validateImportedSetMeaning = (value: Record<string, unknown>): boolean => {
  if (value.performanceStatus !== null && value.performanceStatus !== 'planned' && value.performanceStatus !== 'unperformed') return false;
  if (value.plannedSetType !== null && !isSessionSetType(value.plannedSetType)) return false;
  return (value.plannedWeightValue === null || (typeof value.plannedWeightValue === 'string' &&
      (value.plannedWeightValue === '' || parseSetWeight(value.plannedWeightValue) !== null))) &&
    (value.plannedRepsValue === null || typeof value.plannedRepsValue === 'string') &&
    (value.plannedWeightValue !== null || value.plannedRepsValue !== null ||
      (value.plannedSetType === null && value.performanceStatus === null));
};

export const validateImportedWeightReading = (value: unknown): value is ImportedWeightReading => {
  return record(value) && Object.keys(value).every(key => ['id', 'weightKg', 'measuredAt'].includes(key)) &&
    typeof value.id === 'string' && value.id.trim().length > 0 && date(value.measuredAt) &&
    typeof value.weightKg === 'number' && Number.isFinite(value.weightKg) && value.weightKg > 0;
};

export const validateImportedExerciseDefinition = (value: Record<string, unknown>): boolean => {
  if (value.loadInputMode !== 'total_load' && value.loadInputMode !== 'per_side_load') return false;
  return validateBodyweightContribution(value.bodyweightContribution).ok;
};

export const validateImportedWeightText = (value: unknown): value is string =>
  typeof value === 'string' && parseSetWeight(value) !== null;
