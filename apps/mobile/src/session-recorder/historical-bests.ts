import { loadRecentExerciseBlocks } from '@/src/data';

import { historicalBestOneRepMax } from './session-view-model';

/**
 * The best 1RM each exercise reached in every completed session except
 * `sessionId`, keyed by exercise definition. An exercise whose history cannot
 * be read is left out, so it shows no record rather than a wrong one.
 */
export const loadHistoricalBestsExcluding = async (
  sessionId: string,
  exerciseDefinitionIds: readonly string[]
): Promise<Map<string, number | null>> => {
  const bests = await Promise.all(
    [...new Set(exerciseDefinitionIds)].map(async (exerciseDefinitionId) => {
      try {
        const history = await loadRecentExerciseBlocks({ exerciseDefinitionId });
        const others = history.blocks.filter((block) => block.sessionId !== sessionId);
        return [exerciseDefinitionId, historicalBestOneRepMax(others)] as const;
      } catch {
        return null;
      }
    })
  );
  return new Map(bests.filter((entry): entry is readonly [string, number | null] => entry !== null));
};
