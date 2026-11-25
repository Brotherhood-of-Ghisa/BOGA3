import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import { Card, FigureText, Icon, uiGeometry, uiHairline, uiSpace, useUiRoles, useUiText } from '@/components/ui';
import { contrastRatio } from '@/components/ui/lch';

import type { TimelineStack } from './timeline';
import { overlayMoveActions, useTimelineOverlayPosition, type TimelineOverlayArea } from './use-timeline-overlay-position';

export function TimelineLegend({ area, stack, fills, hidden, testID }: {
  area: TimelineOverlayArea;
  stack: TimelineStack;
  fills: readonly string[];
  hidden: boolean;
  testID: string;
}) {
  const text = useUiText();
  const roles = useUiRoles();
  const { surface } = roles;
  const { animatedStyle, pan, move, measure } = useTimelineOverlayPosition(area);
  // The drag position lives through a week inspection.
  if (hidden) return null;
  return (
    <Animated.View testID={`${testID}-position`} onLayout={event => measure(event.nativeEvent.layout.height)}
      style={[styles.window, { width: area.width, maxHeight: area.height }, animatedStyle]}>
      <Card style={styles.card} testID={testID}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.entries}>
          {stack.items.map(({ id, name }, index) => (
            <View key={id} style={styles.entry}>
              <View testID={`${testID}-swatch-${id}`} style={[styles.swatch, { backgroundColor: fills[index] },
                contrastRatio(fills[index], surface) < 3 && uiHairline(roles, { tone: 'ink' })]} />
              <Text allowFontScaling={false} style={[text.meta, styles.name]}><FigureText>{name}</FigureText></Text>
            </View>
          ))}
        </ScrollView>
        <GestureDetector gesture={pan}>
          <View accessible accessibilityLabel={`Move ${stack.kind} legend`} accessibilityRole="adjustable"
            accessibilityActions={overlayMoveActions} onAccessibilityAction={event => move(event.nativeEvent.actionName)}
            style={styles.handle} testID={`${testID}-move`}>
            <Icon name="move-window" colorRole="inkMuted" size="sm" />
          </View>
        </GestureDetector>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  window: { position: 'absolute', top: 0, left: 0 },
  card: { flexDirection: 'row', flexShrink: 1 },
  scroll: { flex: 1 },
  entries: { gap: uiSpace.xs, paddingLeft: uiSpace.sm, paddingVertical: uiSpace.sm },
  entry: { flexDirection: 'row', alignItems: 'flex-start', gap: uiSpace.xs },
  swatch: { width: uiSpace.sm, height: uiSpace.sm, marginTop: uiSpace.xs },
  name: { flex: 1 },
  handle: {
    alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start',
    width: uiGeometry.tapTarget, minHeight: uiGeometry.tapTarget,
  },
});
