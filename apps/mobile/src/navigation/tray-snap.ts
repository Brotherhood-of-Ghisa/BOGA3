/**
 * Pure helper that turns a finger-release event on the bottom tray into a snap
 * decision (collapse to the peek strip vs. expand back to the full tab bar).
 *
 * Kept free of `react-native` imports so unit tests can exercise it without
 * touching gesture plumbing. The component layer (`BottomTray`) feeds it the
 * release deltas it gets from `PanResponder` and runs the resulting target
 * through `Animated.spring` / `Animated.timing`.
 */

export type TraySnapState = 'expanded' | 'collapsed';

export type TraySnapInput = {
  /** Position the tray was in at the start of the gesture. */
  startState: TraySnapState;
  /**
   * Vertical delta from gesture start, in pixels. Positive = the user dragged
   * the handle downward (toward collapsed). React Native's PanResponder
   * `dy` matches this sign convention.
   */
  dy: number;
  /**
   * Vertical velocity at release, in pixels/ms. Positive = downward.
   * PanResponder reports velocity as px/ms.
   */
  vy: number;
  /**
   * Vertical travel distance between the expanded and collapsed positions
   * (positive number of pixels). Used to compute the position-based threshold.
   */
  travelDistance: number;
};

/**
 * Tunables. Exported so tests can pin them down if we ever want to.
 */
export const TRAY_POSITION_THRESHOLD_RATIO = 0.4;
/** Velocity (px/ms) past which the gesture's direction always wins. */
export const TRAY_VELOCITY_THRESHOLD = 0.5;

/**
 * Decide where the tray should snap to after a drag release.
 *
 * Decision rule:
 * 1. If the release velocity is past the threshold, direction wins
 *    (downward velocity collapses, upward velocity expands).
 * 2. Otherwise, compare the absolute drag distance to a fraction of the
 *    available travel: past the position threshold from `startState`, snap
 *    to the other end; otherwise, snap back to `startState`.
 */
export function resolveTraySnap(input: TraySnapInput): TraySnapState {
  const { startState, dy, vy, travelDistance } = input;

  // Degenerate: a tray with no travel distance can't move, so snap back to
  // wherever it started regardless of the gesture.
  const clampedTravel = Math.max(0, travelDistance);
  if (clampedTravel === 0) {
    return startState;
  }

  // Velocity decides when the user flings.
  if (vy >= TRAY_VELOCITY_THRESHOLD) {
    return 'collapsed';
  }
  if (vy <= -TRAY_VELOCITY_THRESHOLD) {
    return 'expanded';
  }

  // No fling — use position-based snap relative to the starting state.
  const positionThreshold = clampedTravel * TRAY_POSITION_THRESHOLD_RATIO;

  if (startState === 'expanded') {
    // Only a sufficient downward drag collapses.
    return dy >= positionThreshold ? 'collapsed' : 'expanded';
  }

  // startState === 'collapsed': only a sufficient upward drag expands.
  return dy <= -positionThreshold ? 'expanded' : 'collapsed';
}

/**
 * Convert a tray snap state into the `translateY` (in pixels) to apply to the
 * `Animated.View` that wraps the tray. The expanded state sits at the natural
 * origin; the collapsed state slides down by `travelDistance`.
 */
export function traySnapTranslateY(
  state: TraySnapState,
  travelDistance: number
): number {
  return state === 'expanded' ? 0 : Math.max(0, travelDistance);
}
