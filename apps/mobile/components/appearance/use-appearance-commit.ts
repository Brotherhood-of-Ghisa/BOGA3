import { useState } from 'react';

import {
  readIntendedAppearance,
  readStoredAppearance,
  storedChoiceUnusable,
  useStoredAppearance,
} from '@/components/appearance/chosen-theme';
import { useAppTheme } from '@/components/ui/theme-context';
import { saveAppearancePart } from '@/components/ui/theme-launch';
import type { AppearanceChoice } from '@/components/ui/theme-presets';
import { logEvent } from '@/src/logging';

export type CommitOutcome = 'saved' | 'unchanged' | 'failed';

// What a failed commit says and logs.
export type CommitFailure = {
  // Shown in a danger `Notice`: what failed, then that nothing changed.
  message: string;
  // The choice that failed, as the log wants it (`{presetId}`, `{hue}`, …).
  context: Record<string, unknown>;
};

// The Appearance pages' one way to commit a choice: the stored appearance,
// kept current; `commit` saves part of it at once and reports the outcome.
//
// - Choosing what is already stored saves nothing, unless the stored choice
//   is unusable: saving then replaces it.
// - The choice shows before its save returns. A failed save is logged, shows
//   the stored choice again (another page may have saved meanwhile) and sets
//   `saveError`.
// - `applying` is true from a commit until the app is drawn in the stored
//   choice: while a save is on its way, then until the theme provider's
//   repaint (a transition, `theme-context.tsx`) has committed it. Both sides
//   are read through the same parser, so they compare equal once it lands,
//   whichever page saved.
export function useAppearanceCommit() {
  const [appearance, setAppearance] = useStoredAppearance();
  const inUse = useAppTheme().appearance;
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);
  const applying = saving > 0 || JSON.stringify(appearance) !== JSON.stringify(inUse);

  const commit = async (part: Partial<AppearanceChoice>, failure: CommitFailure): Promise<CommitOutcome> => {
    setSaveError(null);
    // Read the store and the saves on their way, not state: two commits can
    // land before a re-render, or before the first has been written.
    const intended = readIntendedAppearance(inUse);
    const unchanged = (Object.keys(part) as (keyof AppearanceChoice)[]).every(
      (key) => JSON.stringify(intended[key]) === JSON.stringify(part[key]),
    );
    if (unchanged && !storedChoiceUnusable()) return 'unchanged';
    setAppearance({ ...intended, ...part });
    setSaving((count) => count + 1);
    try {
      await saveAppearancePart(part);
    } catch (error) {
      void logEvent({
        level: 'warn',
        event: 'theme.save_failed',
        message: 'Could not save the chosen appearance.',
        context: { ...failure.context, error: error instanceof Error ? error.message : String(error) },
      });
      setAppearance(readStoredAppearance(inUse));
      setSaveError(failure.message);
      return 'failed';
    } finally {
      setSaving((count) => count - 1);
    }
    return 'saved';
  };

  return { appearance, setAppearance, saveError, commit, applying };
}
