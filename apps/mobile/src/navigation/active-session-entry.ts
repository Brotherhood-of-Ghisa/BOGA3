import type { Href } from 'expo-router';

import { mainTabHref } from '@/src/navigation/main-tabs';

/** The session view for one session as a page: a completed session's edit. */
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
 * Where the workout in progress lives: the Train tab shows it in place of its
 * Start disc, so every way into it opens Train.
 */
export const ACTIVE_WORKOUT_HREF: Href = mainTabHref('train');
