import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  appearanceRoles,
  pendingAppearance,
  previewMode,
  readIntendedAppearance,
} from '@/components/appearance/chosen-theme';
import { HueRing } from '@/components/appearance/hue-ring';
import { ThemePreview } from '@/components/appearance/theme-preview';
import { useAppearanceCommit } from '@/components/appearance/use-appearance-commit';
import { FormSection, Notice, Screen, SliderRow, uiSpace } from '@/components/ui';
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
import { startingCustom, type AppearanceChoice } from '@/components/ui/theme-presets';

type Draft = CustomColours[CustomPart];

const percent = (value: number): string => `${value}%`;
// The ring's colour for each hue, one function per part, so the ring computes
// its segments once rather than on every drag move.
const RING_COLOURS = Object.fromEntries(
  CUSTOM_PARTS.map((part) => [part, (hue: number) => customSeed(part, { hue, strength: STRENGTH_MAX })]),
) as Record<CustomPart, (hue: number) => string>;
const lightnessLabel = (value: number): string => (value === 0 ? 'Black' : value === LIGHTNESS_MAX ? 'White' : `${value}`);

// The custom colours a choice draws, or the ones it would start from.
function customOf(appearance: AppearanceChoice): CustomColours {
  return startingCustom(appearance, previewMode(appearance));
}

// Settings → Appearance → Custom → one part (background, text, accent, best
// ever, charts): a hue on a ring and a strength, and for the background its
// lightness and depth, with the theme they make, live, on a small mock. A part
// saves when the ring or a slider is let go (or a VoiceOver step is made) and
// applies on the next launch (`theme-launch.ts`), which the page says once it
// has saved.
export function ThemeCustomScreen({ part }: { part: CustomPart }) {
  const { appearance, saveError, commit } = useAppearanceCommit();
  const [draft, setDraft] = useState<Draft>(() => customOf(appearance)[part]);
  const [savedHere, setSavedHere] = useState(false);
  const chosen: AppearanceChoice = { ...appearance, theme: 'custom', custom: { ...customOf(appearance), [part]: draft } };
  const roles = appearanceRoles(chosen);
  const saved = appearance.theme === 'custom' && JSON.stringify(appearance.custom?.[part]) === JSON.stringify(draft);

  // `next` is the value let go at: the event is the truth, not the last render.
  const save = async (next: Draft) => {
    setDraft(next);
    // The colours the saves on their way will store, so another part's save
    // is not overwritten.
    const custom = { ...customOf(readIntendedAppearance()), [part]: next };
    const outcome = await commit(
      { theme: 'custom', custom },
      { message: 'Couldn’t save the colour. Nothing changed.', context: { part, value: next } },
    );
    if (outcome === 'saved') setSavedHere(true);
  };
  const change = (field: keyof CustomBackground) => (value: number) => setDraft((current) => ({ ...current, [field]: value }));
  const end = (field: keyof CustomBackground) => (value: number) => {
    void save({ ...draft, [field]: value });
  };

  return (
    <Screen testID="theme-custom-screen">
      <View style={styles.body}>
        <View style={styles.ring}>
          <HueRing
            accessibilityLabel="Hue"
            colourAt={RING_COLOURS[part]}
            hue={draft.hue}
            onChange={change('hue')}
            onChangeEnd={end('hue')}
            testID="theme-custom-ring"
          />
        </View>
        <FormSection>
          <SliderRow
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
        <ThemePreview roles={roles} testID="theme-custom-preview" />
        {saveError ? <Notice icon="warning" live message={saveError} testID="theme-custom-error" tone="danger" /> : null}
        {savedHere && saved && !saveError && pendingAppearance(appearance).custom[part] ? (
          <Notice icon="success" live message="Saved · next launch" testID="theme-custom-status" />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: uiSpace.lg,
    padding: uiSpace.lg,
  },
  ring: {
    alignItems: 'center',
  },
});
