import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { HueRing } from '@/components/appearance/hue-ring';
import { ThemePreview } from '@/components/appearance/theme-preview';
import { Notice, Screen, uiRoles, uiSpace } from '@/components/ui';
import { hexToLch } from '@/components/ui/lch';
import { generateRoles } from '@/components/ui/theme';
import { hueThemeId, normaliseHue, parseHueThemeId, seedsFromHue } from '@/components/ui/theme-hue';
import { readStoredThemePresetId, saveThemePresetId } from '@/components/ui/theme-launch';
import { logEvent } from '@/src/logging';

// Settings → Appearance → Custom colour: pick one hue on a ring and see the
// theme it makes, live, on a small mock. The hue saves when the ring is let go
// (or a VoiceOver step is made) and applies on the next launch
// (`theme-launch.ts`), which the page says once it has saved.
export function ThemeColourScreen() {
  const [hue, setHue] = useState(initialHue);
  // The custom hue in the store, so a release that changes nothing writes nothing.
  const [storedHue, setStoredHue] = useState<number | null>(storedCustomHue);
  const [savedHere, setSavedHere] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const roles = generateRoles(seedsFromHue(hue));

  // `released` is the plain hue the ring was let go at.
  const commit = async (released: number) => {
    if (released === storedHue) return;
    setSaveError(null);
    try {
      await saveThemePresetId(hueThemeId(released));
    } catch (error) {
      void logEvent({
        level: 'warn',
        event: 'theme.save_failed',
        message: 'Could not save the custom theme colour.',
        context: { hue: released, error: error instanceof Error ? error.message : String(error) },
      });
      setSaveError('Couldn’t save the colour. Nothing changed.');
      return;
    }
    setStoredHue(released);
    setSavedHere(true);
  };

  return (
    <Screen testID="theme-colour-screen">
      <View style={styles.body}>
        <View style={styles.ring}>
          {/* `setHue` is stable, so the ring's gesture is not rebuilt mid-drag. */}
          <HueRing hue={hue} onChange={setHue} onChangeEnd={commit} testID="theme-colour-ring" />
        </View>
        <ThemePreview roles={roles} testID="theme-colour-preview" />
        {saveError ? <Notice icon="warning" live message={saveError} testID="theme-colour-error" tone="danger" /> : null}
        {savedHere && storedHue === hue && !saveError ? (
          <Notice icon="check" live message="Saved · next launch" testID="theme-colour-status" />
        ) : null}
      </View>
    </Screen>
  );
}

// The custom hue in the store, or null when none (or the store is unreadable:
// the ring then starts from the theme in use, and saving reports failures).
function storedCustomHue(): number | null {
  try {
    const stored = readStoredThemePresetId();
    return stored === null ? null : parseHueThemeId(stored);
  } catch {
    return null;
  }
}

// The custom hue already chosen, else the hue of the accent in use.
function initialHue(): number {
  return storedCustomHue() ?? normaliseHue(hexToLch(uiRoles.accent).hue);
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
