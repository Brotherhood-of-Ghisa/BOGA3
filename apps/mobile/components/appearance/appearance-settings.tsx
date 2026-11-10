import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View, type ColorSchemeName } from 'react-native';

import { ChoiceMeta, CustomSection } from '@/components/appearance/appearance-custom';
import { ModeSection } from '@/components/appearance/appearance-mode';
import {
  appearanceLabel,
  appearanceSummary,
  appearanceRoles,
  previewMode,
  readIntendedAppearance,
  usePhoneScheme,
  useStoredAppearance,
} from '@/components/appearance/chosen-theme';
import { applyingHeaderRight } from '@/components/appearance/theme-header';
import { ThemePreview } from '@/components/appearance/theme-preview';
import { useAppearanceCommit } from '@/components/appearance/use-appearance-commit';
import { SubPage } from '@/components/settings/sub-page';
import { ActionRow, ChoiceRow, FormSection, Notice, RadioRow, uiSpace, useUiText } from '@/components/ui';
import { generateRoles, type ThemeMode } from '@/components/ui/theme';
import {
  DEFAULT_THEME_PRESET_ID,
  startingCustom,
  themePresets,
  type ThemePreset,
  type AppearanceChoice,
} from '@/components/ui/theme-presets';
import { SETTINGS_SUB_PAGES } from '@/src/navigation/routes';

// Settings home's Appearance row (`docs/specs/ui/design-language.md` "Choosing
// one"): names the chosen theme and opens the Appearance page. The row shows
// the theme and a preset's mode when it is not light; VoiceOver hears the
// whole choice.
export function AppearanceSettingsRow({ divider = false }: { divider?: boolean }) {
  const router = useRouter();
  const [appearance] = useStoredAppearance();
  return (
    <ChoiceRow
      accessibilityLabel={`Appearance, ${appearanceLabel(appearance)}`}
      divider={divider}
      icon="palette"
      label="Appearance"
      onPress={() => router.push(SETTINGS_SUB_PAGES.appearance)}
      testID="settings-appearance-row"
      value={appearanceSummary(appearance)}
    />
  );
}

// Settings → Appearance: Theme (the presets and Custom as radio rows), then
// Mode for a preset or the custom colours for Custom, then a live preview of
// the choice. While Custom is chosen, Theme collapses to its Custom row and a
// `Show presets` row that lists the presets again; Hide presets or a tap on
// Custom folds them. Each choice is saved at once, and the app repaints in it;
// the header's indicator shows until it has.
export function AppearanceSettingsScreen() {
  const { appearance, saveError, commit, applying } = useAppearanceCommit();
  const phoneScheme = usePhoneScheme();
  const [presetsShown, setPresetsShown] = useState(false);
  const custom = appearance.theme === 'custom';
  const presetsListed = !custom || presetsShown;
  const customChoice: AppearanceChoice = {
    ...appearance,
    theme: 'custom',
    custom: startingCustom(appearance, previewMode(appearance, phoneScheme)),
  };

  return (
    <SubPage testID="settings-appearance-screen">
      {/* Named either way: options merge across renders. */}
      <Stack.Screen options={{ headerRight: applyingHeaderRight(applying, 'settings-appearance-applying') }} />
      <FormSection title="Theme">
        {(presetsListed ? themePresets : []).map((preset, index) => {
          const checked = preset.id === appearance.theme;
          const detail = preset.id === DEFAULT_THEME_PRESET_ID ? ['Default'] : [];
          return (
            <RadioRow
              accessibilityLabel={[preset.label, ...detail.map((word) => word.toLowerCase())].join(', ')}
              checked={checked}
              divider={index > 0}
              key={preset.id}
              label={preset.label}
              meta={<PresetMeta details={detail} mode={previewMode({ ...appearance, theme: preset.id }, phoneScheme)} preset={preset} />}
              onPress={() => {
                void commit(
                  { theme: preset.id },
                  { message: 'Couldn’t save the theme. Nothing changed.', context: { presetId: preset.id } },
                );
              }}
              testID={`settings-appearance-option-${preset.id}`}
            />
          );
        })}
        <RadioRow
          accessibilityLabel="Custom"
          checked={custom}
          divider={presetsListed}
          label="Custom"
          meta={<ChoiceMeta details={[]} roles={appearanceRoles(customChoice, phoneScheme)} />}
          onPress={() => {
            // From the store and the saves on their way, not this render: a
            // part saved on its picker may not have reached this page yet.
            setPresetsShown(false);
            const intended = readIntendedAppearance(appearance);
            if (intended.theme === 'custom') return;
            void commit(
              { theme: 'custom', custom: startingCustom(intended, previewMode(intended, phoneScheme)) },
              { message: 'Couldn’t save the theme. Nothing changed.', context: { presetId: 'custom' } },
            );
          }}
          testID="settings-appearance-option-custom"
        />
        {custom ? (
          <ActionRow
            divider
            kind="act"
            label={presetsShown ? 'Hide presets' : 'Show presets'}
            onPress={() => setPresetsShown((shown) => !shown)}
            testID="settings-appearance-show-presets"
          />
        ) : null}
      </FormSection>
      {custom ? (
        <CustomSection appearance={appearance} />
      ) : (
        <ModeSection appearance={appearance} commit={commit} />
      )}
      {saveError ? <Notice icon="warning" live message={saveError} testID="settings-appearance-error" tone="danger" /> : null}
      <PreviewBlock appearance={appearance} phoneScheme={phoneScheme} />
    </SubPage>
  );
}

// The choice drawn on a small mock of the app.
function PreviewBlock({ appearance, phoneScheme }: { appearance: AppearanceChoice; phoneScheme: ColorSchemeName | null }) {
  const text = useUiText();
  return (
    <View style={styles.preview}>
      <Text accessibilityRole="header" allowFontScaling={false} style={text.label}>
        Preview
      </Text>
      <ThemePreview roles={appearanceRoles(appearance, phoneScheme)} testID="settings-appearance-preview" />
    </View>
  );
}

// Each preset's roles in each mode, for its swatch.
const presetRoles = new Map(
  (['light', 'dark'] as const).flatMap((mode) =>
    themePresets.map((preset) => [`${mode}:${preset.id}`, generateRoles(preset.seeds, mode)] as const),
  ),
);

function PresetMeta({ details, mode, preset }: { details: string[]; mode: ThemeMode; preset: ThemePreset }) {
  return (
    <ChoiceMeta details={details} roles={presetRoles.get(`${mode}:${preset.id}`)!} swatchTestID={`settings-appearance-swatch-${preset.id}`} />
  );
}

const styles = StyleSheet.create({
  preview: {
    gap: uiSpace.sm,
  },
});
