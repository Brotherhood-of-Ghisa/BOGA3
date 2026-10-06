import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SHEET_DRAG_SLOP, SHEET_HORIZONTAL_SLOP, shouldDismissSheet } from '@/components/ui/sheet-gesture';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type SheetProps = {
  visible: boolean;
  // Called for a tap on the backdrop, a downward drag of the handle / title row,
  // the Android back button and the VoiceOver escape gesture. There is no Cancel
  // button: tapping outside or dragging down is the dismissal
  // (`design-language.md` §4). A sheet that refuses (its write is in flight)
  // simply does not close: a drag then springs back.
  onDismiss: () => void;
  // Called once the sheet has gone after `visible` turns false: on iOS from the
  // native modal's dismissal, on Android at once. A native `Alert` opened from
  // here cannot collide with the closing sheet (iOS presents nothing over a
  // modal that is still dismissing): the unlink chooser's confirmation.
  onDismissed?: () => void;
  // Accessibility label of the backdrop, e.g. `Dismiss options`.
  dismissLabel: string;
  title?: string;
  // One control before the title, usually a `chevron-left` `IconButton` that
  // returns from a panel shown inside the sheet (the exercise editor's muscle
  // selector).
  headerLeading?: ReactNode;
  // Controls on the title's row, right-aligned: usually `IconButton`s (the
  // exercise picker's ⋮, Manage and Add new).
  headerActions?: ReactNode;
  // Lifts the panel above the keyboard, for a sheet with a text field in it.
  keyboardAvoiding?: boolean;
  // Usually `ListRow`s.
  children: ReactNode;
  // `<testID>` on the panel, `<testID>-backdrop` on the backdrop, `<testID>-header`
  // on the title row, `<testID>-drag-zone` on the handle and title row the drag
  // starts from, `<testID>-modal` on the native modal.
  testID?: string;
};

const EXIT_MS = 220;
const SNAP_BACK_MS = 180;

// The handle and title row follow a downward drag. A qualifying release slides
// the panel out and asks the host to close; a short, upward, sideways or
// cancelled drag springs back. So does a qualifying one the host refuses. The
// body is outside the gesture, so its scrolling and taps never drag.
function useSheetDrag(visible: boolean, onDismiss: () => void) {
  const { height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const drag = useSharedValue(0);
  const startDrag = useSharedValue(0);
  const closing = useSharedValue(false);
  const visibleRef = useRef(visible);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    visibleRef.current = visible;
  }, [visible]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelAnimation(drag);
    };
  }, [drag]);

  const timing = useCallback(
    (duration: number) => ({ duration: reducedMotion ? 0 : duration, reduceMotion: ReduceMotion.System }),
    [reducedMotion]
  );
  const snapBack = useCallback(() => {
    closing.set(false);
    drag.set(withTiming(0, timing(SNAP_BACK_MS)));
  }, [closing, drag, timing]);
  const release = useCallback(() => {
    drag.set(withTiming(height, timing(EXIT_MS)));
    onDismiss();
    // The host's close has rendered by the next frame; still open means it refused.
    requestAnimationFrame(() => {
      if (mounted.current && visibleRef.current) snapBack();
    });
  }, [drag, height, onDismiss, snapBack, timing]);
  // Once the modal has gone, so the next opening starts in place.
  const reset = useCallback(() => {
    cancelAnimation(drag);
    drag.set(0);
    closing.set(false);
  }, [closing, drag]);

  const pan = usePanGesture({
    activeOffsetY: SHEET_DRAG_SLOP,
    failOffsetY: -SHEET_DRAG_SLOP,
    failOffsetX: [-SHEET_HORIZONTAL_SLOP, SHEET_HORIZONTAL_SLOP],
    onActivate: () => {
      'worklet';
      if (!closing.get()) {
        cancelAnimation(drag);
        startDrag.set(drag.get());
      }
    },
    onUpdate: (event) => {
      'worklet';
      if (!closing.get()) drag.set(Math.max(0, startDrag.get() + event.translationY));
    },
    onDeactivate: (event) => {
      'worklet';
      if (!event.canceled && !closing.get() && shouldDismissSheet({ ...event, translationY: drag.get() })) {
        closing.set(true);
        runOnJS(release)();
      }
    },
    onFinalize: () => {
      'worklet';
      if (!closing.get()) drag.set(withTiming(0, timing(SNAP_BACK_MS)));
    },
  });
  const translation = useAnimatedStyle(() => ({ transform: [{ translateY: drag.get() }] }));
  return { pan, translation, reset };
}

// A design-language bottom sheet: anchored to the bottom edge over a dimmed
// backdrop, with a handle and an optional title. It never grows past the top of
// the screen: a taller body shrinks to fit, so a tall body should scroll. The
// backdrop keeps a full tap target below the status bar even for a tall panel.
// For a sub-page (a browser, an editor, a preview) use `PageSheet` instead
// (`ux-rules.md` "Sheets").
export function Sheet({
  visible,
  onDismiss,
  onDismissed,
  dismissLabel,
  title,
  headerLeading,
  headerActions,
  keyboardAvoiding = false,
  children,
  testID,
}: SheetProps) {
  const insets = useSafeAreaInsets();
  const { pan, translation, reset } = useSheetDrag(visible, onDismiss);
  const handleDismissed = useCallback(() => {
    reset();
    onDismissed?.();
  }, [onDismissed, reset]);
  const wasVisible = useRef(visible);
  useEffect(() => {
    // Android has no `Modal.onDismiss`; its modal is gone once hidden.
    if (Platform.OS !== 'ios' && wasVisible.current && !visible) handleDismissed();
    wasVisible.current = visible;
  }, [visible, handleDismissed]);

  const content = (
    <>
      <Pressable
        accessibilityLabel={dismissLabel}
        accessibilityRole="button"
        onPress={onDismiss}
        style={styles.backdrop}
        testID={testID ? `${testID}-backdrop` : undefined}
      />
      {/* Modal to VoiceOver, which then cannot reach the backdrop; the escape
          gesture (two-finger scrub) dismisses instead. */}
      <Animated.View
        accessibilityViewIsModal
        onAccessibilityEscape={onDismiss}
        style={[styles.panel, { paddingBottom: Math.max(uiSpace.xl, insets.bottom) }, translation]}
        testID={testID}>
        <GestureDetector gesture={pan}>
          <View collapsable={false} testID={testID ? `${testID}-drag-zone` : undefined}>
            <View style={styles.handleArea}>
              <View style={styles.handle} />
            </View>
            {title || headerLeading || headerActions ? (
              <View
                style={[
                  styles.header,
                  headerActions ? styles.headerWithActions : null,
                  headerLeading ? styles.headerWithLeading : null,
                ]}
                testID={testID ? `${testID}-header` : undefined}>
                {headerLeading}
                {title ? (
                  // Two lines, so a title naming an item and its context (`Bench Press · Garage
                  // Gym`) wraps rather than losing the context.
                  <Text allowFontScaling={false} accessibilityRole="header" numberOfLines={2} style={styles.title}>
                    {title}
                  </Text>
                ) : null}
                {headerActions ? <View style={styles.headerActions}>{headerActions}</View> : null}
              </View>
            ) : null}
          </View>
        </GestureDetector>
        {children}
      </Animated.View>
    </>
  );

  return (
    <Modal
      animationType="fade"
      onDismiss={Platform.OS === 'ios' ? handleDismissed : undefined}
      onRequestClose={onDismiss}
      testID={testID ? `${testID}-modal` : undefined}
      transparent
      visible={visible}>
      {/* A modal is its own native root: gestures inside it need their own root view. */}
      <GestureHandlerRootView style={styles.gestureRoot}>
        {keyboardAvoiding ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[styles.root, { paddingTop: insets.top }]}>
            {content}
          </KeyboardAvoidingView>
        ) : (
          <View style={[styles.root, { paddingTop: insets.top }]}>{content}</View>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  root: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: uiRoles.scrim,
  },
  backdrop: {
    flex: 1,
    minHeight: uiGeometry.tapTarget,
  },
  panel: {
    flexShrink: 1,
    paddingTop: uiSpace.sm,
    borderTopLeftRadius: uiGeometry.radius.sheet,
    borderTopRightRadius: uiGeometry.radius.sheet,
    backgroundColor: uiRoles.surface,
  },
  handleArea: {
    alignItems: 'center',
    paddingBottom: uiSpace.md,
  },
  handle: {
    width: uiGeometry.sheetHandle.width,
    height: uiGeometry.sheetHandle.height,
    borderRadius: uiGeometry.radius.pill,
    backgroundColor: uiRoles.rule,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.md,
  },
  // The controls bring their own 44pt target, so the row ends at their edge.
  headerWithActions: {
    paddingRight: uiSpace.sm,
    paddingBottom: uiSpace.sm,
  },
  headerWithLeading: {
    paddingLeft: uiSpace.xs,
    paddingBottom: uiSpace.sm,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto',
  },
  title: {
    flex: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '800',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
});
