import { usePanGesture } from 'react-native-gesture-handler';
import { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { uiGeometry, uiSpace } from '@/components/ui';

export type TimelineOverlayArea = { width: number; height: number; initialX: number; maxX: number };

const MOVE_ACTIONS = {
  moveLeft: { label: 'Move left', x: -1, y: 0 },
  moveRight: { label: 'Move right', x: 1, y: 0 },
  moveUp: { label: 'Move up', x: 0, y: -1 },
  moveDown: { label: 'Move down', x: 0, y: 1 },
};
export const overlayMoveActions = Object.entries(MOVE_ACTIONS).map(([name, { label }]) => ({ name, label }));

function withinArea(value: number, limit: number) {
  'worklet';
  return Math.min(Math.max(0, limit), Math.max(0, value));
}

export function useTimelineOverlayPosition({ initialX, maxX, height }: TimelineOverlayArea) {
  const position = useSharedValue<{ x: number; y: number } | null>(null);
  const start = useSharedValue({ x: 0, y: 0 });
  const windowHeight = useSharedValue(0);
  const pan = usePanGesture({
    minDistance: uiSpace.xs,
    onActivate: () => {
      'worklet';
      const current = position.get() ?? { x: initialX, y: 0 };
      start.set({ x: withinArea(current.x, maxX), y: withinArea(current.y, height - windowHeight.get()) });
    },
    onUpdate: event => {
      'worklet';
      const origin = start.get();
      position.set({
        x: withinArea(origin.x + event.translationX, maxX),
        y: withinArea(origin.y + event.translationY, height - windowHeight.get()),
      });
    },
  });
  const animatedStyle = useAnimatedStyle(() => {
    const current = position.get() ?? { x: initialX, y: 0 };
    return {
      transform: [
        { translateX: withinArea(current.x, maxX) },
        { translateY: withinArea(current.y, height - windowHeight.get()) },
      ],
    };
  });
  const move = (action: string) => {
    if (!Object.hasOwn(MOVE_ACTIONS, action)) return;
    const direction = MOVE_ACTIONS[action as keyof typeof MOVE_ACTIONS];
    const current = position.get() ?? { x: initialX, y: 0 };
    const maxY = height - windowHeight.get();
    position.set({
      x: withinArea(withinArea(current.x, maxX) + direction.x * uiGeometry.tapTarget, maxX),
      y: withinArea(withinArea(current.y, maxY) + direction.y * uiGeometry.tapTarget, maxY),
    });
  };
  return { animatedStyle, pan, move, measure: (nextHeight: number) => windowHeight.set(nextHeight) };
}
