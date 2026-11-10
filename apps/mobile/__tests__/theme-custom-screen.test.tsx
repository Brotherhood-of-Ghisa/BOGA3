/* eslint-disable import/first */

/**
 * Settings → Appearance → Custom → one part: a painted hue bar and a strength
 * slider (and, for the background, lightness and depth sliders) repaint the
 * part's spotlight and a preview live; letting one go stores the part and the
 * app repaints in it, the header's indicator showing until it has. The title
 * switches part in place. There is no save button. The choice lives in
 * expo-sqlite's key-value store, faked in memory by jest.setup.ts. Replaced:
 * the log sink, which is observed, and expo-router's params, `setParams` and
 * stack options (the header's title and right control are rendered in place).
 * Gesture-handler is stubbed (jest.setup.ts), so a release is driven by
 * calling the handler the stub kept on the gesture; the real gesture path is
 * proved on the simulator.
 */

const mockLogEvent = jest.fn();
jest.mock('@/src/logging/logEvent', () => ({ logEvent: (...args: unknown[]) => mockLogEvent(...args) }));

let mockPart: string | undefined = 'background';
const mockTitles: string[] = [];
const mockSetParams = jest.fn();
type MockOptions = { title: string; headerTitle?: () => unknown; headerRight?: () => unknown };
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ part: mockPart }),
  useRouter: () => ({ setParams: mockSetParams }),
  Stack: {
    Screen: ({ options }: { options: MockOptions }) => {
      mockTitles.push(options.title);
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- resolve after mock hoisting.
      return require('react').createElement(require('react').Fragment, null, options.headerTitle?.(), options.headerRight?.());
    },
  },
}));

import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Storage } from 'expo-sqlite/kv-store';
import { StyleSheet, Text } from 'react-native';

import { SPOTLIGHT } from '@/components/appearance/theme-preview';
import { pointToValue } from '@/components/ui/slider-row';
import {
  CUSTOM_PARTS,
  customFromSeeds,
  customSeed,
  generateCustomRoles,
  type CustomColours,
  type CustomPart,
} from '@/components/ui/theme-custom';
import { useUiRoles } from '@/components/ui/theme-context';
import { APPEARANCE_STORAGE_KEY } from '@/components/ui/theme-launch';
import { getThemePreset } from '@/components/ui/theme-presets';
import ThemeCustomRoute from '../app/theme-custom';
import { renderWithTheme } from './helpers/theme';

const CUSTOM: CustomColours = {
  background: { hue: 80, strength: 20, lightness: 90, depth: 100 },
  ink: { hue: 265, strength: 30 },
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
  mockSetParams.mockReset();
  mockPart = 'background';
  mockTitles.length = 0;
});

afterEach(() => {
  jest.restoreAllMocks();
});

type Handlers = Record<'onBegin' | 'onUpdate' | 'onEnd' | 'onFinalize', (event?: unknown, success?: boolean) => void>;
// A slider's gesture is a drag raced against a tap.
const drag = (element: ReturnType<typeof screen.getByRole>) => element.props.gesture.gestures[0].handlers as Handlers;
const tap = (element: ReturnType<typeof screen.getByRole>) => element.props.gesture.gestures[1].handlers as Handlers;
const hueBar = () => screen.getByRole('adjustable', { name: 'Hue' });
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
  expect(hueBar().props.accessibilityValue).toEqual({ text: 'Red, 30 degrees' });
  expect(slider('Strength').props.accessibilityValue).toEqual({ text: '70%' });
  expect(screen.queryByRole('adjustable', { name: 'Lightness' })).toBeNull();
  expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual(['Accent, switch colour']);
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
  expect(screen.queryByText(/next launch/i)).toBeNull();
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

it('repaints the app in the part let go, behind the page as well as on it', async () => {
  store(CUSTOM);
  function Behind() {
    return <Text testID="behind">{useUiRoles().paper}</Text>;
  }
  renderWithTheme(
    <>
      <Behind />
      <ThemeCustomRoute />
    </>,
  );
  expect(screen.getByTestId('behind')).toHaveTextContent(generateCustomRoles(CUSTOM).paper);

  await step(slider('Lightness'), 'decrement');

  await waitFor(() => expect(storedCustom()?.background.lightness).toBeLessThan(CUSTOM.background.lightness));
  const saved = storedCustom()!;
  expect(generateCustomRoles(saved).paper).not.toBe(generateCustomRoles(CUSTOM).paper);
  expect(screen.getByTestId('behind')).toHaveTextContent(generateCustomRoles(saved).paper);
  expect(screen.queryByText(/saved|next launch/i)).toBeNull();
});

it('saves a hue when the bar is let go, keeping the other parts', async () => {
  store(CUSTOM);
  mockPart = 'viz';
  render(<ThemeCustomRoute />);
  fireEvent(screen.getByTestId('theme-custom-hue-track'), 'layout', { nativeEvent: { layout: { width: 359 } } });

  await act(async () => drag(hueBar()).onEnd({ x: 90 }, true));

  await waitFor(() => expect(storedCustom()).toEqual({ ...CUSTOM, viz: { hue: 90, strength: 40 } }));
});

it('paints the hue bar in the part’s colours, words for VoiceOver only, and swatches the part as it would be drawn', () => {
  store(CUSTOM);
  mockPart = 'accent';
  render(<ThemeCustomRoute />);
  const paint = screen.getByTestId('theme-custom-hue-paint').props.children as { props: { style: unknown[] } }[];
  expect(paint).toHaveLength(36);
  const colours = paint.map((segment) => StyleSheet.flatten(segment.props.style).backgroundColor);
  expect(new Set(colours).size).toBeGreaterThan(30);
  expect(colours[0]).toBe(customSeed('accent', { hue: 5, strength: 100 }));
  expect(screen.queryByTestId('theme-custom-hue-value')).toBeNull();
  expect(screen.queryByText(/degrees|Red/)).toBeNull();
  const swatch = () => StyleSheet.flatten(screen.getByTestId('theme-custom-hue-swatch').props.style).backgroundColor;
  expect(swatch()).toBe(generateCustomRoles(CUSTOM).accent);

  act(() => drag(hueBar()).onUpdate({ x: 0 }));
  expect(swatch()).toBe(generateCustomRoles({ ...CUSTOM, accent: { hue: 0, strength: 70 } }).accent);
});

it('switches to another part from the title, and only closes the menu for the part already open', () => {
  store(CUSTOM);
  mockPart = 'text';
  render(<ThemeCustomRoute />);
  fireEvent.press(screen.getByRole('button', { name: 'Secondary text, switch colour' }));
  expect(screen.getByTestId('theme-custom-title-option-text').props.accessibilityState).toMatchObject({ checked: true });

  fireEvent.press(screen.getByTestId('theme-custom-title-option-text'));
  expect(mockSetParams).not.toHaveBeenCalled();

  fireEvent.press(screen.getByRole('button', { name: 'Secondary text, switch colour' }));
  fireEvent.press(screen.getByTestId('theme-custom-title-option-viz'));
  expect(mockSetParams).toHaveBeenCalledWith({ part: 'viz' });
});

it('spotlights every role the part moves, live as a control moves', () => {
  configure({ defaultIncludeHiddenElements: true });
  try {
    store(CUSTOM);
    render(<ThemeCustomRoute />);
    const tile = (index: number) => StyleSheet.flatten(screen.getByTestId(`theme-custom-spotlight-${index}`).props.style).backgroundColor;
    const roles = generateCustomRoles(CUSTOM);
    expect([0, 1, 4].map(tile)).toEqual([roles.paper, roles.surface, roles.viz0]);
    expect(screen.getByText('Divider')).toBeTruthy();

    fireEvent(screen.getByTestId('theme-custom-lightness-track'), 'layout', { nativeEvent: { layout: { width: 100 } } });
    act(() => drag(slider('Lightness')).onUpdate({ x: 20 }));
    expect(tile(0)).toBe(generateCustomRoles({ ...CUSTOM, background: { ...CUSTOM.background, lightness: 20 } }).paper);
  } finally {
    configure({ defaultIncludeHiddenElements: false });
  }
});

it('lists, for each part, only roles that part moves', () => {
  // A role a part moves changes by more than the sRGB rounding a shift of
  // the ink's L* by gamut carries into every role.
  const channels = (colour: string) =>
    colour.startsWith('#') ? [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16)) : (colour.match(/[\d.]+/g) ?? []).map(Number);
  const differs = (a: string, b: string) => channels(a).some((value, index) => Math.abs(value - channels(b)[index]) > 6);
  const moved = (part: CustomPart) => {
    const before = generateCustomRoles(CUSTOM);
    const shifted = { ...CUSTOM, [part]: { ...CUSTOM[part], hue: (CUSTOM[part].hue + 120) % 360, strength: 100 } };
    const after = generateCustomRoles(shifted);
    return new Set((Object.keys(before) as (keyof typeof before)[]).filter((role) => before[role] !== after[role] && differs(before[role], after[role])));
  };
  CUSTOM_PARTS.forEach((part) => {
    const roles = SPOTLIGHT[part].flatMap((sample) => (sample.kind === 'fill' ? [sample.role] : [sample.role, sample.ground]));
    // Each sample but a context one draws at least one role of its own part.
    SPOTLIGHT[part].filter((sample) => !sample.context).forEach((sample) => {
      const own = sample.kind === 'fill' ? [sample.role] : [sample.role, sample.ground];
      expect({ part, sample: sample.label, moves: own.some((role) => moved(part).has(role)) }).toEqual({ part, sample: sample.label, moves: true });
    });
    // And every role the part moves is among them.
    expect({ part, missing: [...moved(part)].filter((role) => !roles.includes(role)) }).toEqual({ part, missing: [] });
  });
});

it('shows the applying indicator from a save until the app is drawn in it', async () => {
  store(CUSTOM);
  let finish: () => void = () => undefined;
  const setItem = jest.spyOn(Storage, 'setItem');
  setItem.mockImplementationOnce((key, value) => new Promise<void>((resolve) => {
    finish = () => {
      Storage.setItemSync(key, value as string);
      resolve();
    };
  }));
  renderWithTheme(<ThemeCustomRoute />);
  expect(screen.queryByTestId('theme-custom-applying')).toBeNull();

  await step(slider('Strength'), 'increment');
  expect(screen.getByRole('progressbar', { name: 'Applying the theme' })).toBeTruthy();

  // The save is queued behind earlier ones: let it reach the store first.
  await waitFor(() => expect(Storage.setItem).toHaveBeenCalled());
  expect(screen.getByRole('progressbar', { name: 'Applying the theme' })).toBeTruthy();
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByTestId('theme-custom-applying')).toBeNull());
  expect(storedCustom()?.background.strength).toBe(25);
});

it('opens Primary text with a hue and strength only, and saves it as `ink`', async () => {
  store(CUSTOM);
  mockPart = 'ink';
  render(<ThemeCustomRoute />);
  expect(mockTitles).toContain('Primary text');
  expect(hueBar().props.accessibilityValue).toEqual({ text: 'Blue, 265 degrees' });
  expect(screen.queryByRole('adjustable', { name: 'Lightness' })).toBeNull();

  await step(slider('Strength'), 'increment');

  await waitFor(() => expect(storedCustom()).toEqual({ ...CUSTOM, ink: { hue: 265, strength: 35 } }));
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
