import { useState } from 'react';
import { DevSettings, StyleSheet, View } from 'react-native';

import { HueRing } from '@/components/appearance/hue-ring';
import { ThemePreview } from '@/components/appearance/theme-preview';
import { ActionButton, Notice, Screen, uiRoles, uiSpace } from '@/components/ui';
import { hexToLch } from '@/components/ui/lch';
import { generateRoles } from '@/components/ui/theme';
import { hueThemeId, normaliseHue, parseHueThemeId, seedsFromHue } from '@/components/ui/theme-hue';
import { readStoredThemePresetId, saveThemePresetId } from '@/components/ui/theme-launch';
import { logEvent } from '@/src/logging';

// Settings → Appearance → Custom colour: pick one hue on a ring and see the
// theme it makes, live, on a small mock. The app itself only repaints on the
// next launch (`theme-launch.ts`), which the saved button's label states; a
// development build reloads at once.
export function ThemeColourScreen() {
  const [hue, setHue] = useState(initialHue);
  // The hue last saved here; the button reads "Saved" while the ring still shows it.
  const [savedHue, setSavedHue] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const roles = generateRoles(seedsFromHue(hue));
  const saved = savedHue === hue;

  const apply = async () => {
    setSaveError(null);
    try {
      await saveThemePresetId(hueThemeId(hue));
    } catch (error) {
      void logEvent({
        level: 'warn',
        event: 'theme.save_failed',
        message: 'Could not save the custom theme colour.',
        context: { hue, error: error instanceof Error ? error.message : String(error) },
      });
      setSaveError('Couldn’t save the colour. Nothing changed.');
      return;
    }
    setSavedHue(hue);
    // A no-op in a production build, where the theme waits for the next launch.
    DevSettings.reload('Theme colour changed');
  };

  return (
    <Screen testID="theme-colour-screen">
      <View style={styles.body}>
        <View style={styles.ring}>
          {/* `setHue` is stable, so the ring's gesture is not rebuilt mid-drag. */}
          <HueRing hue={hue} onChange={setHue} testID="theme-colour-ring" />
        </View>
        <ThemePreview roles={roles} testID="theme-colour-preview" />
        {saveError ? <Notice icon="warning" live message={saveError} testID="theme-colour-error" tone="danger" /> : null}
        <ActionButton
          disabled={saved}
          label={saved ? 'Saved · next launch' : 'Use this colour'}
          onPress={() => void apply()}
          testID="theme-colour-apply"
          variant="primary"
        />
      </View>
    </Screen>
  );
}

// The custom hue already chosen, else the hue of the accent in use.
function initialHue(): number {
  try {
    const stored = readStoredThemePresetId();
    const storedHue = stored === null ? null : parseHueThemeId(stored);
    if (storedHue !== null) return storedHue;
  } catch {
    // Unreadable store: start from the theme in use; saving reports failures.
  }
  return normaliseHue(hexToLch(uiRoles.accent).hue);
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
