// The downward drag that closes a `Sheet` from its handle and title row.
// Points / points per second. A fast flick still needs deliberate downward travel.
export const SHEET_DRAG_SLOP = 8;
export const SHEET_HORIZONTAL_SLOP = 12;
export const SHEET_DISMISS_DISTANCE = 120;
export const SHEET_FLICK_DISTANCE = 24;
export const SHEET_DISMISS_VELOCITY = 900;

export type SheetDrag = {
  translationX: number;
  translationY: number;
  velocityX: number;
  velocityY: number;
};

export function shouldDismissSheet(event: SheetDrag): boolean {
  'worklet';
  const { translationX, translationY, velocityX, velocityY } = event;
  if (translationY <= Math.abs(translationX) || velocityY < 0) return false;
  return translationY >= SHEET_DISMISS_DISTANCE ||
    (translationY >= SHEET_FLICK_DISTANCE && velocityY >= SHEET_DISMISS_VELOCITY &&
      velocityY > Math.abs(velocityX));
}
