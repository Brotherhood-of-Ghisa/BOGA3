/** Portable confirmation and final-outcome decisions; no private scoring arithmetic. */
type Scalar = string | number | boolean | null;
export type CompletionEntity = { type: string; id: string; fields: Record<string, Scalar> };
const COMPLETION_TYPES = new Set(['sessions', 'session_exercises', 'exercise_sets', 'exercise_definitions', 'exercise_group_links']);

export const buildCompletionManifest = (entities: readonly CompletionEntity[]): CompletionEntity[] => {
  const keys = new Set<string>();
  const manifest = entities.map(entity => {
    const key = JSON.stringify([entity.type, entity.id]);
    if (!COMPLETION_TYPES.has(entity.type) || !entity.id || entity.id.length > 160 || keys.has(key)) {
      throw new Error('Invalid completion graph identity');
    }
    keys.add(key);
    for (const [name, value] of Object.entries(entity.fields)) {
      if (name === 'id' || name === 'owner_user_id' || name === 'client_updated_at_ms' || name === 'server_received_at' ||
          name.startsWith('local_') || (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) ||
          (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Invalid completion graph fields');
    }
    return { type: entity.type, id: entity.id, fields: { ...entity.fields } };
  });
  const sessions = manifest.filter(entity => entity.type === 'sessions');
  if (sessions.length !== 1 || sessions[0].fields.status !== 'completed' ||
      typeof sessions[0].fields.completed_at !== 'number' || sessions[0].fields.deleted_at !== null) {
    throw new Error('Completion requires one live completed session');
  }
  return manifest.sort((a, b) => a.type === b.type ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : (a.type < b.type ? -1 : 1));
};

export type NotificationRank = { metric: 'volume' | 'e1rm'; certified: boolean; member_user_id: string; rank: number };
const rankKey = (row: NotificationRank): string => JSON.stringify([row.metric, row.certified, row.member_user_id]);
const direction = (before: number | undefined, after: number | undefined): number => {
  if (before === after) return 0;
  if (before === undefined) return 1;
  if (after === undefined) return -1;
  return Math.sign(before - after);
};

export const countWorkoutRankChanges = (
  before: readonly NotificationRank[], final: readonly NotificationRank[], withoutWorkout: readonly NotificationRank[], lifterId: string,
): number => {
  const oldRanks = new Map(before.map(row => [rankKey(row), row.rank]));
  const finalRanks = new Map(final.map(row => [rankKey(row), row.rank]));
  const excludedRanks = new Map(withoutWorkout.map(row => [rankKey(row), row.rank]));
  const members = new Map([...before, ...final].map(row => [rankKey(row), row.member_user_id]));
  let count = 0;
  for (const [key, member] of members) {
    const old = oldRanks.get(key);
    const next = finalRanks.get(key);
    const excluded = excludedRanks.get(key);
    const net = direction(old, next);
    if (!net || net !== direction(excluded, next)) continue;
    // Only this workout's lifter can gain/lose placement because its own scores changed.
    if ((old === undefined || next === undefined) && (member !== lifterId ||
        (old === undefined) !== (excluded === undefined))) continue;
    count += 1;
  }
  return count;
};

export type WorkoutTarget = {
  group_id: string; group_exercise_id: string; best_metrics: string[];
  before: NotificationRank[]; final: NotificationRank[]; without_workout: NotificationRank[];
};
export const workoutContributions = (targets: readonly WorkoutTarget[], lifterId: string): {
  group_id: string; best_count: number; rank_count: number;
}[] => {
  const groups = new Map<string, { bests: Set<string>; ranks: number; targets: Set<string> }>();
  for (const target of targets) {
    const group = groups.get(target.group_id) ?? { bests: new Set<string>(), ranks: 0, targets: new Set<string>() };
    if (group.targets.has(target.group_exercise_id)) throw new Error('Duplicate workout comparison');
    group.targets.add(target.group_exercise_id);
    for (const metric of target.best_metrics) {
      if (metric !== 'volume' && metric !== 'e1rm') throw new Error('Invalid workout metric');
      group.bests.add(JSON.stringify([target.group_exercise_id, metric]));
    }
    group.ranks += countWorkoutRankChanges(target.before, target.final, target.without_workout, lifterId);
    groups.set(target.group_id, group);
  }
  return [...groups].map(([group_id, group]) => ({ group_id, best_count: group.bests.size, rank_count: group.ranks }));
};
