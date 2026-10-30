import { useState } from 'react';
import { Text, View } from 'react-native';
import { ActionButton, FormField, FormSection, uiSpace, uiText } from '@/components/ui';
import { setCoWCalendar } from '@/src/groups/api';
import { useCoWCalendar } from '@/src/groups/use-cow-calendar';
import { useGroupAction } from '@/src/groups/use-group-action';
import { GroupMissingDataState, pickInlineError } from './group-state-view';

/** Calendar management is an explicit online write; it never moves a published CoW. */
export function CoWTimeZone({ groupId, userId, autoFocus, onAccessChange }: { groupId: string; userId: string; autoFocus: boolean; onAccessChange: () => void }) {
  const calendar = useCoWCalendar(groupId, userId);
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const action = useGroupAction((revision: number, timeZone: string) => setCoWCalendar(groupId, revision, timeZone));
  const save = async () => {
    if (!calendar.firstPage) return;
    setSaved(false);
    const result = await action.run(calendar.firstPage.revision, (draft ?? calendar.firstPage.time_zone ?? '').trim());
    if (result.ok) { setSaved(true); await calendar.refresh(); }
    else if (result.error.code === 'CONFLICT') await calendar.refresh();
    else if (result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND') onAccessChange();
  };
  if (!calendar.firstPage) return <GroupMissingDataState error={pickInlineError(calendar.error)} offline={calendar.offline} onRetry={() => void calendar.refresh()} testIDPrefix="cow-zone" />;
  return <FormSection title="Group calendar">
    <View style={{ padding: uiSpace.md, gap: uiSpace.md }}>
      <FormField label="Time zone" face="text" autoCapitalize="none" autoCorrect={false} autoFocus={autoFocus}
        accessibilityLabel="Group time zone" value={draft ?? calendar.firstPage.time_zone ?? ''} onChangeText={value => { setDraft(value); setSaved(false); }}
        placeholder="Europe/London" editable={!action.pending} error={action.error ? action.offline ? "You're offline. Connect to save." : 'Check the time zone and try again.' : null} testID="cow-zone-input" />
      <ActionButton label={action.pending ? 'Saving…' : 'Save time zone'} variant="outline" disabled={action.pending} onPress={() => void save()} testID="cow-zone-save" />
      {saved ? <Text allowFontScaling={false} style={uiText.meta} testID="cow-zone-saved">Time zone saved</Text> : null}
    </View>
  </FormSection>;
}
