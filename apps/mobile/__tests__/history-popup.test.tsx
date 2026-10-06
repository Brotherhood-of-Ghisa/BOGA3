/* eslint-disable @typescript-eslint/no-require-imports -- Native mechanism mock factories. */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Modal, Platform, Pressable, ScrollView, Text } from 'react-native';
import { HistoryPopup } from '@/components/stats/history-popup';
import { type SheetDrag as HistoryDrag } from '@/components/ui/sheet-gesture';

type Animation = { value: number; config: { duration: number; reduceMotion: string }; complete?: (finished: boolean) => void };
let mockAnimations: Animation[] = [];
let mockHandlers: Record<string, (event?: HistoryDrag & { canceled?: boolean }) => void> = {};
let mockOffsets: Record<string, unknown> = {};
let mockShared: { value: unknown }[] = [];
let mockReducedMotion = false;
const mockCancel = jest.fn();

// Only native gesture/animation mechanisms are replaced. Call the production
// handlers, controlling completion/cancellation instead of pretending to swipe.
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    GestureHandlerRootView: View,
    GestureDetector: ({ children }: { children: unknown }) =>
      React.createElement(View, { testID: 'pan-boundary' }, children),
    usePanGesture: (config: Record<string, unknown>) => {
      for (const name of ['activeOffsetY', 'failOffsetY', 'failOffsetX']) mockOffsets[name] = config[name];
      for (const name of ['onActivate', 'onUpdate', 'onDeactivate', 'onFinalize']) {
        mockHandlers[name] = config[name] as (event?: HistoryDrag & { canceled?: boolean }) => void;
      }
      return {};
    },
  };
});
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true, default: { View }, ReduceMotion: { System: 'system' },
    useReducedMotion: () => mockReducedMotion,
    useSharedValue: (initial: unknown) => {
      const ref = React.useRef({ value: initial });
      if (!mockShared.includes(ref.current)) mockShared.push(ref.current);
      return Object.assign(ref.current, { get: () => ref.current.value,
        set: (value: unknown) => { ref.current.value = value; } });
    },
    useAnimatedStyle: (callback: () => unknown) => callback(),
    runOnJS: (callback: () => void) => callback,
    cancelAnimation: (value: unknown) => mockCancel(value),
    withTiming: (value: number, config: Animation['config'], complete?: Animation['complete']) => {
      mockAnimations.push({ value, config, complete });
      return value;
    },
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

const originalPlatform = Platform.OS;
const event = (changes: Partial<HistoryDrag> = {}): HistoryDrag =>
  ({ translationX: 0, translationY: 0, velocityX: 0, velocityY: 0, ...changes });
const popup = (dismiss: () => void, metric = jest.fn()) => (
  <HistoryPopup header={<Text>History title</Text>} accessibilityLabel="Muscle History: Chest"
    dismissLabel="Dismiss muscle history" onDismiss={dismiss} testID="history">
    <Pressable onPress={metric} testID="metric"><Text>Sets</Text></Pressable>
    <ScrollView testID="chart"><Text>Retained chart</Text></ScrollView>
  </HistoryPopup>
);
const completeAnimation = (finished = true) => act(() => mockAnimations.at(-1)?.complete?.(finished));
const nativeDismiss = () => fireEvent(screen.UNSAFE_getByType(Modal), 'dismiss');

beforeEach(() => {
  Platform.OS = 'ios';
  mockAnimations = []; mockHandlers = {}; mockOffsets = {}; mockShared = [];
  mockReducedMotion = false; mockCancel.mockClear();
});
afterEach(() => { Platform.OS = originalPlatform; });

it('fills the safe-area viewport and scopes its 44pt handle / dismiss action to the header', () => {
  const dismiss = jest.fn(); const metric = jest.fn();
  render(popup(dismiss, metric));
  expect(screen.getByTestId('history-root')).toHaveStyle({ flex: 1, paddingTop: 47 });
  expect(screen.getByTestId('history')).toHaveStyle({ flex: 1, paddingBottom: 34 });
  expect(screen.getByTestId('history')).toHaveProp('accessibilityViewIsModal', true);
  expect(screen.getByTestId('history-handle')).toHaveStyle({ minHeight: 44 });
  expect(screen.getByTestId('history-drag-header')).toHaveProp('accessibilityActions',
    [{ name: 'dismiss', label: 'Dismiss muscle history' }]);
  expect(within(screen.getByTestId('pan-boundary')).queryByTestId('metric')).toBeNull();
  expect(within(screen.getByTestId('pan-boundary')).queryByTestId('chart')).toBeNull();
  fireEvent.press(screen.getByTestId('metric'));
  expect(metric).toHaveBeenCalledTimes(1); expect(dismiss).not.toHaveBeenCalled();
  expect(mockOffsets).toEqual({ activeOffsetY: 8, failOffsetY: -8, failOffsetX: [-12, 12] });
});

it('follows a downward drag and restores a short, upward or cancelled drag without closing', () => {
  const dismiss = jest.fn(); render(popup(dismiss));
  act(() => { mockHandlers.onActivate(); mockHandlers.onUpdate(event({ translationY: 47 })); });
  expect(mockShared[0].value).toBe(47);
  act(() => { mockHandlers.onDeactivate({ ...event({ translationY: 47 }), canceled: false }); mockHandlers.onFinalize(); });
  expect(mockShared[0].value).toBe(0);
  act(() => { mockHandlers.onUpdate(event({ translationY: -20 })); });
  expect(mockShared[0].value).toBe(0);
  act(() => { mockHandlers.onUpdate(event({ translationY: 140 })); mockHandlers.onDeactivate({ ...event({ translationY: 140 }), canceled: true }); mockHandlers.onFinalize(); });
  expect(mockShared[0].value).toBe(0);
  expect(dismiss).not.toHaveBeenCalled();
  expect(screen.getByTestId('chart')).toHaveTextContent('Retained chart');
});

it('finishes one qualifying drag before hiding the modal and calls its host once after native dismissal', () => {
  const dismiss = jest.fn(); render(popup(dismiss));
  act(() => { mockHandlers.onUpdate(event({ translationY: 120 })); mockHandlers.onDeactivate({ ...event({ translationY: 120 }), canceled: false }); mockHandlers.onFinalize(); });
  expect(mockAnimations).toHaveLength(1);
  expect(screen.UNSAFE_getByType(Modal).props.visible).toBe(true);
  expect(dismiss).not.toHaveBeenCalled();
  completeAnimation();
  expect(screen.UNSAFE_getByType(Modal).props.visible).toBe(false);
  expect(dismiss).not.toHaveBeenCalled();
  nativeDismiss(); nativeDismiss();
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it('continues from the current position when a new header drag interrupts snap-back', () => {
  render(popup(jest.fn()));
  // The real animation may be between frames; supply that current UI-thread position.
  mockShared[0].value = 47;
  act(() => { mockHandlers.onActivate(); mockHandlers.onUpdate(event({ translationY: 10 })); });
  expect(mockShared[0].value).toBe(57);
  act(() => { mockHandlers.onDeactivate({ ...event({ translationY: 10 }), canceled: false }); mockHandlers.onFinalize(); });
  expect(mockShared[0].value).toBe(0);
});

it.each(['escape', 'action', 'back', 'backdrop'])('closes through %s using the same guarded callback', path => {
  const dismiss = jest.fn(); render(popup(dismiss));
  if (path === 'escape') fireEvent(screen.getByTestId('history'), 'accessibilityEscape');
  if (path === 'action') {
    fireEvent(screen.getByTestId('history-drag-header'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(mockAnimations).toHaveLength(0);
    fireEvent(screen.getByTestId('history-drag-header'), 'accessibilityAction', { nativeEvent: { actionName: 'dismiss' } });
  }
  if (path === 'back') fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
  if (path === 'backdrop') fireEvent.press(screen.getByTestId('history-backdrop', { includeHiddenElements: true }));
  fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
  expect(mockAnimations).toHaveLength(1);
  completeAnimation(); nativeDismiss();
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it('finishes Android system Back without waiting for the iOS native-dismiss event', () => {
  Platform.OS = 'android';
  const dismiss = jest.fn(); render(popup(dismiss));
  fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
  completeAnimation();
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it('honours reduced motion for exit and snap-back', () => {
  mockReducedMotion = true;
  render(popup(jest.fn()));
  act(() => { mockHandlers.onUpdate(event({ translationY: 40 })); mockHandlers.onFinalize(); });
  expect(mockAnimations.at(-1)?.config).toEqual({ duration: 0, reduceMotion: 'system' });
  fireEvent(screen.getByTestId('history'), 'accessibilityEscape');
  expect(mockAnimations.at(-1)?.config).toEqual({ duration: 0, reduceMotion: 'system' });
});

it('cancels an exit on unmount, ignores its late callback, and reopens at zero offset', () => {
  const dismiss = jest.fn();
  const view = render(popup(dismiss));
  fireEvent(screen.getByTestId('history'), 'accessibilityEscape');
  const oldAnimation = mockAnimations.at(-1)!;
  view.unmount();
  expect(mockCancel).toHaveBeenCalled();
  act(() => oldAnimation.complete?.(true));
  expect(dismiss).not.toHaveBeenCalled();
  mockShared = [];
  render(popup(dismiss));
  expect(mockShared[0].value).toBe(0);
  expect(screen.UNSAFE_getByType(Modal).props.visible).toBe(true);
});
