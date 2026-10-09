// The sets of one history week, as cards for the Timeline's week list: an
// exercise's history draws one card per session block, a muscle's one card per
// exercise block that worked the muscle. Days run Monday first. Pure builders
// plus the hook that reads a week.
import { useEffect, useState } from 'react';

import {
  computeSelectedMuscleDailyEffort,
  loadExerciseRangeEntries,
  type ExerciseHistorySessionEntry,
  type MuscleSetContribution,
} from '@/src/data';
import { parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
import { canonicalizeWeightForReps } from '@/src/exercise-calculations/set-semantics';
import { formatSetRow, type SessionViewSetRow } from '@/src/session-recorder/session-view-model';
import { localWeekBounds } from '@/src/utils/calendar-weeks';

export type WeekSetGroup = {
  key: string;
  sessionId: string;
  title: string;
  detail: string;
  workingSetCount: number;
  rows: SessionViewSetRow[];
};

export type WeekSetsTarget = { exerciseDefinitionId: string } | { muscleGroupIds: string[] };

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A completed session's local day: `Mon 14 Sep`. */
export const formatWeekDay = (date: Date): string =>
  `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;

const setRow = (input: { id: string; weightValue: string; repsValue: string; setType: string | null }, loadContext?: ExerciseHistorySessionEntry['loadContext']) =>
  formatSetRow({
    id: input.id,
    weight: parseSetWeight(canonicalizeWeightForReps(input.weightValue, input.repsValue)),
    reps: parseSetReps(input.repsValue),
    setType: input.setType,
    done: true,
    loadContext,
  });

/** One card per session block of the exercise, titled by its day. */
export const exerciseWeekGroups = (entries: ExerciseHistorySessionEntry[]): WeekSetGroup[] =>
  [...entries]
    .sort((left, right) => left.completedAt.getTime() - right.completedAt.getTime())
    .map((entry) => ({
      key: entry.sessionExerciseId,
      sessionId: entry.sessionId,
      title: formatWeekDay(entry.completedAt),
      detail: entry.gymName?.trim() ? entry.gymName : 'No gym',
      workingSetCount: entry.workingSetCount,
      rows: entry.sets.map((set) => setRow({ ...set, id: set.setId }, entry.loadContext)),
    }));

type MuscleBlock = WeekSetGroup & { completedAt: number; sets: MuscleSetContribution[] };

/** One card per exercise block that worked the muscle, titled by the exercise. */
export const muscleWeekGroups = (contributions: MuscleSetContribution[]): WeekSetGroup[] => {
  const blocks = new Map<string, MuscleBlock>();
  const seen = new Set<string>();
  for (const contribution of contributions) {
    if (seen.has(contribution.setIdentity)) continue;
    seen.add(contribution.setIdentity);
    const block = blocks.get(contribution.sessionExerciseId) ?? {
      key: contribution.sessionExerciseId,
      sessionId: contribution.sessionId,
      title: contribution.exerciseName ?? 'Exercise',
      detail: formatWeekDay(contribution.sessionCompletedAt),
      workingSetCount: 0,
      rows: [],
      completedAt: contribution.sessionCompletedAt.getTime(),
      sets: [],
    };
    block.sets.push(contribution);
    if (contribution.working) block.workingSetCount += 1;
    blocks.set(contribution.sessionExerciseId, block);
  }
  return [...blocks.values()]
    .sort((left, right) => left.completedAt - right.completedAt)
    .map(({ completedAt: _completedAt, sets, ...group }) => ({
      ...group,
      rows: [...sets]
        .sort((left, right) => (left.setOrderIndex ?? 0) - (right.setOrderIndex ?? 0))
        .map((set) => setRow({ ...set, id: set.setId ?? set.setIdentity })),
    }));
};

const loadWeekGroups = async (target: WeekSetsTarget, weekKey: string): Promise<WeekSetGroup[]> => {
  const bounds = localWeekBounds(weekKey);
  if ('exerciseDefinitionId' in target) {
    return exerciseWeekGroups(await loadExerciseRangeEntries({ ...bounds, exerciseDefinitionId: target.exerciseDefinitionId }));
  }
  const days = await computeSelectedMuscleDailyEffort({ ...bounds, muscleGroupIds: target.muscleGroupIds });
  return muscleWeekGroups(days.flatMap((day) => day.contributions));
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
