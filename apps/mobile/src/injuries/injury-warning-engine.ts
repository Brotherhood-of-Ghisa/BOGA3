import type { InjurySide, InjuryView } from '@/src/data/injuries';
import { resolveAnatomyAlias } from './anatomy-aliases';

export type InjuryWarningSeverity = 'acute' | 'managing' | 'monitoring';

export type ExerciseMuscleMappingTarget = {
  muscleGroupId: string;
  role: 'primary' | 'secondary' | 'stabilizer' | null;
};

export type ExerciseAnatomyTarget = {
  exerciseDefinitionId: string;
  name: string;
  mappings?: ExerciseMuscleMappingTarget[];
};

export type InjuryWarning = {
  severity: InjuryWarningSeverity;
  injury: InjuryView;
  matchingMuscles: string[];
  daysSinceOnset: number;
  onsetText: string;
  contraindicationsText: string | null;
  isDismissed: boolean;
};

export type ExerciseWarningResult = {
  hasWarning: boolean;
  activeWarning: InjuryWarning | null;
  allMatchingWarnings: InjuryWarning[];
};

export type ExerciseSideAffinity = 'bilateral' | 'left' | 'right' | 'unilateral_any';

const STATUS_PRIORITY: Record<InjuryWarningSeverity, number> = {
  acute: 0,
  managing: 1,
  monitoring: 2,
};

/**
 * Calculates days elapsed from startedAt to now (normalized to local start of day).
 */
export function calculateDaysSinceOnset(
  startedAt: Date,
  now: Date = new Date()
): { days: number; text: string } {
  const startDay = new Date(startedAt.getFullYear(), startedAt.getMonth(), startedAt.getDate()).getTime();
  const currentDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffMs = Math.max(0, currentDay - startDay);
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (days === 0) return { days: 0, text: 'Started today' };
  if (days === 1) return { days: 1, text: '1 day ago' };
  if (days < 14) return { days, text: `${days} days ago` };
  const weeks = Math.floor(days / 7);
  return { days, text: `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago` };
}

/**
 * Detects whether an exercise is explicit left, explicit right, un-sided unilateral, or bilateral.
 */
export function detectExerciseSideAffinity(exerciseName: string): ExerciseSideAffinity {
  const normalized = exerciseName.toLowerCase();

  const hasLeft = /\b(?:left|\(left\))\b/i.test(normalized);
  const hasRight = /\b(?:right|\(right\))\b/i.test(normalized);

  if (hasLeft && !hasRight) return 'left';
  if (hasRight && !hasLeft) return 'right';

  const isUnilateral =
    /\b(?:one[- ]arm|single[- ]arm|one[- ]leg|single[- ]leg|unilateral|split squat|lunge|lunges|step[- ]up|bulgarian)\b/i.test(
      normalized
    ) || /\b(?:dumbbell row|db row)\b/i.test(normalized);

  if (isUnilateral) return 'unilateral_any';
  return 'bilateral';
}

/**
 * Determines if an exercise stresses the anatomical side affected by an injury.
 * - Bilateral movements involve both sides (stressing left, right, or bilateral injuries).
 * - Explicit unilateral movements match their specific side.
 * - Un-sided unilateral movements involve both sides over the set.
 */
export function isAnatomicalSideConflict(
  exerciseName: string,
  injurySide: InjurySide | null
): boolean {
  if (!injurySide || injurySide === 'bilateral') return true;
  const affinity = detectExerciseSideAffinity(exerciseName);
  if (affinity === 'bilateral' || affinity === 'unilateral_any') return true;
  return affinity === injurySide;
}

/**
 * Extracts counted muscle group IDs (primary or secondary) from an exercise.
 * Stabilizers and unroled mappings do not trigger warnings.
 */
export function getExerciseActiveMuscleGroupIds(exercise: ExerciseAnatomyTarget): string[] {
  if (!exercise.mappings || exercise.mappings.length === 0) return [];
  const ids: string[] = [];
  for (const m of exercise.mappings) {
    if (m.role === 'primary' || m.role === 'secondary') {
      if (!ids.includes(m.muscleGroupId)) {
        ids.push(m.muscleGroupId);
      }
    }
  }
  return ids;
}

/**
 * Resolves the target muscle group ID for an injury, checking its direct FK or alias fallback.
 */
export function resolveInjuryMuscleGroupId(
  injury: Pick<InjuryView, 'muscleGroupId' | 'label'>
): string | null {
  if (injury.muscleGroupId) return injury.muscleGroupId;
  return resolveAnatomyAlias(injury.label);
}

/**
 * Checks if a single injury matches an exercise.
 */
export function isInjuryMatchingExercise(
  exercise: ExerciseAnatomyTarget,
  injury: InjuryView
): { matches: boolean; matchingMuscles: string[] } {
  if (injury.status === 'resolved') {
    return { matches: false, matchingMuscles: [] };
  }

  const targetMuscleId = resolveInjuryMuscleGroupId(injury);
  if (!targetMuscleId) {
    return { matches: false, matchingMuscles: [] };
  }

  const exerciseMuscles = getExerciseActiveMuscleGroupIds(exercise);
  if (!exerciseMuscles.includes(targetMuscleId)) {
    return { matches: false, matchingMuscles: [] };
  }

  if (!isAnatomicalSideConflict(exercise.name, injury.side)) {
    return { matches: false, matchingMuscles: [] };
  }

  return { matches: true, matchingMuscles: [targetMuscleId] };
}

/**
 * Matches active injuries against an exercise, resolving priority hierarchy (acute > managing > monitoring).
 */
export function matchInjuriesToExercise(
  exercise: ExerciseAnatomyTarget,
  activeInjuries: readonly InjuryView[],
  options: {
    dismissedInjuryIds?: ReadonlySet<string>;
    now?: Date;
  } = {}
): ExerciseWarningResult {
  const now = options.now ?? new Date();
  const dismissed = options.dismissedInjuryIds ?? new Set<string>();

  const matching: InjuryWarning[] = [];

  for (const injury of activeInjuries) {
    if (injury.status === 'resolved') continue;
    const { matches, matchingMuscles } = isInjuryMatchingExercise(exercise, injury);
    if (!matches) continue;

    const onset = calculateDaysSinceOnset(injury.startedAt, now);
    const isDismissed = dismissed.has(injury.id);

    matching.push({
      severity: injury.status as InjuryWarningSeverity,
      injury,
      matchingMuscles,
      daysSinceOnset: onset.days,
      onsetText: onset.text,
      contraindicationsText: injury.contraindications ?? null,
      isDismissed,
    });
  }

  matching.sort((a, b) => {
    const pDiff = STATUS_PRIORITY[a.severity] - STATUS_PRIORITY[b.severity];
    if (pDiff !== 0) return pDiff;
    const painA = a.injury.painScore ?? 0;
    const painB = b.injury.painScore ?? 0;
    if (painB !== painA) return painB - painA;
    return b.injury.startedAt.getTime() - a.injury.startedAt.getTime();
  });

  const activeWarning = matching.find((w) => !w.isDismissed) ?? matching[0] ?? null;

  return {
    hasWarning: matching.length > 0,
    activeWarning,
    allMatchingWarnings: matching,
  };
}

export const resolveExerciseWarning = matchInjuriesToExercise;
