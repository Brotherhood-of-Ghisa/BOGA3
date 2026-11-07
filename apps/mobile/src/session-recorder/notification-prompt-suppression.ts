import { Platform, Settings } from 'react-native';

import { isDevMode } from '@/src/utils/isDevMode';

/**
 * iOS user-defaults key that stops the app from raising the system
 * notification-permission dialog. Only the Maestro runtime sets it: the launch
 * script writes it into the dev client's preferences
 * (`scripts/maestro-ios-runtime.sh`), and flows that `clearState` pass it as a
 * launch argument, which lands in the same user defaults. The dialog is
 * system UI that can appear seconds after the tap that caused it and covers
 * every later assertion; `simctl privacy` cannot pre-answer it.
 */
export const SUPPRESS_NOTIFICATION_PROMPT_KEY = 'BogaMaestroSuppressNotificationPrompt';

const TRUE_VALUES = new Set<unknown>([true, 1, '1', 'true', 'YES']);

/**
 * True when the permission prompt must not be shown: a developer build on iOS
 * whose user defaults carry {@link SUPPRESS_NOTIFICATION_PROMPT_KEY}. Release
 * builds ignore the key.
 */
export function isNotificationPromptSuppressed(): boolean {
  if (Platform.OS !== 'ios' || !isDevMode()) {
    return false;
  }
  try {
    return TRUE_VALUES.has(Settings.get(SUPPRESS_NOTIFICATION_PROMPT_KEY));
  } catch {
    return false;
  }
}

/**
 * Persists {@link SUPPRESS_NOTIFICATION_PROMPT_KEY} in this developer build's
 * user defaults. The Maestro harness calls it on every link, so a flow whose
 * `clearState` wiped the launch script's seed is covered again before its next
 * step. A no-op in release builds and off iOS.
 */
export function suppressNotificationPrompt(): void {
  if (Platform.OS !== 'ios' || !isDevMode()) {
    return;
  }
  try {
    Settings.set({ [SUPPRESS_NOTIFICATION_PROMPT_KEY]: true });
  } catch {
    // No SettingsManager (headless runner): nothing can raise the dialog either.
  }
}
