import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton, Icon, ListRow, Notice, SegmentedControl, Sheet, SwitchRow,
  uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography,
} from '@/components/ui';
import type { MuscleReportRow } from '@/src/data/muscle-report-presets';
import {
  buildSettingsMuscleSections, deriveMuscleReportPreset, listMuscleReportRows,
  setMuscleReportPreset, setMuscleTracked, type MuscleReportPreset,
} from '@/src/data/muscle-report-settings';

const PRESET_OPTIONS = [{ value: 'detailed', label: 'Detailed' }, { value: 'broad', label: 'Broad' }] as const;
const PRESET_NAMES = { detailed: 'Detailed', broad: 'Broad', custom: 'Custom' } as const;

/** Reads the user's muscle rows; `change` writes, then reads them again. */
const useMuscleSetup = () => {
  const [rows, setRows] = useState<MuscleReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => listMuscleReportRows().then(
    (next) => { setRows(next); setError(null); },
    () => { setError('Couldn’t load muscles.'); },
  ), []);
  const change = useCallback(async (write: () => Promise<void>) => {
    try {
      await write();
      await reload();
    } catch {
      setError('Couldn’t save the change. Try again.');
    }
  }, [reload]);
  useEffect(() => {
    let live = true;
    void listMuscleReportRows().then((next) => { if (live) setRows(next); },
      () => { if (live) setError('Couldn’t load muscles.'); });
    return () => { live = false; };
  }, []);
  return { rows, error, reload, change };
};

/** Settings → Progress → Muscles ([[muscle.report-groups]]): the preset and a Track switch per muscle. */
export function MuscleSettingsRow() {
  const [visible, setVisible] = useState(false);
  const { rows, error, reload, change } = useMuscleSetup();
  const preset = rows ? deriveMuscleReportPreset(rows) : null;
  const sections = useMemo(() => (rows ? buildSettingsMuscleSections(rows) : []), [rows]);
  return (
    <>
      <ListRow
        accessibilityHint="Opens muscle setup"
        accessibilityLabel={`Muscles, ${preset ? PRESET_NAMES[preset] : 'loading'}`}
        density="list"
        description={preset ? PRESET_NAMES[preset] : undefined}
        divider={false}
        label="Muscles"
        onPress={() => { setVisible(true); void reload(); }}
        testID="settings-muscles-row"
        trailing={<Icon color={uiRoles.inkFaint} name="chevron-right" size="sm" />}
      />
      <Sheet dismissLabel="Dismiss muscles" onDismiss={() => setVisible(false)}
        testID="settings-muscles-sheet" title="Muscles" visible={visible}>
        <ScrollView contentContainerStyle={styles.content} style={styles.scroll} testID="settings-muscles-scroll">
          <View style={styles.block}>
            <SegmentedControl<MuscleReportPreset | 'custom'> accessibilityLabel="Muscle detail" disabled={!rows}
              onChange={(next) => { if (next !== 'custom') void change(() => setMuscleReportPreset(next)); }}
              options={PRESET_OPTIONS} testIDPrefix="settings-muscle-preset" value={preset ?? 'detailed'} />
            <Text allowFontScaling={false} style={styles.hint} testID="settings-muscle-preset-hint">
              {preset === 'custom'
                ? 'Your muscles match neither preset. Choosing one replaces them.'
                : 'Broad merges related muscles. Exercises keep their detailed mappings.'}
            </Text>
          </View>
          {error ? (
            <View style={styles.block}>
              <Notice action={<ActionButton label="Retry" onPress={() => { void reload(); }} variant="text" />}
                icon="warning" live message={error} testID="settings-muscles-error" tone="danger" />
            </View>
          ) : null}
          {sections.map((section) => (
            <View key={section.family} testID={`settings-muscles-family-${section.family}`}>
              {section.showHeader ? (
                <Text accessibilityRole="header" allowFontScaling={false} style={styles.heading}>{section.family}</Text>
              ) : null}
              {section.muscles.map((muscle) => (
                <View key={muscle.id} style={styles.track}>
                  <SwitchRow label={muscle.label} testID={`settings-track-${muscle.id}`} value={muscle.tracked}
                    onValueChange={(value) => { void change(() => setMuscleTracked(muscle.entryIds, value)); }} />
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flexShrink: 1 },
  content: { paddingBottom: uiSpace.md },
  block: { paddingHorizontal: uiSpace.lg, paddingBottom: uiSpace.md, gap: uiSpace.sm },
  hint: {
    fontFamily: uiFonts.display.family, fontSize: uiTypography.size.xs, lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
  },
  heading: {
    paddingHorizontal: uiSpace.lg, paddingTop: uiSpace.md, paddingBottom: uiSpace.sm,
    fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs, letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase', color: uiRoles.inkMuted,
  },
  track: { borderTopWidth: uiBorder.width, borderTopColor: uiRoles.ruleSoft },
});
