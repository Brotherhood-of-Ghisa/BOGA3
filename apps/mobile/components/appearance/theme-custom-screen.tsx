import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View, type ColorSchemeName } from 'react-native';

import {
  appearanceRoles,
  CUSTOM_PART_LABELS,
  previewMode,
  readIntendedAppearance,
  usePhoneScheme,
} from '@/components/appearance/chosen-theme';
import { applyingHeaderRight } from '@/components/appearance/theme-header';
import { PartSpotlight, ThemePreview } from '@/components/appearance/theme-preview';
import { useAppearanceCommit } from '@/components/appearance/use-appearance-commit';
import { FormSection, HeaderTitleMenu, Notice, Screen, SliderRow, uiBorder, uiGeometry, uiSpace, useUiRoles } from '@/components/ui';
import type { UiRoles } from '@/components/ui/theme';
import {
  CUSTOM_PARTS,
  customSeed,
  DEPTH_MAX,
  LIGHTNESS_MAX,
  STRENGTH_MAX,
  type CustomBackground,
  type CustomColours,
  type CustomPart,
} from '@/components/ui/theme-custom';
import { hueName } from '@/components/ui/theme-hue';
import { startingCustom, type AppearanceChoice } from '@/components/ui/theme-presets';

type Draft = CustomColours[CustomPart];

const percent = (value: number): string => `${value}%`;
const HUE_MAX = 359;
const HUE_SEGMENTS = 36;
// The hue bar's paint for each part: each segment the colour its hue gives at
// full strength, so the bar shows what each hue can reach (some lose chroma).
// Computed once, not on every drag move.
const HUE_PAINT = Object.fromEntries(
  CUSTOM_PARTS.map((part) => [
    part,
    Array.from({ length: HUE_SEGMENTS }, (_, index) =>
      customSeed(part, { hue: ((index + 0.5) * (HUE_MAX + 1)) / HUE_SEGMENTS, strength: STRENGTH_MAX }),
    ),
  ]),
) as Record<CustomPart, string[]>;
// The role that stands for a part: what the hue bar's swatch shows, in the
// theme being made.
const PART_ROLE: Record<CustomPart, keyof UiRoles> = {
  background: 'paper',
  ink: 'ink',
  text: 'inkMuted',
  accent: 'accent',
  record: 'record',
  viz: 'viz4',
};
const PART_OPTIONS = CUSTOM_PARTS.map((id) => ({ id, label: CUSTOM_PART_LABELS[id] }));
// What VoiceOver hears for a hue; the bar itself shows no words.
const hueLabel = (hue: number): string => `${hueName(hue)}, ${hue} degrees`;
const lightnessLabel = (value: number): string => (value === 0 ? 'Black' : value === LIGHTNESS_MAX ? 'White' : `${value}`);

// The custom colours a choice draws, or the ones it would start from.
function customOf(appearance: AppearanceChoice, phoneScheme: ColorSchemeName | null): CustomColours {
  return startingCustom(appearance, previewMode(appearance, phoneScheme));
}

// Settings → Appearance → Custom → one part (background, primary text,
// secondary text, accent, best ever, charts): a hue on a painted bar and a
// strength, and for the background its lightness and depth; then the part's
// roles alone (`PartSpotlight`) and the whole theme on a small mock, both live
// while a control is held. A part saves when a slider is let go (or a
// VoiceOver step is made), and the app repaints in it; the header's indicator
// shows until it has. The title switches to another part in place.
export function ThemeCustomScreen({ part, onChoosePart }: { part: CustomPart; onChoosePart: (part: CustomPart) => void }) {
  const { appearance, saveError, commit, applying } = useAppearanceCommit();
  const phoneScheme = usePhoneScheme();
  const [draft, setDraft] = useState<Draft>(() => customOf(appearance, phoneScheme)[part]);
  const chosen: AppearanceChoice = { ...appearance, theme: 'custom', custom: { ...customOf(appearance, phoneScheme), [part]: draft } };
  const roles = appearanceRoles(chosen, phoneScheme);
  const liveRoles = useUiRoles();

  // `next` is the value let go at: the event is the truth, not the last render.
  const save = async (next: Draft) => {
    setDraft(next);
    // The colours the saves on their way will store, so another part's save
    // is not overwritten.
    const custom = { ...customOf(readIntendedAppearance(appearance), phoneScheme), [part]: next };
    await commit(
      { theme: 'custom', custom },
      { message: 'Couldn’t save the colour. Nothing changed.', context: { part, value: next } },
    );
  };
  const change = (field: keyof CustomBackground) => (value: number) => setDraft((current) => ({ ...current, [field]: value }));
  const end = (field: keyof CustomBackground) => (value: number) => {
    void save({ ...draft, [field]: value });
  };

  return (
    <Screen testID="theme-custom-screen">
      <Stack.Screen
        options={{
          title: CUSTOM_PART_LABELS[part],
          headerTitle: () => (
            <HeaderTitleMenu currentId={part} onChoose={onChoosePart} options={PART_OPTIONS} sheetTitle="Colour" testID="theme-custom-title" />
          ),
          // Named either way: options merge across renders.
          headerRight: applyingHeaderRight(applying, 'theme-custom-applying'),
        }}
      />
      <View style={styles.body}>
        <FormSection>
          <SliderRow
            format={hueLabel}
            label="Hue"
            max={HUE_MAX}
            onChange={change('hue')}
            onChangeEnd={end('hue')}
            testID="theme-custom-hue"
            trackColours={HUE_PAINT[part]}
            trailing={<View style={[styles.swatch, { backgroundColor: roles[PART_ROLE[part]], borderColor: liveRoles.rule }]} testID="theme-custom-hue-swatch" />}
            value={draft.hue}
          />
          <SliderRow
            divider
            format={percent}
            label="Strength"
            max={STRENGTH_MAX}
            onChange={change('strength')}
            onChangeEnd={end('strength')}
            testID="theme-custom-strength"
            value={draft.strength}
          />
          {'lightness' in draft ? (
            <>
              <SliderRow
                divider
                format={lightnessLabel}
                label="Lightness"
                max={LIGHTNESS_MAX}
                onChange={change('lightness')}
                onChangeEnd={end('lightness')}
                testID="theme-custom-lightness"
                value={draft.lightness}
              />
              <SliderRow
                divider
                format={percent}
                label="Depth"
                max={DEPTH_MAX}
                onChange={change('depth')}
                onChangeEnd={end('depth')}
                testID="theme-custom-depth"
                value={draft.depth}
              />
            </>
          ) : null}
        </FormSection>
        <PartSpotlight part={part} roles={roles} testID="theme-custom-spotlight" />
        <ThemePreview roles={roles} testID="theme-custom-preview" />
        {saveError ? <Notice icon="warning" live message={saveError} testID="theme-custom-error" tone="danger" /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: uiSpace.lg,
    padding: uiSpace.lg,
  },
  // The part's own role in the theme being made, on this page's ground.
  swatch: {
    width: uiGeometry.tapTarget / 2,
    height: uiGeometry.tapTarget / 2,
    borderWidth: uiBorder.width,
    borderRadius: uiGeometry.radius.control,
  },
});
