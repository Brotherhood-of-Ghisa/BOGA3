/* eslint-disable import/first */

/**
 * Settings → Appearance → Custom background: a hue ring and a tint step repaint
 * a preview of the page live; letting the ring go (or picking a tint) stores the
 * background for the next launch and the page says so. There is no save button.
 * The choice lives in expo-sqlite's key-value store, faked in memory by
 * jest.setup.ts. Replaced: the log sink, which is observed. Gesture-handler is
 * stubbed (jest.setup.ts), so the ring's release is driven by calling the
 * handler the stub kept on the gesture; the real release path is proved on the
 * simulator.
 */

const mockLogEvent = jest.fn();
jest.mock('@/src/logging/logEvent', () => ({ logEvent: (...args: unknown[]) => mockLogEvent(...args) }));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Storage } from 'expo-sqlite/kv-store';
import { StyleSheet } from 'react-native';

import { appearanceRoles } from '@/components/appearance/chosen-theme';
import { APPEARANCE_STORAGE_KEY } from '@/components/ui/theme-launch';
import { DEFAULT_APPEARANCE } from '@/components/ui/theme-presets';
import ThemeBackgroundRoute from '../app/theme-background';

const storedBackground = (): unknown => {
  const record = Storage.getItemSync(APPEARANCE_STORAGE_KEY);
  return record === null ? null : (JSON.parse(record) as { background: unknown }).background;
};

beforeEach(() => {
  mockLogEvent.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const ring = () => screen.getByRole('adjustable', { name: 'Hue' });
const pan = () => ring().props.gesture.handlers as Record<'onBegin' | 'onUpdate' | 'onFinalize', (event?: unknown) => void>;
// A touch at the top of the 240pt ring is 0°, at its right edge 90°.
const touch = (x: number, y: number) => ({ x, y });
const previewGround = () => StyleSheet.flatten(screen.getByTestId('theme-background-preview', { includeHiddenElements: true }).props.style).backgroundColor;
const tint = (value: 'Soft' | 'Medium' | 'Strong') => screen.getByRole('tab', { name: value });
const savedStatus = () => screen.queryByTestId('theme-background-status');
const release = (x: number, y: number) =>
  act(async () => {
    pan().onBegin(touch(x, y));
    pan().onFinalize(touch(x, y));
  });

it('starts at the middle tint, with nothing saved', () => {
  render(<ThemeBackgroundRoute />);
  expect(tint('Medium').props.accessibilityState).toEqual({ selected: true });
  expect(storedBackground()).toBeNull();
  expect(savedStatus()).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});

it('starts at the custom background chosen before', () => {
  Storage.setItemSync(APPEARANCE_STORAGE_KEY, '{"accent":"warm","background":{"hue":265,"tint":3},"text":"match","mode":"light"}');
  render(<ThemeBackgroundRoute />);
  expect(ring().props.accessibilityValue).toEqual({ text: 'Blue, 265 degrees' });
  expect(tint('Strong').props.accessibilityState).toEqual({ selected: true });
});

it('repaints the preview as the ring moves and a tint is picked, saving nothing until released', () => {
  render(<ThemeBackgroundRoute />);

  act(() => pan().onBegin(touch(240, 120)));
  expect(previewGround()).toBe(appearanceRoles({ ...DEFAULT_APPEARANCE, background: { hue: 90, tint: 2 } }).paper);
  expect(storedBackground()).toBeNull();
});

it('keeps the text and accent already chosen in the preview', () => {
  Storage.setItemSync(APPEARANCE_STORAGE_KEY, '{"accent":"plum","background":"match","text":"navy","mode":"light"}');
  render(<ThemeBackgroundRoute />);
  act(() => pan().onBegin(touch(240, 120)));
  const appearance = { ...DEFAULT_APPEARANCE, accent: 'plum' as const, text: 'navy' as const };
  expect(previewGround()).toBe(appearanceRoles({ ...appearance, background: { hue: 90, tint: 2 } }).paper);
});

it('saves the background when the ring is let go, keeping the rest, and says it applies next launch', async () => {
  Storage.setItemSync(APPEARANCE_STORAGE_KEY, '{"accent":"plum","background":"match","text":"navy","mode":"light"}');
  render(<ThemeBackgroundRoute />);

  await release(240, 120);

  expect(await screen.findByText('Saved · next launch')).toBeTruthy();
  expect(JSON.parse(Storage.getItemSync(APPEARANCE_STORAGE_KEY)!)).toEqual({
    accent: 'plum',
    background: { hue: 90, tint: 2 },
    text: 'navy',
    mode: 'light',
  });
});

it('saves a tint at once, at the hue showing', async () => {
  Storage.setItemSync(APPEARANCE_STORAGE_KEY, '{"accent":"warm","background":{"hue":90,"tint":1},"text":"match","mode":"light"}');
  render(<ThemeBackgroundRoute />);

  fireEvent.press(tint('Strong'));

  await waitFor(() => expect(storedBackground()).toEqual({ hue: 90, tint: 3 }));
  expect(await screen.findByText('Saved · next launch')).toBeTruthy();
  expect(tint('Strong').props.accessibilityState).toEqual({ selected: true });
});

it('saves a VoiceOver step at once', async () => {
  Storage.setItemSync(APPEARANCE_STORAGE_KEY, '{"accent":"warm","background":{"hue":90,"tint":2},"text":"match","mode":"light"}');
  render(<ThemeBackgroundRoute />);

  await act(async () => {
    fireEvent(ring(), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  });

  await waitFor(() => expect(storedBackground()).toEqual({ hue: 100, tint: 2 }));
});

it('writes nothing when the ring is let go at the background already stored', async () => {
  Storage.setItemSync(APPEARANCE_STORAGE_KEY, '{"accent":"warm","background":{"hue":90,"tint":2},"text":"match","mode":"light"}');
  const setItem = jest.spyOn(Storage, 'setItem');
  render(<ThemeBackgroundRoute />);

  await release(240, 120);

  expect(setItem).not.toHaveBeenCalled();
  expect(savedStatus()).toBeNull();
});

it('says nothing changed, and logs why, when the save fails, and saves on the next release', async () => {
  jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  render(<ThemeBackgroundRoute />);

  await release(240, 120);

  expect(await screen.findByText('Couldn’t save the background. Nothing changed.')).toBeTruthy();
  expect(screen.getByTestId('theme-background-error').props.accessibilityRole).toBe('alert');
  expect(storedBackground()).toBeNull();
  expect(savedStatus()).toBeNull();
  expect(mockLogEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      level: 'warn',
      event: 'theme.save_failed',
      context: { background: { hue: 90, tint: 2 }, error: 'disk full' },
    }),
  );

  await release(240, 120);
  expect(await screen.findByText('Saved · next launch')).toBeTruthy();
  expect(screen.queryByText('Couldn’t save the background. Nothing changed.')).toBeNull();
  expect(storedBackground()).toEqual({ hue: 90, tint: 2 });
});
