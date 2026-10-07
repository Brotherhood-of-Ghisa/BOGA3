/* eslint-disable @typescript-eslint/no-require-imports -- Native mechanism mock factories. */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions, Modal, Platform, Pressable, ScrollView, Text } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from '@/components/ui/sheet';
import { shouldDismissSheet, type SheetDrag } from '@/components/ui/sheet-gesture';

type Animation = { value: number; config: { duration: number; reduceMotion: string } };
let mockAnimations: Animation[] = [];
let mockHandlers: Record<string, (event?: SheetDrag & { canceled?: boolean }) => void> = {};
let mockOffsets: Record<string, unknown> = {};
let mockShared: { value: unknown }[] = [];
let mockReducedMotion = false;
let frames: FrameRequestCallback[] = [];

// Only native gesture/animation mechanisms are replaced. The production
// handlers run; the test drives them instead of pretending to swipe.
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
        mockHandlers[name] = config[name] as (event?: SheetDrag & { canceled?: boolean }) => void;
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
    cancelAnimation: jest.fn(),
    withTiming: (value: number, config: Animation['config']) => {
      mockAnimations.push({ value, config });
      return value;
    },
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

const originalPlatform = Platform.OS;
const drag = () => mockShared[0].value;
const event = (changes: Partial<SheetDrag> = {}): SheetDrag =>
  ({ translationX: 0, translationY: 0, velocityX: 0, velocityY: 0, ...changes });
const release = (translationY: number, canceled = false) => act(() => {
  mockHandlers.onActivate();
  mockHandlers.onUpdate(event({ translationY }));
  mockHandlers.onDeactivate({ ...event({ translationY }), canceled });
  mockHandlers.onFinalize();
});
const nextFrame = () => act(() => { const pending = frames; frames = []; pending.forEach((frame) => frame(0)); });

function GymLike({ visible, onDismiss, onDismissed, onRow = jest.fn(), onAction = jest.fn() }: {
  visible: boolean; onDismiss: () => void; onDismissed?: () => void; onRow?: () => void; onAction?: () => void;
}) {
  return (
    <Sheet dismissLabel="Dismiss gym picker" headerActions={<IconButton accessibilityLabel="Add gym" name="plus" onPress={onAction} testID="action" />}
      onDismiss={onDismiss} onDismissed={onDismissed} testID="gym" title="Gym" visible={visible}>
      <ScrollView testID="body"><Pressable onPress={onRow} testID="row"><Text>Garage Gym</Text></Pressable></ScrollView>
    </Sheet>
  );
}

beforeEach(() => {
  Platform.OS = 'ios';
  mockAnimations = []; mockHandlers = {}; mockOffsets = {}; mockShared = []; frames = [];
  mockReducedMotion = false;
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation((frame) => { frames.push(frame); return frames.length; });
});
afterEach(() => { Platform.OS = originalPlatform; jest.restoreAllMocks(); });

describe('sheet release rules', () => {
  it.each<[SheetDrag, boolean]>([
    [event({ translationY: 119 }), false],
    [event({ translationY: 120 }), true],
    [event({ translationY: 121 }), true],
    [event({ translationY: 23, velocityY: 900 }), false],
    [event({ translationY: 24, velocityY: 899 }), false],
    [event({ translationY: 24, velocityY: 900 }), true],
    [event({ translationY: 25, velocityY: 901 }), true],
    [event({ translationY: 120, velocityY: -1 }), false],
    [event({ translationY: -120, velocityY: 1000 }), false],
    [event({ velocityY: 1000 }), false],
    [event({ translationX: 120, translationY: 120 }), false],
    [event({ translationX: -121, translationY: 120 }), false],
    [event({ translationY: 24, velocityY: 900, velocityX: 900 }), false],
    [event({ translationY: 24, velocityY: 900, velocityX: -901 }), false],
  ])('decides %j as %s', (input, expected) => {
    expect(shouldDismissSheet(input)).toBe(expected);
  });
});

it('drags from the handle and title row only; the body and header controls keep their taps', () => {
  const dismiss = jest.fn(); const onRow = jest.fn(); const onAction = jest.fn();
  render(<GymLike onAction={onAction} onDismiss={dismiss} onRow={onRow} visible />);
  const zone = within(screen.getByTestId('pan-boundary'));
  expect(zone.getByTestId('gym-drag-zone')).toBeTruthy();
  expect(zone.getByTestId('gym-header')).toHaveTextContent('Gym');
  expect(zone.queryByTestId('body')).toBeNull();
  expect(mockOffsets).toEqual({ activeOffsetY: 8, failOffsetY: -8, failOffsetX: [-12, 12] });
  fireEvent.press(screen.getByTestId('row'));
  fireEvent.press(screen.getByTestId('action'));
  expect(onRow).toHaveBeenCalledTimes(1); expect(onAction).toHaveBeenCalledTimes(1);
  expect(dismiss).not.toHaveBeenCalled();
});

it('follows the finger and springs back from a short, upward or cancelled drag without closing', () => {
  const dismiss = jest.fn(); render(<GymLike onDismiss={dismiss} visible />);
  act(() => { mockHandlers.onActivate(); mockHandlers.onUpdate(event({ translationY: 60 })); });
  expect(drag()).toBe(60);
  act(() => { mockHandlers.onDeactivate({ ...event({ translationY: 60 }), canceled: false }); mockHandlers.onFinalize(); });
  expect(drag()).toBe(0);
  act(() => { mockHandlers.onActivate(); mockHandlers.onUpdate(event({ translationY: -30 })); });
  expect(drag()).toBe(0);
  release(160, true);
  expect(drag()).toBe(0);
  expect(dismiss).not.toHaveBeenCalled();
});

it('slides out on a qualifying release, asks the host once, and reopens in place after the native dismissal', () => {
  const dismiss = jest.fn(); const dismissed = jest.fn();
  const view = render(<GymLike onDismiss={dismiss} onDismissed={dismissed} visible />);
  release(130);
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(mockAnimations.at(-1)).toEqual({ value: Dimensions.get('window').height, config: { duration: 220, reduceMotion: 'system' } });
  view.rerender(<GymLike onDismiss={dismiss} onDismissed={dismissed} visible={false} />);
  nextFrame();
  expect(drag()).toBe(Dimensions.get('window').height);
  // A second drag while it leaves is ignored.
  release(200);
  expect(dismiss).toHaveBeenCalledTimes(1);
  fireEvent(screen.UNSAFE_getByType(Modal), 'dismiss');
  expect(dismissed).toHaveBeenCalledTimes(1);
  expect(drag()).toBe(0);
  view.rerender(<GymLike onDismiss={dismiss} onDismissed={dismissed} visible />);
  expect(screen.getByTestId('gym')).toHaveStyle({ transform: [{ translateY: 0 }] });
  release(130);
  expect(dismiss).toHaveBeenCalledTimes(2);
});

it('springs back when the host refuses to close (its write is in flight)', () => {
  const refuse = jest.fn(); render(<GymLike onDismiss={refuse} visible />);
  release(150);
  expect(refuse).toHaveBeenCalledTimes(1);
  nextFrame();
  expect(drag()).toBe(0);
  expect(mockAnimations.at(-1)?.config.duration).toBe(180);
  // And it can be dragged again.
  release(150);
  expect(refuse).toHaveBeenCalledTimes(2);
});

it('resets on Android once hidden, with no native dismissal event', () => {
  Platform.OS = 'android';
  const dismissed = jest.fn(); const dismiss = jest.fn();
  const view = render(<GymLike onDismiss={dismiss} onDismissed={dismissed} visible />);
  release(130);
  view.rerender(<GymLike onDismiss={dismiss} onDismissed={dismissed} visible={false} />);
  expect(dismissed).toHaveBeenCalledTimes(1);
  expect(drag()).toBe(0);
});

it('honours reduced motion for the exit and the snap-back', () => {
  mockReducedMotion = true;
  render(<GymLike onDismiss={jest.fn()} visible />);
  release(40);
  expect(mockAnimations.at(-1)?.config).toEqual({ duration: 0, reduceMotion: 'system' });
  release(130);
  expect(mockAnimations.at(-1)?.config).toEqual({ duration: 0, reduceMotion: 'system' });
});

it.each(['backdrop', 'escape', 'back'])('still closes through %s without a slide', (path) => {
  const dismiss = jest.fn(); render(<GymLike onDismiss={dismiss} visible />);
  if (path === 'backdrop') fireEvent.press(screen.getByTestId('gym-backdrop', { includeHiddenElements: true }));
  if (path === 'escape') fireEvent(screen.getByTestId('gym'), 'accessibilityEscape');
  if (path === 'back') fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(mockAnimations).toHaveLength(0);
});
