export const DEFAULT_WEEKLY_MUSCLE_TARGET = 8;
export type MuscleTargets = Readonly<Record<string, number>>;

export const muscleTargetAttainment = (count: number, weeklyTarget: number, weeks = 1): number =>
  Math.min(1, Math.max(0, count / weeklyTarget / weeks));

/** Each muscle is capped before averaging; muscles with no sets still count. */
export const groupedTargetAttainment = (
  muscleIds: readonly string[], counts: Readonly<Record<string, number>>, targets: MuscleTargets, weeks = 1,
): number => muscleIds.length === 0 ? 0 : muscleIds.reduce((total, id) =>
  total + muscleTargetAttainment(counts[id] ?? 0, targets[id] ?? DEFAULT_WEEKLY_MUSCLE_TARGET, weeks), 0) / muscleIds.length;
