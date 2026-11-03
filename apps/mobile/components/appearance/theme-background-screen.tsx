import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  appearanceRoles,
  BACKGROUND_TINT_LABELS,
  pendingAppearance,
} from '@/components/appearance/chosen-theme';
import { HueRing } from '@/components/appearance/hue-ring';
import { ThemePreview } from '@/components/appearance/theme-preview';
import { useAppearanceCommit } from '@/components/appearance/use-appearance-commit';
import { FormSection, Notice, SegmentRow, Screen, uiRoles, uiSpace } from '@/components/ui';
import { hexToLch } from '@/components/ui/lch';
import { normaliseHue } from '@/components/ui/theme-hue';
import { BACKGROUND_TINTS, type BackgroundTint, type CustomBackground } from '@/components/ui/theme-neutrals';
import type { AppearanceChoice } from '@/components/ui/theme-presets';

const TINT_OPTIONS = BACKGROUND_TINTS.map((tint) => ({ value: tint, label: BACKGROUND_TINT_LABELS[tint] }));
const DEFAULT_TINT: BackgroundTint = 2;

// Settings → Appearance → Custom background: pick one hue on a ring and a tint
// step, and see the page they make, live, on a small mock. The background
// saves when the ring is let go (or a VoiceOver step is made) or a tint is
// picked, and applies on the next launch (`theme-launch.ts`), which the page
// says once it has saved.
export function ThemeBackgroundScreen() {
  const { appearance, saveError, commit } = useAppearanceCommit();
  const [choice, setChoice] = useState<CustomBackground>(() => initialBackground(appearance));
  const [savedHere, setSavedHere] = useState(false);
  const roles = appearanceRoles({ ...appearance, background: choice });
  const stored = appearance.background;
  const saved = typeof stored === 'object' && stored.hue === choice.hue && stored.tint === choice.tint;

  // `next` is the hue the ring was let go at, or the tint picked: the event is
  // the truth, not the last render.
  const save = async (next: CustomBackground) => {
    setChoice(next);
    const outcome = await commit(
      { background: next },
      { message: 'Couldn’t save the background. Nothing changed.', context: { background: next } },
    );
    if (outcome === 'saved') setSavedHere(true);
  };

  return (
    <Screen testID="theme-background-screen">
      <View style={styles.body}>
        <View style={styles.ring}>
          <HueRing
            accessibilityLabel="Background hue"
            hue={choice.hue}
            onChange={(hue) => setChoice((current) => ({ ...current, hue }))}
            onChangeEnd={(hue) => {
              void save({ ...choice, hue });
            }}
            testID="theme-background-ring"
          />
        </View>
        <FormSection>
          <SegmentRow
            label="Tint"
            onChange={(tint) => {
              void save({ ...choice, tint });
            }}
            options={TINT_OPTIONS}
            testIDPrefix="theme-background-tint"
            value={choice.tint}
          />
        </FormSection>
        <ThemePreview roles={roles} testID="theme-background-preview" />
        {saveError ? <Notice icon="warning" live message={saveError} testID="theme-background-error" tone="danger" /> : null}
        {savedHere && saved && !saveError && pendingAppearance(appearance).background ? (
          <Notice icon="success" live message="Saved · next launch" testID="theme-background-status" />
        ) : null}
      </View>
    </Screen>
  );
}

// The custom background already chosen, else the hue of the ground in use at
// the middle tint.
function initialBackground({ background }: AppearanceChoice): CustomBackground {
  if (typeof background === 'object') return background;
  return { hue: normaliseHue(hexToLch(uiRoles.rule).hue), tint: DEFAULT_TINT };
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
