// One coalesced "the server has this device's new rows" refresh for every
// mounted group resource.
//
// A sync cycle that pushes rows fires `notifyRowsPushed()`. A single timer
// serves every resource: each push (re)arms it to fire
// `GROUP_RESOURCE_AFTER_PUSH_REFRESH_MS` after the latest push, then every
// subscribed listener runs once. Pushes inside the window therefore coalesce
// into one refresh per subscriber. Listeners are the resources on screen: a
// hidden resource unsubscribes and so is never refreshed by a push. The timer
// and the push subscription exist only while someone is subscribed.

import { getLastRowsPushedAtMs, subscribeToRowsPushed } from '@/src/sync/push-signal';

/** Delay after a push that reads refresh at: the evaluator has usually caught up by then. */
export const GROUP_RESOURCE_AFTER_PUSH_REFRESH_MS = 3_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeFromPush: (() => void) | null = null;

const disarm = (): void => {
  if (timer !== null) clearTimeout(timer);
  timer = null;
};

const fire = (): void => {
  timer = null;
  for (const listener of [...listeners]) listener();
};

/** Arms the shared timer for a push at `pushedAtMs`, replacing any earlier arming. */
const armFrom = (pushedAtMs: number): void => {
  disarm();
  const wait = pushedAtMs + GROUP_RESOURCE_AFTER_PUSH_REFRESH_MS - Date.now();
  if (wait > 0) timer = setTimeout(fire, wait);
};

/**
 * Runs `listener` once, `GROUP_RESOURCE_AFTER_PUSH_REFRESH_MS` after each push
 * (or burst of pushes), including a push just before subscribing. Returns the
 * unsubscribe.
 */
export const subscribeToAfterPushRefresh = (listener: () => void): (() => void) => {
  listeners.add(listener);
  if (unsubscribeFromPush === null) {
    unsubscribeFromPush = subscribeToRowsPushed(() => armFrom(Date.now()));
  }
  const lastPushedAtMs = getLastRowsPushedAtMs();
  // A timer already armed belongs to the latest push; do not move it.
  if (timer === null && lastPushedAtMs !== null) armFrom(lastPushedAtMs);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    disarm();
    unsubscribeFromPush?.();
    unsubscribeFromPush = null;
  };
};

/** Test-only reset so a suite starts with no subscribers and no armed timer. */
export const __resetAfterPushRefreshForTests = (): void => {
  listeners.clear();
  disarm();
  unsubscribeFromPush?.();
  unsubscribeFromPush = null;
};
