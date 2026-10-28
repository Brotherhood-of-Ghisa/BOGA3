import { AppState } from 'react-native';

import { getAppIconName, setAlternateAppIcon, supportsAlternateIcons } from 'expo-alternate-app-icons';

import { DEFAULT_THEME_PRESET_ID, type ResolvedTheme } from '@/components/ui/theme-presets';
import { logEvent } from '@/src/logging';
import { isNovember, watchNovemberAppearance } from '@/src/utils/seasonal-appearance';

let inFlight: Promise<void> | null = null;

// Each preset has its own icon, every custom colour shares Rainbow, and Warm (the
// default) is the primary icon and the fallback; names match the config plugin.
async function applyThemeAppIcon(
  preset: ResolvedTheme['preset'], november: boolean, interrupted: () => boolean,
): Promise<boolean> {
  const themeName = preset.id === 'custom' ? 'Rainbow' : preset.label;
  const iconName = november ? `${themeName}November` : preset.id === DEFAULT_THEME_PRESET_ID ? null : themeName;
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
  let completedSeason: { year: number; november: boolean } | undefined;
  let backgrounded = false;

  function reconcile() {
    const now = new Date();
    const november = isNovember(now);
    const year = now.getFullYear();
    if (stopped || (completedSeason?.year === year && completedSeason.november === november) || state !== 'active') return;
    if (inFlight) {
      void inFlight.then(reconcile);
      return;
    }
    backgrounded = false;
    inFlight = applyThemeAppIcon(preset, november, () => stopped || backgrounded || state !== 'active')
      .then((complete) => { if (complete) completedSeason = { year, november }; })
      .finally(() => {
        inFlight = null;
        // A foreground event can arrive before UIKit rejects the cancelled request.
        reconcile();
      });
  }

  const subscription = AppState.addEventListener('change', (nextState) => {
    state = nextState;
    if (state === 'background') backgrounded = true;
    reconcile();
  });
  const stopCalendar = watchNovemberAppearance(reconcile);
  return () => {
    stopped = true;
    subscription.remove();
    stopCalendar();
  };
}
