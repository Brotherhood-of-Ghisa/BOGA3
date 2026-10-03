import { useEffect, useState } from 'react';
import {
  computeSelectedExerciseDailyEffort, computeSelectedExerciseWeeklyEffort,
  computeSelectedMuscleDailyEffortMetrics, computeSelectedMuscleWeeklyEffort,
  type DailyEffortMetrics, type SelectedMuscleWeeklyEffort,
} from '@/src/data';
import { calendarWeekBounds, keepHistorySelection } from '@/src/utils/calendar-weeks';

type MuscleTarget = { muscleGroupIds: string[] };
type ExerciseTarget = { exerciseDefinitionId: string };

const loadHistory = async (target: MuscleTarget | ExerciseTarget, weeks: number) => {
  const bounds = calendarWeekBounds(weeks);
  const [weekly, daily] = 'muscleGroupIds' in target ? await Promise.all([
    computeSelectedMuscleWeeklyEffort({ ...bounds, muscleGroupIds: target.muscleGroupIds }),
    computeSelectedMuscleDailyEffortMetrics({ ...bounds, muscleGroupIds: target.muscleGroupIds }),
  ]) : await Promise.all([
    computeSelectedExerciseWeeklyEffort({ ...bounds, exerciseDefinitionId: target.exerciseDefinitionId }),
    computeSelectedExerciseDailyEffort({ ...bounds, exerciseDefinitionId: target.exerciseDefinitionId }),
  ]);
  return { weekly, daily };
};

/** A superseded window, dismissed sheet or account unmount cannot publish its read. */
export function useHistory<T extends MuscleTarget | ExerciseTarget>(weeks: number, revision: number) {
  const [selected, setSelected] = useState<T | null>(null);
  const [daily, setDaily] = useState<DailyEffortMetrics[]>([]);
  const [weekly, setWeekly] = useState<SelectedMuscleWeeklyEffort[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weekKey, setWeekKey] = useState<string | null>(null);
  const currentWeekKey = weekKey === null ? null : keepHistorySelection(weekKey, weeks);
  if (weekKey !== null && weekKey !== currentWeekKey) setWeekKey(currentWeekKey);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    const read = async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await loadHistory(selected, weeks);
        if (!active) return;
        setDaily(next.daily);
        setWeekly(next.weekly);
        setWeekKey(previous => keepHistorySelection(previous, weeks));
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Unknown error');
      } finally {
        if (active) setLoading(false);
      }
    };
    void read();
    return () => { active = false; };
  }, [selected, weeks, revision]);
  const select = (target: T) => {
    setDaily([]);
    setWeekly([]);
    setWeekKey(null);
    setError(null);
    setSelected(target);
  };
  const dismiss = () => setSelected(null);
  return { selected, daily, weekly, loading, error, weekKey: currentWeekKey, select, dismiss, selectWeek: setWeekKey };
}
