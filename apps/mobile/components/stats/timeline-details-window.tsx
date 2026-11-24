import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import type { TimelineDetailsArea } from '@/components/heatmaps/TimelineHeatmap';
import { Card, FigureText, Icon, IconButton, uiGeometry, uiSpace, useUiText } from '@/components/ui';

const MOVE_ACTIONS = {
  moveLeft: { label: 'Move left', x: -1, y: 0 },
  moveRight: { label: 'Move right', x: 1, y: 0 },
  moveUp: { label: 'Move up', x: 0, y: -1 },
  moveDown: { label: 'Move down', x: 0, y: 1 },
};
const accessibilityActions = Object.entries(MOVE_ACTIONS).map(([name, { label }]) => ({ name, label }));

function withinArea(value: number, limit: number) {
  'worklet';
  return Math.min(Math.max(0, limit), Math.max(0, value));
}

function useWindowPosition({ initialX, maxX, height }: TimelineDetailsArea) {
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

export function TimelineDetailsWindow({ area, heading, gym, onClose, testID, children }: {
  area: TimelineDetailsArea;
  heading?: string;
  gym?: string;
  onClose: () => void;
  testID: string;
  children: ReactNode;
}) {
  const text = useUiText();
  const { animatedStyle, pan, move, measure } = useWindowPosition(area);
  return (
    <Animated.View testID={`${testID}-position`} onLayout={event => measure(event.nativeEvent.layout.height)}
      style={[styles.window, { width: area.width, maxHeight: Math.max(uiGeometry.tapTarget, area.height - uiSpace.lg) }, animatedStyle]}>
      <Card style={styles.shrink} testID={testID}>
        <View onAccessibilityEscape={onClose} style={styles.shrink}>
          <View style={styles.header}>
            <GestureDetector gesture={pan}>
              <View accessible accessibilityLabel={[heading, gym, 'Move week details'].filter(Boolean).join(', ')} accessibilityRole="adjustable"
                accessibilityActions={accessibilityActions} onAccessibilityAction={event => move(event.nativeEvent.actionName)}
                style={styles.handle} testID={`${testID}-move`}>
                <Icon name="move-window" colorRole="inkMuted" size="sm" />
                {heading ? <Text allowFontScaling={false} style={[text.title, styles.heading]}><FigureText strong>{heading}</FigureText></Text> : null}
                {gym ? <Text allowFontScaling={false} style={[text.meta, styles.gym]}><FigureText>{gym}</FigureText></Text> : null}
              </View>
            </GestureDetector>
            <IconButton name="x" size="sm" accessibilityLabel="Close week details" onPress={onClose} testID={`${testID}-close`} />
          </View>
          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  window: { position: 'absolute', top: 0, left: 0 },
  shrink: { flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingRight: uiSpace.xs },
  handle: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm,
    minHeight: uiGeometry.tapTarget, paddingLeft: uiSpace.sm,
  },
  heading: { flexShrink: 1 },
  gym: { marginLeft: 'auto', maxWidth: '45%' },
  scroll: { flexGrow: 0, flexShrink: 1 },
});
