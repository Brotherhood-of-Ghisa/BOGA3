import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  Icon,
  ListRow,
  Notice,
  Sheet,
  uiBorder,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import { generateRoles } from '@/components/ui/theme';
import { launchTheme, readStoredThemePresetId, saveThemePresetId } from '@/components/ui/theme-launch';
import {
  DEFAULT_THEME_PRESET_ID,
  getThemePreset,
  resolveThemePreset,
  themePresets,
  type ThemePreset,
  type ThemePresetId,
} from '@/components/ui/theme-presets';

// Settings → Preferences → Appearance (`docs/specs/ui/ux-rules.md` §9b): a row
// naming the chosen theme, and a sheet listing the presets. A choice is saved
// at once and applies on the next launch; the app cannot restart itself.
export function AppearanceSettingsRow() {
  const [chosenId, setChosenId] = useState<ThemePresetId>(readChosenId);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const chosen = getThemePreset(chosenId);
  const pending = chosenId !== launchTheme.preset.id;

  const choose = async (id: ThemePresetId) => {
    if (id === chosenId) return;
    const previous = chosenId;
    setChosenId(id);
    setSaveError(null);
    try {
      await saveThemePresetId(id);
    } catch {
      setChosenId(previous);
      setSaveError('Couldn’t save the theme. Nothing changed.');
    }
  };

  return (
    <>
      <ListRow
        accessibilityHint="Opens the theme choices"
        accessibilityLabel={`Appearance, ${pending ? `${chosen.label} from next launch` : chosen.label}`}
        density="list"
        description={pending ? `${chosen.label} from next launch` : chosen.label}
        divider={false}
        label="Appearance"
        leading={<Icon color={uiRoles.inkMuted} name="palette" />}
        onPress={() => setSheetVisible(true)}
        testID="settings-appearance-row"
        trailing={<Icon color={uiRoles.inkFaint} name="chevron-right" size="sm" />}
      />
      <Sheet
        dismissLabel="Dismiss appearance"
        onDismiss={() => setSheetVisible(false)}
        testID="settings-appearance-sheet"
        title="Appearance"
        visible={sheetVisible}>
        {themePresets.map((preset, index) => (
          <ListRow
            accessibilityLabel={preset.id === DEFAULT_THEME_PRESET_ID ? `${preset.label}, default` : preset.label}
            checked={preset.id === chosenId}
            divider={index > 0}
            key={preset.id}
            leading={<Icon color={uiRoles.ink} name={preset.id === chosenId ? 'radio-on' : 'radio-off'} />}
            meta={<PresetSwatch preset={preset} />}
            onPress={() => {
              void choose(preset.id);
            }}
            testID={`settings-appearance-option-${preset.id}`}>
            <View style={styles.optionText}>
              <Text allowFontScaling={false} style={styles.optionLabel}>
                {preset.label}
              </Text>
              {preset.id === DEFAULT_THEME_PRESET_ID ? (
                <Text allowFontScaling={false} style={styles.detail}>
                  Default
                </Text>
              ) : null}
            </View>
          </ListRow>
        ))}
        <View style={styles.footer}>
          {saveError ? (
            <Notice icon="warning" live message={saveError} testID="settings-appearance-error" tone="danger" />
          ) : null}
          <Text
            accessibilityLiveRegion="polite"
            allowFontScaling={false}
            style={styles.note}
            testID="settings-appearance-note">
            {pending
              ? `${chosen.label} applies the next time you open BoGa. Close BoGa fully, then open it again.`
              : 'A new theme applies the next time you open BoGa.'}
          </Text>
        </View>
      </Sheet>
    </>
  );
}

// The stored choice. Falls back to the theme in use when the store cannot be
// read: `readLaunchTheme` has already reported why.
function readChosenId(): ThemePresetId {
  try {
    return resolveThemePreset(readStoredThemePresetId()).preset.id;
  } catch {
    return launchTheme.preset.id;
  }
}

// A preset as its own colours: `ink`, `accent`, `record` and the ramp's third
// step on its `paper`. These are another theme's values, so they cannot be
// roles of this one.
const swatchColours = new Map(
  themePresets.map((preset) => {
    const roles = generateRoles(preset.seeds);
    return [preset.id, { ground: roles.paper, border: roles.rule, marks: [roles.ink, roles.accent, roles.record, roles.viz3] }];
  }),
);

function PresetSwatch({ preset }: { preset: ThemePreset }) {
  const colours = swatchColours.get(preset.id)!;
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      style={[styles.swatch, { backgroundColor: colours.ground, borderColor: colours.border }]}
      testID={`settings-appearance-swatch-${preset.id}`}>
      {colours.marks.map((colour, index) => (
        <View key={index} style={[styles.swatchMark, { backgroundColor: colour }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  optionText: {
    paddingVertical: uiSpace.sm,
  },
  optionLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  detail: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  swatch: {
    flexDirection: 'row',
    gap: uiSpace.xs,
    padding: uiSpace.xs,
    borderWidth: uiBorder.width,
    borderRadius: uiGeometry.radius.control,
  },
  swatchMark: {
    width: uiSpace.md,
    height: uiSpace.xl,
    borderRadius: uiGeometry.radius.control / 2,
  },
  footer: {
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.lg,
    paddingTop: uiSpace.sm,
    paddingBottom: uiSpace.md,
  },
  note: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
});
