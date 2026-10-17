import { AppState } from 'react-native';

import { getAppIconName, setAlternateAppIcon, supportsAlternateIcons } from 'expo-alternate-app-icons';

import { DEFAULT_THEME_PRESET_ID, type ResolvedTheme } from '@/components/ui/theme-presets';
import { logEvent } from '@/src/logging';

let inFlight: Promise<void> | null = null;

// Selection follows [[appearance.app-icon-theme]]; names match the config plugin.
async function applyThemeAppIcon(preset: ResolvedTheme['preset'], interrupted: () => boolean): Promise<boolean> {
  const iconName = preset.id === DEFAULT_THEME_PRESET_ID ? null : preset.id === 'custom' ? 'Rainbow' : preset.label;
  try {
    if (getAppIconName() === iconName) return true;
    await setAlternateAppIcon(iconName);
  } catch (error) {
    if (interrupted()) return false;
    let fallbackError: string | null = null;
    if (iconName !== null) {
      try {
        await setAlternateAppIcon(null);
      } catch (cause) {
        if (interrupted()) return false;
        fallbackError = cause instanceof Error ? cause.message : String(cause);
      }
    }
    void logEvent({
      level: 'warn',
      event: 'theme.icon_failed',
      message: 'Could not apply the theme app icon.',
      context: { presetId: preset.id, error: error instanceof Error ? error.message : String(error), fallbackError },
    });
  }
  return true;
}

export function startThemeAppIcon(preset: ResolvedTheme['preset']): () => void {
  if (!supportsAlternateIcons) return () => {};
  let state = AppState.currentState;
  let stopped = false;
  let finished = false;
  let backgrounded = false;

  function reconcile() {
    if (stopped || finished || state !== 'active') return;
    if (inFlight) {
      void inFlight.then(reconcile);
      return;
    }
    backgrounded = false;
    inFlight = applyThemeAppIcon(preset, () => stopped || backgrounded || state !== 'active')
      .then((complete) => { finished = complete; })
      .finally(() => {
        inFlight = null;
        // A foreground event can arrive before UIKit rejects the cancelled request.
        if (!finished) reconcile();
      });
  }

  const subscription = AppState.addEventListener('change', (nextState) => {
    state = nextState;
    if (state === 'background') backgrounded = true;
    reconcile();
  });
  reconcile();
  return () => {
    stopped = true;
    subscription.remove();
  };
}
