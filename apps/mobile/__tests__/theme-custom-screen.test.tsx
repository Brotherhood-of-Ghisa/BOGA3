/* eslint-disable import/first */

/**
 * Settings → Appearance → Custom → one part: a hue ring and a strength slider
 * (and, for the background, lightness and depth sliders) repaint a preview
 * live; letting one go stores the part for the next launch and the page says
 * so. There is no save button. The choice lives in expo-sqlite's key-value
 * store, faked in memory by jest.setup.ts. Replaced: the log sink, which is
 * observed, and expo-router's params and stack title. Gesture-handler is
 * stubbed (jest.setup.ts), so a release is driven by calling the handler the
 * stub kept on the gesture; the real gesture path is proved on the simulator.
 */

const mockLogEvent = jest.fn();
jest.mock('@/src/logging/logEvent', () => ({ logEvent: (...args: unknown[]) => mockLogEvent(...args) }));

let mockPart: string | undefined = 'background';
const mockTitles: string[] = [];
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ part: mockPart }),
  Stack: { Screen: ({ options }: { options: { title: string } }) => (mockTitles.push(options.title), null) },
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Storage } from 'expo-sqlite/kv-store';
import { StyleSheet } from 'react-native';

import { pointToValue } from '@/components/ui/slider-row';
import { customFromSeeds, generateCustomRoles, type CustomColours } from '@/components/ui/theme-custom';
import * as themeLaunch from '@/components/ui/theme-launch';
import { APPEARANCE_STORAGE_KEY } from '@/components/ui/theme-launch';
import { getThemePreset } from '@/components/ui/theme-presets';
import ThemeCustomRoute from '../app/theme-custom';

const CUSTOM: CustomColours = {
  background: { hue: 80, strength: 20, lightness: 90, depth: 100 },
  text: { hue: 60, strength: 10 },
  accent: { hue: 30, strength: 70 },
  record: { hue: 90, strength: 50 },
  viz: { hue: 150, strength: 40 },
};

const store = (custom: CustomColours, theme = 'custom') =>
  Storage.setItemSync(APPEARANCE_STORAGE_KEY, JSON.stringify({ theme, mode: 'light', custom }));
const storedCustom = (): CustomColours | null => {
  const record = Storage.getItemSync(APPEARANCE_STORAGE_KEY);
  return record === null ? null : JSON.parse(record).custom;
};

beforeEach(() => {
  mockLogEvent.mockReset();
  mockPart = 'background';
  mockTitles.length = 0;
});

afterEach(() => {
  jest.restoreAllMocks();
});

type Handlers = Record<'onBegin' | 'onUpdate' | 'onEnd' | 'onFinalize', (event?: unknown, success?: boolean) => void>;
const handlers = (element: ReturnType<typeof screen.getByRole>) => element.props.gesture.handlers as Handlers;
// A slider's gesture is a drag raced against a tap.
const drag = (element: ReturnType<typeof screen.getByRole>) => element.props.gesture.gestures[0].handlers as Handlers;
const tap = (element: ReturnType<typeof screen.getByRole>) => element.props.gesture.gestures[1].handlers as Handlers;
const ring = () => screen.getByRole('adjustable', { name: 'Hue' });
const slider = (name: string) => screen.getByRole('adjustable', { name });
const step = (element: ReturnType<typeof slider>, actionName: 'increment' | 'decrement') =>
  act(async () => {
    fireEvent(element, 'accessibilityAction', { nativeEvent: { actionName } });
  });
const previewGround = () => StyleSheet.flatten(screen.getByTestId('theme-custom-preview', { includeHiddenElements: true }).props.style).backgroundColor;

it('titles the page with its part, and opens the background for an unknown one', () => {
  mockPart = 'record';
  render(<ThemeCustomRoute />);
  expect(mockTitles).toContain('Best ever');
  mockPart = 'neon';
  render(<ThemeCustomRoute />);
  expect(mockTitles).toContain('Background');
  expect(slider('Lightness')).toBeTruthy();
});

it('offers lightness and depth for the background only', () => {
  store(CUSTOM);
  render(<ThemeCustomRoute />);
  expect(slider('Strength').props.accessibilityValue).toEqual({ text: '20%' });
  expect(slider('Lightness').props.accessibilityValue).toEqual({ text: '90' });
  expect(slider('Depth').props.accessibilityValue).toEqual({ text: '100%' });

  mockPart = 'accent';
  screen.unmount();
  render(<ThemeCustomRoute />);
  expect(ring().props.accessibilityValue).toEqual({ text: 'Red, 30 degrees' });
  expect(slider('Strength').props.accessibilityValue).toEqual({ text: '70%' });
  expect(screen.queryByRole('adjustable', { name: 'Lightness' })).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});

it('names the ends of the lightness slider', async () => {
  store({ ...CUSTOM, background: { ...CUSTOM.background, lightness: 99 } });
  render(<ThemeCustomRoute />);
  await step(slider('Lightness'), 'increment');
  expect(slider('Lightness').props.accessibilityValue).toEqual({ text: 'White' });
  await waitFor(() => expect(storedCustom()?.background.lightness).toBe(100));
});

it('starts from the preset in use when no custom colours are stored', () => {
  render(<ThemeCustomRoute />);
  const start = customFromSeeds(getThemePreset('warm').seeds, 'light');
  expect(slider('Lightness').props.accessibilityValue).toEqual({ text: `${start.background.lightness}` });
});

it('repaints the preview as a slider moves, and saves only when it is let go', async () => {
  store(CUSTOM);
  render(<ThemeCustomRoute />);
  const track = screen.getByTestId('theme-custom-lightness-track');
  fireEvent(track, 'layout', { nativeEvent: { layout: { width: 200 } } });

  act(() => drag(slider('Lightness')).onUpdate({ x: 20 }));
  const dark = { ...CUSTOM, background: { ...CUSTOM.background, lightness: 10 } };
  expect(previewGround()).toBe(generateCustomRoles(dark).paper);
  expect(storedCustom()).toEqual(CUSTOM);

  await act(async () => drag(slider('Lightness')).onEnd({ x: 20 }, true));
  await waitFor(() => expect(storedCustom()).toEqual(dark));
  expect(await screen.findByText('Saved · next launch')).toBeTruthy();
});

it('saves a tap on the track, and nothing when the page scroll takes the touch', async () => {
  store(CUSTOM);
  render(<ThemeCustomRoute />);
  fireEvent(screen.getByTestId('theme-custom-depth-track'), 'layout', { nativeEvent: { layout: { width: 300 } } });

  await act(async () => {
    drag(slider('Depth')).onEnd({ x: 30 }, false);
    tap(slider('Depth')).onEnd({ x: 30 }, false);
  });
  expect(storedCustom()).toEqual(CUSTOM);

  await act(async () => tap(slider('Depth')).onEnd({ x: 30 }, true));
  await waitFor(() => expect(storedCustom()?.background.depth).toBe(30));
});

it('says nothing is saved for the next launch when the part is set back to the theme in use', async () => {
  store(CUSTOM);
  jest.replaceProperty(themeLaunch, 'launchTheme', { ...themeLaunch.launchTheme, appearance: { theme: 'custom', mode: 'light', custom: CUSTOM } });
  render(<ThemeCustomRoute />);
  await step(slider('Strength'), 'increment');
  expect(await screen.findByText('Saved · next launch')).toBeTruthy();
  await step(slider('Strength'), 'decrement');
  await waitFor(() => expect(storedCustom()).toEqual(CUSTOM));
  expect(screen.queryByTestId('theme-custom-status')).toBeNull();
});

it('saves a hue when the ring is let go, keeping the other parts', async () => {
  store(CUSTOM);
  mockPart = 'viz';
  render(<ThemeCustomRoute />);

  // A touch at the right edge of the 240pt ring is 90°.
  await act(async () => {
    handlers(ring()).onBegin({ x: 240, y: 120 });
    handlers(ring()).onFinalize({ x: 240, y: 120 });
  });

  await waitFor(() => expect(storedCustom()).toEqual({ ...CUSTOM, viz: { hue: 90, strength: 40 } }));
});

it('saves a VoiceOver step on depth at once', async () => {
  store(CUSTOM);
  render(<ThemeCustomRoute />);
  await step(slider('Depth'), 'decrement');
  await waitFor(() => expect(storedCustom()?.background.depth).toBe(85));
});

it('makes Custom the theme when a part is saved from a preset', async () => {
  store(CUSTOM, 'plum');
  mockPart = 'text';
  render(<ThemeCustomRoute />);
  await step(slider('Strength'), 'increment');
  await waitFor(() => expect(JSON.parse(Storage.getItemSync(APPEARANCE_STORAGE_KEY)!).theme).toBe('custom'));
  expect(storedCustom()?.text).toEqual({ hue: 60, strength: 15 });
});

it('writes nothing when a slider is let go at the value already stored', async () => {
  store(CUSTOM);
  const setItem = jest.spyOn(Storage, 'setItem');
  render(<ThemeCustomRoute />);
  fireEvent(screen.getByTestId('theme-custom-strength-track'), 'layout', { nativeEvent: { layout: { width: 100 } } });

  await act(async () => tap(slider('Strength')).onEnd({ x: 20 }, true));

  expect(setItem).not.toHaveBeenCalled();
  expect(screen.queryByTestId('theme-custom-status')).toBeNull();
});

it('says nothing changed, and logs why, when the save fails', async () => {
  store(CUSTOM);
  jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  render(<ThemeCustomRoute />);

  await step(slider('Strength'), 'increment');

  expect(await screen.findByText('Couldn’t save the colour. Nothing changed.')).toBeTruthy();
  expect(screen.getByTestId('theme-custom-error').props.accessibilityRole).toBe('alert');
  expect(storedCustom()).toEqual(CUSTOM);
  expect(mockLogEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      level: 'warn',
      event: 'theme.save_failed',
      context: { part: 'background', value: { ...CUSTOM.background, strength: 25 }, error: 'disk full' },
    }),
  );
});

describe('pointToValue', () => {
  it('maps a point along the track to a whole number, clamped to the ends', () => {
    expect(pointToValue(0, 200, 100)).toBe(0);
    expect(pointToValue(100, 200, 100)).toBe(50);
    expect(pointToValue(201, 200, 300)).toBe(300);
    expect(pointToValue(-5, 200, 100)).toBe(0);
    expect(pointToValue(50, 0, 100)).toBe(0);
  });
});
