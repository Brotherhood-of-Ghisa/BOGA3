/**
 * The swipe shell's decision rules (`ux-rules.md` "Swipes on the exercise page"), as pure functions:
 * a side the screen does not offer can neither be dragged nor fired, an
 * offered side fires past its distance or on a fling, and the side's two
 * layers cross-fade so the latched look starts exactly where the swipe fires.
 * The gesture itself is native; the screen test covers which sides a row offers.
 */
import { clampSwipeDrag, swipeOutcome, swipeSideVisual } from '@/components/exercise-page/swipe-set-row';

const BOTH = { left: true, right: true };
const RIGHT_ONLY = { left: false, right: true };
const LEFT_ONLY = { left: true, right: false };
const NONE = { left: false, right: false };

describe('swipe set row decisions', () => {
  it('follows the finger to the 36pt trigger, then resists to a 72pt cap', () => {
    // Up to the trigger the row is under the finger exactly.
    expect(clampSwipeDrag(20, BOTH)).toBe(20);
    expect(clampSwipeDrag(36, BOTH)).toBe(36);
    expect(clampSwipeDrag(-36, BOTH)).toBe(-36);
    // Past it the row gives 45% of the finger, so the drag hits a wall right
    // where the release starts firing.
    expect(clampSwipeDrag(56, BOTH)).toBeCloseTo(45);
    expect(clampSwipeDrag(-56, BOTH)).toBeCloseTo(-45);
    expect(clampSwipeDrag(400, BOTH)).toBe(72);
    expect(clampSwipeDrag(-400, BOTH)).toBe(-72);

    expect(clampSwipeDrag(-60, RIGHT_ONLY)).toBe(0);
    expect(clampSwipeDrag(20, RIGHT_ONLY)).toBe(20);
    expect(clampSwipeDrag(20, LEFT_ONLY)).toBe(0);
    expect(clampSwipeDrag(-20, LEFT_ONLY)).toBe(-20);
    expect(clampSwipeDrag(20, NONE)).toBe(0);
  });

  it('fires an offered side past the 36pt trigger or on a fling, never short of both', () => {
    expect(swipeOutcome(37, 0, BOTH)).toBe('right');
    expect(swipeOutcome(-37, 0, BOTH)).toBe('left');
    expect(swipeOutcome(20, 501, BOTH)).toBe('right');
    expect(swipeOutcome(-20, -501, BOTH)).toBe('left');
    expect(swipeOutcome(36, 500, BOTH)).toBeNull();
    expect(swipeOutcome(-36, -500, BOTH)).toBeNull();
    // A fling against the drag's direction fires nothing.
    expect(swipeOutcome(20, -900, BOTH)).toBeNull();
    expect(swipeOutcome(0, 900, BOTH)).toBeNull();
  });

  it('goes solid only from the trigger on, and never for the other side', () => {
    // Short of the cross-fade: the wash alone, growing with the drag.
    expect(swipeSideVisual(-20, 'left')).toMatchObject({ solid: 0 });
    expect(swipeSideVisual(-20, 'left').wash).toBeGreaterThan(swipeSideVisual(-8, 'left').wash);
    // The last fifth of the run-up (28.8pt → 36pt) hands over to the solid.
    expect(swipeSideVisual(-28.8, 'left').solid).toBe(0);
    expect(swipeSideVisual(-32, 'left').solid).toBeGreaterThan(0);
    // At and past the trigger: solid, wash gone, symbol at its largest.
    const latched = swipeSideVisual(-36, 'left');
    expect(latched).toMatchObject({ solid: 1, wash: 0 });
    expect(latched.scale).toBeCloseTo(1.15);
    expect(swipeSideVisual(-72, 'left')).toEqual(latched);

    // A drag one way never lights the other side.
    expect(swipeSideVisual(-36, 'right')).toMatchObject({ wash: 0, solid: 0 });
    expect(swipeSideVisual(36, 'left')).toMatchObject({ wash: 0, solid: 0 });
    expect(swipeSideVisual(0, 'left')).toMatchObject({ wash: 0, solid: 0 });
    expect(swipeSideVisual(36, 'right')).toMatchObject({ solid: 1 });
  });

  it('never fires a side that is not offered', () => {
    expect(swipeOutcome(-80, -900, RIGHT_ONLY)).toBeNull();
    expect(swipeOutcome(80, 900, RIGHT_ONLY)).toBe('right');
    expect(swipeOutcome(80, 900, LEFT_ONLY)).toBeNull();
    expect(swipeOutcome(-80, -900, LEFT_ONLY)).toBe('left');
    expect(swipeOutcome(80, 900, NONE)).toBeNull();
  });
});
