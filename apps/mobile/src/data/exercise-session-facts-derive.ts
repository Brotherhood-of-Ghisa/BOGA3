// Pure derivation of exercise session facts (spec 05, "Exercise session
// facts"): one exercise definition's completed history in, one row per session
// out, each with the session's bests and its personal-record flags.

import { addFiniteVolume, enteredWeightKg } from '@/src/exercise-calculations/analytics';
import {
  eligibleSetsByBlockInSessionOrder,
  pickBestEstimatedOneRepMaxSet,
  type EligibleSessionSet,
} from '@/src/exercise-calculations/best-set';
import { summarizeVolume, type LoadContext } from '@/src/exercise-calculations/load-metrics';
import type { SessionSetPerformanceStatus } from '@/src/exercise-calculations/set-semantics';

import type { ExerciseSessionFact } from './schema';
import { isWorkingSessionSetType } from './set-types';

/**
 * Bump when a rule below changes what a row holds. Every device then rebuilds
 * the whole table once before its next facts read.
 */
export const EXERCISE_SESSION_FACTS_RULES_VERSION = 2;

export type FactsSetInput = {
  id: string;
  orderIndex: number;
  weightValue: string;
  repsValue: string;
  setType: string | null;
  performanceStatus: SessionSetPerformanceStatus;
};

/** One block of the definition in a session, with its personal-policy load context. */
export type FactsBlockInput = {
  id: string;
  orderIndex: number;
  loadContext: LoadContext;
  sets: FactsSetInput[];
};

export type FactsSessionInput = {
  sessionId: string;
  completedAt: Date;
  blocks: FactsBlockInput[];
};

export type ExerciseSessionFactRow = ExerciseSessionFact;

type SessionBests = Omit<ExerciseSessionFactRow, 'prE1rm' | 'prWeight' | 'prVolume'>;

/** The order PR history uses: `completed_at`, then session id. */
export const compareFactSessionOrder = (
  left: { completedAt: Date; sessionId: string },
  right: { completedAt: Date; sessionId: string },
): number =>
  left.completedAt.getTime() - right.completedAt.getTime() ||
  left.sessionId.localeCompare(right.sessionId);

type EligibleSet = EligibleSessionSet<FactsBlockInput, FactsSetInput>;

type Best = { value: number; setId: string; reps: number };

/** Raw entered kg; equal weight goes to more reps, then to session order. */
const pickTopWeight = (best: Best | null, { set, metric }: EligibleSet): Best | null => {
  const value = enteredWeightKg(set);
  if (value === null) return best;
  if (best !== null && (value < best.value || (value === best.value && metric.reps <= best.reps))) {
    return best;
  }
  return { value, setId: set.id, reps: metric.reps };
};

/** The session's bests for one definition, or null when it has no eligible set. */
export const summarizeFactSession = (
  exerciseDefinitionId: string,
  session: FactsSessionInput,
): SessionBests | null => {
  const blocks = eligibleSetsByBlockInSessionOrder<FactsSetInput, FactsBlockInput>(session.blocks)
    .filter((sets) => sets.length > 0);
  if (blocks.length === 0) return null;

  const bestE1rm = pickBestEstimatedOneRepMaxSet(blocks.flat());
  let topWeight: Best | null = null;
  let knownVolume: number | null = 0;
  let totalVolume: number | null = 0;
  let workingSets = 0;
  for (const sets of blocks) {
    const coverage = summarizeVolume(sets.map(({ metric }) => metric));
    knownVolume = addFiniteVolume(knownVolume, coverage.knownVolumeKgReps);
    totalVolume = addFiniteVolume(totalVolume, coverage.totalVolumeKgReps);
    for (const eligible of sets) {
      topWeight = pickTopWeight(topWeight, eligible);
      if (isWorkingSessionSetType(eligible.set.setType)) workingSets += 1;
    }
  }

  return {
    sessionId: session.sessionId,
    exerciseDefinitionId,
    achievedAt: session.completedAt,
    bestE1rmKg: bestE1rm?.estimatedOneRepMaxKg ?? null,
    bestE1rmSetId: bestE1rm?.set.id ?? null,
    topWeightKg: topWeight?.value ?? null,
    topWeightSetId: topWeight?.setId ?? null,
    volumeKg: totalVolume ?? knownVolume,
    volumeComplete: totalVolume !== null,
    workingSets,
  };
};

/** A value strictly above every earlier value is a PR; the first value is the baseline. */
const createRecordTracker = () => {
  let bar: number | null = null;
  return (value: number | null): boolean => {
    if (value === null) return false;
    const isRecord = bar !== null && value > bar;
    if (bar === null || value > bar) bar = value;
    return isRecord;
  };
};

/**
 * Facts for one definition across its completed history, in PR-history order.
 * An incomplete volume is never a volume PR and never raises the volume bar.
 */
export const deriveExerciseSessionFacts = (
  exerciseDefinitionId: string,
  sessions: FactsSessionInput[],
): ExerciseSessionFactRow[] => {
  const e1rmRecord = createRecordTracker();
  const weightRecord = createRecordTracker();
  const volumeRecord = createRecordTracker();
  return [...sessions]
    .sort(compareFactSessionOrder)
    .flatMap((session) => {
      const bests = summarizeFactSession(exerciseDefinitionId, session);
      if (!bests) return [];
      return [{
        ...bests,
        prE1rm: e1rmRecord(bests.bestE1rmKg),
        prWeight: weightRecord(bests.topWeightKg),
        prVolume: volumeRecord(bests.volumeComplete ? bests.volumeKg : null),
      }];
    });
};
