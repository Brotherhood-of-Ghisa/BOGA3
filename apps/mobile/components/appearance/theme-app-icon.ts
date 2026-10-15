import { getAppIconName, setAlternateAppIcon, supportsAlternateIcons } from 'expo-alternate-app-icons';

import { DEFAULT_THEME_PRESET_ID, type ResolvedTheme } from '@/components/ui/theme-presets';
import { logEvent } from '@/src/logging';

// Selection follows [[appearance.app-icon-theme]]; names match the config plugin.
export async function applyThemeAppIcon(preset: ResolvedTheme['preset']): Promise<void> {
  if (!supportsAlternateIcons) return;
  const iconName = preset.id === 'custom' || preset.id === DEFAULT_THEME_PRESET_ID ? null : preset.label;
  try {
    if (getAppIconName() === iconName) return;
    await setAlternateAppIcon(iconName);
  } catch (error) {
    let fallbackError: string | null = null;
    if (iconName !== null) {
      try {
        await setAlternateAppIcon(null);
      } catch (cause) {
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
}
