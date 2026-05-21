import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { uiColors, uiRadius, uiSpace } from '@/components/ui';
import {
  resolveTraySnap,
  traySnapTranslateY,
  type TraySnapState,
} from '@/src/navigation/tray-snap';

/**
 * Height of the always-visible "peek" strip when the tray is collapsed.
 * Picked so the drag handle plus a little padding stay in view above the
 * device's safe-area inset.
 */
const PEEK_HEIGHT = 28;

const COLLAPSE_DURATION_MS = 220;

type TrayVisibilityContextValue = {
  state: TraySnapState;
  expand: () => void;
  collapse: () => void;
  toggle: () => void;
};

const TrayVisibilityContext = createContext<TrayVisibilityContextValue | null>(null);

export function TrayVisibilityProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TraySnapState>('expanded');

  const value = useMemo<TrayVisibilityContextValue>(
    () => ({
      state,
      expand: () => setState('expanded'),
      collapse: () => setState('collapsed'),
      toggle: () =>
        setState((current) => (current === 'expanded' ? 'collapsed' : 'expanded')),
    }),
    [state]
  );

  return (
    <TrayVisibilityContext.Provider value={value}>
      {children}
    </TrayVisibilityContext.Provider>
  );
}

/**
 * Read or imperatively drive tray visibility. Screens can call `collapse()`
 * or `expand()` if they need to force a state (e.g. focus a deep modal).
 * Tray initial state is `expanded`.
 */
export function useTrayVisibility(): TrayVisibilityContextValue {
  const value = useContext(TrayVisibilityContext);
  if (!value) {
    throw new Error(
      'useTrayVisibility must be used inside <TrayVisibilityProvider>. Wrap (tabs)/_layout in a provider.'
    );
  }
  return value;
}

type BottomTrayProps = {
  children: ReactNode;
};

/**
 * Collapsible bottom navigation tray. Wraps its content in an
 * `Animated.View` whose `translateY` is driven by a `PanResponder` attached
 * to a small drag handle at the top. Releases past a threshold snap to either
 * the expanded or the collapsed (peek strip) position.
 *
 * State is held in `TrayVisibilityProvider` so screens can force expand /
 * collapse via `useTrayVisibility()`. Initial state is `expanded`; the tray
 * does not persist across app restarts (out of scope for this task).
 */
export function BottomTray({ children }: BottomTrayProps) {
  const { state, expand, collapse } = useTrayVisibility();

  // Content height drives the collapse travel distance. We measure on layout
  // and keep it in a ref so the PanResponder closure always sees the latest
  // value without re-creating itself.
  const contentHeightRef = useRef(0);
  const stateRef = useRef<TraySnapState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const translateY = useRef(new Animated.Value(0)).current;
  // Drag offsets that get layered on top of the snapped position while the
  // user is actively pulling on the handle.
  const dragOffset = useRef(new Animated.Value(0)).current;

  // Animate to the appropriate snap whenever `state` changes externally
  // (e.g. screen called `expand()` or initial mount with a non-zero height).
  useEffect(() => {
    const travel = Math.max(0, contentHeightRef.current - PEEK_HEIGHT);
    Animated.timing(translateY, {
      toValue: traySnapTranslateY(state, travel),
      duration: COLLAPSE_DURATION_MS,
      useNativeDriver: true,
    }).start();
  }, [state, translateY]);

  const onContentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      contentHeightRef.current = height;
      // Re-pin to the current state's translate based on the freshly measured
      // travel distance. Skip animation on first layout to avoid a visible
      // bounce.
      const travel = Math.max(0, height - PEEK_HEIGHT);
      translateY.setValue(traySnapTranslateY(stateRef.current, travel));
    },
    [translateY]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > 2,
        onPanResponderGrant: () => {
          dragOffset.setValue(0);
        },
        onPanResponderMove: (_event, gesture) => {
          const travel = Math.max(0, contentHeightRef.current - PEEK_HEIGHT);
          const startY = traySnapTranslateY(stateRef.current, travel);
          // Clamp drag so we never overshoot past either end.
          const next = Math.min(travel, Math.max(0, startY + gesture.dy));
          translateY.setValue(next);
        },
        onPanResponderRelease: (_event, gesture) => {
          const travel = Math.max(0, contentHeightRef.current - PEEK_HEIGHT);
          const nextState = resolveTraySnap({
            startState: stateRef.current,
            dy: gesture.dy,
            vy: gesture.vy,
            travelDistance: travel,
          });

          if (nextState === stateRef.current) {
            // Snap back to current — animate to make the spring back feel
            // intentional rather than rely on the parent state effect (which
            // wouldn't fire because the value didn't change).
            Animated.timing(translateY, {
              toValue: traySnapTranslateY(nextState, travel),
              duration: COLLAPSE_DURATION_MS,
              useNativeDriver: true,
            }).start();
            return;
          }

          if (nextState === 'collapsed') {
            collapse();
          } else {
            expand();
          }
        },
        onPanResponderTerminate: () => {
          // Treat termination like a release with no movement: snap back.
          const travel = Math.max(0, contentHeightRef.current - PEEK_HEIGHT);
          Animated.timing(translateY, {
            toValue: traySnapTranslateY(stateRef.current, travel),
            duration: COLLAPSE_DURATION_MS,
            useNativeDriver: true,
          }).start();
        },
      }),
    [translateY, dragOffset, collapse, expand]
  );

  const handleHandleTap = useCallback(() => {
    // Tapping the handle while collapsed restores the tray; while expanded it
    // collapses (mirrors the drag affordance for accessibility).
    if (stateRef.current === 'collapsed') {
      expand();
    } else {
      collapse();
    }
  }, [expand, collapse]);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.root, { transform: [{ translateY }] }]}
      testID="bottom-tray-root"
      onLayout={onContentLayout}>
      <View {...panResponder.panHandlers} style={styles.handleHitArea}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            state === 'expanded' ? 'Collapse navigation tray' : 'Expand navigation tray'
          }
          accessibilityState={{ expanded: state === 'expanded' }}
          onPress={handleHandleTap}
          style={styles.handlePressable}
          testID="bottom-tray-handle">
          <View style={styles.handleIndicator} />
        </Pressable>
      </View>
      <View style={styles.body} testID="bottom-tray-body">
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: uiSpace.xxl,
    paddingBottom: uiSpace.sm,
    backgroundColor: 'transparent',
  },
  handleHitArea: {
    alignItems: 'center',
    paddingVertical: uiSpace.xs,
  },
  handlePressable: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: uiSpace.xs,
    paddingHorizontal: uiSpace.xxl,
    borderRadius: uiRadius.full,
  },
  handleIndicator: {
    width: 44,
    height: 4,
    borderRadius: uiRadius.full,
    backgroundColor: uiColors.borderInputStrong,
  },
  body: {
    // Leaves the inner TopLevelTabs / tab bar to manage its own surface.
  },
});

export const BOTTOM_TRAY_PEEK_HEIGHT = PEEK_HEIGHT;
