import { useEffect, useState } from 'react';
import {
  computeSelectedExerciseHistoryEffort, computeSelectedMuscleHistoryEffort,
  type DailyEffortMetrics, type SelectedMuscleWeeklyEffort,
} from '@/src/data';
import { calendarWeekBounds, keepHistorySelection } from '@/src/utils/calendar-weeks';

type MuscleTarget = { muscleGroupIds: string[] };
type ExerciseTarget = { exerciseDefinitionId: string };

export const isIndividualMuscleHistoryTarget = (target: MuscleTarget): boolean =>
  target.muscleGroupIds.length === 1 && target.muscleGroupIds[0].trim().length > 0;

const loadHistory = async (target: MuscleTarget | ExerciseTarget, weeks: number) => {
  const bounds = calendarWeekBounds(weeks);
  return 'muscleGroupIds' in target
    ? computeSelectedMuscleHistoryEffort({ ...bounds, muscleGroupIds: target.muscleGroupIds })
    : computeSelectedExerciseHistoryEffort({ ...bounds, exerciseDefinitionId: target.exerciseDefinitionId });
};

/** A superseded window, dismissed sheet or account unmount cannot publish its read. */
export function useHistory<T extends MuscleTarget | ExerciseTarget>(weeks: number, revision: number) {
  const [selected, setSelected] = useState<T | null>(null);
  const [daily, setDaily] = useState<DailyEffortMetrics[]>([]);
  const [weekly, setWeekly] = useState<SelectedMuscleWeeklyEffort[]>([]);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<{ selected: T; weeks: number; revision: number; message: string } | null>(null);
  const [snapshot, setSnapshot] = useState<{ selected: T; weeks: number; revision: number } | null>(null);
  const [weekKey, setWeekKey] = useState<string | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const currentWeekKey = weekKey === null ? null : keepHistorySelection(weekKey, weeks);
  if (weekKey !== null && weekKey !== currentWeekKey) setWeekKey(currentWeekKey);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    const read = async () => {
      setLoading(true);
      setFailure(null);
      try {
        const next = await loadHistory(selected, weeks);
        if (!active) return;
        setSnapshot({ selected, weeks, revision });
        setDaily(next.daily);
        setWeekly(next.weekly);
        setWeekKey(previous => keepHistorySelection(previous, weeks));
      } catch (cause) {
        if (active) setFailure({ selected, weeks, revision, message: cause instanceof Error ? cause.message : 'Unknown error' });
      } finally {
        if (active) setLoading(false);
      }
    };
    // Commit the sheet and its spinner to native before any synchronous SQLite
    // or aggregation work. The timer yields after the first animation frame.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => { timer = setTimeout(() => { void read(); }, 0); });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [selected, weeks, revision, retryRevision]);
  const select = (target: T) => {
    const valid = !('muscleGroupIds' in target) || isIndividualMuscleHistoryTarget(target);
    setLoading(valid);
    setDaily([]);
    setWeekly([]);
    setWeekKey(null);
    setFailure(null);
    setSelected(valid ? target : null);
  };
  const dismiss = () => setSelected(null);
  const retry = () => setRetryRevision(value => value + 1);
  const current = snapshot?.selected === selected && snapshot?.weeks === weeks && snapshot?.revision === revision;
  const error = failure?.selected === selected && failure?.weeks === weeks && failure?.revision === revision ? failure.message : null;
  return { selected, daily: current ? daily : [], weekly: current ? weekly : [], loading: !!selected && (loading || (!current && !error)), error, weekKey: currentWeekKey, select, dismiss, retry, selectWeek: setWeekKey };
}
