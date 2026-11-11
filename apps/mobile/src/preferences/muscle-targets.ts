// Weekly target choices, synced per account (`synced.ts`). Muscle identities and reporting stay with the catalogue.
export type MuscleTargetMode = 'single' | 'per-muscle';
/** One map for every setup: reported muscle id (an entry id, or a combined muscle's key) to its weekly target. */
export type MuscleTargetOverrides = Record<string, number>;
export type MuscleTargetPreferences = {
  weeklyWorkingSetTarget: number;
  muscleTargetMode: MuscleTargetMode;
  muscleTargetOverrides: MuscleTargetOverrides;
};

const EMPTY_TARGETS: Readonly<Record<string, number>> = {};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const isMuscleTargetOverrides = (value: unknown): value is MuscleTargetOverrides =>
  isRecord(value) && Object.entries(value).every(([id, target]) => id.trim().length > 0 && typeof target === 'number' &&
    Number.isSafeInteger(target) && target > 0);

/** Effective override projection for [[muscle.weekly-targets]]. */
export const effectiveMuscleTargetOverrides = (preferences: MuscleTargetPreferences): Readonly<Record<string, number>> =>
  preferences.muscleTargetMode === 'per-muscle' ? preferences.muscleTargetOverrides : EMPTY_TARGETS;

export const muscleWeeklyTarget = (preferences: MuscleTargetPreferences, muscleId: string): number => {
  const targets = effectiveMuscleTargetOverrides(preferences);
  return Object.hasOwn(targets, muscleId) ? targets[muscleId] : preferences.weeklyWorkingSetTarget;
};

/** Immutable single-entry update for [[muscle.weekly-targets]]. */
export const withMuscleTarget = (
  overrides: MuscleTargetOverrides, muscleId: string, target: number | undefined,
): MuscleTargetOverrides => {
  const targets = { ...overrides };
  if (target === undefined) delete targets[muscleId];
  else Object.defineProperty(targets, muscleId, { value: target, enumerable: true, configurable: true, writable: true });
  return targets;
};
