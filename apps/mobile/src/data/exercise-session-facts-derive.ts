// Pure derivation of exercise session facts (spec 05, "Exercise session
// facts"): one exercise definition's completed history in, one row per session
// out, each with the session's bests and its personal-record flags. Only
// working sets count: a session with none for the definition has no row.

import { summarizeSessionBests } from '@/src/exercise-calculations/best-set';
import type { LoadContext } from '@/src/exercise-calculations/load-metrics';
import { compareRecordOrder, createRecordBook } from '@/src/exercise-calculations/records';
import type { SessionSetPerformanceStatus } from '@/src/exercise-calculations/set-semantics';

import type { ExerciseSessionFact } from './schema';

/**
 * Bump when a rule below changes what a row holds. Every device then rebuilds
 * the whole table once before its next facts read.
 */
export const EXERCISE_SESSION_FACTS_RULES_VERSION = 4;

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

type SessionBests = Omit<ExerciseSessionFactRow, 'prE1rm' | 'prWeight' | 'prVolume'> & { topWeightReps: number | null };

/** The order PR history uses: the record order (`compareRecordOrder`). */
export const compareFactSessionOrder = compareRecordOrder;

/** The session's bests for one definition, or null when it has no working set. */
export const summarizeFactSession = (
  exerciseDefinitionId: string,
  session: FactsSessionInput,
): SessionBests | null => {
  const bests = summarizeSessionBests<FactsSetInput, FactsBlockInput>(session.blocks);
  if (!bests) return null;
  return {
    sessionId: session.sessionId,
    exerciseDefinitionId,
    achievedAt: session.completedAt,
    bestE1rmKg: bests.oneRepMax?.estimatedOneRepMaxKg ?? null,
    bestE1rmSetId: bests.oneRepMax?.set.id ?? null,
    topWeightKg: bests.topWeight?.weight ?? null,
    topWeightSetId: bests.topWeight?.set.id ?? null,
    topWeightReps: bests.topWeight?.reps ?? null,
    volumeKg: bests.volumeKg,
    volumeComplete: bests.volumeComplete,
    workingSets: bests.workingSets,
  };
};

/**
 * Facts for one definition across its completed history, in PR-history order.
 * The PR flags are the record book's (`records.ts`): an incomplete volume is
 * never a volume PR and never raises the volume bar.
 */
export const deriveExerciseSessionFacts = (
  exerciseDefinitionId: string,
  sessions: FactsSessionInput[],
): ExerciseSessionFactRow[] => {
  const book = createRecordBook();
  return [...sessions]
    .sort(compareFactSessionOrder)
    .flatMap((session) => {
      const summary = summarizeFactSession(exerciseDefinitionId, session);
      if (!summary) return [];
      const { topWeightReps, ...bests } = summary;
      const flags = book.add({
        oneRepMax: bests.bestE1rmKg === null ? null : { value: bests.bestE1rmKg },
        weight: bests.topWeightKg === null || topWeightReps === null
          ? null : { weight: bests.topWeightKg, reps: topWeightReps },
        volume: bests.volumeComplete && bests.volumeKg !== null ? { value: bests.volumeKg } : null,
      });
      return [{ ...bests, prE1rm: flags.oneRepMax, prWeight: flags.weight, prVolume: flags.volume }];
    });
};
