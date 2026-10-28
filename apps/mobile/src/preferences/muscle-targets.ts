// Weekly target choices, synced per account (`synced.ts`). Muscle identities and reporting stay with the catalogue.
export type MuscleTargetMode = 'single' | 'per-muscle';
export type MuscleTargetScope = 'detailed' | 'broad' | 'custom';
export type MuscleTargetOverrides = Partial<Record<MuscleTargetScope, Record<string, number>>>;
export type MuscleTargetPreferences = {
  weeklyWorkingSetTarget: number;
  muscleTargetMode: MuscleTargetMode;
  muscleTargetOverrides: MuscleTargetOverrides;
};

const EMPTY_TARGETS: Readonly<Record<string, number>> = {};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const isMuscleTargetOverrides = (value: unknown): value is MuscleTargetOverrides =>
  isRecord(value) && Object.entries(value).every(([scope, targets]) =>
    ['detailed', 'broad', 'custom'].includes(scope) && isRecord(targets) &&
    Object.entries(targets).every(([id, target]) => id.trim().length > 0 && typeof target === 'number' &&
      Number.isSafeInteger(target) && target > 0));

/** Effective override projection for [[muscle.weekly-targets]]. */
export const effectiveMuscleTargetOverrides = (
  preferences: MuscleTargetPreferences, scope: MuscleTargetScope,
): Readonly<Record<string, number>> =>
  preferences.muscleTargetMode === 'per-muscle' ? preferences.muscleTargetOverrides[scope] ?? EMPTY_TARGETS : EMPTY_TARGETS;

export const muscleWeeklyTarget = (
  preferences: MuscleTargetPreferences, scope: MuscleTargetScope, muscleId: string,
): number => {
  const targets = effectiveMuscleTargetOverrides(preferences, scope);
  return Object.hasOwn(targets, muscleId) ? targets[muscleId] : preferences.weeklyWorkingSetTarget;
};

/** Immutable single-entry update for [[muscle.weekly-targets]]. */
export const withMuscleTarget = (
  overrides: MuscleTargetOverrides, scope: MuscleTargetScope, muscleId: string, target: number | undefined,
): MuscleTargetOverrides => {
  const targets = { ...overrides[scope] };
  if (target === undefined) delete targets[muscleId];
  else Object.defineProperty(targets, muscleId, { value: target, enumerable: true, configurable: true, writable: true });
  return { ...overrides, [scope]: targets };
};
