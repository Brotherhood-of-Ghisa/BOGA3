/**
 * The swipe shell's decision rules (`ux-rules.md` "Swipes on the exercise page"), as pure functions:
 * a side the screen does not offer can neither be dragged nor fired, and an
 * offered side fires past its distance or on a fling. The gesture itself is
 * native; the screen test covers which sides the open row offers.
 */
import { clampSwipeDrag, swipeOutcome } from '@/components/exercise-page/swipe-set-row';

const BOTH = { left: true, right: true };
const RIGHT_ONLY = { left: false, right: true };
const LEFT_ONLY = { left: true, right: false };
const NONE = { left: false, right: false };

describe('swipe set row decisions', () => {
  it('caps the drag at 88pt and pins it at 0 towards a side not offered', () => {
    expect(clampSwipeDrag(200, BOTH)).toBe(88);
    expect(clampSwipeDrag(-200, BOTH)).toBe(-88);
    expect(clampSwipeDrag(40, BOTH)).toBe(40);

    expect(clampSwipeDrag(-60, RIGHT_ONLY)).toBe(0);
    expect(clampSwipeDrag(60, RIGHT_ONLY)).toBe(60);
    expect(clampSwipeDrag(60, LEFT_ONLY)).toBe(0);
    expect(clampSwipeDrag(-60, LEFT_ONLY)).toBe(-60);
    expect(clampSwipeDrag(60, NONE)).toBe(0);
  });

  it('fires an offered side past the 56pt trigger or on a fling, never short of both', () => {
    expect(swipeOutcome(57, 0, BOTH)).toBe('right');
    expect(swipeOutcome(-57, 0, BOTH)).toBe('left');
    expect(swipeOutcome(20, 501, BOTH)).toBe('right');
    expect(swipeOutcome(-20, -501, BOTH)).toBe('left');
    expect(swipeOutcome(56, 500, BOTH)).toBeNull();
    expect(swipeOutcome(-56, -500, BOTH)).toBeNull();
    // A fling against the drag's direction fires nothing.
    expect(swipeOutcome(20, -900, BOTH)).toBeNull();
    expect(swipeOutcome(0, 900, BOTH)).toBeNull();
  });

  it('never fires a side that is not offered', () => {
    expect(swipeOutcome(-80, -900, RIGHT_ONLY)).toBeNull();
    expect(swipeOutcome(80, 900, RIGHT_ONLY)).toBe('right');
    expect(swipeOutcome(80, 900, LEFT_ONLY)).toBeNull();
    expect(swipeOutcome(-80, -900, LEFT_ONLY)).toBe('left');
    expect(swipeOutcome(80, 900, NONE)).toBeNull();
  });
});
