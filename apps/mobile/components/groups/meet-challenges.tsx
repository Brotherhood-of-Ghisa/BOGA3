import type { StagedMeetChallenge } from '@/src/groups/meet-draft';
import { useCallback, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { ActionButton, ChoiceRow, FormSection, ScreenScroll, Sheet, uiSpace, useUiText } from '@/components/ui';
import { listCompetitionExercises, removeMeetChallenge, saveMeetChallenge } from '@/src/groups/api';
import { groupCacheKeys } from '@/src/groups/cache';
import { createCoWId } from '@/src/groups/cow-draft';
import { canEditMeetChallenge, MEET_METRICS, meetMetrics, meetPermissions, meetWriteMessage } from '@/src/groups/meet-presentation';
import type { MeetChallengeWire, MeetDetailWire, MeetMetric } from '@/src/groups/meet-wire';
import { useGroupAction } from '@/src/groups/use-group-action';
import { useGroupResource } from '@/src/groups/use-group-resource';
import { useMeetClock } from '@/src/groups/use-meets';
import { GroupWriteNotice } from './write-notice';
import { GroupMissingDataState, pickInlineError } from './group-state-view';

/** Online-only challenge editor; author/admin actions and per-challenge versions. */
export function MeetChallenges({ data, userId, onChanged }: { data: MeetDetailWire; userId: string; onChanged: () => Promise<void> }) {
  const catalogueRead = useCallback(() => listCompetitionExercises(data.meet.group_id), [data.meet.group_id]);
  const catalogue = useGroupResource({ userId, cacheKey: groupCacheKeys.groupExercises(data.meet.group_id), fetcher: catalogueRead, evictGroupIdOnNotFound: data.meet.group_id });
  const [editing, setEditing] = useState<MeetChallengeWire | 'new' | null>(null);
  const text = useUiText(); const now = useMeetClock();
  const permissions = meetPermissions(data.meet, data.viewer.role, now);
  const remove = useGroupAction((challenge: MeetChallengeWire) => removeMeetChallenge(data.meet.group_id, data.meet.meet_id, challenge.challenge_id, challenge.version));
  const [message, setMessage] = useState<string | null>(null);
  const removeChallenge = async (challenge: MeetChallengeWire) => {
    const result = await remove.run(challenge);
    setMessage(result.ok ? null : meetWriteMessage(result.error.code, remove.offline));
    await onChanged();
  };
  return <>
    <FormSection title="Challenges">
      {data.challenges.map(challenge => <View key={challenge.challenge_id} testID={`meet-challenge-${challenge.challenge_id}`} style={{ padding: uiSpace.md, gap: uiSpace.sm }}>
        <Text allowFontScaling={false} style={text.bodyStrong}>{challenge.exercise_name}</Text>
        <Text allowFontScaling={false} style={text.body}>{MEET_METRICS[challenge.metric]}</Text>
        <Text allowFontScaling={false} style={text.meta}>{`Added by ${challenge.author?.username ?? 'Former member'}`}</Text>
        {permissions.challenges && canEditMeetChallenge(challenge, data.viewer.role, userId) ? <>
          <ActionButton label="Edit challenge" variant="text" disabled={remove.pending || !catalogue.data} onPress={() => setEditing(challenge)} />
          <ActionButton label="Remove challenge" variant="text" tone="danger" disabled={remove.pending || !catalogue.data} onPress={() => Alert.alert('Remove challenge?', challenge.exercise_name,
            [{ text: 'Keep challenge', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void removeChallenge(challenge) }])} />
        </> : null}
      </View>)}
      {!data.challenges.length ? <Text allowFontScaling={false} style={text.body}>No challenges</Text> : null}
      {permissions.challenges ? <ActionButton label="Add challenge" variant="text" testID="meet-add-challenge" disabled={!catalogue.data} onPress={() => setEditing('new')} /> : null}
    </FormSection>
    {message ? <GroupWriteNotice testID="meet-write-notice" message={message} tone="error" /> : null}
    {editing ? <MeetChallengeEditor key={editing === 'new' ? 'new' : editing.challenge_id} userId={userId}
      groupId={data.meet.group_id} meetId={data.meet.meet_id} challenge={editing === 'new' ? null : editing} onDismiss={() => setEditing(null)} onChanged={onChanged} /> : null}
  </>;
}


export function MeetChallengeEditor({ groupId, meetId, userId, challenge, onDismiss, onChanged, onStage }: {
  groupId: string; meetId: string | null; userId: string; challenge: MeetChallengeWire | null; onDismiss: () => void; onChanged: () => Promise<void>;
  onStage?: (challenge: StagedMeetChallenge) => void;
}) {
  const read = useCallback(() => listCompetitionExercises(groupId), [groupId]);
  const exercises = useGroupResource({ userId, cacheKey: groupCacheKeys.groupExercises(groupId), fetcher: read, evictGroupIdOnNotFound: groupId });
  const [challengeId] = useState(() => challenge?.challenge_id ?? createCoWId());
  const [exerciseId, setExerciseId] = useState(challenge?.group_exercise_id ?? '');
  const [metric, setMetric] = useState<MeetMetric>(challenge?.metric ?? 'e1rm');
  const [version, setVersion] = useState(challenge?.version ?? null);
  const [blocked, setBlocked] = useState(false); const [message, setMessage] = useState<string | null>(null);
  const action = useGroupAction(() => saveMeetChallenge({ groupId, meetId: meetId!, challengeId, exerciseId, metric, version }));
  const chosen = exercises.data?.exercises.find(e => e.group_exercise_id === exerciseId);
  const submit = async () => {
    if (action.pending || blocked) return;
    if (onStage && chosen) { onStage({ challengeId, exerciseId, exerciseName: chosen.name, metric }); onDismiss(); return; }
    const result = await action.run();
    if (result.ok) { await onChanged(); onDismiss(); return; }
    setMessage(meetWriteMessage(result.error.code, action.offline));
    if (!action.offline && ['CONFLICT', 'NETWORK', 'INTERNAL'].includes(result.error.code)) setBlocked(true);
  };
  const check = async () => {
    // Re-read with the server, retaining fields and the original create identity.
    const { getMeet } = await import('@/src/groups/api');
    try {
      const latest = await getMeet(groupId, meetId!);
      const current = latest.challenges.find(c => c.challenge_id === challengeId);
      if (current?.group_exercise_id === exerciseId && current.metric === metric) { await onChanged(); onDismiss(); return; }
      if (challenge && !current) { setMessage('This challenge was removed.'); return; }
      setVersion(current?.version ?? null); setBlocked(false); setMessage('Review your selections before saving again.');
      await onChanged();
    } catch { setMessage("Couldn't check status. Try again when connected."); }
  };
  return <Sheet visible onDismiss={() => { if (!action.pending) onDismiss(); }} dismissLabel="Dismiss challenge" title={challenge ? 'Edit challenge' : 'Add challenge'}>
    <ScreenScroll keyboardShouldPersistTaps="handled">
      {!exercises.data ? <GroupMissingDataState error={pickInlineError(exercises.error)} offline={exercises.offline} onRetry={() => void exercises.refresh()} testIDPrefix="meet-challenge-exercises" /> : <>
        <FormSection title="Exercise">{exercises.data.exercises.filter(e => e.archived_at_ms === null).map(e =>
          <ChoiceRow key={e.group_exercise_id} label={`${e.name}${e.group_exercise_id === exerciseId ? ' · Selected' : ''}`} disabled={action.pending || blocked}
            onPress={() => { setExerciseId(e.group_exercise_id); setMetric(e.rules.default_metric === 'seconds' ? 'seconds' : 'e1rm'); }} />)}</FormSection>
        <FormSection title="Metric">{meetMetrics(chosen?.rules.default_metric === 'seconds').map(m =>
          <ChoiceRow key={m} label={`${MEET_METRICS[m]}${metric === m ? ' · Selected' : ''}`} disabled={action.pending || blocked} onPress={() => setMetric(m)} />)}</FormSection>
      </>}
      {message ? <GroupWriteNotice testID="meet-write-notice" tone="error" message={message} /> : null}
      {blocked ? <ActionButton label="Check status" variant="outline" disabled={action.offline} onPress={() => void check()} /> : null}
      <ActionButton variant="primary" label="Save challenge" disabled={action.pending || blocked || !chosen || chosen.archived_at_ms !== null} onPress={() => void submit()} />
    </ScreenScroll>
  </Sheet>;
}
