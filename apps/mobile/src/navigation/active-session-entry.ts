import type { Href } from 'expo-router';

import { mainTabHref, type MainTabKey } from '@/src/navigation/main-tabs';
import { loadActiveSessionId } from '@/src/session-entry';

/** The session view for one session. */
export const sessionViewHref = (sessionId: string): Href =>
  `/session/${encodeURIComponent(sessionId)}` as Href;

/** The exercise page for one exercise of a session. */
export const sessionExerciseHref = (sessionId: string, sessionExerciseId: string): Href =>
  `/session/${encodeURIComponent(sessionId)}/exercise/${encodeURIComponent(sessionExerciseId)}` as Href;

/** The exercise picker that adds an exercise to a session (an iOS page sheet). */
export const sessionAddExerciseHref = (sessionId: string): Href =>
  `/session/${encodeURIComponent(sessionId)}/add-exercise` as Href;

/** The open session's volume against the user's history. */
export const sessionCompareHref = (sessionId: string): Href =>
  `/session/${encodeURIComponent(sessionId)}/compare` as Href;

/**
 * Where a main tab leads. Train is the way into training, so with a workout in
 * progress it opens that session directly. A failed lookup opens Train, which
 * shows its own retryable read error rather than assuming there is no workout.
 */
export async function mainTabDestination(
  tab: MainTabKey,
  loadActive: () => Promise<string | null> = loadActiveSessionId,
): Promise<Href> {
  if (tab !== 'train') return mainTabHref(tab);
  try {
    const activeSessionId = await loadActive();
    return activeSessionId ? sessionViewHref(activeSessionId) : mainTabHref(tab);
  } catch {
    return mainTabHref(tab);
  }
}
