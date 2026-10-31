import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  isThemePending,
  readChosenId,
  themeLabel,
  useChosenThemeId,
} from '@/components/appearance/chosen-theme';
import { SubPage } from '@/components/settings/sub-page';
import { ChoiceRow, FormSection, Notice, RadioRow, uiBorder, uiGeometry, uiSpace, uiText, uiTextTone } from '@/components/ui';
import { generateRoles } from '@/components/ui/theme';
import { hueName, parseHueThemeId } from '@/components/ui/theme-hue';
import { launchTheme, saveThemePresetId } from '@/components/ui/theme-launch';
import {
  DEFAULT_THEME_PRESET_ID,
  themePresets,
  type ThemePreset,
  type ThemePresetId,
} from '@/components/ui/theme-presets';
import { logEvent } from '@/src/logging';
import { SETTINGS_SUB_PAGES, THEME_COLOUR_ROUTE } from '@/src/navigation/routes';

// Settings home's Appearance row (`docs/specs/ui/design-language.md` "Presets"):
// names the chosen theme and opens the Appearance page. A choice applies on the
// next launch, as the app cannot restart itself, so a pending choice reads
// `from next launch` here.
export function AppearanceSettingsRow({ divider = false }: { divider?: boolean }) {
  const router = useRouter();
  const [chosenId] = useChosenThemeId();
  const label = themeLabel(chosenId);
  const shown = isThemePending(chosenId) ? `${label} from next launch` : label;
  return (
    <ChoiceRow
      accessibilityLabel={`Appearance, ${shown}`}
      divider={divider}
      icon="palette"
      label="Appearance"
      onPress={() => router.push(SETTINGS_SUB_PAGES.appearance)}
      testID="settings-appearance-row"
      value={shown}
    />
  );
}

// Settings → Appearance: the presets as radio rows, a choice saved at once and
// labelled `Next launch` until the app reopens, then Custom colour, which opens
// the hue picker.
export function AppearanceSettingsScreen() {
  const router = useRouter();
  const [chosenId, setChosenId] = useChosenThemeId();
  const [saveError, setSaveError] = useState<string | null>(null);
  const customHue = parseHueThemeId(chosenId);
  const pending = isThemePending(chosenId);

  const choose = async (id: ThemePresetId) => {
    // Re-choosing the current preset saves nothing, unless this launch could
    // not use the stored choice: saving then replaces the unusable value.
    if (id === chosenId && !launchTheme.problem) return;
    setChosenId(id);
    setSaveError(null);
    try {
      await saveThemePresetId(id);
    } catch (error) {
      void logEvent({
        level: 'warn',
        event: 'theme.save_failed',
        message: 'Could not save the chosen theme preset.',
        context: { presetId: id, error: error instanceof Error ? error.message : String(error) },
      });
      // Show what is stored, not what was showing before the tap: another
      // choice may have saved meanwhile.
      setChosenId(readChosenId());
      setSaveError('Couldn’t save the theme. Nothing changed.');
    }
  };

  return (
    <SubPage testID="settings-appearance-screen">
      <FormSection footnote="Applies next launch" title="Theme">
        {themePresets.map((preset, index) => {
          const details = presetDetails(preset.id, chosenId, pending);
          return (
            <RadioRow
              accessibilityLabel={[preset.label, ...details.map((detail) => detail.toLowerCase())].join(', ')}
              checked={preset.id === chosenId}
              divider={index > 0}
              key={preset.id}
              label={preset.label}
              meta={<PresetMeta details={details} preset={preset} />}
              onPress={() => {
                void choose(preset.id);
              }}
              testID={`settings-appearance-option-${preset.id}`}
            />
          );
        })}
        <ChoiceRow
          divider
          label="Custom colour"
          onPress={() => router.push(THEME_COLOUR_ROUTE)}
          testID="settings-appearance-option-custom"
          value={customHue !== null ? `${hueName(customHue)}, ${customHue}°${pending ? ' · Next launch' : ''}` : undefined}
        />
      </FormSection>
      {saveError ? <Notice icon="warning" live message={saveError} testID="settings-appearance-error" tone="danger" /> : null}
    </SubPage>
  );
}

// The words beside a preset's name: `Default`, and `Next launch` on the chosen
// preset while it waits for the next launch.
function presetDetails(id: ThemePresetId, chosenId: string, pending: boolean): string[] {
  return [
    ...(id === DEFAULT_THEME_PRESET_ID ? ['Default'] : []),
    ...(id === chosenId && pending ? ['Next launch'] : []),
  ];
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

function PresetMeta({ details, preset }: { details: string[]; preset: ThemePreset }) {
  return (
    <View style={styles.meta}>
      {details.length > 0 ? (
        <Text allowFontScaling={false} style={[uiText.meta, uiTextTone.muted]}>
          {details.join(' · ')}
        </Text>
      ) : null}
      <PresetSwatch preset={preset} />
    </View>
  );
}

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
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
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
});
