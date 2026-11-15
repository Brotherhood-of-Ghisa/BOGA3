import {
  computeAllTissueReloadMetrics,
  computeCurrentWeeklyLoad,
  computePreInjuryBaseline,
  computeTissueReloadMetrics,
  evaluateCautionAlert,
  getPreInjuryBaselineWindow,
  isContributionMatchingInjury,
  RELOAD_BASELINE_WINDOW_DAYS,
  RELOAD_SPIKE_MULTIPLIER,
  RELOAD_VOLUME_FLOOR,
} from '@/src/injuries/tissue-reload';
import type { InjuryView } from '@/src/data/injuries';
import type { MuscleSetContribution } from '@/src/data/muscle-analytics';

const makeContribution = (
  overrides: Partial<MuscleSetContribution> & { completedAt: Date; muscleGroupId: string }
): MuscleSetContribution => ({
  setIdentity: overrides.setIdentity ?? `set-${Math.random().toString(36).slice(2)}`,
  muscleGroupId: overrides.muscleGroupId,
  role: overrides.role ?? 'primary',
  roleWeight: overrides.roleWeight ?? 1,
  working: overrides.working ?? true,
  rehab: overrides.rehab ?? false,
  volumeIncluded: overrides.volumeIncluded ?? true,
  weightedVolume: overrides.weightedVolume ?? 500,
  setVolume: overrides.setVolume ?? 500,
  metrics: {
    eligible: true,
    reps: 10,
    load: {
      status: 'known',
      enteredWeightKg: 50,
      bodyweightPartKg: 0,
      calculatedLoadKg: 50,
      perSideCalculatedLoadKg: 50,
    },
    volumeKgReps: 500,
    estimatedOneRepMaxKg: 66,
    estimatedTotalOneRepMaxKg: 66,
  },
  enteredWeightKg: 50,
  sessionId: overrides.sessionId ?? 'session-1',
  sessionCompletedAt: overrides.completedAt,
  sessionExerciseId: 'se-1',
  exerciseDefinitionId: 'ed-1',
  exerciseName: overrides.exerciseName ?? 'Barbell Squat',
  setId: 's-1',
  setOrderIndex: 1,
  setType: overrides.rehab ? 'rehab' : null,
  weightValue: '50',
  repsValue: '10',
});

const makeInjury = (overrides: Partial<InjuryView> = {}): InjuryView => ({
  id: overrides.id ?? 'injury-1',
  muscleGroupId: Object.prototype.hasOwnProperty.call(overrides, 'muscleGroupId')
    ? overrides.muscleGroupId!
    : 'quads',
  muscleGroupName: overrides.muscleGroupName ?? 'Quadriceps',
  side: overrides.side ?? null,
  status: overrides.status ?? 'managing',
  painScore: overrides.painScore ?? 4,
  label: overrides.label ?? 'Left Quadriceps Strain',
  notes: overrides.notes ?? null,
  contraindications: overrides.contraindications ?? null,
  startedAt: overrides.startedAt ?? new Date('2026-05-15T12:00:00Z'),
  resolvedAt: overrides.resolvedAt ?? null,
  createdAt: overrides.createdAt ?? new Date('2026-05-15T12:00:00Z'),
  updatedAt: overrides.updatedAt ?? new Date('2026-05-15T12:00:00Z'),
});

describe('tissue-reload analytics', () => {
  describe('pre-injury baseline window and calculation', () => {
    it('defines the 28-day baseline window immediately preceding startedAt', () => {
      const startedAt = new Date('2026-05-15T12:00:00Z');
      const window = getPreInjuryBaselineWindow(startedAt);

      expect(window.end.getTime()).toBe(startedAt.getTime());
      expect(window.start.getTime()).toBe(
        startedAt.getTime() - RELOAD_BASELINE_WINDOW_DAYS * 24 * 60 * 60 * 1000
      );
    });

    it('sums working sets in the baseline window and divides by 4 for weekly average', () => {
      const startedAt = new Date('2026-05-15T12:00:00Z');
      const injury = makeInjury({ startedAt, muscleGroupId: 'quads' });

      // Inside window: 16 sets across 4 weeks
      const insideWindowContributions: MuscleSetContribution[] = [];
      for (let day = 1; day <= 16; day += 1) {
        const date = new Date(startedAt.getTime() - day * 24 * 60 * 60 * 1000);
        insideWindowContributions.push(
          makeContribution({ completedAt: date, muscleGroupId: 'quads', roleWeight: 1 })
        );
      }

      // Outside window (before 28 days)
      const tooOld = makeContribution({
        completedAt: new Date(startedAt.getTime() - 29 * 24 * 60 * 60 * 1000),
        muscleGroupId: 'quads',
      });

      // Outside window (after startedAt)
      const afterOnset = makeContribution({
        completedAt: new Date(startedAt.getTime() + 1 * 24 * 60 * 60 * 1000),
        muscleGroupId: 'quads',
      });

      // Different muscle
      const otherMuscle = makeContribution({
        completedAt: new Date(startedAt.getTime() - 5 * 24 * 60 * 60 * 1000),
        muscleGroupId: 'chest',
      });

      const all = [...insideWindowContributions, tooOld, afterOnset, otherMuscle];
      const baseline = computePreInjuryBaseline(all, injury);

      // 16 working sets / 4 weeks = 4.0 sets/week
      expect(baseline).toBe(4.0);
    });

    it('returns 0 when no pre-injury history exists', () => {
      const injury = makeInjury({ startedAt: new Date('2026-05-15T12:00:00Z') });
      const baseline = computePreInjuryBaseline([], injury);
      expect(baseline).toBe(0);
    });
  });

  describe('current weekly load tracking', () => {
    it('accumulates working sets, rehab sets, and rehab volume kg in the current calendar week', () => {
      // Wednesday May 20, 2026
      const now = new Date('2026-05-20T14:00:00Z');
      const injury = makeInjury({ muscleGroupId: 'quads' });

      const contributions: MuscleSetContribution[] = [
        // Working set on Monday of this week (May 18)
        makeContribution({
          completedAt: new Date('2026-05-18T10:00:00Z'),
          muscleGroupId: 'quads',
          working: true,
          rehab: false,
          roleWeight: 1,
        }),
        // Another working set on Tuesday (May 19)
        makeContribution({
          completedAt: new Date('2026-05-19T10:00:00Z'),
          muscleGroupId: 'quads',
          working: true,
          rehab: false,
          roleWeight: 1,
        }),
        // Rehab set on Tuesday (May 19) with 250 kg volume
        makeContribution({
          completedAt: new Date('2026-05-19T10:30:00Z'),
          muscleGroupId: 'quads',
          working: false,
          rehab: true,
          roleWeight: 1,
          setVolume: 250,
        }),
        // Rehab set on Wednesday (May 20) with 300 kg volume
        makeContribution({
          completedAt: new Date('2026-05-20T10:00:00Z'),
          muscleGroupId: 'quads',
          working: false,
          rehab: true,
          roleWeight: 1,
          setVolume: 300,
        }),
        // Set from previous week (Sunday May 17) -> excluded
        makeContribution({
          completedAt: new Date('2026-05-17T20:00:00Z'),
          muscleGroupId: 'quads',
          working: true,
        }),
      ];

      const load = computeCurrentWeeklyLoad(contributions, injury, now);

      expect(load.workingSets).toBe(2);
      expect(load.rehabSets).toBe(2);
      expect(load.rehabVolumeKg).toBe(550);
    });
  });

  describe('caution alert evaluation matrix', () => {
    it('Scenario 1: Below Floor (baseline=1.0, current=5 -> spike % high but floor not met)', () => {
      const evaluation = evaluateCautionAlert(5, 1.0);
      expect(evaluation.isCautionAlert).toBe(false);
      expect(evaluation.spikePercent).toBe(400);
    });

    it('Scenario 2: Spike Met (baseline=4.0, current=6 -> threshold is 5.2, floor 6 met)', () => {
      const evaluation = evaluateCautionAlert(6, 4.0);
      expect(evaluation.isCautionAlert).toBe(true);
      expect(evaluation.threshold).toBe(5.2);
      expect(evaluation.spikePercent).toBe(50);
    });

    it('Scenario 3: Within Baseline (baseline=5.0, current=6 -> threshold is 6.5, current <= threshold)', () => {
      const evaluation = evaluateCautionAlert(6, 5.0);
      expect(evaluation.isCautionAlert).toBe(false);
      expect(evaluation.threshold).toBe(6.5);
      expect(evaluation.spikePercent).toBe(20);
    });

    it('Scenario 4: Zero Baseline Below Floor (baseline=0, current=4 -> floor 6 not met)', () => {
      const evaluation = evaluateCautionAlert(4, 0);
      expect(evaluation.isCautionAlert).toBe(false);
      expect(evaluation.spikePercent).toBeNull();
    });

    it('Scenario 5: Zero Baseline At Floor (baseline=0, current=6 -> floor met, triggers caution)', () => {
      const evaluation = evaluateCautionAlert(6, 0);
      expect(evaluation.isCautionAlert).toBe(true);
      expect(evaluation.spikePercent).toBeNull();
    });

    it('Scenario 6: Exact 30% Threshold Boundary (baseline=5.0, current=6.5 -> strictly greater required)', () => {
      const evaluation = evaluateCautionAlert(6.5, 5.0);
      expect(evaluation.isCautionAlert).toBe(false);
      expect(evaluation.threshold).toBe(6.5);
      expect(evaluation.spikePercent).toBe(30);
    });

    it('Scenario 7: Just Over 30% Threshold (baseline=5.0, current=6.6 -> 6.6 > 6.5 triggers caution)', () => {
      const evaluation = evaluateCautionAlert(6.6, 5.0);
      expect(evaluation.isCautionAlert).toBe(true);
      expect(evaluation.threshold).toBe(6.5);
      expect(evaluation.spikePercent).toBe(32);
    });

    it('Scenario 8: Rested Week (baseline=10.0, current=0 -> caution suppressed, -100% trend)', () => {
      const evaluation = evaluateCautionAlert(0, 10.0);
      expect(evaluation.isCautionAlert).toBe(false);
      expect(evaluation.spikePercent).toBe(-100);
    });
  });

  describe('anatomical side filtering and alias matching', () => {
    it('matches unilateral left injury with left and bilateral movements, ignores right movements', () => {
      const injury = makeInjury({ muscleGroupId: 'quads', side: 'left' });

      const leftLegExt = makeContribution({
        completedAt: new Date(),
        muscleGroupId: 'quads',
        exerciseName: 'Left Single-Leg Extension',
      });
      const rightLegExt = makeContribution({
        completedAt: new Date(),
        muscleGroupId: 'quads',
        exerciseName: 'Right Single-Leg Extension',
      });
      const bilateralSquat = makeContribution({
        completedAt: new Date(),
        muscleGroupId: 'quads',
        exerciseName: 'Barbell Back Squat',
      });

      expect(isContributionMatchingInjury(leftLegExt, injury)).toBe(true);
      expect(isContributionMatchingInjury(bilateralSquat, injury)).toBe(true);
      expect(isContributionMatchingInjury(rightLegExt, injury)).toBe(false);
    });

    it('resolves anatomical alias when muscleGroupId is null', () => {
      const unlinkedInjury = makeInjury({
        muscleGroupId: null,
        label: 'Patellar tendon irritation',
        side: 'bilateral',
      });

      const squat = makeContribution({
        completedAt: new Date(),
        muscleGroupId: 'quads',
        exerciseName: 'Barbell Squat',
      });
      const bench = makeContribution({
        completedAt: new Date(),
        muscleGroupId: 'chest',
        exerciseName: 'Bench Press',
      });

      expect(isContributionMatchingInjury(squat, unlinkedInjury)).toBe(true);
      expect(isContributionMatchingInjury(bench, unlinkedInjury)).toBe(false);
    });

    it('returns false when injury cannot be mapped to any muscle', () => {
      const unmappedInjury = makeInjury({
        muscleGroupId: null,
        label: 'Bruised tailbone',
      });

      const squat = makeContribution({
        completedAt: new Date(),
        muscleGroupId: 'quads',
        exerciseName: 'Barbell Squat',
      });

      expect(isContributionMatchingInjury(squat, unmappedInjury)).toBe(false);
    });
  });

  describe('computeTissueReloadMetrics & computeAllTissueReloadMetrics', () => {
    it('computes full metrics object for an active injury', () => {
      const now = new Date('2026-05-20T12:00:00Z');
      const startedAt = new Date('2026-05-01T12:00:00Z');
      const injury = makeInjury({
        id: 'inj-quads',
        muscleGroupId: 'quads',
        muscleGroupName: 'Quadriceps',
        side: 'left',
        status: 'acute',
        painScore: 6,
        label: 'Left Quad Strain',
        startedAt,
      });

      // 16 working sets pre-injury = 4.0 sets/wk baseline
      const preInjuryContributions: MuscleSetContribution[] = [];
      for (let i = 1; i <= 16; i += 1) {
        preInjuryContributions.push(
          makeContribution({
            completedAt: new Date(startedAt.getTime() - i * 24 * 60 * 60 * 1000),
            muscleGroupId: 'quads',
            exerciseName: 'Left Leg Press',
            working: true,
          })
        );
      }

      // 7 working sets and 3 rehab sets current week
      const currentWeekContributions: MuscleSetContribution[] = [];
      for (let i = 0; i < 7; i += 1) {
        currentWeekContributions.push(
          makeContribution({
            completedAt: new Date('2026-05-18T10:00:00Z'),
            muscleGroupId: 'quads',
            exerciseName: 'Left Leg Press',
            working: true,
            rehab: false,
          })
        );
      }
      for (let i = 0; i < 3; i += 1) {
        currentWeekContributions.push(
          makeContribution({
            completedAt: new Date('2026-05-19T10:00:00Z'),
            muscleGroupId: 'quads',
            exerciseName: 'Left Leg Press',
            working: false,
            rehab: true,
            setVolume: 150,
          })
        );
      }

      const allContributions = [...preInjuryContributions, ...currentWeekContributions];
      const metrics = computeTissueReloadMetrics(allContributions, injury, now);

      expect(metrics.injuryId).toBe('inj-quads');
      expect(metrics.muscleGroupId).toBe('quads');
      expect(metrics.muscleGroupName).toBe('Quadriceps');
      expect(metrics.status).toBe('acute');
      expect(metrics.painScore).toBe(6);
      expect(metrics.baselineWeeklyAverage).toBe(4.0);
      expect(metrics.currentWeeklyWorkingSets).toBe(7);
      expect(metrics.currentWeeklyRehabSets).toBe(3);
      expect(metrics.currentWeeklyRehabVolumeKg).toBe(450);
      expect(metrics.isCautionAlert).toBe(true); // 7 >= 6 and 7 > 4.0 * 1.3 = 5.2
      expect(metrics.cautionThreshold).toBe(5.2);
      expect(metrics.spikePercent).toBe(75);
    });

    it('filters out resolved injuries in computeAllTissueReloadMetrics', () => {
      const activeInjury = makeInjury({ id: 'inj-1', status: 'acute' });
      const resolvedInjury = makeInjury({ id: 'inj-2', status: 'resolved' });

      const results = computeAllTissueReloadMetrics([], [activeInjury, resolvedInjury]);
      expect(results).toHaveLength(1);
      expect(results[0].injuryId).toBe('inj-1');
    });
  });
});
