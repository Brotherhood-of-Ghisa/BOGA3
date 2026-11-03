import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { BackgroundSection, TextSection } from '@/components/appearance/appearance-neutrals';
import {
  appearanceLabel,
  appearanceRoles,
  pendingAppearance,
  useStoredAppearance,
} from '@/components/appearance/chosen-theme';
import { ThemePreview } from '@/components/appearance/theme-preview';
import { useAppearanceCommit } from '@/components/appearance/use-appearance-commit';
import { SubPage } from '@/components/settings/sub-page';
import { ChoiceRow, FormSection, Notice, RadioRow, uiBorder, uiGeometry, uiSpace, uiText, uiTextTone } from '@/components/ui';
import { generateRoles } from '@/components/ui/theme';
import { hueName, parseHueThemeId } from '@/components/ui/theme-hue';
import {
  DEFAULT_THEME_PRESET_ID,
  themePresets,
  type ThemePreset,
  type AppearanceChoice,
  type ThemePresetId,
} from '@/components/ui/theme-presets';
import { SETTINGS_SUB_PAGES, THEME_COLOUR_ROUTE } from '@/src/navigation/routes';

// Settings home's Appearance row (`docs/specs/ui/design-language.md` "Choosing
// one"): names the chosen theme — the accent, then the background and text when
// they are not the theme's own — and opens the Appearance page. A choice
// applies on the next launch, as the app cannot restart itself, so a pending
// choice reads `from next launch` here.
export function AppearanceSettingsRow({ divider = false }: { divider?: boolean }) {
  const router = useRouter();
  const [appearance] = useStoredAppearance();
  const label = appearanceLabel(appearance);
  const shown = pendingAppearance(appearance).any ? `${label} from next launch` : label;
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

// Settings → Appearance: a live preview of the choice, then Theme (the presets
// as radio rows, then Custom colour, which opens the hue picker), Background
// and Text. Each choice is saved at once and labelled `Next launch` until the
// app reopens.
export function AppearanceSettingsScreen() {
  const router = useRouter();
  const { appearance, saveError, commit } = useAppearanceCommit();
  const pending = pendingAppearance(appearance);
  const customHue = parseHueThemeId(appearance.accent);

  return (
    <SubPage testID="settings-appearance-screen">
      <PreviewBlock appearance={appearance} />
      <FormSection title="Theme">
        {themePresets.map((preset, index) => {
          const checked = preset.id === appearance.accent;
          const detail = presetDetails(preset.id, checked, pending.accent);
          return (
            <RadioRow
              accessibilityLabel={[preset.label, ...detail.map((word) => word.toLowerCase())].join(', ')}
              checked={checked}
              divider={index > 0}
              key={preset.id}
              label={preset.label}
              meta={<PresetMeta details={detail} preset={preset} />}
              onPress={() => {
                void commit(
                  { accent: preset.id },
                  { message: 'Couldn’t save the theme. Nothing changed.', context: { presetId: preset.id } },
                );
              }}
              testID={`settings-appearance-option-${preset.id}`}
            />
          );
        })}
        <ChoiceRow
          accessibilityLabel={customHue !== null ? undefined : 'Custom colour'}
          divider
          label="Custom colour"
          onPress={() => router.push(THEME_COLOUR_ROUTE)}
          testID="settings-appearance-option-custom"
          value={customHue !== null ? `${hueName(customHue)}, ${customHue}°${pending.accent ? ' · Next launch' : ''}` : undefined}
        />
      </FormSection>
      <BackgroundSection appearance={appearance} commit={commit} pending={pending} />
      <TextSection appearance={appearance} commit={commit} pending={pending} />
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
  preview: {
    gap: uiSpace.sm,
  },
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
