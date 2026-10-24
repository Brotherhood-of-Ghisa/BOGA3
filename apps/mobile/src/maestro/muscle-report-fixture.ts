import { completeSessionDraft, persistSessionDraftSnapshot, upsertLocalGym } from '@/src/data';

const MINUTE_MS = 60 * 1000;

/**
 * One session completed half an hour ago, whose exercises reach the entries
 * Broad merges or a user switches off ([[muscle.report-groups]]): Lat Pulldown
 * (Lats primary; Upper back and Biceps secondary), Barbell Back Squat (Quads
 * primary; Glute Max, Adductors and Spinal Erectors secondary) and Standing
 * Calf Raise (Calves), three working sets each. Dated relative to `now`, so it sits in
 * today's Progress period whatever day the flow runs.
 */
export const MUSCLE_REPORT_FIXTURE = {
  gymId: 'maestro_muscle_report_gym',
  gymName: 'Canal Street Gym',
  sessionId: 'maestro_muscle_report_session',
} as const;

const BLOCKS = [
  { block: 'pulldown', exerciseDefinitionId: 'seed_lat_pulldown', name: 'Lat Pulldown', weightValue: '60' },
  { block: 'squat', exerciseDefinitionId: 'seed_barbell_back_squat', name: 'Barbell Back Squat', weightValue: '100' },
  { block: 'calf', exerciseDefinitionId: 'seed_standing_calf_raise', name: 'Standing Calf Raise', weightValue: '80' },
] as const;

export const seedMuscleReportFixture = async ({ now = new Date() }: { now?: Date } = {}) => {
  const { gymId, gymName, sessionId } = MUSCLE_REPORT_FIXTURE;
  await upsertLocalGym({ id: gymId, name: gymName });
  const startedAt = new Date(now.getTime() - 90 * MINUTE_MS);
  const completedAt = new Date(now.getTime() - 30 * MINUTE_MS);
  await persistSessionDraftSnapshot(
    {
      sessionId,
      gymId,
      startedAt,
      exercises: BLOCKS.map(({ block, exerciseDefinitionId, name, weightValue }) => ({
        id: `${sessionId}_${block}`,
        exerciseDefinitionId,
        name,
        sets: Array.from({ length: 3 }, (_, index) => ({
          id: `${sessionId}_${block}_${index + 1}`,
          weightValue,
          repsValue: '8',
          setType: 'rir_2' as const,
          performanceStatus: null,
        })),
      })),
    },
    { now: completedAt },
  );
  await completeSessionDraft(sessionId, { completedAt, now: completedAt });
  return MUSCLE_REPORT_FIXTURE;
};
