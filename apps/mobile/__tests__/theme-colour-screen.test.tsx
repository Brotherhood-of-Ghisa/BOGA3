/* eslint-disable import/first */

/**
 * Settings → Appearance → Custom colour: a hue ring repaints a preview of the
 * theme live; "Use this colour" stores `hue:<deg>` for the next launch and
 * asks a development build to reload. The choice lives in expo-sqlite's
 * key-value store, faked in memory by jest.setup.ts. Replaced: the log sink,
 * which is observed; `DevSettings.reload` is spied.
 */

const mockLogEvent = jest.fn();
jest.mock('@/src/logging/logEvent', () => ({ logEvent: (...args: unknown[]) => mockLogEvent(...args) }));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Storage } from 'expo-sqlite/kv-store';
import { DevSettings, StyleSheet } from 'react-native';

import { pointToHue } from '@/components/appearance/hue-ring';
import { generateRoles } from '@/components/ui/theme';
import { seedsFromHue } from '@/components/ui/theme-hue';
import { THEME_PRESET_STORAGE_KEY } from '@/components/ui/theme-launch';
import ThemeColourRoute from '../app/theme-colour';

let reload: jest.SpyInstance;

beforeEach(() => {
  mockLogEvent.mockReset();
  reload = jest.spyOn(DevSettings, 'reload').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const ring = () => screen.getByRole('adjustable', { name: 'Hue' });
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

it('repaints the preview as the hue changes', () => {
  render(<ThemeColourRoute />);
  expect(previewBackground('LOG SET')).toBe(generateRoles(seedsFromHue(47)).accent);

  fireEvent(ring(), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  expect(ring().props.accessibilityValue).toEqual({ text: 'Orange, 57 degrees' });
  expect(previewBackground('LOG SET')).toBe(generateRoles(seedsFromHue(57)).accent);

  for (let step = 0; step < 6; step += 1) {
    fireEvent(ring(), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
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

it('stores the hue for the next launch and asks to reload', async () => {
  render(<ThemeColourRoute />);
  // No sentence explains the ring or the restart (copy.no-inline-explanation).
  expect(screen.queryByText(/ring|next time/i)).toBeNull();
  fireEvent(ring(), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });

  fireEvent.press(screen.getByTestId('theme-colour-apply'));

  // Wait on the label, not the store: the fake store holds the value before the
  // write's promise settles, so the saved state may not have rendered yet.
  // The button carries the restart: saved, from the next launch, until the hue moves.
  await waitFor(() => expect(screen.getByTestId('theme-colour-apply')).toHaveTextContent('Saved · next launch'));
  expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBe('hue:57');
  expect(reload).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('theme-colour-apply').props.accessibilityState).toEqual({ disabled: true });

  fireEvent(ring(), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  expect(screen.getByTestId('theme-colour-apply')).toHaveTextContent('Use this colour');
  expect(screen.getByTestId('theme-colour-apply').props.accessibilityState).toEqual({ disabled: false });
});

it('says nothing changed, and logs why, when the save fails', async () => {
  jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  render(<ThemeColourRoute />);

  fireEvent.press(screen.getByTestId('theme-colour-apply'));

  expect(await screen.findByText('Couldn’t save the colour. Nothing changed.')).toBeTruthy();
  expect(Storage.getItemSync(THEME_PRESET_STORAGE_KEY)).toBeNull();
  expect(reload).not.toHaveBeenCalled();
  expect(mockLogEvent).toHaveBeenCalledWith(
    expect.objectContaining({ level: 'warn', event: 'theme.save_failed', context: { hue: 47, error: 'disk full' } }),
  );
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
