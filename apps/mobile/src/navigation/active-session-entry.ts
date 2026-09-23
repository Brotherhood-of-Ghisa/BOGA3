import type { Href } from 'expo-router';

/** The session view (redesign step 5) for one session. */
export const sessionViewHref = (sessionId: string): Href =>
  `/session/${encodeURIComponent(sessionId)}` as Href;

/** The exercise page (redesign step 4) for one exercise of a session. */
export const sessionExerciseHref = (sessionId: string, sessionExerciseId: string): Href =>
  `/session/${encodeURIComponent(sessionId)}/exercise/${encodeURIComponent(sessionExerciseId)}` as Href;

export const SESSION_RECORDER_ROUTE = '/session-recorder';

/**
 * Where "open the active session" goes: the session view when the new
 * exercise/session screens setting is on, otherwise the recorder exactly as
 * before. Without a known session id there is no session view to open, so it
 * falls back to the recorder, which finds the draft itself.
 */
export const activeSessionHref = (sessionId: string | null, newScreensEnabled: boolean): Href =>
  newScreensEnabled && sessionId ? sessionViewHref(sessionId) : SESSION_RECORDER_ROUTE;
