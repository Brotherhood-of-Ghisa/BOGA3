import {
  TRAY_POSITION_THRESHOLD_RATIO,
  TRAY_VELOCITY_THRESHOLD,
  resolveTraySnap,
  traySnapTranslateY,
} from '../tray-snap';

const TRAVEL = 100;
const PAST_POSITION = TRAVEL * TRAY_POSITION_THRESHOLD_RATIO + 1;
const SHORT_OF_POSITION = TRAVEL * TRAY_POSITION_THRESHOLD_RATIO - 1;
const FAST_DOWN = TRAY_VELOCITY_THRESHOLD + 0.1;
const FAST_UP = -(TRAY_VELOCITY_THRESHOLD + 0.1);
const SLOW = TRAY_VELOCITY_THRESHOLD - 0.1;

describe('resolveTraySnap — fling (velocity wins)', () => {
  it('collapses when released with strong downward velocity, even with zero displacement', () => {
    expect(
      resolveTraySnap({
        startState: 'expanded',
        dy: 0,
        vy: FAST_DOWN,
        travelDistance: TRAVEL,
      })
    ).toBe('collapsed');
  });

  it('expands when released with strong upward velocity from the collapsed state', () => {
    expect(
      resolveTraySnap({
        startState: 'collapsed',
        dy: 0,
        vy: FAST_UP,
        travelDistance: TRAVEL,
      })
    ).toBe('expanded');
  });

  it('honors a strong upward fling even if displacement is still slightly down', () => {
    // User started pulling down then snapped back upward with a flick.
    expect(
      resolveTraySnap({
        startState: 'expanded',
        dy: 5,
        vy: FAST_UP,
        travelDistance: TRAVEL,
      })
    ).toBe('expanded');
  });
});

describe('resolveTraySnap — slow drag (position decides)', () => {
  it('collapses an expanded tray when the user drags past the position threshold', () => {
    expect(
      resolveTraySnap({
        startState: 'expanded',
        dy: PAST_POSITION,
        vy: SLOW,
        travelDistance: TRAVEL,
      })
    ).toBe('collapsed');
  });

  it('stays expanded when the slow drag does not cross the position threshold', () => {
    expect(
      resolveTraySnap({
        startState: 'expanded',
        dy: SHORT_OF_POSITION,
        vy: SLOW,
        travelDistance: TRAVEL,
      })
    ).toBe('expanded');
  });

  it('expands a collapsed tray when the user drags upward past the threshold', () => {
    expect(
      resolveTraySnap({
        startState: 'collapsed',
        dy: -PAST_POSITION,
        vy: -SLOW,
        travelDistance: TRAVEL,
      })
    ).toBe('expanded');
  });

  it('stays collapsed when the upward drag does not cross the threshold', () => {
    expect(
      resolveTraySnap({
        startState: 'collapsed',
        dy: -SHORT_OF_POSITION,
        vy: -SLOW,
        travelDistance: TRAVEL,
      })
    ).toBe('collapsed');
  });

  it('snaps back to expanded if the user drags upward while already expanded (no negative displacement collapse)', () => {
    expect(
      resolveTraySnap({
        startState: 'expanded',
        dy: -50,
        vy: 0,
        travelDistance: TRAVEL,
      })
    ).toBe('expanded');
  });

  it('snaps back to collapsed if the user drags downward while already collapsed', () => {
    expect(
      resolveTraySnap({
        startState: 'collapsed',
        dy: 50,
        vy: 0,
        travelDistance: TRAVEL,
      })
    ).toBe('collapsed');
  });
});

describe('resolveTraySnap — degenerate inputs', () => {
  it('treats a zero travel distance as "snap back to start"', () => {
    expect(
      resolveTraySnap({
        startState: 'expanded',
        dy: 200,
        vy: 0,
        travelDistance: 0,
      })
    ).toBe('expanded');
  });

  it('clamps a negative travel distance to zero (snap-back behavior)', () => {
    expect(
      resolveTraySnap({
        startState: 'collapsed',
        dy: -200,
        vy: 0,
        travelDistance: -50,
      })
    ).toBe('collapsed');
  });
});

describe('traySnapTranslateY', () => {
  it('returns 0 for the expanded state', () => {
    expect(traySnapTranslateY('expanded', 80)).toBe(0);
  });

  it('returns the travel distance for the collapsed state', () => {
    expect(traySnapTranslateY('collapsed', 80)).toBe(80);
  });

  it('clamps a negative travel distance to zero', () => {
    expect(traySnapTranslateY('collapsed', -10)).toBe(0);
  });
});
