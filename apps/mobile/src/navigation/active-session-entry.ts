import type { Href } from 'expo-router';

/** The session view for one session. */
export const sessionViewHref = (sessionId: string): Href =>
  `/session/${encodeURIComponent(sessionId)}` as Href;

/** The exercise page for one exercise of a session. */
export const sessionExerciseHref = (sessionId: string, sessionExerciseId: string): Href =>
  `/session/${encodeURIComponent(sessionId)}/exercise/${encodeURIComponent(sessionExerciseId)}` as Href;

/** The open session's volume against the user's history. */
export const sessionCompareHref = (sessionId: string): Href =>
  `/session/${encodeURIComponent(sessionId)}/compare` as Href;
