import { useState } from 'react';

import { readIntendedAppearance, readStoredAppearance, useStoredAppearance } from '@/components/appearance/chosen-theme';
import { launchTheme, saveAppearancePart } from '@/components/ui/theme-launch';
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
// - Choosing what is already stored saves nothing, unless this launch could
//   not use the stored choice: saving then replaces the unusable value.
// - The choice shows before its save returns. A failed save is logged, shows
//   the stored choice again (another page may have saved meanwhile) and sets
//   `saveError`.
export function useAppearanceCommit() {
  const [appearance, setAppearance] = useStoredAppearance();
  const [saveError, setSaveError] = useState<string | null>(null);

  const commit = async (part: Partial<AppearanceChoice>, failure: CommitFailure): Promise<CommitOutcome> => {
    setSaveError(null);
    // Read the store and the saves on their way, not state: two commits can
    // land before a re-render, or before the first has been written.
    const intended = readIntendedAppearance();
    const unchanged = (Object.keys(part) as (keyof AppearanceChoice)[]).every(
      (key) => JSON.stringify(intended[key]) === JSON.stringify(part[key]),
    );
    if (unchanged && !launchTheme.problem) return 'unchanged';
    setAppearance({ ...intended, ...part });
    try {
      await saveAppearancePart(part);
    } catch (error) {
      void logEvent({
        level: 'warn',
        event: 'theme.save_failed',
        message: 'Could not save the chosen appearance.',
        context: { ...failure.context, error: error instanceof Error ? error.message : String(error) },
      });
      setAppearance(readStoredAppearance());
      setSaveError(failure.message);
      return 'failed';
    }
    return 'saved';
  };

  return { appearance, setAppearance, saveError, commit };
}
