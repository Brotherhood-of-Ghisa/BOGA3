import { render, screen } from '@testing-library/react-native';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { Circle, Path } from 'react-native-svg';

import { ICON_GLYPHS } from '@/components/ui/icon-glyphs';
import { Icon, type IconName, uiIconSize, uiRoles } from '@/components/ui';

const ICON_NAMES = Object.keys(ICON_GLYPHS) as IconName[];

describe('Icon', () => {
  it.each(ICON_NAMES)('draws %s on the 24 grid at every size', (name) => {
    for (const size of Object.keys(uiIconSize) as (keyof typeof uiIconSize)[]) {
      const { unmount } = render(<Icon name={name} size={size} testID="icon" />);
      const box = screen.getByTestId('icon', { includeHiddenElements: true });
      expect(box).toHaveStyle({ width: uiIconSize[size], height: uiIconSize[size] });
      unmount();
    }
    expect(ICON_GLYPHS[name].length).toBeGreaterThan(0);
  });

  it('is hidden from assistive tech unless it carries its own label', () => {
    render(<Icon name="check" testID="decorative" />);
    expect(screen.queryByTestId('decorative')).toBeNull();
    const hidden = screen.getByTestId('decorative', { includeHiddenElements: true });
    expect(hidden.props.accessible).toBe(false);
    expect(screen.queryByRole('image')).toBeNull();

    render(<Icon label="Certified" name="check" />);
    expect(screen.getByRole('image', { name: 'Certified' })).toBeTruthy();
  });

  it('paints in the given role colour, defaulting to ink', () => {
    const { UNSAFE_getAllByType, rerender } = render(<Icon name="x" />);
    expect(UNSAFE_getAllByType(Path).map((path) => path.props.stroke)).toEqual([uiRoles.ink, uiRoles.ink]);

    rerender(<Icon color={uiRoles.danger} name="x" />);
    expect(UNSAFE_getAllByType(Path).map((path) => path.props.stroke)).toEqual([uiRoles.danger, uiRoles.danger]);
  });

  // design-language §5: filled check = done, accent ring = current, dashed
  // ring = planned.
  it('gives the set-state glyphs their design-language colours', () => {
    const done = render(<Icon name="set-done" />);
    const [disc] = done.UNSAFE_getAllByType(Circle);
    expect(disc.props).toMatchObject({ fill: uiRoles.ink, stroke: uiRoles.ink });
    expect(done.UNSAFE_getAllByType(Path)[0].props.stroke).toBe(uiRoles.surface);
    done.unmount();

    const current = render(<Icon name="set-current" />);
    expect(current.UNSAFE_getAllByType(Circle)[0].props).toMatchObject({
      fill: 'none',
      stroke: uiRoles.accent,
    });
    current.unmount();

    const planned = render(<Icon name="set-planned" />);
    const arcs = planned.UNSAFE_getAllByType(Path);
    expect(arcs).toHaveLength(8);
    expect(arcs.every((arc) => arc.props.stroke === uiRoles.planned)).toBe(true);
  });
});

// The glyphs the icon set retired (2026-09-22) must not come back as `Text`
// icons. `×` and `−` are not here: they are the multiplication and minus signs
// inside figures ("100 kg × 5", "−12%"), not icons. Comments are skipped.
describe('retired Unicode glyphs stay retired', () => {
  const RETIRED = /[›⋮▾▼★●○↗↑↓⚙✓≡]|👤/u;
  const APP_ROOT = join(__dirname, '..', '..');

  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        return entry === '__tests__' || entry === 'node_modules' ? [] : sourceFiles(full);
      }
      return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
    });

  it('finds no retired glyph outside comments in app, components or src', () => {
    const offenders = ['app', 'components', 'src']
      .flatMap((dir) => sourceFiles(join(APP_ROOT, dir)))
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
