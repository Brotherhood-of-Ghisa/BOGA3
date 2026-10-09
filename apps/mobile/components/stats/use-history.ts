import { useEffect, useState } from 'react';
import {
  computeSelectedExerciseHistoryEffort, computeSelectedMuscleHistoryEffort,
  type DailyEffortMetrics, type SelectedMuscleWeeklyEffort,
} from '@/src/data';
import { calendarWeekBounds } from '@/src/utils/calendar-weeks';

/** What one history page is about: one exercise definition or one muscle group. */
export type HistorySubject =
  | { kind: 'exercise'; id: string }
  | { kind: 'muscle'; id: string };

const historySubjectId = (subject: HistorySubject | null): string | null => {
  const id = subject?.id.trim();
  return id ? id : null;
};

const loadHistory = async (kind: HistorySubject['kind'], id: string, weeks: number) => {
  const bounds = calendarWeekBounds(weeks);
  return kind === 'muscle'
    ? computeSelectedMuscleHistoryEffort({ ...bounds, muscleGroupIds: [id] })
    : computeSelectedExerciseHistoryEffort({ ...bounds, exerciseDefinitionId: id });
};

/**
 * The read behind one history page. A superseded window, a changed subject or
 * an account unmount cannot publish its read: every published value carries the
 * (subject, window, revision) it was read for, and the page shows nothing until
 * the current one has landed.
 */
export function useHistory(subject: HistorySubject | null, weeks: number, revision: number) {
  const kind = subject?.kind ?? null;
  const id = historySubjectId(subject);
  const context = `${kind ?? ''}:${id ?? ''}:${weeks}:${revision}`;
  const [loading, setLoading] = useState(id !== null);
  const [loaded, setLoaded] = useState<{ context: string; daily: DailyEffortMetrics[]; weekly: SelectedMuscleWeeklyEffort[] } | null>(null);
  const [failure, setFailure] = useState<{ context: string; message: string } | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  useEffect(() => {
    if (kind === null || id === null) return;
    let active = true;
    const read = async () => {
      setLoading(true);
      setFailure(null);
      try {
        const next = await loadHistory(kind, id, weeks);
        if (!active) return;
        setLoaded({ context, daily: next.daily, weekly: next.weekly });
      } catch (cause) {
        if (active) setFailure({ context, message: cause instanceof Error ? cause.message : 'Unknown error' });
      } finally {
        if (active) setLoading(false);
      }
    };
    // Commit the page and its spinner to native before any synchronous SQLite
    // or aggregation work. The timer yields after the first animation frame.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => { timer = setTimeout(() => { void read(); }, 0); });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Retry repeats the same context read.
  }, [kind, id, weeks, revision, retryRevision]);
  const current = loaded?.context === context ? loaded : null;
  const error = failure?.context === context ? failure.message : null;
  return {
    daily: current?.daily ?? [], weekly: current?.weekly ?? [],
    loading: id !== null && (loading || (!current && !error)),
    error,
    retry: () => setRetryRevision(value => value + 1),
  };
}
