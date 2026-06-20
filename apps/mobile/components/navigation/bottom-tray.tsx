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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { uiColors, uiRadius, uiSpace } from '@/components/ui';
import { resolveTraySnap, type TraySnapState } from '@/src/navigation/tray-snap';

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
 * Collapsible bottom navigation tray. Animates the container's `height`
 * (with `overflow: hidden`) so the parent bottom-tab-bar slot actually
 * shrinks when the tray collapses, freeing screen space for the active
 * screen rather than just hiding the tray visually.
 *
 * State is held in `TrayVisibilityProvider` so screens can force expand /
 * collapse via `useTrayVisibility()`. Initial state is `expanded`; the tray
 * does not persist across app restarts (out of scope for this task).
 */
export function BottomTray({ children }: BottomTrayProps) {
  const { state, expand, collapse } = useTrayVisibility();
  // The custom tab bar does not receive React Navigation's safe-area inset
  // (the (tabs) layout only applies the top edge), so without this the tray
  // hugs the device's bottom edge / home indicator. Reserve the bottom inset
  // below the whole tray — applied in both collapsed and expanded states, and
  // below the handle so the handle itself is never padded.
  const insets = useSafeAreaInsets();

  // Natural (uncollapsed) inner-content height, measured via the inner
  // wrapper's onLayout. Kept in a ref so the PanResponder closure always
  // sees the latest value without re-creating itself.
  const contentHeightRef = useRef(0);
  const stateRef = useRef<TraySnapState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const containerHeight = useRef(new Animated.Value(0)).current;

  const resolveTargetHeight = useCallback((target: TraySnapState) => {
    if (target === 'collapsed') return PEEK_HEIGHT;
    return contentHeightRef.current;
  }, []);

  // Animate to the appropriate height whenever `state` changes externally
  // (e.g. screen called `expand()` or initial mount with a non-zero height).
  useEffect(() => {
    Animated.timing(containerHeight, {
      toValue: resolveTargetHeight(state),
      duration: COLLAPSE_DURATION_MS,
      useNativeDriver: false,
    }).start();
  }, [state, containerHeight, resolveTargetHeight]);

  const onContentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      if (height === contentHeightRef.current) {
        return;
      }
      contentHeightRef.current = height;
      // Re-pin to the current state's height based on the freshly measured
      // natural content height. Skip animation on first layout to avoid a
      // visible bounce.
      containerHeight.setValue(resolveTargetHeight(stateRef.current));
    },
    [containerHeight, resolveTargetHeight]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > 2,
        onPanResponderMove: (_event, gesture) => {
          const startHeight = resolveTargetHeight(stateRef.current);
          // Downward drag (positive dy) shrinks height; upward grows it.
          // Clamp so we never overshoot past either end.
          const next = Math.min(
            contentHeightRef.current,
            Math.max(PEEK_HEIGHT, startHeight - gesture.dy)
          );
          containerHeight.setValue(next);
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
            Animated.timing(containerHeight, {
              toValue: resolveTargetHeight(nextState),
              duration: COLLAPSE_DURATION_MS,
              useNativeDriver: false,
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
          Animated.timing(containerHeight, {
            toValue: resolveTargetHeight(stateRef.current),
            duration: COLLAPSE_DURATION_MS,
            useNativeDriver: false,
          }).start();
        },
      }),
    [containerHeight, collapse, expand, resolveTargetHeight]
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
    <View pointerEvents="box-none" style={{ paddingBottom: insets.bottom }}>
      <Animated.View
        pointerEvents="box-none"
        style={[styles.root, { height: containerHeight }]}
        testID="bottom-tray-root">
        <View onLayout={onContentLayout} style={styles.content}>
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
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  content: {
    paddingHorizontal: uiSpace.xxl,
    paddingBottom: uiSpace.sm,
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
