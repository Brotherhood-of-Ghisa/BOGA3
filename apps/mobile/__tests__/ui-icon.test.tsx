import { screen } from '@testing-library/react-native';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { Circle, Path } from 'react-native-svg';

import { ICON_GLYPHS } from '@/components/ui/icon-glyphs';
import { DEFAULT_APPEARANCE } from '@/components/ui/theme-presets';
import { Icon, type IconName, uiIconSize } from '@/components/ui';

import { requireWithReactCompiler } from './helpers/react-compiler';
import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

const roles = rolesFor(DEFAULT_APPEARANCE);

const ICON_NAMES = Object.keys(ICON_GLYPHS) as IconName[];

describe('Icon', () => {
  it.each(ICON_NAMES)('draws %s on the 24 grid at every size', (name) => {
    for (const size of Object.keys(uiIconSize) as (keyof typeof uiIconSize)[]) {
      const { unmount } = renderWithTheme(<Icon name={name} size={size} testID="icon" />);
      const box = screen.getByTestId('icon', { includeHiddenElements: true });
      expect(box).toHaveStyle({ width: uiIconSize[size], height: uiIconSize[size] });
      unmount();
    }
    expect(ICON_GLYPHS[name].length).toBeGreaterThan(0);
  });

  it('is hidden from assistive tech unless it carries its own label', () => {
    renderWithTheme(<Icon name="check" testID="decorative" />);
    expect(screen.queryByTestId('decorative')).toBeNull();
    const hidden = screen.getByTestId('decorative', { includeHiddenElements: true });
    expect(hidden.props.accessible).toBe(false);
    expect(screen.queryByRole('image')).toBeNull();

    renderWithTheme(<Icon label="Certified" name="check" />);
    expect(screen.getByRole('image', { name: 'Certified' })).toBeTruthy();
  });

  it('paints in the given role colour, defaulting to ink', () => {
    const { UNSAFE_getAllByType, rerender } = renderWithTheme(<Icon name="x" />);
    expect(UNSAFE_getAllByType(Path).map((path) => path.props.stroke)).toEqual([roles.ink, roles.ink]);

    rerender(<Icon color={roles.danger} name="x" />);
    expect(UNSAFE_getAllByType(Path).map((path) => path.props.stroke)).toEqual([roles.danger, roles.danger]);
  });

  it('paints in a role named by `colorRole`, which wins over the glyph\'s own', () => {
    const { UNSAFE_getAllByType, rerender } = renderWithTheme(<Icon name="x" colorRole="inkMuted" />);
    expect(UNSAFE_getAllByType(Path).map((path) => path.props.stroke)).toEqual([roles.inkMuted, roles.inkMuted]);

    rerender(<Icon name="set-current" colorRole="danger" />);
    expect(UNSAFE_getAllByType(Circle)[0].props.stroke).toBe(roles.danger);
  });

  // The Icon colour pattern: a call site names the role, and the icon reads
  // the roles itself, so it repaints with the theme. Compiled as the device
  // runs it, so a cached read would show here.
  it('repaints its role, its glyph default and its knockout when the theme is saved', async () => {
    const { Icon: CompiledIcon } = requireWithReactCompiler<typeof import('@/components/ui/icon')>('components/ui/icon.tsx');
    const slateDark = { theme: 'slate', mode: 'dark', custom: null } as const;
    const slate = rolesFor(slateDark);
    const { UNSAFE_getAllByType } = renderWithTheme(
      <>
        <CompiledIcon name="x" colorRole="accent" />
        <CompiledIcon name="set-done" />
      </>,
    );
    expect(UNSAFE_getAllByType(Path)[0].props.stroke).toBe(roles.accent);

    await switchTheme(slateDark);
    const [cross, , tick] = UNSAFE_getAllByType(Path);
    expect(cross.props.stroke).toBe(slate.accent);
    expect(UNSAFE_getAllByType(Circle)[0].props).toMatchObject({ fill: slate.ink, stroke: slate.ink });
    expect(tick.props.stroke).toBe(slate.onInk);
  });

  // design-language §5: filled check = done, accent ring = current, dashed
  // ring = planned.
  it('gives the set-state glyphs their design-language colours', () => {
    const done = renderWithTheme(<Icon name="set-done" />);
    const [disc] = done.UNSAFE_getAllByType(Circle);
    expect(disc.props).toMatchObject({ fill: roles.ink, stroke: roles.ink });
    expect(done.UNSAFE_getAllByType(Path)[0].props.stroke).toBe(roles.surface);
    done.unmount();

    const current = renderWithTheme(<Icon name="set-current" />);
    expect(current.UNSAFE_getAllByType(Circle)[0].props).toMatchObject({
      fill: 'none',
      stroke: roles.accent,
    });
    current.unmount();

    const planned = renderWithTheme(<Icon name="set-planned" />);
    const arcs = planned.UNSAFE_getAllByType(Path);
    expect(arcs).toHaveLength(8);
    expect(arcs.every((arc) => arc.props.stroke === roles.inkGhost)).toBe(true);
  });
});

const APP_ROOT = join(__dirname, '..');
const UI_DIRS = ['app', 'components', 'src'];

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' || entry === 'node_modules' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const uiSources = (): string[] => UI_DIRS.flatMap((dir) => sourceFiles(join(APP_ROOT, dir)));

// The glyphs the icon set retired (2026-09-22) must not come back as `Text`
// icons. `×` and `−` are not here: they are the multiplication and minus signs
// inside figures ("100 kg × 5", "−12%"), not icons. Comments are skipped.
describe('retired Unicode glyphs stay retired', () => {
  const RETIRED = /[›⋮▾▼★●○↗↑↓⚙✓≡]|👤/u;

  it('finds no retired glyph outside comments in app, components or src', () => {
    const offenders = uiSources()
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line) && RETIRED.test(line))
          .map(({ line, index }) => `${relative(APP_ROOT, file)}:${index + 1}: ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });
});

// design-language §"One superlative: `record`": a PR figure is carried by its
// bold `record` colour (and the band on cards that have one), never by a mark
// beside the number. The arrow the record surfaces used to draw was removed
// (2026-10-17); `arrow-up` stays available for reordering controls and trends,
// which are `ink`.
describe('no record figure draws a mark beside the number', () => {
  // Every `<Icon ... />` element, self-closing and possibly spanning lines.
  const ICON_ELEMENT = /<Icon\b[\s\S]*?\/>/g;

  // `name="arrow-up"` and `name={'arrow-up'}` both; `color` as the role or
  // through the `record` text style.
  const ARROW_NAME = /name=\{?['"]arrow-/;
  const RECORD_COLOUR = /roles\.record\b|colorRole="record"|record\.color\b/;

  it('pairs a record colour with no arrow glyph in app, components or src', () => {
    const offenders = uiSources().flatMap((file) =>
      (readFileSync(file, 'utf8').match(ICON_ELEMENT) ?? [])
        .filter((element) => RECORD_COLOUR.test(element) && ARROW_NAME.test(element))
        .map((element) => `${relative(APP_ROOT, file)}: ${element.replace(/\s+/g, ' ')}`),
    );
    expect(offenders).toEqual([]);
  });
});
