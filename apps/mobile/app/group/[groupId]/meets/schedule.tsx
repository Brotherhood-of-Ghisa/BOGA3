import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { ActionButton, Card, FormField, FormSection, ScreenScroll, uiSpace, useUiText } from '@/components/ui';
import { GroupsSignInRequired } from '@/components/groups/sign-in-required';
import { GroupLostAccessState, GroupMissingDataState, GroupStateView, pickInlineError } from '@/components/groups/group-state-view';
import { GroupWriteNotice } from '@/components/groups/write-notice';
import { MeetChallengeEditor, MeetChallenges } from '@/components/groups/meet-challenges';
import { useAuth } from '@/src/auth';
import { canManageGroup } from '@/src/groups';
import { isMeetNotFound } from '@/src/groups/api';
import { openMeetMaps } from '@/src/groups/meet-location';
import { MEET_METRICS, meetHref } from '@/src/groups/meet-presentation';
import type { MeetDraft } from '@/src/groups/meet-draft';
import { useMeetEditor } from '@/src/groups/use-meet-editor';

export default function MeetScheduleRoute() {
  const { isConfigured, user } = useAuth(); const { groupId, meetId } = useLocalSearchParams<{ groupId: string; meetId?: string }>();
  if (!isConfigured || !user) return <GroupsSignInRequired isConfigured={isConfigured} />;
  if (!groupId) return <GroupLostAccessState testID="meet-lost-access" />;
  return <MeetEditor key={`${user.id}:${groupId}:${meetId ?? 'new'}`} userId={user.id} groupId={groupId} meetId={meetId ?? null} />;
}
function MeetEditor({ groupId, meetId, userId }: { groupId: string; meetId: string | null; userId: string }) {
  const model = useMeetEditor(groupId, meetId, userId); const router = useRouter();
  const complete = async (check = false) => { const id = await (check ? model.checkStatus() : model.save()); if (id) router.replace(meetHref(groupId, id)); };
  let body;
  if (isMeetNotFound(model.definition.error)) body = <GroupStateView testID="meet-state" title="Meet unavailable" />;
  else if (model.group.lostAccess || model.definition.lostAccess || model.calendar.lostAccess) body = <GroupLostAccessState testID="meet-lost-access" />;
  else if (!model.group.data) body = <GroupMissingDataState error={pickInlineError(model.group.error)} offline={model.group.offline} onRetry={() => void model.group.refresh()} testIDPrefix="meet-form" />;
  else if (!canManageGroup(model.group.data.group.my_role)) body = <GroupStateView testID="meet-state" title="Only owners and admins can schedule meets" />;
  else if (model.permissions && !model.permissions.challenges) body = <GroupStateView testID="meet-state" title="This meet is cancelled" />;
  else if (!model.zone) body = <GroupStateView testID="meet-state" title="Set the group time zone before scheduling a meet" />;
  else if (!model.draft) body = <GroupMissingDataState error={pickInlineError(model.definition.error)} offline={model.definition.offline} onRetry={() => void model.definition.refresh()} testIDPrefix="meet-form-definition" />;
  else body = <MeetEditorFields model={model} userId={userId} groupId={groupId} onSave={() => void complete()} onCheck={() => void complete(true)} />;
  return <ScreenScroll keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets testID="meet-form-screen"><Stack.Screen options={{ title: meetId ? 'Edit meet' : 'Schedule meet' }} />{body}</ScreenScroll>;
}
const FIELDS: { key: keyof MeetDraft; label: string; limit?: number }[] = [
  { key: 'title', label: 'Title', limit: 80 }, { key: 'date', label: 'Date' }, { key: 'start', label: 'Start (HH:MM)' },
  { key: 'endDate', label: 'End date' }, { key: 'end', label: 'End (HH:MM)' },
  { key: 'venue', label: 'Venue name', limit: 80 }, { key: 'address', label: 'Address', limit: 200 }, { key: 'note', label: 'Entry note', limit: 1000 },
];
function MeetEditorFields({ model, userId, groupId, onSave, onCheck }: { model: ReturnType<typeof useMeetEditor>; userId: string; groupId: string; onSave: () => void; onCheck: () => void }) {
  const text = useUiText(); const [adding, setAdding] = useState(false);
  const busy = model.pending || model.checking || model.blocked;
  const editable = !model.meet || model.permissions?.fields;
  const draft = model.draft!;
  return <>
    <Text allowFontScaling={false} style={text.meta}>{model.zone}</Text>
    <View style={{ gap: uiSpace.md }}>{FIELDS.map(field => <FormField key={field.key} label={field.key === 'date' || field.key === 'endDate' ? `${field.label} (${model.dateFormat})` : field.label} accessibilityLabel={field.key === 'date' || field.key === 'endDate' ? `${field.label} (${model.dateFormat})` : field.label}
      face={['date', 'start', 'endDate', 'end'].includes(field.key) ? 'figure' : 'text'} value={String(draft[field.key] ?? '')}
      maxLength={field.limit} editable={!!editable && !busy} multiline={field.key === 'note'} autoCorrect={false}
      onChangeText={value => model.change(field.key, value)} onBlur={field.key === 'address' ? () => void model.checkAddress() : undefined} testID={`meet-form-${field.key}`} />)}</View>
    {model.checkingAddress ? <Text allowFontScaling={false} style={text.meta}>Checking address…</Text> : null}
    {model.preview ? <Card><Text allowFontScaling={false} style={text.body}>{model.preview.address}</Text>
      <ActionButton label="Open in Maps" variant="text" onPress={() => { void openMeetMaps(model.preview!).catch(() => undefined); }} />
    </Card> : null}
    {model.message ? <GroupWriteNotice testID="meet-write-notice" tone="error" message={model.message} /> : null}
    {model.blocked ? <ActionButton label={model.checking ? 'Checking…' : 'Check status'} disabled={model.checking || model.offline} variant="outline" onPress={onCheck} /> : null}
    {editable ? <ActionButton variant="primary" label={model.pending ? 'Saving…' : model.meet ? 'Save changes' : 'Schedule meet'} disabled={busy || model.checkingAddress} onPress={onSave} testID="meet-form-submit" /> : null}
    {!model.meet || model.staged.length ? <FormSection title="Challenges">
      {model.staged.map(c => <View key={c.challengeId} testID={`meet-staged-${c.challengeId}`}><Text allowFontScaling={false} style={text.body}>{`${c.exerciseName} · ${MEET_METRICS[c.metric]}`}</Text>
        <ActionButton label="Remove challenge" variant="text" disabled={busy} onPress={() => model.setStaged(previous => previous.filter(row => row.challengeId !== c.challengeId))} /></View>)}
      <ActionButton label="Add challenge" variant="text" disabled={busy || !model.exercises.data} onPress={() => setAdding(true)} />
    </FormSection> : null}
    {adding ? <MeetChallengeEditor groupId={groupId} meetId={null} userId={userId} challenge={null} onDismiss={() => setAdding(false)} onChanged={async () => undefined}
      onStage={challenge => model.setStaged(previous => [...previous, challenge])} /> : null}
    {model.definition.data ? <MeetChallenges data={model.definition.data} userId={userId} onChanged={model.definition.refresh} /> : null}
  </>;
}
