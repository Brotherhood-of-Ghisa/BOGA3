import { useState } from 'react';
import { Keyboard, ScrollView, Text, View } from 'react-native';
import { ActionButton, Icon, ListRow, SearchField, Sheet, uiRoles, uiSpace, uiText } from '@/components/ui';
import type { CompetitionExerciseWire } from '@/src/groups/competition-wire';
import type { GroupApiError } from '@/src/groups/api';
import { GroupInlineError, GroupMissingDataState } from './group-state-view';

/** Choose an existing active group comparison; dismissal never changes the form. */
export function CoWExercisePicker({ visible, onDismiss, onDismissed, exercises, selectedId, onPick, error, offline, onRetry, onAdd }: {
  visible: boolean; onDismiss: () => void; onDismissed: () => void; exercises: CompetitionExerciseWire[] | null;
  selectedId: string | null; onPick: (id: string) => void; error: GroupApiError | null; offline: boolean; onRetry: () => void; onAdd: () => void;
}) {
  const [query, setQuery] = useState('');
  const active = exercises?.filter(row => row.archived_at_ms === null);
  const matches = active?.filter(row => row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <Sheet visible={visible} onDismiss={onDismiss} onDismissed={onDismissed} dismissLabel="Dismiss exercise choices" title="Choose exercise" keyboardAvoiding testID="cow-exercise-picker">
    <View style={{ padding: uiSpace.md, gap: uiSpace.md }}>
      <SearchField accessibilityLabel="Search group exercises" value={query} onChangeText={setQuery} placeholder="Search exercises" testID="cow-exercise-search" />
      {error && active ? <GroupInlineError error={error} onRetry={onRetry} testID="cow-picker-error" /> : null}
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: uiSpace.xl * 10 }}>
        {!active ? <GroupMissingDataState error={error} offline={offline} onRetry={onRetry} testIDPrefix="cow-picker" />
          : active.length === 0 ? <><Text allowFontScaling={false} style={uiText.meta}>No active group exercises</Text><ActionButton label="Add exercise" variant="outline" onPress={onAdd} testID="cow-picker-add" /></>
          : matches?.length === 0 ? <Text allowFontScaling={false} style={uiText.meta}>No matching exercises</Text>
          : matches?.map((row, index) => <ListRow key={row.group_exercise_id} label={row.name} density="list" divider={index > 0}
              checked={row.group_exercise_id === selectedId} onPress={() => { Keyboard.dismiss(); onPick(row.group_exercise_id); }}
              testID={`cow-picker-${row.group_exercise_id}`} trailing={row.group_exercise_id === selectedId ? <Icon name="check" color={uiRoles.ink} /> : undefined} />)}
      </ScrollView>
    </View>
  </Sheet>;
}
