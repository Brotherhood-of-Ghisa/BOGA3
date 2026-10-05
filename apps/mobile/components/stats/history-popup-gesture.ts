// Points / points per second. A fast flick still needs deliberate downward travel.
export const HISTORY_DRAG_SLOP = 8;
export const HISTORY_HORIZONTAL_SLOP = 12;
export const HISTORY_DISMISS_DISTANCE = 120;
export const HISTORY_FLICK_DISTANCE = 24;
export const HISTORY_DISMISS_VELOCITY = 900;

export type HistoryDrag = {
  translationX: number;
  translationY: number;
  velocityX: number;
  velocityY: number;
};

export function shouldDismissHistory(event: HistoryDrag): boolean {
  'worklet';
  const { translationX, translationY, velocityX, velocityY } = event;
  if (translationY <= Math.abs(translationX) || velocityY < 0) return false;
  return translationY >= HISTORY_DISMISS_DISTANCE ||
    (translationY >= HISTORY_FLICK_DISTANCE && velocityY >= HISTORY_DISMISS_VELOCITY &&
      velocityY > Math.abs(velocityX));
}
