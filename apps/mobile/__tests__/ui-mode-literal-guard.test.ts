import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

// Every screen draws in the mode the app is drawn in now
// (`docs/specs/ui/ux-rules.md` "Appearance"). A colour comes from a role and a
// native surface's mode from `useUiMode()` (`components/ui/theme-context.tsx`),
// so nothing outside the theme files may fix either: no hex, rgb, hsl or named
// colour literal, no literal `themeVariant`, status-bar style,
// `keyboardAppearance` or alert `userInterfaceStyle`. And only
// `theme-native.ts` reads, follows or pins the phone's mode: anything else
// would see the pin, or follow the phone while the app is pinned.

const MOBILE_ROOT = join(__dirname, '..');
const SCANNED = ['app', 'components', 'src'];
// The files that hold the seeds and the fixed role values, and the one that
// reads, follows and pins the phone's mode.
const THEME_FILES = new Set([
  'components/ui/theme.ts',
  'components/ui/theme-presets.ts',
  'components/ui/theme-hue.ts',
]);
const OS_MODE_READER = 'components/ui/theme-native.ts';

const COLOUR_LITERAL =
  /['"`]#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})['"`]|(?:rgba?|hsla?)\(\s*\d{1,3}\s*,|\b(?:\w*[cC]olor|fill|stroke)(?::\s*|=\{?\s*)['"`](?:white|black)['"`]/g;
// A prop given a string literal: `prop="x"`, `prop='x'` or `prop={'x'}`.
const literalProp = (prop: string) => new RegExp(`\\b${prop}=(?:"|'|\\{\\s*['"\`])`, 'g');
const RULES: { name: string; pattern: RegExp; exempt: (path: string) => boolean }[] = [
  { name: 'a colour literal', pattern: COLOUR_LITERAL, exempt: (path) => THEME_FILES.has(path) },
  { name: 'a literal `themeVariant`', pattern: literalProp('themeVariant'), exempt: () => false },
  { name: 'a literal `keyboardAppearance`', pattern: literalProp('keyboardAppearance'), exempt: () => false },
  { name: 'a literal status-bar `style`', pattern: /<StatusBar\b[^>]*?\bstyle=(?:"|'|\{\s*['"`])/g, exempt: () => false },
  { name: 'a literal status-bar `barStyle`', pattern: literalProp('barStyle'), exempt: () => false },
  { name: 'a fixed status-bar call', pattern: /\bsetStatusBarStyle\(\s*['"`]|\bStatusBar\.setBarStyle\(\s*['"`]/g, exempt: () => false },
  { name: 'a fixed alert or action-sheet style', pattern: /\buserInterfaceStyle:\s*['"`](?:light|dark)['"`]/g, exempt: () => false },
  {
    name: 'a read of the OS mode',
    pattern: /\buseColorScheme\b|\bAppearance\.(?:getColorScheme|addChangeListener|setColorScheme)\b/g,
    exempt: (path) => path === OS_MODE_READER,
  },
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

function offences(path: string, source: string): string[] {
  return RULES.filter((rule) => !rule.exempt(path)).flatMap((rule) =>
    [...source.matchAll(rule.pattern)].map(
      (match) => `${path}:${source.slice(0, match.index).split('\n').length} — ${rule.name}`,
    ),
  );
}

describe('no light-only literal outside the theme files', () => {
  it('holds across app/, components/ and src/', () => {
    const found = SCANNED.flatMap((directory) => sourceFiles(join(MOBILE_ROOT, directory))).flatMap((path) =>
      offences(relative(MOBILE_ROOT, path).split('\\').join('/'), readFileSync(path, 'utf8')),
    );
    expect(found).toEqual([]);
  });

  it.each([
    ['a fixed date-picker variant', '<DateTimePicker themeVariant="light" value={date} />'],
    ['a fixed date-picker variant in braces', "<DateTimePicker themeVariant={'dark'} />"],
    ['a fixed status bar', '<StatusBar style="dark" />'],
    ['a fixed keyboard', '<TextInput keyboardAppearance="light" />'],
    ['a hex colour', "export const MOUSTACHE_FILL = '#393938';"],
    ['a short hex colour', 'const ink = "#000";'],
    ['an rgb colour', "backgroundColor: 'rgba(0, 0, 0, 0.5)',"],
    ['an hsl colour', "color: 'hsl(30, 10%, 20%)',"],
    ['a named colour', "<Icon color=\"white\" name=\"check\" />"],
    ['a named colour in braces', "borderColor: 'black',"],
    ['a fixed RN status bar', '<StatusBar barStyle="dark-content" />'],
    ['a fixed status-bar call', "setStatusBarStyle('dark');"],
    ['a fixed RN status-bar call', "StatusBar.setBarStyle('light-content');"],
    ['a fixed alert style', "Alert.alert('Title', 'Message', [], { userInterfaceStyle: 'light' });"],
    ['a colour-scheme hook', 'const scheme = useColorScheme();'],
    ['an OS mode listener', 'Appearance.addChangeListener(() => {});'],
  ])('rejects %s', (_name, source) => {
    expect(offences('components/example.tsx', source)).not.toEqual([]);
  });

  it.each([
    ['a mode-following date picker', '<DateTimePicker themeVariant={mode} value={date} />'],
    ['a mode-following status bar', '<StatusBar style={statusBarStyleFor(mode)} />'],
    ['a role', 'backgroundColor: roles.paper,'],
    ['an id that is not a colour', "const href = `#${definitionId}`;"],
    ['a swatch id that names a colour', "{ id: 'white', label: 'White', hue: 0, chroma: 0 },"],
    ['the config value named in a comment', '// `userInterfaceStyle: "automatic"` (`app.config.ts`)'],
  ])('allows %s', (_name, source) => {
    expect(offences('components/example.tsx', source)).toEqual([]);
  });

  it('lets the theme files hold the seeds, and theme-native read and pin the OS mode', () => {
    expect(offences('components/ui/theme.ts', "selection: '#000000',")).toEqual([]);
    expect(offences(OS_MODE_READER, 'const osScheme = Appearance.getColorScheme();')).toEqual([]);
    expect(offences(OS_MODE_READER, "Appearance.setColorScheme?.('unspecified');")).toEqual([]);
    expect(offences('components/ui/theme-launch.ts', 'const osScheme = Appearance.getColorScheme();')).not.toEqual([]);
  });
});
