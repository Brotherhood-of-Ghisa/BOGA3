import { completeSessionDraft, persistSessionDraftSnapshot, upsertLocalGym } from '@/src/data';
import { getAccountLocalPreferenceState } from '@/src/preferences/account-local';
import { localPeriodWindow } from '@/src/utils/local-calendar';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Today's Progress card with every part drawn: a completed history dated
 * relative to `now`, so the week, the period chart and the latest session are
 * populated whatever day the flow runs.
 *
 * - The previous period: a session every third day from its 2nd, so its dashed
 *   line spans the whole period.
 * - This period: a session every other day from its 1st, up to yesterday, plus
 *   one this morning when `now` is past 09:00, so it runs ahead of the
 *   previous one's pace.
 * - Each session is a bench, squat and row block of three working sets
 *   (nine in all). Bench climbs 2.5 every fourth session and in the latest,
 *   so this week always has PRs: three each time (1RM, Weight and Volume).
 *
 * Written through the session repository, so the facts table derives its PRs
 * exactly as it would for logged sessions.
 */
export const TODAY_PROGRESS_FIXTURE = {
  gymId: 'maestro_today_progress_gym',
  gymName: 'Canal Street Gym',
  workingSetsPerSession: 9,
} as const;

const dayOf = (start: Date, day: number) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + day, 7);

const sessionDays = (now: Date, periodWeeks: number): Date[] => {
  const days: Date[] = [];
  const previous = localPeriodWindow(now, periodWeeks, -1).start;
  for (let day = 1; day < periodWeeks * 7; day += 3) days.push(dayOf(previous, day));
  const current = localPeriodWindow(now, periodWeeks).start;
  const thisMorning = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7);
  for (let day = 0; dayOf(current, day) < thisMorning; day += 2) days.push(dayOf(current, day));
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

export const seedTodayProgressFixture = async ({
  now = new Date(),
  periodWeeks = getAccountLocalPreferenceState().values.targetWindowWeeks,
}: { now?: Date; periodWeeks?: number } = {}) => {
  await upsertLocalGym({ id: TODAY_PROGRESS_FIXTURE.gymId, name: TODAY_PROGRESS_FIXTURE.gymName });

  const days = sessionDays(now, periodWeeks);
  for (const [index, startedAt] of days.entries()) {
    const sessionId = `maestro_today_progress_${index + 1}`;
    const completedAt = new Date(startedAt.getTime() + HOUR_MS);
    const climbs = Math.floor(index / 4) + (index === days.length - 1 ? 1 : 0);
    const benchKg = String(80 + climbs * 2.5);
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
