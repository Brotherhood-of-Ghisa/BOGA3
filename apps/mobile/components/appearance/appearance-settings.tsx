import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ChoiceMeta, CustomSection } from '@/components/appearance/appearance-custom';
import { ModeSection } from '@/components/appearance/appearance-mode';
import {
  appearanceLabel,
  appearanceSummary,
  appearanceRoles,
  pendingAppearance,
  previewMode,
  readIntendedAppearance,
  useStoredAppearance,
} from '@/components/appearance/chosen-theme';
import { ThemePreview } from '@/components/appearance/theme-preview';
import { useAppearanceCommit } from '@/components/appearance/use-appearance-commit';
import { SubPage } from '@/components/settings/sub-page';
import { ActionRow, ChoiceRow, FormSection, Notice, RadioRow, uiSpace, uiText, uiTextTone } from '@/components/ui';
import { generateRoles, type ThemeMode } from '@/components/ui/theme';
import {
  DEFAULT_THEME_PRESET_ID,
  startingCustom,
  themePresets,
  type ThemePreset,
  type AppearanceChoice,
  type ThemePresetId,
} from '@/components/ui/theme-presets';
import { SETTINGS_SUB_PAGES } from '@/src/navigation/routes';

// Settings home's Appearance row (`docs/specs/ui/design-language.md` "Choosing
// one"): names the chosen theme and opens the Appearance page. The row shows
// the theme, a preset's mode when it is not light, and `from next launch` on a
// pending choice (a choice applies on the next launch, as the app cannot
// restart itself); VoiceOver hears the whole choice.
export function AppearanceSettingsRow({ divider = false }: { divider?: boolean }) {
  const router = useRouter();
  const [appearance] = useStoredAppearance();
  const label = appearanceLabel(appearance);
  const spoken = pendingAppearance(appearance).any ? `${label} from next launch` : label;
  return (
    <ChoiceRow
      accessibilityLabel={`Appearance, ${spoken}`}
      divider={divider}
      icon="palette"
      label="Appearance"
      onPress={() => router.push(SETTINGS_SUB_PAGES.appearance)}
      testID="settings-appearance-row"
      value={appearanceSummary(appearance)}
    />
  );
}

// Settings → Appearance: a live preview of the choice, then Theme (the presets
// and Custom as radio rows), then Mode for a preset or the custom colours for
// Custom. While Custom is chosen, Theme collapses to its Custom row and a
// `Show presets` row that lists the presets again; Hide presets or a tap on
// Custom folds them. Each choice is saved at
// once and labelled `Next launch` until the app reopens.
export function AppearanceSettingsScreen() {
  const { appearance, saveError, commit } = useAppearanceCommit();
  const [presetsShown, setPresetsShown] = useState(false);
  const pending = pendingAppearance(appearance);
  const custom = appearance.theme === 'custom';
  const presetsListed = !custom || presetsShown;
  const customChoice: AppearanceChoice = {
    ...appearance,
    theme: 'custom',
    custom: startingCustom(appearance, previewMode(appearance)),
  };
  // Custom waits for the next launch when it, or any part of it, does.
  const customDetail = custom && pending.any ? ['Next launch'] : [];

  return (
    <SubPage testID="settings-appearance-screen">
      <PreviewBlock appearance={appearance} />
      <FormSection title="Theme">
        {(presetsListed ? themePresets : []).map((preset, index) => {
          const checked = preset.id === appearance.theme;
          const detail = presetDetails(preset.id, checked, pending.theme);
          return (
            <RadioRow
              accessibilityLabel={[preset.label, ...detail.map((word) => word.toLowerCase())].join(', ')}
              checked={checked}
              divider={index > 0}
              key={preset.id}
              label={preset.label}
              meta={<PresetMeta details={detail} mode={previewMode({ ...appearance, theme: preset.id })} preset={preset} />}
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
          accessibilityLabel={['Custom', ...customDetail.map((word) => word.toLowerCase())].join(', ')}
          checked={custom}
          divider={presetsListed}
          label="Custom"
          meta={<ChoiceMeta details={customDetail} roles={appearanceRoles(customChoice)} />}
          onPress={() => {
            // From the store and the saves on their way, not this render: a
            // part saved on its picker may not have reached this page yet.
            setPresetsShown(false);
            const intended = readIntendedAppearance();
            if (intended.theme === 'custom') return;
            void commit(
              { theme: 'custom', custom: startingCustom(intended, previewMode(intended)) },
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
        <CustomSection appearance={appearance} pending={pending} />
      ) : (
        <ModeSection appearance={appearance} commit={commit} pending={pending} />
      )}
      {saveError ? <Notice icon="warning" live message={saveError} testID="settings-appearance-error" tone="danger" /> : null}
    </SubPage>
  );
}

// The choice drawn on a small mock of the app, and when it applies.
function PreviewBlock({ appearance }: { appearance: AppearanceChoice }) {
  return (
    <View style={styles.preview}>
      <Text accessibilityRole="header" allowFontScaling={false} style={uiText.label}>
        Preview
      </Text>
      <ThemePreview roles={appearanceRoles(appearance)} testID="settings-appearance-preview" />
      <Text allowFontScaling={false} style={[uiText.meta, uiTextTone.muted]} testID="settings-appearance-footnote">
        Applies next launch
      </Text>
    </View>
  );
}

// The words beside a preset's name: `Default`, and `Next launch` on the chosen
// preset while it waits for the next launch.
function presetDetails(id: ThemePresetId, checked: boolean, pending: boolean): string[] {
  return [
    ...(id === DEFAULT_THEME_PRESET_ID ? ['Default'] : []),
    ...(checked && pending ? ['Next launch'] : []),
  ];
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
