import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton, Card, Icon, ListRow, SegmentedControl, Sheet, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { updatePreferences } from '@/src/preferences/hooks';
import type { AccountLocalPreferenceState } from '@/src/preferences/account-local';
import { EffortSettings } from './effort-settings';
import { PreferenceNumberField } from './number-field';

export const HEATMAP_VIEW_OPTIONS = [{ value: 'daily' as const, label: 'Daily' }, { value: 'weekly' as const, label: 'Weekly' }];

export function ProgressSettings({ state }: { state: AccountLocalPreferenceState }) {
  const { values, pending } = state;
  const catalog = useExerciseCatalog();
  const [editingTargets, setEditingTargets] = useState(false);
  const targets = pending.weeklyMuscleTargets ?? values.weeklyMuscleTargets;
  const resetTarget = (id: string) => {
    const next = { ...targets };
    delete next[id];
    updatePreferences({ weeklyMuscleTargets: next });
  };
  return <View style={styles.section} testID="settings-section-progress">
    <Text allowFontScaling={false} accessibilityRole="header" style={styles.heading}>Progress</Text>
    <Card>
      <ListRow label="Weekly muscle targets" description="Working sets per muscle per week. Default: 8."
        divider={false} onPress={() => setEditingTargets(true)} testID="settings-muscle-targets-row"
        trailing={<Icon name="chevron-right" color={uiRoles.inkFaint} size="sm" />} />
    </Card>
    <Card style={styles.card}>
      <PreferenceNumberField label="Target window (weeks)" testID="settings-target-window"
        value={pending.targetWindowWeeks ?? values.targetWindowWeeks}
        onCommit={targetWindowWeeks => updatePreferences({ targetWindowWeeks })} />
      <PreferenceNumberField label="History look-back (weeks)" testID="settings-history-lookback"
        value={pending.historyLookbackWeeks ?? values.historyLookbackWeeks}
        onCommit={historyLookbackWeeks => updatePreferences({ historyLookbackWeeks })} />
      <Text allowFontScaling={false} style={styles.label}>History view</Text>
      <SegmentedControl accessibilityLabel="History view" options={HEATMAP_VIEW_OPTIONS}
        value={pending.heatmapView ?? values.heatmapView} onChange={heatmapView => updatePreferences({ heatmapView })}
        testIDPrefix="settings-heatmap-view" />
    </Card>
    <Card style={styles.card}><EffortSettings values={{ ...values, ...pending }} /></Card>
    <Sheet visible={editingTargets} onDismiss={() => setEditingTargets(false)} title="Weekly muscle targets"
      dismissLabel="Dismiss weekly muscle targets" testID="settings-muscle-targets-sheet" keyboardAvoiding>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.card}>
        {catalog.muscleGroups.map(muscle => <View key={muscle.id} style={styles.target}>
          <View style={styles.field}>
            <PreferenceNumberField label={`${muscle.displayName} (W/sets per week)`}
              value={targets[muscle.id] ?? 8} testID={`settings-muscle-target-${muscle.id}`}
              onCommit={quota => updatePreferences({ weeklyMuscleTargets: { ...targets, [muscle.id]: quota } })} />
          </View>
          <ActionButton label="Reset" accessibilityLabel={`Reset ${muscle.displayName} target to 8`}
            testID={`settings-muscle-target-reset-${muscle.id}`} variant="outline"
            disabled={targets[muscle.id] === undefined} onPress={() => resetTarget(muscle.id)} />
        </View>)}
        {catalog.status === 'error' ? <Text allowFontScaling={false} style={styles.label}>Muscle list could not be loaded.</Text> : null}
      </ScrollView>
    </Sheet>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: uiSpace.sm },
  card: { padding: uiSpace.md, gap: uiSpace.md },
  heading: { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, lineHeight: uiTypography.lineHeight.xxs, color: uiRoles.inkMuted, textTransform: 'uppercase' },
  label: { fontFamily: uiFonts.display.family, fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink },
  target: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm },
  field: { flex: 1 },
});
