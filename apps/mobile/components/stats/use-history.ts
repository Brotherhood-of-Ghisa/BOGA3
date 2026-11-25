import { useEffect, useState } from 'react';
import {
  computeSelectedExerciseHistoryEffort, computeSelectedExercisesHistoryEffort, computeSelectedMuscleHistoryEffort,
  type DailyEffortMetrics, type SelectedMuscleWeeklyEffort,
} from '@/src/data';
import { historyWeekBounds } from '@/src/utils/calendar-weeks';
import { encodeGymRouteParam, type GymScopeOption } from '@/src/utils/gym-scope-route';

/** Muscle scopes use reported IDs and independent Sets and Volume effort filters. */
type MuscleHistorySubject = (
  | { id: string; ids?: never }
  | { id?: never; ids: string[] }
) & { kind: 'muscle'; gymId?: string | null; countSecondary?: boolean; countSecondaryVolume?: boolean };

export type HistorySubject =
  | { kind: 'exercise'; id: string; ids?: never; gymId?: string | null }
  | { kind: 'exercises'; id?: never; ids: readonly string[]; gymId?: string | null }
  | MuscleHistorySubject;

export const historySubjectId = (subject: HistorySubject | null): string | null =>
  subject?.ids ? JSON.stringify(subject.ids) : subject?.id?.trim() || null;

export const historyMuscleIds = (subject: MuscleHistorySubject): string[] => subject.ids ?? [subject.id.trim()];

const NO_GYMS: GymScopeOption[] = [];

const loadHistory = async (subject: HistorySubject, id: string, weeks: number) => {
  // One clock for the window and the workout in progress, which counts here.
  const now = new Date();
  const bounds = { ...historyWeekBounds(weeks, now), now };
  if (subject.kind === 'muscle') {
    return computeSelectedMuscleHistoryEffort({ ...bounds, muscleGroupIds: historyMuscleIds(subject), ...(subject.gymId === undefined ? {} : { gymId: subject.gymId }),
      countSecondary: subject.countSecondary, countSecondaryVolume: subject.countSecondaryVolume });
  }
  const scope = { ...bounds, ...(subject.gymId === undefined ? {} : { gymId: subject.gymId }) };
  return subject.kind === 'exercises'
    ? computeSelectedExercisesHistoryEffort({ ...scope, exerciseDefinitionIds: subject.ids })
    : computeSelectedExerciseHistoryEffort({ ...scope, exerciseDefinitionId: id });
};

/**
 * The read behind one history page. A superseded window, a changed subject or
 * an account unmount cannot publish its read: every published value carries the
 * (subject, window, revision) it was read for. Until the current one lands the
 * hook is loading, and keeps returning the subject's last read, so a gym or
 * secondary-set change redraws the chart once instead of tearing it down for a
 * spinner. Another subject or account never shows this one's figures, and a
 * failed read returns nothing.
 */
export function useHistory(subject: HistorySubject | null, weeks: number, revision: number, accountRevision: number) {
  const kind = subject?.kind ?? null;
  const id = historySubjectId(subject);
  const gymId = subject?.gymId;
  const gymKey = encodeGymRouteParam(gymId) ?? '';
  const primaryOnly = subject?.kind === 'muscle' && subject.countSecondary === false;
  const primaryVolumeOnly = subject?.kind === 'muscle' && subject.countSecondaryVolume === false;
  const subjectKey = `${kind ?? ''}:${id ?? ''}:${accountRevision}`;
  const context = `${subjectKey}:${gymKey}:${primaryOnly ? 'primary' : 'all'}:${primaryVolumeOnly}:${weeks}:${revision}`;
  const [loading, setLoading] = useState(id !== null);
  const [loaded, setLoaded] = useState<{
    context: string; subjectKey: string; daily: DailyEffortMetrics[]; weekly: SelectedMuscleWeeklyEffort[]; gyms: GymScopeOption[];
  } | null>(null);
  const [failure, setFailure] = useState<{ context: string; message: string } | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  useEffect(() => {
    if (subject === null || id === null) return;
    let active = true;
    const read = async () => {
      setLoading(true);
      setFailure(null);
      try {
        const next = await loadHistory(subject, id, weeks);
        if (!active) return;
        setLoaded({ context, subjectKey, daily: next.daily, weekly: next.weekly, gyms: next.gyms });
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Retry repeats the same context read; `subject` is read through kind, id, gym and primaryOnly.
  }, [kind, id, gymKey, primaryOnly, primaryVolumeOnly, weeks, revision, accountRevision, retryRevision]);
  const current = loaded?.context === context ? loaded : null;
  const error = failure?.context === context ? failure.message : null;
  const shown = id === null ? null : current ?? (error === null && loaded?.subjectKey === subjectKey ? loaded : null);
  return {
    daily: shown?.daily ?? [], weekly: shown?.weekly ?? [],
    // The gym choices outlive a gym or secondary-set change on the same
    // subject, so the picker stays put while the new read loads.
    gyms: loaded?.subjectKey === subjectKey ? loaded.gyms : NO_GYMS,
    loading: id !== null && (loading || (!current && !error)),
    error,
    retry: () => setRetryRevision(value => value + 1),
  };
}
