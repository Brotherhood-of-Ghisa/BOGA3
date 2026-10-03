import { completeSessionDraft, persistSessionDraftSnapshot, upsertLocalGym } from '@/src/data';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Today's Progress card with every part drawn: a completed history dated
 * relative to `now`, so the week, the month chart and the latest session are
 * populated whatever day the flow runs.
 *
 * - The previous month: a session every third day from the 2nd, so its dashed
 *   line spans the whole month.
 * - This month: a session every other day from the 1st, up to yesterday, plus
 *   one this morning when `now` is past 09:00, so the month runs ahead of the
 *   previous one's pace.
 * - Each session is a bench, squat and row block of three working sets
 *   (nine in all). Bench climbs 2.5 every fourth session, a PR each time.
 *
 * Written through the session repository, so the facts table derives its PRs
 * exactly as it would for logged sessions.
 */
export const TODAY_PROGRESS_FIXTURE = {
  gymId: 'maestro_today_progress_gym',
  gymName: 'Canal Street Gym',
  workingSetsPerSession: 9,
} as const;

const sessionDays = (now: Date): Date[] => {
  const days: Date[] = [];
  const previousMonthDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  for (let day = 2; day <= previousMonthDays; day += 3) {
    days.push(new Date(now.getFullYear(), now.getMonth() - 1, day, 7));
  }
  for (let day = 1; day < now.getDate(); day += 2) {
    days.push(new Date(now.getFullYear(), now.getMonth(), day, 7));
  }
  const thisMorning = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7);
  if (now.getTime() - thisMorning.getTime() >= 2 * HOUR_MS) days.push(thisMorning);
  return days;
};

const workingSets = (sessionId: string, block: string, weightValue: string) =>
  Array.from({ length: 3 }, (_, index) => ({
    id: `${sessionId}_${block}_${index + 1}`,
    weightValue,
    repsValue: '5',
    setType: 'rir_2' as const,
    performanceStatus: null,
  }));

export const seedTodayProgressFixture = async ({ now = new Date() }: { now?: Date } = {}) => {
  await upsertLocalGym({ id: TODAY_PROGRESS_FIXTURE.gymId, name: TODAY_PROGRESS_FIXTURE.gymName });

  const days = sessionDays(now);
  for (const [index, startedAt] of days.entries()) {
    const sessionId = `maestro_today_progress_${index + 1}`;
    const completedAt = new Date(startedAt.getTime() + HOUR_MS);
    const benchKg = String(80 + Math.floor(index / 4) * 2.5);
    await persistSessionDraftSnapshot(
      {
        sessionId,
        gymId: TODAY_PROGRESS_FIXTURE.gymId,
        startedAt,
        exercises: [
          { id: `${sessionId}_bench`, exerciseDefinitionId: 'seed_barbell_bench_press', name: 'Barbell Bench Press', sets: workingSets(sessionId, 'bench', benchKg) },
          { id: `${sessionId}_squat`, exerciseDefinitionId: 'seed_barbell_back_squat', name: 'Barbell Back Squat', sets: workingSets(sessionId, 'squat', '100') },
          { id: `${sessionId}_row`, exerciseDefinitionId: 'seed_barbell_bent_over_row', name: 'Barbell Bent Over Row', sets: workingSets(sessionId, 'row', '70') },
        ],
      },
      { now: completedAt },
    );
    await completeSessionDraft(sessionId, { completedAt, now: completedAt });
  }

  return { ...TODAY_PROGRESS_FIXTURE, sessionCount: days.length };
};
