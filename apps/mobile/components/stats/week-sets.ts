import { useDateFormat } from '@/src/preferences/hooks';
import { formatShortDate } from '@/src/utils/local-time';
import type { ExerciseDateFormat } from '@/src/preferences/model';
// The sets of one history week for the Timeline's week list
// the blocks to list, each drawn with View
// Session's card for it (`loadCompletedSessionCards`).
import { useEffect, useState } from 'react';

import {
  countMuscleSets,
  computeSelectedMuscleDailyEffort,
  loadExerciseRangeEntries,
  loadLocalGymById,
  loadSessionSnapshotById,
  type ExerciseHistorySessionEntry,
  type MuscleSetContribution,
} from '@/src/data';
import type { RecordLine } from '@/src/session-insights/record-band';
import { loadCompletedSessionCards } from '@/src/session-recorder/completed-session-cards';
import type { CompletedSessionDetailCard } from '@/src/session-recorder/completed-session-detail-model';
import type { SessionViewSetRow } from '@/src/session-recorder/session-view-model';
import { historyWeekBounds, localWeekBounds } from '@/src/utils/calendar-weeks';
import { startOfLocalDay } from '@/src/utils/local-calendar';
import { inProgressSessionDate } from '@/src/data/in-progress-session';
import { loadActiveSessionId } from '@/src/session-entry';
import { addFiniteVolume } from '@/src/exercise-calculations/analytics';
import { encodeGymRouteParam, NO_GYM_LABEL } from '@/src/utils/gym-scope-route';

export type WeekSetGroup = {
  key: string;
  sessionId: string;
  title: string;
  detail: string;
  rows: SessionViewSetRow[];
  record: RecordLine[];
  // The block's exercise, on a muscle's list only: the card links to its progress.
  exerciseDefinitionId: string | null;
  // How the block worked the muscle, on a muscle's list only.
  role: WeekBlockRole | null;
  contribution?: { sets: number; volume: number | null };
};

/** A block counts as primary work when any of its sets worked the muscle as primary. */
export type WeekBlockRole = 'primary' | 'secondary';

/** One session block to list: its card's title, or the card's exercise name when absent. */
export type WeekBlock = {
  sessionId: string;
  sessionExerciseId: string;
  completedAt: Date;
  title?: string;
  detail: string;
  exerciseDefinitionId?: string;
  role?: WeekBlockRole;
  contributions?: MuscleSetContribution[];
};

/** Each list follows its page's three-state gym scope. */
export type WeekSetsTarget = ({ exerciseDefinitionId: string } | { muscleGroupIds: string[]; countSecondary?: boolean;
  countSecondaryVolume?: boolean; metric?: 'workingSetCount' | 'totalVolume' })
  & { gymId?: string | null; includeInProgress?: boolean };

export const formatWeekDay = (date: Date, dateFormat: ExerciseDateFormat): string =>
  formatShortDate(date, dateFormat);

/** An exercise's blocks, titled by their day, with their gym. */
export const exerciseWeekBlocks = (entries: ExerciseHistorySessionEntry[], dateFormat: ExerciseDateFormat): WeekBlock[] =>
  entries.map((entry) => ({
    sessionId: entry.sessionId,
    sessionExerciseId: entry.sessionExerciseId,
    completedAt: entry.completedAt,
    title: formatWeekDay(entry.completedAt, dateFormat),
    detail: entry.gymName?.trim() ? entry.gymName : NO_GYM_LABEL,
  }));

/** The blocks that worked a muscle, titled by their exercise, with their day. */
export const muscleWeekBlocks = (contributions: MuscleSetContribution[], dateFormat: ExerciseDateFormat): WeekBlock[] => {
  const blocks = new Map<string, WeekBlock>();
  for (const contribution of contributions) {
    const role: WeekBlockRole = contribution.role === 'primary' ? 'primary' : 'secondary';
    const block = blocks.get(contribution.sessionExerciseId);
    if (block) {
      if (role === 'primary') block.role = role;
      block.contributions?.push(contribution);
      continue;
    }
    blocks.set(contribution.sessionExerciseId, {
      role,
      sessionId: contribution.sessionId,
      sessionExerciseId: contribution.sessionExerciseId,
      completedAt: contribution.sessionCompletedAt,
      detail: formatWeekDay(contribution.sessionCompletedAt, dateFormat),
      exerciseDefinitionId: contribution.exerciseDefinitionId,
      contributions: [contribution],
    });
  }
  return [...blocks.values()];
};

/** The listed blocks' cards, newest first; a block without a card (no performed set) is left out. */
export const weekSetGroups = (
  blocks: WeekBlock[],
  cardsBySessionId: ReadonlyMap<string, CompletedSessionDetailCard[]>
): WeekSetGroup[] =>
  [...blocks]
    .sort((left, right) => right.completedAt.getTime() - left.completedAt.getTime())
    .flatMap((block) => {
      const card = cardsBySessionId.get(block.sessionId)?.find((candidate) => candidate.id === block.sessionExerciseId);
      const ids = block.contributions ? new Set(block.contributions.map(row => row.setId)) : null;
      const rows = ids ? card?.rows.filter(row => ids.has(row.id)) ?? [] : card?.rows ?? [];
      return card ? [{
        key: block.sessionExerciseId,
        sessionId: block.sessionId,
        title: block.title ?? card.name,
        detail: block.detail,
        rows,
        // A whole-exercise Volume band can include sets hidden in this muscle view.
        record: ids ? card.record.filter(line => ids.has(line.key)) : card.record,
        exerciseDefinitionId: block.exerciseDefinitionId ?? null,
        role: block.role ?? null,
        ...(block.contributions ? { contribution: {
          sets: countMuscleSets(block.contributions).weightedSetCount,
          volume: block.contributions.reduce<number | null>((sum, row) => addFiniteVolume(sum, row.weightedVolume ?? 0), 0),
        } } : {}),
      }] : [];
    });

export type SetPeriod = { weekKey: string; dayKey?: string };

export const setPeriodBounds = (period: SetPeriod, lookbackWeeks?: number, now = new Date()) => {
  const day = period.dayKey ? new Date(`${period.dayKey}T00:00:00`) : null;
  const bounds = day ? { start: day, end: startOfLocalDay(day, 1) } : localWeekBounds(period.weekKey);
  if (lookbackWeeks === undefined) return bounds;
  const history = historyWeekBounds(lookbackWeeks, now);
  return { start: new Date(Math.max(bounds.start.getTime(), history.start.getTime())),
    end: new Date(Math.min(bounds.end.getTime(), history.end.getTime())) };
};

const inProgressExerciseBlocks = async (target: Extract<WeekSetsTarget, { exerciseDefinitionId: string }>,
  bounds: { start: Date; end: Date }, dateFormat: ExerciseDateFormat, now: Date): Promise<WeekBlock[]> => {
  if (!target.includeInProgress) return [];
  const completedAt = inProgressSessionDate(now);
  if (completedAt < bounds.start || completedAt >= bounds.end) return [];
  const sessionId = await loadActiveSessionId();
  const graph = sessionId ? await loadSessionSnapshotById(sessionId) : null;
  if (!graph || graph.status !== 'active' || (target.gymId !== undefined && (graph.gymId ?? null) !== target.gymId)) return [];
  const gymName = graph.gymId ? (await loadLocalGymById(graph.gymId))?.name : null;
  return graph.exercises.filter(exercise => exercise.exerciseDefinitionId === target.exerciseDefinitionId)
    .map(exercise => ({ sessionId: graph.sessionId, sessionExerciseId: exercise.id, completedAt,
      title: formatWeekDay(completedAt, dateFormat), detail: gymName?.trim() || NO_GYM_LABEL }));
};

const loadWeekBlocks = async (target: WeekSetsTarget, period: SetPeriod, dateFormat: ExerciseDateFormat, lookbackWeeks?: number): Promise<WeekBlock[]> => {
  const now = new Date();
  const bounds = setPeriodBounds(period, lookbackWeeks, now);
  if ('exerciseDefinitionId' in target) {
    const entries = await loadExerciseRangeEntries({ ...bounds, exerciseDefinitionId: target.exerciseDefinitionId });
    const { gymId } = target;
    return [...exerciseWeekBlocks(gymId === undefined ? entries : entries.filter((entry) => (entry.gymId ?? null) === gymId), dateFormat),
      ...await inProgressExerciseBlocks(target, bounds, dateFormat, now)];
  }
  const days = await computeSelectedMuscleDailyEffort({ ...bounds, muscleGroupIds: target.muscleGroupIds, gymId: target.gymId,
    countSecondary: target.countSecondary, countSecondaryVolume: target.countSecondaryVolume,
    ...(target.includeInProgress ? { now } : {}) });
  return muscleWeekBlocks(days.flatMap((day) => day.contributions).filter(contribution =>
    target.metric === 'totalVolume' ? contribution.volumeIncluded : contribution.working), dateFormat);
};

const loadWeekGroups = async (target: WeekSetsTarget, period: SetPeriod, dateFormat: ExerciseDateFormat, lookbackWeeks?: number): Promise<WeekSetGroup[]> => {
  const blocks = await loadWeekBlocks(target, period, dateFormat, lookbackWeeks);
  const sessionIds = [...new Set(blocks.map((block) => block.sessionId))];
  const cards = await Promise.all(sessionIds.map(sessionId => loadCompletedSessionCards(sessionId, target.includeInProgress)));
  return weekSetGroups(blocks, new Map(sessionIds.map((sessionId, index) => [sessionId, cards[index]])));
};

export type WeekSetsState = { groups: WeekSetGroup[]; loading: boolean; error: string | null };

/**
 * The selected week's sets; a superseded week or an unmount cannot publish its
 * read. While a newer request for the same subject loads, the last read's
 * cards stay listed, so a week, gym or secondary-set change swaps the cards
 * once instead of blanking the list; another subject's cards never show.
 */
export function useWeekSets(target: WeekSetsTarget | null, weekKey: string | null, revision = 0): WeekSetsState {
  const { groups, loading, error } = usePeriodSets(target, weekKey === null ? null : { weekKey }, revision);
  return { groups, loading, error };
}

/** Shares the Timeline's reader with day/week detail; account changes discard old cards. */
export function usePeriodSets(target: WeekSetsTarget | null, period: SetPeriod | null, revision = 0, accountRevision = 0, lookbackWeeks?: number): WeekSetsState & { sameScope: boolean } {
  const dateFormat = useDateFormat();
  // The last read and the request it answered; a newer request is loading until its read lands.
  const [read, setRead] = useState<{ groups: WeekSetGroup[]; error: string | null; for: string | null; subject: string | null; scope: string | null }>(
    { groups: [], error: null, for: null, subject: null, scope: null });
  const subjectKey = target === null ? null : 'exerciseDefinitionId' in target
    ? `exercise:${target.exerciseDefinitionId}:${accountRevision}` : `muscle:${target.muscleGroupIds.join(',')}:${accountRevision}`;
  const targetKey = target === null ? null : 'exerciseDefinitionId' in target
    ? `${subjectKey}:${encodeGymRouteParam(target.gymId) ?? ''}` : `${subjectKey}:${encodeGymRouteParam(target.gymId) ?? ''}:${target.countSecondary}:${target.countSecondaryVolume}:${target.metric}`;
  const scopeKey = target === null || period === null ? null : `${targetKey}:${target.includeInProgress}|${period.weekKey}:${period.dayKey ?? ''}|${dateFormat}|${lookbackWeeks}`;
  const requestKey = scopeKey === null ? null : `${scopeKey}|${revision}`;
  useEffect(() => {
    if (target === null || period === null) return;
    let active = true;
    loadWeekGroups(target, period, dateFormat, lookbackWeeks).then(
      (groups) => { if (active) setRead({ groups, error: null, for: requestKey, subject: subjectKey, scope: scopeKey }); },
      (cause: unknown) => {
        if (active) setRead({ groups: [], error: cause instanceof Error ? cause.message : 'Unknown error', for: requestKey, subject: subjectKey, scope: scopeKey });
      },
    );
    return () => { active = false; };
    // `requestKey` names the target, week and revision; `target` is read through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);
  if (requestKey === null) return { groups: [], loading: false, error: null, sameScope: false };
  const current = read.for === requestKey;
  return { groups: current || read.subject === subjectKey ? read.groups : [], loading: !current, error: current ? read.error : null,
    sameScope: read.scope === scopeKey };
}
