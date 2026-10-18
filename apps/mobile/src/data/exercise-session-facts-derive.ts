// Pure derivation of exercise session facts (spec 05, "Exercise session
// facts"): one exercise definition's completed history in, one row per session
// out, each with the session's bests and personal-record flags. A row can
// carry volume with zero working sets when the two policies differ.
//
// An exercise split per gym keeps each gym's records and PR flags to itself,
// beside the whole-exercise book every exercise has ([[gym.split]]).

import {
  isPooledGymBucket, reportingBucket, type GymBucketKey, type GymSplitDefinition,
} from '@/src/exercise-calculations/gym-bucket';
import { summarizeSessionBests } from '@/src/exercise-calculations/best-set';
import type { LoadContext } from '@/src/exercise-calculations/load-metrics';
import { compareRecordOrder, createRecordBook } from '@/src/exercise-calculations/records';
import type { SessionSetPerformanceStatus } from '@/src/exercise-calculations/set-semantics';

import type { ExerciseSessionFact } from './schema';

/**
 * Bump when a rule below changes what a row holds. Every device then rebuilds
 * the whole table once before its next facts read.
 */
export const EXERCISE_SESSION_FACTS_RULES_VERSION = 9;

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
  /** The session's gym, which picks its bucket when the definition is split. */
  gymId: string | null;
  blocks: FactsBlockInput[];
};

/** The definition being derived: its id, and whether it reports per gym. */
export type FactsDefinitionInput = GymSplitDefinition & { id: string };

export type ExerciseSessionFactRow = ExerciseSessionFact;

type SessionBests = Omit<
  ExerciseSessionFactRow,
  'prE1rm' | 'prWeight' | 'prVolume' | 'ownPrE1rm' | 'ownPrWeight' | 'ownPrVolume'
> & { topWeightReps: number | null };

/** The order PR history uses: the record order (`compareRecordOrder`). */
export const compareFactSessionOrder = compareRecordOrder;

/**
 * The session's bests in its reporting bucket, or null when it has neither
 * working nor volume-included sets.
 */
export const summarizeFactSession = (
  definition: FactsDefinitionInput,
  session: FactsSessionInput,
): SessionBests | null => {
  const bests = summarizeSessionBests<FactsSetInput, FactsBlockInput>(session.blocks);
  if (!bests) return null;
  return {
    sessionId: session.sessionId,
    exerciseDefinitionId: definition.id,
    gymBucket: reportingBucket(definition, session.gymId),
    achievedAt: session.completedAt,
    bestE1rmKg: bests.oneRepMax?.estimatedOneRepMaxKg ?? null,
    bestE1rmSetId: bests.oneRepMax?.set.id ?? null,
    topWeightKg: bests.topWeight?.weight ?? null,
    topWeightSetId: bests.topWeight?.set.id ?? null,
    topWeightReps: bests.topWeight?.reps ?? null,
    volumeKg: bests.volumeKg,
    workingSets: bests.workingSets,
    volumeSets: bests.volumeSets,
  };
};

/**
 * Facts for one definition across its completed history, in PR-history order.
 * The PR flags are the record book's (`records.ts`). Every session feeds the
 * whole-exercise book, whose flags are `pr_*`. On a split exercise a session
 * at a gym also feeds that gym's own book, and its `own_pr_*` are that book's,
 * so one gym never sets or raises another's records; everywhere else
 * `own_pr_*` are the whole exercise's. A Volume that left out a set whose load
 * cannot be calculated competes like any other.
 */
export const deriveExerciseSessionFacts = (
  definition: FactsDefinitionInput,
  sessions: FactsSessionInput[],
): ExerciseSessionFactRow[] => {
  const whole = createRecordBook();
  const gymBooks = new Map<GymBucketKey, ReturnType<typeof createRecordBook>>();
  return [...sessions]
    .sort(compareFactSessionOrder)
    .flatMap((session) => {
      const summary = summarizeFactSession(definition, session);
      if (!summary) return [];
      const { topWeightReps, ...bests } = summary;
      const entry = {
        oneRepMax: bests.bestE1rmKg === null ? null : { value: bests.bestE1rmKg },
        weight: bests.topWeightKg === null || topWeightReps === null
          ? null : { weight: bests.topWeightKg, reps: topWeightReps },
        volume: bests.volumeKg === null ? null : { value: bests.volumeKg },
      };
      const flags = whole.add(entry);
      let own = flags;
      if (!isPooledGymBucket(bests.gymBucket)) {
        const book = gymBooks.get(bests.gymBucket) ?? createRecordBook();
        gymBooks.set(bests.gymBucket, book);
        own = book.add(entry);
      }
      return [{
        ...bests,
        prE1rm: flags.oneRepMax, prWeight: flags.weight, prVolume: flags.volume,
        ownPrE1rm: own.oneRepMax, ownPrWeight: own.weight, ownPrVolume: own.volume,
      }];
    });
};
