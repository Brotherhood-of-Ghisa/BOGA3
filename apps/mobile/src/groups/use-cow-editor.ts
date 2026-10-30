import { canManageGroup } from './write-view-model';
import { useCallback, useEffect, useState } from 'react';
import { cancelCoW, createCoW, getCoW, getCoWCalendar, getGroup, isCoWNotFound, listCoWs, listCompetitionExercises, toGroupApiError, updateCoW } from './api';
import { groupCacheKeys } from './cache';
import { coWDraftFrom, createCoWId, emptyCoWDraft, validateCoWDraft, type CoWDraft } from './cow-draft';
import type { CoWMetric } from './cow-scoring';
import { useCoWCalendar } from './use-cow-calendar';
import { useCoWDefinition } from './use-cow-definition';
import { useGroupAction } from './use-group-action';
import { useGroupResource } from './use-group-resource';

/** Retain intent through refresh and resolve uncertain writes before enabling another create. */
export function useCoWEditor(groupId: string, cowId: string | null, userId: string) {
  const readGroup = useCallback(() => getGroup(groupId), [groupId]);
  const group = useGroupResource({ userId, cacheKey: groupCacheKeys.group(groupId), fetcher: readGroup, evictGroupIdOnNotFound: groupId });
  const readExercises = useCallback(() => listCompetitionExercises(groupId), [groupId]);
  const exercises = useGroupResource({ userId, cacheKey: groupCacheKeys.groupExercises(groupId), fetcher: readExercises, evictGroupIdOnNotFound: groupId });
  const calendar = useCoWCalendar(groupId, userId);
  const definition = useCoWDefinition(groupId, cowId, userId);
  const cow = definition.firstPage?.cow;
  const calendarKey = calendar.firstPage?.next_week_start ? `${calendar.firstPage.next_week_start}:${calendar.firstPage.time_zone}` : null;
  const [reviewedCalendar, setReviewedCalendar] = useState<string | null>(null);
  if (reviewedCalendar === null && calendarKey) setReviewedCalendar(calendarKey);
  const weekChanged = !cowId && reviewedCalendar !== null && calendarKey !== null && reviewedCalendar !== calendarKey;
  const [requestId] = useState(createCoWId);
  const [stored, setStored] = useState<CoWDraft | null>(() => cowId ? null : emptyCoWDraft);
  const initial = cow ? coWDraftFrom(cow) : emptyCoWDraft;
  if (stored === null && cow) setStored(initial);
  const draft = stored ?? initial;
  const [showErrors, setShowErrors] = useState(false);
  const [uncertain, setUncertain] = useState<'save' | 'cancel' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [occupied, setOccupied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!cow || cow.state !== 'scheduled') return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, cow.starts_at_us / 1000 - Date.now()));
    return () => clearTimeout(timer);
  }, [cow]);
  const editable = !cowId || cow?.state === 'scheduled' && now < cow.starts_at_us / 1000;
  const errors = validateCoWDraft(draft, exercises.data?.exercises ?? null);
  const action = useGroupAction(async (command: 'save' | 'cancel') => {
    if (command === 'cancel') return cancelCoW(groupId, cowId!, draft.revision!);
    if (cowId) return updateCoW(groupId, cowId, { revision: draft.revision!, groupExerciseId: draft.exerciseId!, metrics: draft.metrics });
    const cal = calendar.firstPage!;
    return createCoW(groupId, { cowId: requestId, groupExerciseId: draft.exerciseId!, metrics: draft.metrics,
      calendarRevision: cal.revision, weekStart: cal.next_week_start! });
  });
  const run = async (command: 'save' | 'cancel') => {
    setShowErrors(true); setMessage(null);
    if (!group.data || !canManageGroup(group.data.group.my_role) || !editable || uncertain || checking || occupied || action.pending || command === 'save' && (errors.exercise || errors.metrics || !calendar.firstPage?.next_week_start)) return false;
    if (command === 'save' && weekChanged) { setReviewedCalendar(calendarKey); setMessage('Week changed. Review the new dates.'); return false; }
    const result = await action.run(command);
    if (result.ok) return true;
    if (result.error.invalidPayload || result.error.code === 'INTERNAL' || result.error.code === 'NETWORK' && !action.offline || result.error.code === 'CONFLICT') {
      setUncertain(command); setMessage("Couldn't confirm the CoW. Check status before trying again.");
    } else setMessage(result.error.code === 'FORBIDDEN' ? 'Only owners and admins can manage CoWs.'
      : result.error.code === 'VALIDATION' ? 'Review the exercise, leaderboards and next week.'
      : action.offline ? "You're offline. Connect to the internet and try again." : "Couldn't save the CoW. Try again.");
    if (['FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'VALIDATION'].includes(result.error.code)) void Promise.all([group.refresh(), definition.refresh(), calendar.refresh()]);
    return false;
  };
  const checkStatus = async () => {
    if (checking || action.offline) return false;
    setChecking(true);
    try {
      const current = await getCoW(groupId, cowId ?? requestId).catch(error => { if (isCoWNotFound(error)) return null; throw error; });
      if (current && (!cowId || uncertain === 'cancel' && current.cow.state === 'cancelled' || uncertain === 'save' && current.cow.revision > (draft.revision ?? 0) &&
        current.cow.group_exercise_id === draft.exerciseId && JSON.stringify(current.cow.metrics) === JSON.stringify(draft.metrics))) return true;
      const [cal, list] = await Promise.all([getCoWCalendar(groupId), listCoWs(groupId)]);
      const taken = !cowId && list.cows.some(row => row.state === 'scheduled' && row.week_start === cal.next_week_start);
      setOccupied(taken); setUncertain(null); action.reset();
      if (current) setStored(previous => ({ ...(previous ?? draft), revision: current.cow.revision }));
      setMessage(taken ? 'A CoW is already scheduled.' : current ? 'Review your selections before saving again.' : 'No CoW was created. Review next week and try again.');
      await Promise.all([group.refresh(), definition.refresh(), calendar.refresh(), exercises.refresh()]);
    } catch (caught) {
      const error = toGroupApiError(caught);
      setMessage(error.code === 'NETWORK' ? "You're offline. Check status when connected." : "Couldn't check the CoW. Try again.");
      if (error.code === 'NOT_FOUND') void group.refresh();
    } finally { setChecking(false); }
    return false;
  };
  const pickExercise = (exerciseId: string) => setStored(previous => ({ ...(previous ?? draft), exerciseId }));
  const toggleMetric = (metric: CoWMetric) => setStored(previous => {
    const value = previous ?? draft;
    const metrics = value.metrics.includes(metric) ? value.metrics.filter(row => row !== metric) : [...value.metrics, metric];
    return { ...value, metrics: (['e1rm', 'improvement', 'volume'] as CoWMetric[]).filter(row => metrics.includes(row)) };
  });
  return { group, exercises, calendar, definition, cow, draft, validation: errors, errors: showErrors ? errors : { exercise: null, metrics: null },
    run, checkStatus, pickExercise, toggleMetric, message: weekChanged ? 'Week changed. Review the new dates.' : message, weekChanged, uncertain, checking, occupied, pending: action.pending, offline: action.offline,
    editable };
}
