import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { SHEET_DRAG_SLOP, SHEET_HORIZONTAL_SLOP, shouldDismissSheet } from '@/components/ui/sheet-gesture';

type Props = {
  children: ReactNode;
  header: ReactNode;
  accessibilityLabel: string;
  dismissLabel: string;
  onDismiss: () => void;
  testID: string;
};

// History alone fills the viewport. The header owns the pan; the charts and
// metric controls remain siblings, outside its gesture boundary.
export function HistoryPopup({ children, header, accessibilityLabel, dismissLabel, onDismiss, testID }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const drag = useSharedValue(0);
  const closing = useSharedValue(false);
  const startDrag = useSharedValue(0);
  const [visible, setVisible] = useState(true);
  const phase = useRef<'open' | 'animating' | 'hidden' | 'finished'>('open');
  const mounted = useRef(true);
  const hideModal = useCallback(() => {
    if (!mounted.current || phase.current !== 'animating') return;
    phase.current = 'hidden';
    setVisible(false);
  }, []);
  const finishDismissal = useCallback(() => {
    if (!mounted.current || phase.current !== 'hidden') return;
    phase.current = 'finished';
    // The native modal is gone before the host clears its target / restores focus.
    onDismiss();
  }, [onDismiss]);
  const dismiss = useCallback(() => {
    if (phase.current !== 'open') return;
    phase.current = 'animating';
    closing.set(true);
    drag.set(withTiming(height, { duration: reducedMotion ? 0 : 220, reduceMotion: ReduceMotion.System },
      finished => { if (finished) runOnJS(hideModal)(); }));
  }, [closing, drag, height, hideModal, reducedMotion]);

  useEffect(() => {
    if (Platform.OS !== 'ios' && !visible) finishDismissal();
  }, [visible, finishDismissal]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelAnimation(drag); };
  }, [drag]);

  const pan = usePanGesture({
    activeOffsetY: SHEET_DRAG_SLOP,
    failOffsetY: -SHEET_DRAG_SLOP,
    failOffsetX: [-SHEET_HORIZONTAL_SLOP, SHEET_HORIZONTAL_SLOP],
    onActivate: () => {
      'worklet';
      if (!closing.get()) { cancelAnimation(drag); startDrag.set(drag.get()); }
    },
    onUpdate: event => {
      'worklet';
      if (!closing.get()) drag.set(Math.max(0, startDrag.get() + event.translationY));
    },
    onDeactivate: event => {
      'worklet';
      if (!event.canceled && !closing.get() && shouldDismissSheet({ ...event, translationY: drag.get() })) {
        closing.set(true);
        runOnJS(dismiss)();
      }
    },
    onFinalize: () => {
      'worklet';
      if (!closing.get()) drag.set(withTiming(0,
        { duration: reducedMotion ? 0 : 180, reduceMotion: ReduceMotion.System }));
    },
  });
  const translation = useAnimatedStyle(() => ({ transform: [{ translateY: drag.get() }] }));

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={dismiss}
      onDismiss={Platform.OS === 'ios' ? finishDismissal : undefined} testID={`${testID}-modal`}>
      <GestureHandlerRootView style={[styles.root, { paddingTop: insets.top }]} testID={`${testID}-root`}>
        <Pressable accessibilityRole="button" accessibilityLabel={dismissLabel}
          onPress={dismiss} style={StyleSheet.absoluteFill} testID={`${testID}-backdrop`} />
        <Animated.View accessibilityViewIsModal onAccessibilityEscape={dismiss}
          style={[styles.panel, { paddingBottom: Math.max(uiSpace.lg, insets.bottom) }, translation]} testID={testID}>
          <GestureDetector gesture={pan}>
            <Animated.View accessible accessibilityRole="header" accessibilityLabel={accessibilityLabel}
              accessibilityHint="Swipe down to dismiss, or use the dismiss accessibility action."
              accessibilityActions={[{ name: 'dismiss', label: dismissLabel }]}
              onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'dismiss') dismiss(); }}
              onAccessibilityEscape={dismiss} testID={`${testID}-drag-header`}>
              <View style={styles.handleArea} testID={`${testID}-handle`}>
                <View style={styles.handle} />
                <Text allowFontScaling={false} style={styles.hint}>Swipe down to dismiss</Text>
              </View>
              {header}
            </Animated.View>
          </GestureDetector>
          {children}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: uiRoles.scrim },
  panel: { flex: 1, borderTopLeftRadius: uiGeometry.radius.sheet,
    borderTopRightRadius: uiGeometry.radius.sheet, backgroundColor: uiRoles.surface },
  handleArea: { alignItems: 'center', justifyContent: 'center', minHeight: uiGeometry.tapTarget,
    gap: uiSpace.sm, paddingTop: uiSpace.sm, paddingBottom: uiSpace.md },
  handle: { width: uiGeometry.sheetHandle.width, height: uiGeometry.sheetHandle.height,
    borderRadius: uiGeometry.radius.pill, backgroundColor: uiRoles.rule },
  hint: { fontFamily: uiFonts.body.family, fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm, color: uiRoles.inkMuted },
});
