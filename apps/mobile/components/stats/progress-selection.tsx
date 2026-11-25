import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton, ListRow, Notice, Sheet, uiSpace, useUiText } from '@/components/ui';
import { MAX_PROGRESS_SELECTION } from '@/src/utils/progress-selection';

export type ProgressSelectionKind = 'exercise' | 'muscle';
export type SelectedProgressItem = { id: string; name: string };

type Selection = {
  kind: ProgressSelectionKind;
  items: SelectedProgressItem[];
  atLimit?: boolean;
};

/** Selection exists only for this mounted Progress visit, including Back from charts. */
export function useProgressSelection(kind: ProgressSelectionKind | null) {
  const [state, setState] = useState<Selection | null>(null);
  const selection = state?.kind === kind ? state : null;
  if (state && !selection) setState(null);

  const update = (item: SelectedProgressItem, toggle: boolean) => {
    if (!kind) return;
    setState(current => {
      const items = current?.kind === kind ? current.items : [];
      if (items.some(selected => selected.id === item.id)) {
        return toggle ? { kind, items: items.filter(selected => selected.id !== item.id) } : current;
      }
      if (items.length === MAX_PROGRESS_SELECTION) return { kind, items, atLimit: true };
      return { kind, items: [...items, { id: item.id, name: item.name }] };
    });
  };

  return {
    selected: selection?.items ?? null,
    error: selection?.atLimit ? `Choose up to ${MAX_PROGRESS_SELECTION} ${selection.kind}s.` : null,
    add: (item: SelectedProgressItem) => update(item, false),
    toggle: (item: SelectedProgressItem) => update(item, true),
    cancel: () => setState(null),
  };
}

type SelectionItems = {
  kind: ProgressSelectionKind;
  items: readonly SelectedProgressItem[];
};

const countLabel = (kind: ProgressSelectionKind, count: number) => `${count} ${kind}${count === 1 ? '' : 's'}`;

/** Full names stay readable; this sheet describes the scope, never changes it. */
export function ProgressSelectionSheet({ kind, items, visible, onDismiss }: SelectionItems & {
  visible: boolean; onDismiss: () => void;
}) {
  const text = useUiText();
  return <Sheet dismissLabel={`Dismiss selected ${kind}s`} onDismiss={onDismiss}
    title={countLabel(kind, items.length)} testID={`selected-${kind}s-sheet`} visible={visible}>
    <ScrollView contentContainerStyle={styles.names}>
      {items.map(item => <ListRow accessible accessibilityLabel={item.name} key={item.id}
        testID={`selected-${kind}-${item.id}`}><Text allowFontScaling={false} style={text.body}>{item.name}</Text></ListRow>)}
    </ScrollView>
  </Sheet>;
}

/** Occupies the existing search/filter row only while multi-selection is active. */
export function ProgressSelectionControls({ kind, items, error, onCancel, onShow }: SelectionItems & {
  error: string | null; onCancel: () => void; onShow: () => void;
}) {
  const [namesVisible, setNamesVisible] = useState(false);
  // Keep the literals discoverable by the Maestro selector check.
  const prefix = kind === 'muscle' ? 'stats-muscle-selection' : 'stats-exercise-selection';
  return <>
    <View style={styles.controls} testID={`${prefix}-controls`}>
      <ActionButton label="Cancel" onPress={onCancel} size="compact" variant="text" testID={`${prefix}-cancel`} />
      <ActionButton label={`${items.length} selected`} onPress={() => setNamesVisible(true)} size="compact" variant="link"
        accessibilityLabel={`${countLabel(kind, items.length)} selected, show names`} testID={`${prefix}-count`} />
      <ActionButton disabled={items.length < 2} label="Show progress" onPress={onShow} size="compact" variant="primary"
        testID={`${prefix}-show`} />
    </View>
    {error ? <Notice live message={error} tone="danger" testID={`${prefix}-limit`} /> : null}
    <ProgressSelectionSheet kind={kind} items={items} visible={namesVisible} onDismiss={() => setNamesVisible(false)} />
  </>;
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: uiSpace.xs },
  names: { paddingBottom: uiSpace.lg },
});
