import { Platform, Settings } from 'react-native';

import { getAppFlavor } from '@/src/utils/app-flavor';
import { isDevMode } from '@/src/utils/isDevMode';

/**
 * iOS user-defaults key that stops the app from raising the system
 * notification-permission dialog. Only the Maestro runtime sets it: the launch
 * writes it into the dev client's preferences (`scripts/maestro-ios-runtime.sh`)
 * and every harness link writes it again, since a flow's `clearState` wipes
 * the preferences. The dialog is system UI that can appear many seconds after
 * the tap that caused it and covers every later assertion; `simctl privacy`
 * cannot pre-answer it.
 */
export const SUPPRESS_NOTIFICATION_PROMPT_KEY = 'BogaMaestroSuppressNotificationPrompt';

// Only local dev clients (the build Maestro drives) honour the key. The
// internal TestFlight build is a dev build too, but its flavor is `preview`,
// so a harness link opened on a phone cannot silence its alerts for good.
const isEligibleBuild = (): boolean =>
  Platform.OS === 'ios' && isDevMode() && getAppFlavor() === 'local';

/** True when the permission prompt must not be shown (see the key above). */
export function isNotificationPromptSuppressed(): boolean {
  if (!isEligibleBuild()) {
    return false;
  }
  try {
    // `defaults write -bool true` and `Settings.set` both store a boolean,
    // which the bridge reads back as `true` (or `1`).
    const value = Settings.get(SUPPRESS_NOTIFICATION_PROMPT_KEY);
    return value === true || value === 1;
  } catch {
    return false;
  }
}

/**
 * Persists {@link SUPPRESS_NOTIFICATION_PROMPT_KEY}. The Maestro harness calls
 * it on every link, so a flow whose `clearState` wiped the launch's seed is
 * covered again from its next harness link. A no-op outside local iOS dev
 * clients.
 */
export function suppressNotificationPrompt(): void {
  if (!isEligibleBuild()) {
    return;
  }
  try {
    Settings.set({ [SUPPRESS_NOTIFICATION_PROMPT_KEY]: true });
  } catch {
    // No SettingsManager (headless runner): nothing can raise the dialog either.
  }
}
