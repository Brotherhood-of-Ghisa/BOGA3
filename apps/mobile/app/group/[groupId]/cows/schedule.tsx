import { GroupsSignInRequired } from '@/components/groups/sign-in-required';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { AccessibilityInfo, Alert, findNodeHandle, Keyboard, Pressable, StyleSheet, Text, View, type ViewInstance } from 'react-native';
import { ActionButton, ChoiceRow, FigureText, FormSection, Icon, ScreenScroll, uiBorder, uiGeometry, uiRoles, uiSpace, uiText } from '@/components/ui';
import { GroupLostAccessState, GroupMissingDataState, GroupStateView, pickInlineError } from '@/components/groups/group-state-view';
import { GroupWriteNotice } from '@/components/groups/write-notice';
import { CoWExercisePicker } from '@/components/groups/cow-exercise-picker';
import { useAuth } from '@/src/auth';
import { canManageGroup, useMountedRef } from '@/src/groups';
import { useCoWEditor } from '@/src/groups/use-cow-editor';
import { COW_FORM_LABELS, COW_METRICS, coWAccessibleDates, coWDateRange } from '@/src/groups/cow-presentation';
import { useDateFormat } from '@/src/preferences/hooks';
import { coWsHref, coWStandingsHref } from '@/src/navigation/routes';

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;
type Editor = ReturnType<typeof useCoWEditor>;

export default function CoWScheduleRoute() {
  const { isConfigured, user } = useAuth();
  const params = useLocalSearchParams<{ groupId?: string; cowId?: string }>();
  const groupId = first(params.groupId); const cowId = first(params.cowId);
  if (!isConfigured || !user) return <GroupsSignInRequired isConfigured={isConfigured} />;
  if (!groupId) return <GroupLostAccessState testID="cow-form-lost-access" />;
  return <CoWEditor key={`${user.id}:${groupId}:${cowId ?? 'new'}`} groupId={groupId} cowId={cowId} userId={user.id} />;
}
function CoWEditor({ groupId, cowId, userId }: { groupId: string; cowId: string | null; userId: string }) {
  const router = useRouter();
  const model = useCoWEditor(groupId, cowId, userId);
  const mounted = useMountedRef();
  const [picker, setPicker] = useState(false);
  const complete = async (command: 'save' | 'cancel') => { const ok = await model.run(command); if (ok && mounted.current) router.back(); };
  const check = async () => { const ok = await model.checkStatus(); if (ok && mounted.current) router.back(); };
  let body;
  if (model.group.lostAccess || model.exercises.lostAccess || model.definition.lostAccess || model.calendar.lostAccess) body = <GroupLostAccessState testID="cow-form-lost-access" />;
  else if (model.definition.resourceMissing) body = <GroupStateView title="CoW unavailable" testID="cow-form-missing" />;
  else if (!model.group.data) body = <GroupMissingDataState error={pickInlineError(model.group.error)} offline={model.group.offline} onRetry={() => void model.group.refresh()} testIDPrefix="cow-form-group" />;
  else if (!canManageGroup(model.group.data.group.my_role)) body = <GroupStateView title="Only owners and admins can manage CoWs" testID="cow-form-forbidden" />;
  else if (cowId && !model.cow) body = <GroupMissingDataState error={pickInlineError(model.definition.error)} offline={model.definition.offline} onRetry={() => void model.definition.refresh()} testIDPrefix="cow-form-definition" />;
  else if (!model.editable) body = <GroupStateView title="This CoW is read-only" testID="cow-form-read-only" actionLabel="View standings"
    onAction={() => router.push(coWStandingsHref(groupId, cowId!, model.cow!.metrics[0]))} />;
  else body = <CoWEditorFields model={model} groupId={groupId} editing={cowId !== null} picker={picker} setPicker={setPicker} onSave={() => void complete('save')}
    onCancel={() => Alert.alert('Cancel CoW?', 'This releases the next-week slot.', [{ text: 'Keep CoW', style: 'cancel' }, { text: 'Cancel CoW', style: 'destructive', onPress: () => void complete('cancel') }])}
    onCheck={() => void check()} />;
  return <ScreenScroll keyboardShouldPersistTaps="handled" testID="cow-form-screen"><Stack.Screen options={{ title: cowId ? 'Edit CoW' : 'Schedule CoW' }} />{body}</ScreenScroll>;
}

function CoWEditorFields({ model, groupId, editing, picker, setPicker, onSave, onCancel, onCheck }: {
  model: Editor; groupId: string; editing: boolean; picker: boolean; setPicker: (visible: boolean) => void; onSave: () => void; onCancel: () => void; onCheck: () => void;
}) {
  const router = useRouter();
  const dateFormat = useDateFormat();
  const launcher = useRef<ViewInstance>(null);
  const metricsLauncher = useRef<ViewInstance>(null);
  const addAfterDismiss = useRef(false);
  const mounted = useMountedRef();
  const disabled = model.pending || model.checking || model.uncertain !== null;
  const chosen = model.exercises.data?.exercises.find(row => row.group_exercise_id === model.draft.exerciseId);
  const week = model.cow?.week_start ?? model.calendar.firstPage?.next_week_start;
  const zone = model.cow?.time_zone ?? model.calendar.firstPage?.time_zone;
  const restore = () => {
    if (!mounted.current) return;
    if (addAfterDismiss.current) { addAfterDismiss.current = false; router.push(`/group/${groupId}/exercises/new`); return; }
    const handle = launcher.current ? findNodeHandle(launcher.current) : null;
    if (typeof handle === 'number') AccessibilityInfo.setAccessibilityFocus(handle);
  };
  const submit = () => {
    onSave();
    const target = model.validation.exercise ? launcher.current : model.validation.metrics ? metricsLauncher.current : null;
    if (target) requestAnimationFrame(() => { if (!mounted.current) return; const handle = findNodeHandle(target); if (typeof handle === 'number') AccessibilityInfo.setAccessibilityFocus(handle); });
  };
  return <>
    <Text allowFontScaling={false} style={uiText.title}>{model.group.data!.group.name}</Text>
    <View style={styles.week}>
      <Text allowFontScaling={false} style={uiText.label}>Next week</Text>
      {week ? <View style={styles.dates}><Text allowFontScaling={false} style={uiText.figure} accessibilityLabel={coWAccessibleDates(week, dateFormat)}><FigureText>{coWDateRange(week, dateFormat)}</FigureText></Text><Text allowFontScaling={false} style={uiText.meta}>{zone}</Text></View> : null}
    </View>
    {!model.calendar.firstPage ? <GroupMissingDataState error={pickInlineError(model.calendar.error)} offline={model.calendar.offline} onRetry={() => void model.calendar.refresh()} testIDPrefix="cow-form-calendar" />
      : !zone ? <GroupStateView title="Group time zone not set" testID="cow-form-zone-unset" /> : null}
    <FormSection title="Exercise" error={model.errors.exercise} errorTestID="cow-form-exercise-error">
      <ChoiceRow ref={launcher} label={chosen?.name ?? (model.draft.exerciseId && model.exercises.data ? 'Exercise unavailable' : 'Choose exercise')}
        accessibilityLabel={`Exercise: ${chosen?.name ?? 'Choose exercise'}`} disabled={disabled} testID="cow-form-exercise"
        onPress={() => { Keyboard.dismiss(); setPicker(true); }} />
    </FormSection>
    <FormSection title="Leaderboards" error={model.errors.metrics} errorTestID="cow-form-metrics-error">
      {COW_METRICS.map((metric, index) => <Pressable key={metric} ref={index === 0 ? metricsLauncher : undefined} accessibilityRole="checkbox" accessibilityLabel={COW_FORM_LABELS[metric]}
        accessibilityState={{ checked: model.draft.metrics.includes(metric), disabled }} disabled={disabled}
        onPress={() => model.toggleMetric(metric)} style={[styles.checkRow, index > 0 ? styles.divider : null]} testID={`cow-form-metric-${metric}`}>
        <View style={[styles.box, model.draft.metrics.includes(metric) ? styles.checked : null]}>{model.draft.metrics.includes(metric) ? <Icon name="check" color={uiRoles.surface} size="sm" /> : null}</View>
        <Text allowFontScaling={false} style={[uiText.body, styles.name]}>{COW_FORM_LABELS[metric]}{metric === 'e1rm' && chosen?.rules.bodyweight_calculations_enabled && chosen.rules.bodyweight_contribution > 0 ? ' (%BW)' : ''}</Text>
      </Pressable>)}
    </FormSection>
    {model.message ? <GroupWriteNotice message={model.message} tone="error" testID="cow-form-message" /> : null}
    {model.uncertain ? <ActionButton label={model.checking ? 'Checking…' : 'Check status'} variant="outline" disabled={model.checking || model.offline} onPress={onCheck} testID="cow-form-check-status" /> : null}
    {model.occupied ? <ActionButton label="View CoWs" variant="outline" onPress={() => router.push(coWsHref(groupId))} testID="cow-form-view-cows" /> : null}
    <ActionButton label={model.pending ? 'Saving…' : model.weekChanged ? 'Review new dates' : editing ? 'Save changes' : 'Schedule CoW'} variant="primary"
      disabled={disabled || model.occupied || !model.calendar.firstPage?.next_week_start} onPress={submit} testID="cow-form-submit" />
    {editing ? <ActionButton label="Cancel CoW" variant="outline" tone="danger" disabled={disabled} onPress={onCancel} testID="cow-form-cancel" /> : null}
    <CoWExercisePicker visible={picker} onDismiss={() => setPicker(false)} onDismissed={restore} selectedId={model.draft.exerciseId}
      exercises={model.exercises.data?.exercises ?? null} error={pickInlineError(model.exercises.error)} offline={model.exercises.offline}
      onRetry={() => void model.exercises.refresh()} onPick={id => { model.pickExercise(id); setPicker(false); }}
      onAdd={() => { addAfterDismiss.current = true; setPicker(false); }} />
  </>;
}
const styles = StyleSheet.create({
  week: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: uiSpace.md, flexWrap: 'wrap' }, dates: { alignItems: 'flex-end', gap: uiSpace.xs },
  checkRow: { minHeight: uiGeometry.tapTarget, padding: uiSpace.md, flexDirection: 'row', alignItems: 'center', gap: uiSpace.md },
  box: { width: uiSpace.lg, height: uiSpace.lg, borderWidth: uiBorder.width, borderColor: uiRoles.ink, borderRadius: uiGeometry.radius.control, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: uiRoles.ink }, divider: { borderTopWidth: uiBorder.width, borderTopColor: uiRoles.ruleSoft }, name: { flex: 1 },
});
