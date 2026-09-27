import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
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

import { uiGeometry, uiRoles, uiSpace } from '@/components/ui';
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
  const expand = useCallback(() => setState('expanded'), []);
  const collapse = useCallback(() => setState('collapsed'), []);
  const toggle = useCallback(
    () => setState((current) => (current === 'expanded' ? 'collapsed' : 'expanded')),
    []
  );

  const value = useMemo<TrayVisibilityContextValue>(
    () => ({
      state,
      expand,
      collapse,
      toggle,
    }),
    [collapse, expand, state, toggle]
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
  // wrapper's onLayout. The PanResponder is rebuilt when it or `state`
  // changes, so its closure always sees the latest values.
  const [contentHeight, setContentHeight] = useState(0);

  // Lazy state, not a ref: the Animated.Value is created once and read during
  // render (as the container's `height` style).
  const [containerHeight] = useState(() => new Animated.Value(0));

  const resolveTargetHeight = useCallback(
    (target: TraySnapState) => (target === 'collapsed' ? PEEK_HEIGHT : contentHeight),
    [contentHeight]
  );

  const animateTo = useCallback(
    (target: TraySnapState) => {
      Animated.timing(containerHeight, {
        toValue: resolveTargetHeight(target),
        duration: COLLAPSE_DURATION_MS,
        useNativeDriver: false,
      }).start();
    },
    [containerHeight, resolveTargetHeight]
  );

  // Animate to the appropriate height whenever `state` changes externally
  // (e.g. screen called `expand()` or initial mount with a non-zero height).
  // An effect event, so a fresh content measurement does not re-animate —
  // `onContentLayout` pins that without animation.
  const animateToState = useEffectEvent(() => animateTo(state));
  useEffect(() => {
    animateToState();
  }, [state]);

  const onContentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      if (height === contentHeight) {
        return;
      }
      setContentHeight(height);
      // Re-pin to the current state's height based on the freshly measured
      // natural content height. Skip animation on first layout to avoid a
      // visible bounce.
      containerHeight.setValue(state === 'collapsed' ? PEEK_HEIGHT : height);
    },
    [containerHeight, contentHeight, state]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > 2,
        onPanResponderMove: (_event, gesture) => {
          const startHeight = resolveTargetHeight(state);
          // Downward drag (positive dy) shrinks height; upward grows it.
          // Clamp so we never overshoot past either end.
          const next = Math.min(
            contentHeight,
            Math.max(PEEK_HEIGHT, startHeight - gesture.dy)
          );
          containerHeight.setValue(next);
        },
        onPanResponderRelease: (_event, gesture) => {
          const travel = Math.max(0, contentHeight - PEEK_HEIGHT);
          const nextState = resolveTraySnap({
            startState: state,
            dy: gesture.dy,
            vy: gesture.vy,
            travelDistance: travel,
          });

          if (nextState === state) {
            // Snap back to current — animate to make the spring back feel
            // intentional rather than rely on the parent state effect (which
            // wouldn't fire because the value didn't change).
            animateTo(nextState);
            return;
          }

          if (nextState === 'collapsed') {
            collapse();
          } else {
            expand();
          }
        },
        onPanResponderTerminate: () => {
          animateTo(state);
        },
      }),
    [animateTo, containerHeight, collapse, contentHeight, expand, resolveTargetHeight, state]
  );

  const handleHandleTap = useCallback(() => {
    // Tapping the handle while collapsed restores the tray; while expanded it
    // collapses (mirrors the drag affordance for accessibility).
    if (state === 'collapsed') {
      expand();
    } else {
      collapse();
    }
  }, [expand, collapse, state]);

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
    paddingHorizontal: uiSpace.lg,
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
    paddingHorizontal: uiSpace.lg,
    borderRadius: uiGeometry.radius.pill,
  },
  // The sheet handle's recipe (`design-language.md` §4).
  handleIndicator: {
    width: uiGeometry.sheetHandle.width,
    height: uiGeometry.sheetHandle.height,
    borderRadius: uiGeometry.radius.pill,
    backgroundColor: uiRoles.ruleStrong,
  },
  body: {
    // Leaves the inner MainTabs / tab bar to manage its own surface.
  },
});

export const BOTTOM_TRAY_PEEK_HEIGHT = PEEK_HEIGHT;
