import { screen } from '@testing-library/react-native';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import type { ReactElement } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { Circle, Ellipse, Line, Path, Polyline, Rect } from 'react-native-svg';

import { FilterChip } from '@/components/exercise-catalog/exercise-list-controls';
import { GymPickerButton } from '@/components/gyms/gym-picker';
import { DailyHeatmap, TimelineHeatmap, WeeklyHeatmap, buildHeatmapData } from '@/components/heatmaps';
import { HeatmapLegend } from '@/components/heatmaps/HeatmapLegend';
import { RmCurveContent, type CurveScope } from '@/components/rm-curve/content';
import { Card } from '@/components/ui/card';
import { ChipGroup } from '@/components/ui/chip-group';
import { FormField } from '@/components/ui/form-field';
import { FormError } from '@/components/ui/form-section';
import { contrastRatio } from '@/components/ui/lch';
import { PageRefreshControl } from '@/components/ui/page-refresh-control';
import { pageWordColour, selectedPill } from '@/components/ui/text-roles';
import { generateRoles, type UiRoles } from '@/components/ui/theme';
import { customFromSeeds, generateCustomRoles } from '@/components/ui/theme-custom';
import { seedsFromHue } from '@/components/ui/theme-hue';
import { themePresets, type AppearanceChoice } from '@/components/ui/theme-presets';
import type { DailyEffortMetrics } from '@/src/data';
import { loadRmCurve } from '@/src/rm-curve/repository';

import wave from './fixtures/rm-curve-weekly-wave.json';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { seedWaveHistory } from './helpers/rm-curve-history';
import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

// Every word and glyph drawn straight on the page clears its floor there
// (`design-language.md` §2): 4.5:1 for words, 3:1 for faint words (legends,
// ticks), a glyph or a mark. On
// Ink + paper the page is dark under light cards, so a word in a card ink or
// a coloured role vanishes on it. Each surface below is drawn on the page in
// Ink + paper, and each word and glyph whose ground is the page — no view with
// a background of its own between it and the page — is read back against it.
// (A mark on a card, a cell or a track sits on that ground, which the preset
// gates hold.)

const INK_PAPER: AppearanceChoice = { theme: 'ink-paper', mode: 'light', custom: null };
const WARM: AppearanceChoice = { theme: 'warm', mode: 'light', custom: null };
const roles = (): UiRoles => rolesFor(INK_PAPER);
const MODES = ['light', 'dark'] as const;
const OTHER_PRESETS = themePresets.filter((preset) => preset.ladder === undefined);

const HEX = /^#[0-9A-F]{6}$/i;
const SHAPES = [Path, Rect, Circle, Line, Ellipse, Polyline];

// Host nodes: what the renderer draws, whichever component drew it.
const hostNodes = (type: 'Text' | 'View') => screen.UNSAFE_root.findAll((node) => (node.type as unknown) === type);

// The ground behind a node: the nearest ancestor view with an opaque background.
function groundOf(node: ReactTestInstance, page: string): string {
  for (let at: ReactTestInstance | null = node.parent; at; at = at.parent) {
    if ((at.type as unknown) !== 'View') continue;
    const background = StyleSheet.flatten(at.props.style)?.backgroundColor;
    if (typeof background === 'string' && HEX.test(background)) return background;
  }
  return page;
}

// A text's colour: its own, else the one it inherits from an enclosing text.
function colourOf(node: ReactTestInstance): string | undefined {
  for (let at: ReactTestInstance | null = node; at; at = at.parent) {
    if ((at.type as unknown) !== 'Text') continue;
    const colour = StyleSheet.flatten(at.props.style)?.color;
    if (typeof colour === 'string') return colour;
  }
  return undefined;
}

/** Every word and glyph on the page below its floor there, as `text: colour on ground`. */
function belowFloor(): string[] {
  const page = roles().paper;
  const words = hostNodes('Text')
    .filter((node) => node.children.some((child) => typeof child === 'string' && child.trim()))
    .map((node) => {
      const colour = colourOf(node);
      // The faint inks are the 3:1 tier: legends, ticks, planned values.
      const floor = colour === roles().pageInkFaint || colour === roles().inkFaint ? 3 : 4.5;
      return { what: node.children.filter((child) => typeof child === 'string').join(''), colour, ground: groundOf(node, page), floor };
    });
  const glyphs = SHAPES.flatMap((shape) => screen.UNSAFE_queryAllByType(shape as never))
    .flatMap((node) => [node.props.stroke, node.props.fill]
      .filter((paint): paint is string => typeof paint === 'string' && HEX.test(paint))
      .map((colour) => ({ what: `${String((node.type as { displayName?: string }).displayName ?? 'shape')}`, colour, ground: groundOf(node, page), floor: 3 })));
  // A mark drawn as a thin view: a tick, a reference line, a rule.
  const marks = hostNodes('View')
    .filter((node) => {
      const style = StyleSheet.flatten(node.props.style) ?? {};
      return typeof style.backgroundColor === 'string' && HEX.test(style.backgroundColor)
        && ((typeof style.width === 'number' && style.width <= 2) || (typeof style.height === 'number' && style.height <= 2));
    })
    .map((node) => ({ what: 'mark', colour: StyleSheet.flatten(node.props.style)?.backgroundColor as string, ground: groundOf(node, page), floor: 3 }));
  return [...words, ...glyphs, ...marks]
    .filter(({ ground }) => ground === page)
    .filter(({ colour, ground, floor }) => colour !== undefined && HEX.test(colour) && contrastRatio(colour, ground) < floor)
    .map(({ what, colour, ground }) => `${what}: ${colour} on ${ground}`);
}

beforeEach(async () => {
  await switchTheme(INK_PAPER);
});

describe('the page-safe colours', () => {
  it('keep a coloured word’s own colour, and a selected pill’s `ink`, in every other preset, every hue theme and custom theme', () => {
    const others = MODES.flatMap((mode) => [
      ...OTHER_PRESETS.map((preset) => rolesFor({ theme: preset.id, mode, custom: null })),
      ...Array.from({ length: 360 }, (_, hue) => generateRoles(seedsFromHue(hue), mode)),
      ...themePresets.map((preset) => generateCustomRoles(customFromSeeds(preset.seeds, mode))),
    ]);
    const moved = others.filter((each) =>
      [each.danger, each.accent, each.record].some((colour) => pageWordColour(each, colour) !== colour)
      || JSON.stringify(selectedPill(each, 'page')) !== JSON.stringify({ fill: each.ink, label: each.onInk, edge: 'ink' }));
    expect(moved).toEqual([]);
  });

  it('draws Ink + paper’s coloured words on the page in the page ink, and outlines its selected `ink` pill in the page ink', () => {
    for (const colour of [roles().danger, roles().accent, roles().record]) expect(pageWordColour(roles(), colour)).toBe(roles().pageInk);
    const pill = selectedPill(roles(), 'page');
    expect(pill).toEqual({ fill: roles().ink, label: roles().onInk, edge: 'pageInk' });
    expect(contrastRatio(roles()[pill.edge], roles().paper)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(pill.label, pill.fill)).toBeGreaterThanOrEqual(4.5);
    // Told apart from an unselected `surface` pill.
    expect(contrastRatio(pill.fill, roles().surface)).toBeGreaterThanOrEqual(3);
  });
});

describe('an error line', () => {
  it('reads on the page behind a warning sign, and stays `danger` on a card', () => {
    renderWithTheme(
      <View>
        <FormError message="Couldn’t start the workout." testID="on-page" textRole="bodyStrong" />
        <Card><FormError message="Name is required." testID="on-card" /></Card>
      </View>,
    );
    expect(belowFloor()).toEqual([]);
    expect(StyleSheet.flatten(screen.getByTestId('on-page').props.style).color).toBe(roles().pageInk);
    expect(StyleSheet.flatten(screen.getByTestId('on-card').props.style).color).toBe(roles().danger);
    expect(screen.UNSAFE_queryAllByProps({ name: 'warning' })).toHaveLength(1);
  });

  it.each(MODES.flatMap((mode) => OTHER_PRESETS.map((preset) => [preset.id, mode] as const)))(
    'is `danger` with no sign on the page of %s in %s mode',
    async (theme, mode) => {
      const choice: AppearanceChoice = { theme, mode, custom: null };
      await switchTheme(choice);
      renderWithTheme(<FormError message="Not saved" testID="error" />);
      expect(StyleSheet.flatten(screen.getByTestId('error').props.style).color).toBe(rolesFor(choice).danger);
      expect(screen.UNSAFE_queryAllByProps({ name: 'warning' })).toHaveLength(0);
    },
  );

  it('under a field on the page reads too', () => {
    renderWithTheme(<FormField error="Use a whole number." label="Reps" onChangeText={jest.fn()} testID="reps" value="x" />);
    expect(belowFloor()).toEqual([]);
  });
});

describe('the history heatmap pages', () => {
  const TODAY = '2026-05-13';
  const day = (dateKey: string, totalVolume: number, prs = 0): DailyEffortMetrics => ({
    dateKey, totalVolume, workingSetCount: 2, estimatedRM1: 95, highestWeight: 80,
    personalRecordCounts: { totalVolume: prs, estimatedRM1: 0, highestWeight: 0 },
  } as DailyEffortMetrics);
  const days = [day('2026-03-02', 900), day('2026-03-16', 1500, 1), day('2026-04-06', 300), day('2026-04-20', 1100), day('2026-05-04', 400), day('2026-05-11', 1200, 2), day(TODAY, 800)];
  const data = buildHeatmapData(days, 'totalVolume', { todayDateKey: TODAY });
  const weekly = data.weekly.filter((week) => week.weekStartDateKey <= TODAY);

  it.each([
    ['Timeline', <TimelineHeatmap key="t" data={data} formatValue={String} metric="totalVolume" metricLabel="Volume" onSelectWeek={jest.fn()}
      selectedWeekKey={weekly.at(-1)!.weekStartDateKey} testIDPrefix="ink" unitLabel={() => 'kg'} />],
    ['Grid', <DailyHeatmap key="d" data={data} formatValue={String} metricLabel="Volume" testIDPrefix="ink" />],
    ['Weekly', <WeeklyHeatmap key="w" data={data} formatValue={String} metric="totalVolume" metricLabel="Volume" testIDPrefix="ink" />],
    ['the legend', <HeatmapLegend key="l" />],
  ] as [string, ReactElement][])('draws %s on the page in the page inks', (_name, view) => {
    renderWithTheme(view);
    expect(hostNodes('Text').length).toBeGreaterThan(0);
    expect(belowFloor()).toEqual([]);
  });
});

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockFixture.database }));

describe('the Timeline’s focused week', () => {
  const data = buildHeatmapData([{ dateKey: '2026-05-11', totalVolume: 1200, workingSetCount: 2, estimatedRM1: 95, highestWeight: 80 } as DailyEffortMetrics],
    'totalVolume', { todayDateKey: '2026-05-13' });
  const timeline = () => (
    <TimelineHeatmap data={data} formatValue={String} metric="totalVolume" metricLabel="Volume" onSelectWeek={jest.fn()}
      selectedWeekKey="2026-05-11" testIDPrefix="focus" unitLabel={() => 'kg'} />
  );
  // The SVG elements' own props: the host nodes hold processed colours.
  const shape = (type: typeof Path | typeof Rect, testID: string) =>
    screen.UNSAFE_queryAllByType(type as never).find((node) => node.props.testID === testID);
  const focusedBar = () => shape(Path, 'focus-timeline-bar-2026-05-11')?.props.fill;

  it('draws its bar in the page ink with no band on Ink + paper, where the band would hide it', () => {
    renderWithTheme(timeline());
    expect(focusedBar()).toBe(roles().pageInk);
    expect(shape(Rect, 'focus-timeline-selected')).toBeUndefined();
  });

  it('keeps the `ruleSoft` band behind an `ink` bar in every other preset', async () => {
    await switchTheme(WARM);
    renderWithTheme(timeline());
    expect(focusedBar()).toBe(rolesFor(WARM).ink);
    expect(shape(Rect, 'focus-timeline-selected')?.props.fill).toBe(rolesFor(WARM).ruleSoft);
  });
});

describe('the RM curve’s count lines', () => {
  beforeEach(() => { mockFixture = createInMemoryDatabase(); seedWaveHistory(mockFixture.database); });
  afterEach(() => { mockFixture.close(); });

  it('draw on the page in the page inks', async () => {
    const model = (await loadRmCurve({ exerciseDefinitionId: 'curve', start: new Date(wave.scenarios.plateau[0].startedAt),
      end: new Date(wave.scenarios.plateau.at(-1)!.completedAt + 1), historyLookbackWeeks: 52, gym: { gymId: 'synthetic-gym' } }))!;
    const scope: CurveScope = { range: 'history', gym: { gymId: 'synthetic-gym' }, rir: null };
    renderWithTheme(<RmCurveContent dateFormat="YYYY-MM-DD" historyWeeks={52} onScope={jest.fn()} progressWeeks={4}
      read={{ status: 'ready', data: model, retry: jest.fn() }} scope={scope} />);
    expect(screen.getByText(/\d+ sets · \d+ sessions/)).toBeTruthy();
    expect(belowFloor()).toEqual([]);
  });
});

describe('a selected chip on the page', () => {
  const styleOf = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style) ?? {};
  const pills = (fill: string) => hostNodes('View').filter((node) => styleOf(node).backgroundColor === fill);

  it.each([
    ['ChipGroup', <ChipGroup key="c" mode="single" onChange={jest.fn()} options={[{ value: 'a', label: 'All' }, { value: 'b', label: 'Mine' }]} testIDPrefix="chips" value="a" />],
    ['FilterChip', (
      <View key="f">
        <FilterChip accessibilityLabel="Chest" accessibilityRole="button" label="Chest" on onPress={jest.fn()} testID="on" />
        <FilterChip accessibilityLabel="Back" accessibilityRole="button" label="Back" on={false} onPress={jest.fn()} testID="off" />
      </View>
    )],
  ] as [string, ReactElement][])('is an outlined `ink` pill among `surface` ones: %s', (_name, view) => {
    renderWithTheme(view);
    expect(belowFloor()).toEqual([]);
    const [selected] = pills(roles().ink);
    const [unselected] = pills(roles().surface);
    expect(contrastRatio(styleOf(selected).borderColor as string, roles().paper)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(roles().ink, styleOf(unselected).backgroundColor as string)).toBeGreaterThanOrEqual(3);
  });

  it('keeps a compact gym chip’s label and chevron readable on its pill', () => {
    renderWithTheme(<GymPickerButton onPress={jest.fn()} options={[{ gymId: 'g1', name: 'Home' }, { gymId: 'g2', name: 'Club' }]} size="compact" testID="gym" value="g1" />);
    expect(belowFloor()).toEqual([]);
    expect(contrastRatio(styleOf(pills(roles().ink)[0]).borderColor as string, roles().paper)).toBeGreaterThanOrEqual(3);
  });
});

describe('pull to refresh', () => {
  it('turns its spinner in the page’s muted ink', () => {
    renderWithTheme(<PageRefreshControl onRefresh={jest.fn()} refreshing />);
    const control = screen.UNSAFE_getByType(RefreshControl);
    expect(control.props.tintColor).toBe(roles().pageInkMuted);
    expect(contrastRatio(control.props.tintColor, roles().paper)).toBeGreaterThanOrEqual(3);
  });

  it('passes on the style and the scroll view Android’s ScrollView clones into it', () => {
    renderWithTheme(
      <PageRefreshControl onRefresh={jest.fn()} refreshing={false} style={{ flex: 1 }}>
        <View testID="scroll-content" />
      </PageRefreshControl>,
    );
    const control = screen.UNSAFE_getByType(RefreshControl);
    expect(control.props.style).toEqual({ flex: 1 });
    expect(control.props.children.props.testID).toBe('scroll-content');
  });

  it('is offered only through `PageRefreshControl`', () => {
    const root = join(__dirname, '..');
    const files = ['app', 'components', 'src'].flatMap((dir) => sources(join(root, dir)));
    const direct = files
      .filter((file) => !relative(root, file).startsWith('components/ui/'))
      .filter((file) => /<RefreshControl\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file));
    expect(direct).toEqual([]);
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}
