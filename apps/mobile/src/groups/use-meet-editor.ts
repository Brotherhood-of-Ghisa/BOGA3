import { useDateFormat } from '../preferences/hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createMeet, getGroup, getMeet, isMeetNotFound, listCompetitionExercises, saveMeetChallenge, updateMeet } from './api';
import { groupCacheKeys } from './cache';
import { createCoWId } from './cow-draft';
import { emptyMeetDraft, meetDraftFields, meetDraftFrom, sameMeetFields, updateMeetDraft, type MeetDraft, type StagedMeetChallenge } from './meet-draft';
import { meetPermissions, meetWriteMessage } from './meet-presentation';
import { checkMeetAddress, type MeetLocation } from './meet-location';
import { useGroupAction } from './use-group-action';
import { useGroupResource } from './use-group-resource';
import { useCoWCalendar } from './use-cow-calendar';
import { useMeet, useMeetClock } from './use-meets';

/** Draft intent is never replaced by a background refresh. Conflict rebasing is explicit. */
export function useMeetEditor(groupId: string, meetId: string | null, userId: string) {
  const preferredFormat = useDateFormat(); const [dateFormat] = useState(preferredFormat);
  const read = useCallback(() => getGroup(groupId), [groupId]);
  const group = useGroupResource({ userId, cacheKey: groupCacheKeys.group(groupId), fetcher: read, evictGroupIdOnNotFound: groupId });
  const readExercises = useCallback(() => listCompetitionExercises(groupId), [groupId]);
  const exercises = useGroupResource({ userId, cacheKey: groupCacheKeys.groupExercises(groupId), fetcher: readExercises, evictGroupIdOnNotFound: groupId });
  const calendar = useCoWCalendar(groupId, userId);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const effectiveId = meetId ?? createdId;
  const [staged, setStaged] = useState<StagedMeetChallenge[]>([]);
  const definition = useMeet(groupId, effectiveId, userId); const meet = definition.data?.meet;
  const zone = meet?.time_zone ?? calendar.firstPage?.time_zone ?? null;
  const [requestId] = useState(createCoWId);
  const [draft, setDraft] = useState<MeetDraft | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  if (!draft && zone && (!meetId || meet)) { setDraft(meet ? meetDraftFrom(meet, zone, dateFormat) : emptyMeetDraft(zone, dateFormat)); setVersion(meet?.version ?? null); }
  const [defaultEnd, setDefaultEnd] = useState(!meetId);
  const [message, setMessage] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<MeetLocation | null>(null);
  const [checkingAddress, setCheckingAddress] = useState(false);
  const addressSequence = useRef(0);
  const now = useMeetClock();
  const permissions = meet ? meetPermissions(meet, group.data?.group.my_role ?? 'member', now) : null;
  const action = useGroupAction(async () => {
    const fields = meetDraftFields(draft!, zone!, dateFormat)!;
    const written = effectiveId ? await updateMeet(groupId, effectiveId, version!, fields) : await createMeet(groupId, requestId, fields);
    setCreatedId(written.meet.meet_id); setVersion(written.meet.version);
    for (const challenge of staged) {
      await saveMeetChallenge({ groupId, meetId: written.meet.meet_id, ...challenge, version: null });
      setStaged(previous => previous.filter(row => row.challengeId !== challenge.challengeId));
    }
    setStaged([]);
    return written;
  });
  useEffect(() => { if (createdId && !action.pending) void definition.refresh(); }, [createdId, action.pending, definition.refresh]);
  const change = (key: keyof MeetDraft, value: string) => {
    if (!draft || !zone) return;
    if (key === 'end' || key === 'endDate') setDefaultEnd(false);
    if (key === 'address') { addressSequence.current++; setPreview(null); setCheckingAddress(false); }
    setDraft(updateMeetDraft(draft, key, value, zone, { defaultEnd, format: dateFormat }));
  };
  const checkAddress = async () => {
    if (!draft) return;
    const sequence = ++addressSequence.current; const address = draft.address;
    setCheckingAddress(true);
    const result = await checkMeetAddress(address, !action.offline);
    if (sequence !== addressSequence.current) return;
    setCheckingAddress(false); setPreview(result.latitude === null ? null : result);
    setDraft(previous => previous?.address === address ? { ...previous, latitude: result.latitude, longitude: result.longitude } : previous);
  };
  const save = async () => {
    if (!draft || !zone || blocked || action.pending || checking || checkingAddress) return null;
    if (!meetDraftFields(draft, zone, dateFormat)) { setMessage('Check the date, start, end and venue.'); return null; }
    const result = await action.run();
    if (result.ok) return result.value.meet.meet_id;
    setMessage(meetWriteMessage(result.error.code, action.offline));
    void definition.refresh();
    if (!action.offline && ['NETWORK', 'INTERNAL', 'CONFLICT'].includes(result.error.code)) setBlocked(true);
    return null;
  };
  const checkStatus = async () => {
    if (checking || action.offline) return null;
    setChecking(true);
    try {
      const current = await getMeet(groupId, effectiveId ?? requestId).catch(error => { if (isMeetNotFound(error)) return null; throw error; });
      const fields = draft && zone ? meetDraftFields(draft, zone, dateFormat) : null;
      if (current) {
        setCreatedId(current.meet.meet_id);
        setStaged(previous => previous.filter(row => !current.challenges.some(saved => saved.challenge_id === row.challengeId)));
      }
      const challengesSaved = current && staged.every(c => current.challenges.some(stored => stored.challenge_id === c.challengeId && stored.group_exercise_id === c.exerciseId && stored.metric === c.metric));
      if (current && fields && sameMeetFields(current.meet, fields) && challengesSaved) return current.meet.meet_id;
      setVersion(current?.meet.version ?? null); setBlocked(false);
      setMessage('Review your input before saving again.');
      await Promise.all([definition.refresh(), group.refresh()]);
    } catch { setMessage("Couldn't check status. Try again when connected."); }
    finally { setChecking(false); }
    return null;
  };
  return { dateFormat, group, exercises, calendar, definition, meet, zone, draft, change, version, message, blocked, checking, save, checkStatus,
    staged, setStaged, preview, checkAddress, checkingAddress, pending: action.pending, offline: action.offline, permissions };
}
