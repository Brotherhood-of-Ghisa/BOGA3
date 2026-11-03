import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

// `surface` is a ground — cards, sheets, inputs — never a foreground
// (`docs/specs/ui/design-language.md` §2, "`surface` is a ground, never a
// foreground"). A label, glyph, ring or stroke drawn on a filled role takes
// that fill's on-colour role
// (`onAccent`, `onSelection`, `onDanger`, `onInk`), so a ground that stops being
// white cannot make it vanish. Every `surface` in `app/` and `components/`
// must therefore paint a ground: a `backgroundColor`, a shape's `fill`, or the
// `surface` key of a role set handed on. Anything else — `color`, `stroke`,
// `tintColor`, `borderColor`, an SVG text's `fill`, or an alias the key cannot
// be read from — fails here.

const MOBILE_ROOT = join(__dirname, '..');
const SCANNED = ['app', 'components'];
const SURFACE = /\b(?:uiRoles|roles)\.surface\b/g;
// The prop or style key a value is set on: `key: value` or `prop={value}`. A
// ternary's ` : ` has a space before the colon, so it is not a key.
const KEY = /([A-Za-z_]\w*)(?::\s|=\{)/g;
const GROUND_KEYS = new Set(['backgroundColor', 'fill', 'surface']);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

// Why one use of `surface` is not a ground, or null when it is.
function foregroundUse(source: string, index: number): string | null {
  const lineStart = source.lastIndexOf('\n', index) + 1;
  const keys = [...source.slice(lineStart, index).matchAll(KEY)];
  const key = keys.at(-1)?.[1];
  if (key === undefined) return 'no style key or prop on its line';
  if (!GROUND_KEYS.has(key)) return `set on \`${key}\``;
  if (key === 'fill') {
    const tag = [...source.slice(0, index).matchAll(/<([A-Za-z][\w.]*)/g)].at(-1)?.[1] ?? '';
    if (/Text$/.test(tag)) return `the fill of \`<${tag}>\`, which is its text colour`;
  }
  return null;
}

function foregroundUses(source: string): { line: number; reason: string }[] {
  return [...source.matchAll(SURFACE)].flatMap((match) => {
    const reason = foregroundUse(source, match.index!);
    return reason === null ? [] : [{ line: source.slice(0, match.index).split('\n').length, reason }];
  });
}

describe('`surface` is never a foreground', () => {
  it('paints only grounds across app/ and components/', () => {
    const offences = SCANNED.flatMap((directory) => sourceFiles(join(MOBILE_ROOT, directory))).flatMap((path) =>
      foregroundUses(readFileSync(path, 'utf8')).map(
        ({ line, reason }) => `${relative(MOBILE_ROOT, path)}:${line} — ${reason}`,
      ),
    );
    expect(offences).toEqual([]);
  });

  it.each([
    ['a text colour', 'labelOn: {\n    color: uiRoles.surface,\n  },'],
    ['a glyph colour', '<Icon color={uiRoles.surface} name="check" />'],
    ['a chosen glyph colour', '<Icon color={on ? uiRoles.surface : uiRoles.inkMuted} />'],
    ['a stroke', '<Circle fill={uiRoles.ink} stroke={selected ? uiRoles.ink : uiRoles.surface} />'],
    ['a tint', '<Image tintColor={uiRoles.surface} />'],
    ['a ring', 'marker: { borderColor: uiRoles.surface, backgroundColor: uiRoles.ink },'],
    ['an SVG text', '<SvgText\n  fill={selected ? uiRoles.surface : uiRoles.inkMuted}'],
    ['a theme preview label', '<Text style={[uiText.button, text(roles.surface)]}>'],
    ['an alias', 'const KNOCKOUT_COLOR = uiRoles.surface;'],
    ['a record of glyph colours', 'const GLYPH: Record<Tone, string> = {\n  accent: uiRoles.surface,\n};'],
  ])('rejects %s', (_name, source) => {
    expect(foregroundUses(source)).not.toEqual([]);
  });

  it.each([
    ['a card ground', 'card: { backgroundColor: uiRoles.surface },'],
    ['an inline ground', '<View style={[styles.card, { backgroundColor: roles.surface, borderColor: roles.rule }]}>'],
    ['a hollow marker', '<Circle fill={projected ? uiRoles.surface : uiRoles.ink} stroke={uiRoles.ink} />'],
    ['a role set handed on', 'paper: uiRoles.paper, surface: uiRoles.surface, rule: uiRoles.rule,'],
  ])('allows %s', (_name, source) => {
    expect(foregroundUses(source)).toEqual([]);
  });
});
