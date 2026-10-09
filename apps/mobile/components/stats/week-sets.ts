// The sets of one history week, as cards for the Timeline's week list: an
// exercise's history lists each session block of the exercise, a muscle's each
// exercise block that worked the muscle, days Monday first. A card is View
// Session's card for that block (`loadCompletedSessionCards`): the same rows,
// record highlights and record band as every finished session.
import { useEffect, useState } from 'react';

import {
  computeSelectedMuscleDailyEffort,
  loadExerciseRangeEntries,
  type ExerciseHistorySessionEntry,
  type MuscleSetContribution,
} from '@/src/data';
import type { RecordLine } from '@/src/session-insights/record-band';
import { loadCompletedSessionCards } from '@/src/session-recorder/completed-session-cards';
import type { CompletedSessionDetailCard } from '@/src/session-recorder/completed-session-detail-model';
import type { SessionViewSetRow } from '@/src/session-recorder/session-view-model';
import { localWeekBounds } from '@/src/utils/calendar-weeks';

export type WeekSetGroup = {
  key: string;
  sessionId: string;
  title: string;
  detail: string;
  workingSetCount: number;
  rows: SessionViewSetRow[];
  record: RecordLine[];
};

/** One session block to list: its card's title, or the card's exercise name when absent. */
export type WeekBlock = { sessionId: string; sessionExerciseId: string; completedAt: Date; title?: string; detail: string };

export type WeekSetsTarget = { exerciseDefinitionId: string } | { muscleGroupIds: string[] };

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A completed session's local day: `Mon 14 Sep`. */
export const formatWeekDay = (date: Date): string =>
  `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;

/** An exercise's blocks, titled by their day, with their gym. */
export const exerciseWeekBlocks = (entries: ExerciseHistorySessionEntry[]): WeekBlock[] =>
  entries.map((entry) => ({
    sessionId: entry.sessionId,
    sessionExerciseId: entry.sessionExerciseId,
    completedAt: entry.completedAt,
    title: formatWeekDay(entry.completedAt),
    detail: entry.gymName?.trim() ? entry.gymName : 'No gym',
  }));

/** The blocks that worked a muscle, titled by their exercise, with their day. */
export const muscleWeekBlocks = (contributions: MuscleSetContribution[]): WeekBlock[] => {
  const blocks = new Map<string, WeekBlock>();
  for (const contribution of contributions) {
    if (blocks.has(contribution.sessionExerciseId)) continue;
    blocks.set(contribution.sessionExerciseId, {
      sessionId: contribution.sessionId,
      sessionExerciseId: contribution.sessionExerciseId,
      completedAt: contribution.sessionCompletedAt,
      detail: formatWeekDay(contribution.sessionCompletedAt),
    });
  }
  return [...blocks.values()];
};

/** The listed blocks' cards, oldest first; a block without a card (no performed set) is left out. */
export const weekSetGroups = (
  blocks: WeekBlock[],
  cardsBySessionId: ReadonlyMap<string, CompletedSessionDetailCard[]>
): WeekSetGroup[] =>
  [...blocks]
    .sort((left, right) => left.completedAt.getTime() - right.completedAt.getTime())
    .flatMap((block) => {
      const card = cardsBySessionId.get(block.sessionId)?.find((candidate) => candidate.id === block.sessionExerciseId);
      return card ? [{
        key: block.sessionExerciseId,
        sessionId: block.sessionId,
        title: block.title ?? card.name,
        detail: block.detail,
        workingSetCount: card.setCount,
        rows: card.rows,
        record: card.record,
      }] : [];
    });

const loadWeekBlocks = async (target: WeekSetsTarget, weekKey: string): Promise<WeekBlock[]> => {
  const bounds = localWeekBounds(weekKey);
  if ('exerciseDefinitionId' in target) {
    return exerciseWeekBlocks(await loadExerciseRangeEntries({ ...bounds, exerciseDefinitionId: target.exerciseDefinitionId }));
  }
  const days = await computeSelectedMuscleDailyEffort({ ...bounds, muscleGroupIds: target.muscleGroupIds });
  return muscleWeekBlocks(days.flatMap((day) => day.contributions));
};

const loadWeekGroups = async (target: WeekSetsTarget, weekKey: string): Promise<WeekSetGroup[]> => {
  const blocks = await loadWeekBlocks(target, weekKey);
  const sessionIds = [...new Set(blocks.map((block) => block.sessionId))];
  const cards = await Promise.all(sessionIds.map(loadCompletedSessionCards));
  return weekSetGroups(blocks, new Map(sessionIds.map((sessionId, index) => [sessionId, cards[index]])));
};

export type WeekSetsState = { groups: WeekSetGroup[]; loading: boolean; error: string | null };

/** The selected week's sets; a superseded week or an unmount cannot publish its read. */
export function useWeekSets(target: WeekSetsTarget | null, weekKey: string | null, revision = 0): WeekSetsState {
  // The last read and the request it answered; a newer request is loading until its read lands.
  const [read, setRead] = useState<{ groups: WeekSetGroup[]; error: string | null; for: string | null }>({ groups: [], error: null, for: null });
  const targetKey = target === null ? null : 'exerciseDefinitionId' in target ? target.exerciseDefinitionId : target.muscleGroupIds.join(',');
  const requestKey = target === null || weekKey === null ? null : `${targetKey}|${weekKey}|${revision}`;
  useEffect(() => {
    if (target === null || weekKey === null) return;
    let active = true;
    loadWeekGroups(target, weekKey).then(
      (groups) => { if (active) setRead({ groups, error: null, for: requestKey }); },
      (cause: unknown) => {
        if (active) setRead({ groups: [], error: cause instanceof Error ? cause.message : 'Unknown error', for: requestKey });
      },
    );
    return () => { active = false; };
    // `requestKey` names the target, week and revision; `target` is read through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);
  if (requestKey === null) return { groups: [], loading: false, error: null };
  const current = read.for === requestKey;
  return { groups: current ? read.groups : [], loading: !current, error: current ? read.error : null };
}
