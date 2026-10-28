import { localDateKey } from '@/src/utils/calendar-weeks';
import {
  collectMuscleSetContributions,
  countedMuscleAnalyticsSessionIds,
  countMuscleSet,
  createMuscleSetCounter,
  type MuscleAnalyticsInput,
  type MuscleSetCounter,
  type ReportedMuscle,
} from './muscle-analytics';

/**
 * Each muscle's working sets per local day ([[muscle.set-count]]), and the
 * days that hold a counted session. `muscles` is every muscle of the input in
 * its order, trained or not; a muscle's day with no sets is absent from `sets`.
 */
export type MuscleDailySets = {
  muscles: ReportedMuscle[];
  /** By muscle id, then local `YYYY-MM-DD` day key. */
  sets: Record<string, Record<string, number>>;
  /** Local day keys of the counted sessions, ascending. */
  sessionDays: string[];
};

export const aggregateMuscleDailySets = (input: MuscleAnalyticsInput): MuscleDailySets => {
  const counters = new Map<string, Map<string, MuscleSetCounter>>();
  for (const contribution of collectMuscleSetContributions(input)) {
    if (!contribution.working) continue;
    const day = localDateKey(contribution.sessionCompletedAt);
    const byDay = counters.get(contribution.muscleGroupId) ?? new Map<string, MuscleSetCounter>();
    counters.set(contribution.muscleGroupId, byDay);
    const counter = byDay.get(day) ?? createMuscleSetCounter();
    byDay.set(day, counter);
    countMuscleSet(counter, contribution);
  }

  const sets: MuscleDailySets['sets'] = {};
  for (const [muscleId, byDay] of counters) {
    const days: Record<string, number> = {};
    for (const [day, counter] of byDay) {
      if (counter.counts.weightedSetCount > 0) days[day] = counter.counts.weightedSetCount;
    }
    sets[muscleId] = days;
  }

  const counted = countedMuscleAnalyticsSessionIds(input);
  const sessionDays = new Set(
    input.sessions.filter((session) => counted.has(session.id)).map((session) => localDateKey(session.completedAt)),
  );
  return { muscles: input.muscleGroups, sets, sessionDays: [...sessionDays].sort() };
};
