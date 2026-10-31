/* eslint-disable import/first */

/**
 * Settings → Appearance → Custom colour: a hue ring repaints a preview of the
 * theme live; letting the ring go stores `hue:<deg>` for the next launch and
 * the page says so. There is no save button. The choice lives in expo-sqlite's
 * key-value store, faked in memory by jest.setup.ts. Replaced: the log sink,
 * which is observed. Gesture-handler is stubbed (jest.setup.ts), so the ring's
 * release is driven by calling the handler the stub kept on the gesture; the
 * real release path is proved on the simulator.
 */

const mockLogEvent = jest.fn();
jest.mock('@/src/logging/logEvent', () => ({ logEvent: (...args: unknown[]) => mockLogEvent(...args) }));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Storage } from 'expo-sqlite/kv-store';
import { StyleSheet } from 'react-native';

import { pointToHue } from '@/components/appearance/hue-ring';
import { generateRoles } from '@/components/ui/theme';
import { seedsFromHue } from '@/components/ui/theme-hue';
import { THEME_PRESET_STORAGE_KEY } from '@/components/ui/theme-launch';
import ThemeColourRoute from '../app/theme-colour';

beforeEach(() => {
  mockLogEvent.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// One VoiceOver step on the ring; it saves, so the save is let settle.
const step = (actionName: 'increment' | 'decrement') =>
  act(async () => {
    fireEvent(ring(), 'accessibilityAction', { nativeEvent: { actionName } });
  });
const ring = () => screen.getByRole('adjustable', { name: 'Hue' });
// What the ring's pan gesture does on the JS thread (see the header).
const pan = () => ring().props.gesture.handlers as Record<'onBegin' | 'onUpdate' | 'onFinalize', (event?: unknown) => void>;
// A touch at the top of the 240pt ring is 0°, at its right edge 90°.
const touch = (x: number, y: number) => ({ x, y });
const savedStatus = () => screen.queryByTestId('theme-colour-status');
// The preview is decoration to VoiceOver; its colours are read off the mock.
const previewBackground = (text: string) => {
  const label = screen.getByText(text, { includeHiddenElements: true });
  return StyleSheet.flatten(label.parent!.parent!.props.style).backgroundColor;
};

it('starts at the hue of the accent in use', () => {
  render(<ThemeColourRoute />);
  // Warm's accent, #C2410C, sits at LCh hue 47.
  expect(ring().props.accessibilityValue).toEqual({ text: 'Orange, 47 degrees' });
});

it('starts at a custom hue chosen before', () => {
  Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'hue:265');
  render(<ThemeColourRoute />);
  expect(ring().props.accessibilityValue).toEqual({ text: 'Blue, 265 degrees' });
});

it('repaints the preview as the hue changes', async () => {
  render(<ThemeColourRoute />);
  expect(previewBackground('LOG SET')).toBe(generateRoles(seedsFromHue(47)).accent);

  await step('increment');
  expect(ring().props.accessibilityValue).toEqual({ text: 'Orange, 57 degrees' });
  expect(previewBackground('LOG SET')).toBe(generateRoles(seedsFromHue(57)).accent);

  for (let count = 0; count < 6; count += 1) {
    await step('decrement');
  }
  // Wraps past 0°.
  expect(ring().props.accessibilityValue).toEqual({ text: 'Pink, 357 degrees' });
  expect(previewBackground('BEST EVER')).toBe(generateRoles(seedsFromHue(357)).recordWash);
});

it('shows the preview sets with their 1RM to one decimal and counts the performed set', () => {
  render(<ThemeColourRoute />);
  const preview = (text: string) => screen.getByText(text, { includeHiddenElements: true });
  // 1rm.formula: 80 × 8 is 102.1; the planned 82.5 × 8 projects 105.3.
  // set.count-display: the header counts only the performed set.
  expect(preview('1 set · 1RM 102.1')).toBeTruthy();
  expect(preview('1RM 102.1')).toBeTruthy();
  expect(preview('1RM 105.3')).toBeTruthy();
  expect(screen.queryByText(/1RM (101|102|—)$/, { includeHiddenElements: true })).toBeNull();
});

it('has no Use this colour button', () => {
  render(<ThemeColourRoute />);
  expect(screen.queryByText('Use this colour')).toBeNull();
  expect(screen.queryByTestId('theme-colour-apply')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  expect(savedStatus()).toBeNull();
});

it('saves the hue when the ring is let go and says it applies next launch', async () => {
  render(<ThemeColourRoute />);
  act(() => pan().onBegin(touch(120, 0)));
  act(() => pan().onUpdate(touch(240, 120)));
  // Dragging saves nothing.
  expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBeNull();
  expect(savedStatus()).toBeNull();

  await act(async () => pan().onFinalize(touch(240, 120)));

  expect(await screen.findByText('Saved · next launch')).toBeTruthy();
  expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBe('hue:90');

  // Moving the ring on hides the status until that hue is let go too.
  act(() => pan().onBegin(touch(120, 240)));
  expect(savedStatus()).toBeNull();
  await act(async () => pan().onFinalize(touch(120, 240)));
  await waitFor(() => expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBe('hue:180'));
  expect(await screen.findByText('Saved · next launch')).toBeTruthy();
});

it('saves the hue at the release point, not the last hue the ring rendered', async () => {
  render(<ThemeColourRoute />);
  act(() => pan().onBegin(touch(120, 0)));
  expect(ring().props.accessibilityValue).toEqual({ text: 'Pink, 0 degrees' });

  // The finger moved on before the last move was rendered: the event is the truth.
  await act(async () => pan().onFinalize(touch(240, 120)));

  expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBe('hue:90');
});

it('saves a VoiceOver step at once', async () => {
  render(<ThemeColourRoute />);
  await step('increment');

  expect(await screen.findByText('Saved · next launch')).toBeTruthy();
  expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBe('hue:57');
});

it('writes nothing when the ring is let go at the hue already stored', async () => {
  Storage.setItemSync(THEME_PRESET_STORAGE_KEY, 'hue:90');
  const setItem = jest.spyOn(Storage, 'setItem');
  render(<ThemeColourRoute />);

  act(() => pan().onBegin(touch(240, 120)));
  await act(async () => pan().onFinalize(touch(240, 120)));

  expect(setItem).not.toHaveBeenCalled();
  expect(savedStatus()).toBeNull();
});

it('says nothing changed, and logs why, when the save fails, and saves on the next release', async () => {
  jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  render(<ThemeColourRoute />);

  act(() => pan().onBegin(touch(240, 120)));
  await act(async () => pan().onFinalize(touch(240, 120)));

  expect(await screen.findByText('Couldn’t save the colour. Nothing changed.')).toBeTruthy();
  expect(screen.getByTestId('theme-colour-error').props.accessibilityRole).toBe('alert');
  expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBeNull();
  expect(savedStatus()).toBeNull();
  expect(mockLogEvent).toHaveBeenCalledWith(
    expect.objectContaining({ level: 'warn', event: 'theme.save_failed', context: { hue: 90, error: 'disk full' } }),
  );

  // Letting go at the same hue again retries: nothing was stored.
  act(() => pan().onBegin(touch(240, 120)));
  await act(async () => pan().onFinalize(touch(240, 120)));
  expect(await screen.findByText('Saved · next launch')).toBeTruthy();
  expect(screen.queryByText('Couldn’t save the colour. Nothing changed.')).toBeNull();
  expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBe('hue:90');
});

describe('pointToHue', () => {
  it('reads 0° at the top of the ring, clockwise', () => {
    expect(pointToHue(120, 0, 240)).toBe(0);
    expect(pointToHue(240, 120, 240)).toBe(90);
    expect(pointToHue(120, 240, 240)).toBe(180);
    expect(pointToHue(0, 120, 240)).toBe(270);
    expect(pointToHue(0, 0, 240)).toBe(315);
  });
});
