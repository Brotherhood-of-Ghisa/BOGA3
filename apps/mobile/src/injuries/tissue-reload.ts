import { countMuscleSets, countMuscleRehabSets, type MuscleSetContribution } from '@/src/data/muscle-analytics';
import type { InjurySide, InjuryStatus, InjuryView } from '@/src/data/injuries';
import { isAnatomicalSideConflict, resolveInjuryMuscleGroupId } from './injury-warning-engine';
import { localWeekWindow, type LocalWindow } from '@/src/utils/local-calendar';

export const RELOAD_VOLUME_FLOOR = 6;
export const RELOAD_SPIKE_MULTIPLIER = 1.30;
export const RELOAD_BASELINE_WINDOW_DAYS = 28;

export type CautionEvaluation = {
  readonly isCautionAlert: boolean;
  readonly threshold: number;
  readonly spikePercent: number | null;
};

export type CurrentWeeklyLoad = {
  readonly workingSets: number;
  readonly rehabSets: number;
  readonly rehabVolumeKg: number;
};

export type TissueReloadMetrics = {
  readonly injuryId: string;
  readonly muscleGroupId: string | null;
  readonly muscleGroupName?: string | null;
  readonly label: string;
  readonly side: InjurySide | null;
  readonly status: InjuryStatus;
  readonly painScore: number | null;
  readonly baselineWeeklyAverage: number;
  readonly currentWeeklyWorkingSets: number;
  readonly currentWeeklyRehabSets: number;
  readonly currentWeeklyRehabVolumeKg: number;
  readonly spikePercent: number | null;
  readonly isCautionAlert: boolean;
  readonly cautionThreshold: number;
};

export type InjuryTargetInput = Pick<InjuryView, 'muscleGroupId' | 'label' | 'side'>;

export type ReloadAnalyticsOptions = {
  readonly countSecondary?: boolean;
};

/** Pre-injury 28-day window: [startedAt - 28d, startedAt). */
export function getPreInjuryBaselineWindow(startedAt: Date): LocalWindow {
  const start = new Date(startedAt.getTime() - RELOAD_BASELINE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { start, end: startedAt };
}

/** Determines if a set contribution targets the anatomical structure of an injury. */
export function isContributionMatchingInjury(
  contribution: MuscleSetContribution,
  injury: InjuryTargetInput
): boolean {
  const targetMuscleId = resolveInjuryMuscleGroupId(injury);
  if (!targetMuscleId) return false;
  if (contribution.muscleGroupId !== targetMuscleId) return false;
  if (!isAnatomicalSideConflict(contribution.exerciseName ?? '', injury.side ?? null)) {
    return false;
  }
  return true;
}

/** Filters a stream of set contributions to those belonging to an injury's anatomy and time window. */
export function filterContributionsForInjuryWindow(
  contributions: Iterable<MuscleSetContribution>,
  injury: InjuryTargetInput,
  window: LocalWindow
): MuscleSetContribution[] {
  const startTime = window.start.getTime();
  const endTime = window.end.getTime();
  const matched: MuscleSetContribution[] = [];

  for (const c of contributions) {
    const t = c.sessionCompletedAt.getTime();
    if (t >= startTime && t < endTime) {
      if (isContributionMatchingInjury(c, injury)) {
        matched.push(c);
      }
    }
  }
  return matched;
}

/**
 * Computes 4-week pre-injury baseline weekly average working sets over [T_injury - 28d, T_injury).
 */
export function computePreInjuryBaseline(
  contributions: Iterable<MuscleSetContribution>,
  injury: Pick<InjuryView, 'muscleGroupId' | 'label' | 'side' | 'startedAt'>
): number {
  const window = getPreInjuryBaselineWindow(injury.startedAt);
  const matched = filterContributionsForInjuryWindow(contributions, injury, window);
  const counts = countMuscleSets(matched);
  return Math.round((counts.weightedSetCount / 4) * 10) / 10;
}

/**
 * Computes working sets, rehab sets, and rehab volume (kg) accumulated during the current calendar week.
 */
export function computeCurrentWeeklyLoad(
  contributions: Iterable<MuscleSetContribution>,
  injury: InjuryTargetInput,
  now: Date = new Date()
): CurrentWeeklyLoad {
  const window = localWeekWindow(now);
  const matched = filterContributionsForInjuryWindow(contributions, injury, window);
  const workingCounts = countMuscleSets(matched);
  const rehabCounts = countMuscleRehabSets(matched);

  let rehabVolumeKg = 0;
  for (const c of matched) {
    if (c.rehab === true && c.setVolume !== null && Number.isFinite(c.setVolume)) {
      rehabVolumeKg += c.setVolume;
    }
  }

  return {
    workingSets: workingCounts.weightedSetCount,
    rehabSets: rehabCounts.weightedSetCount,
    rehabVolumeKg: Math.round(rehabVolumeKg * 10) / 10,
  };
}

/**
 * Evaluates caution spike condition:
 * Alerts when current weekly working sets spike >30% over baseline,
 * gated strictly by an absolute volume floor (>= 6 sets).
 */
export function evaluateCautionAlert(
  currentWorkingSets: number,
  baselineAverage: number
): CautionEvaluation {
  const threshold = Math.round(baselineAverage * RELOAD_SPIKE_MULTIPLIER * 10) / 10;
  const isFloorMet = currentWorkingSets >= RELOAD_VOLUME_FLOOR;

  if (!isFloorMet) {
    const spikePercent = baselineAverage > 0
      ? Math.round(((currentWorkingSets - baselineAverage) / baselineAverage) * 100)
      : null;
    return { isCautionAlert: false, threshold, spikePercent };
  }

  if (baselineAverage === 0) {
    return { isCautionAlert: true, threshold: 0, spikePercent: null };
  }

  const isSpike = currentWorkingSets > threshold;
  const spikePercent = Math.round(((currentWorkingSets - baselineAverage) / baselineAverage) * 100);

  return {
    isCautionAlert: isSpike,
    threshold,
    spikePercent,
  };
}

/**
 * Computes complete reload analytics for a single injury structure.
 */
export function computeTissueReloadMetrics(
  contributions: Iterable<MuscleSetContribution>,
  injury: InjuryView,
  now: Date = new Date()
): TissueReloadMetrics {
  const baselineWeeklyAverage = computePreInjuryBaseline(contributions, injury);
  const currentLoad = computeCurrentWeeklyLoad(contributions, injury, now);
  const caution = evaluateCautionAlert(currentLoad.workingSets, baselineWeeklyAverage);

  return {
    injuryId: injury.id,
    muscleGroupId: resolveInjuryMuscleGroupId(injury),
    muscleGroupName: injury.muscleGroupName ?? null,
    label: injury.label,
    side: injury.side ?? null,
    status: injury.status,
    painScore: injury.painScore ?? null,
    baselineWeeklyAverage,
    currentWeeklyWorkingSets: currentLoad.workingSets,
    currentWeeklyRehabSets: currentLoad.rehabSets,
    currentWeeklyRehabVolumeKg: currentLoad.rehabVolumeKg,
    spikePercent: caution.spikePercent,
    isCautionAlert: caution.isCautionAlert,
    cautionThreshold: caution.threshold,
  };
}

/**
 * Computes reload analytics for all active injuries (excluding resolved).
 */
export function computeAllTissueReloadMetrics(
  contributions: Iterable<MuscleSetContribution>,
  injuries: readonly InjuryView[],
  now: Date = new Date()
): readonly TissueReloadMetrics[] {
  const active = injuries.filter(i => i.status !== 'resolved');
  return active.map(injury => computeTissueReloadMetrics(contributions, injury, now));
}
