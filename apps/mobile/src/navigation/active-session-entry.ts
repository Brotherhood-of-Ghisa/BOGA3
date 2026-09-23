import type { Href } from 'expo-router';

/** The session view (redesign step 5) for one session. */
export const sessionViewHref = (sessionId: string): Href =>
  `/session/${encodeURIComponent(sessionId)}` as Href;

/** The exercise page (redesign step 4) for one exercise of a session. */
export const sessionExerciseHref = (sessionId: string, sessionExerciseId: string): Href =>
  `/session/${encodeURIComponent(sessionId)}/exercise/${encodeURIComponent(sessionExerciseId)}` as Href;
