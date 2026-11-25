import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import {
  overlayMoveActions, useTimelineOverlayPosition, type TimelineOverlayArea,
} from '@/components/heatmaps/use-timeline-overlay-position';
import { Card, FigureText, Icon, IconButton, uiGeometry, uiSpace, useUiText } from '@/components/ui';

export function TimelineDetailsWindow({ area, heading, gym, onClose, testID, children }: {
  area: TimelineOverlayArea;
  heading?: string;
  gym?: string;
  onClose: () => void;
  testID: string;
  children: ReactNode;
}) {
  const text = useUiText();
  const { animatedStyle, pan, move, measure } = useTimelineOverlayPosition(area);
  return (
    <Animated.View testID={`${testID}-position`} onLayout={event => measure(event.nativeEvent.layout.height)}
      style={[styles.window, { width: area.width, maxHeight: Math.max(uiGeometry.tapTarget, area.height - uiSpace.lg) }, animatedStyle]}>
      <Card style={styles.shrink} testID={testID}>
        <View onAccessibilityEscape={onClose} style={styles.shrink}>
          <View style={styles.header}>
            <GestureDetector gesture={pan}>
              <View accessible accessibilityLabel={[heading, gym, 'Move week details'].filter(Boolean).join(', ')} accessibilityRole="adjustable"
                accessibilityActions={overlayMoveActions} onAccessibilityAction={event => move(event.nativeEvent.actionName)}
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
