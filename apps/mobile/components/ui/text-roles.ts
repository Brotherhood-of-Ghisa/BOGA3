import { StyleSheet } from 'react-native';

import type { UiRoles } from '@/components/ui/theme';
import { useUiRoles } from '@/components/ui/theme-context';
import { uiFonts, uiGeometry, uiRoles, uiTypography } from '@/components/ui/tokens';

// The text roles (`docs/specs/ui/design-language.md` §3, "Text roles"). A
// screen names what its text does — a title, a row's name, a quiet figure —
// and takes the face, weight, size and line-height from here; it never picks
// them itself. Colour is a separate choice (the tone), and so is the one step
// of emphasis (`uiTextEmphasis`). Layout (width, alignment, flex) stays in the
// screen's own styles, listed after the role.
const buildText = (roles: UiRoles) => StyleSheet.create({
  // A page's own title, at the top of its scroll.
  pageTitle: {
    fontFamily: uiFonts.display.family,
    fontWeight: '800',
    fontSize: uiTypography.size.xxl,
    lineHeight: uiTypography.lineHeight.xxl,
    color: roles.ink,
  },
  // A sheet's title, in its header bar.
  sheetTitle: {
    fontFamily: uiFonts.display.family,
    fontWeight: '800',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: roles.ink,
  },
  // A card, section or tab title; a state panel's title.
  title: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: roles.ink,
  },
  // A micro-label: a block's heading, a column header, a figure's legend, a
  // unit. Muted by default; `ink` for a block's own name, `faint` for the
  // secondary ones (a date range, column headers).
  label: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: roles.inkMuted,
  },
  // A button's caps label (`ActionButton`).
  button: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    letterSpacing: uiTypography.size.sm * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: roles.ink,
  },
  // A choice's name: a row in a card (`ListRow`/`SwitchRow` at list density),
  // a form's action row.
  option: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: roles.ink,
  },
  // A sheet's roomy option row: `option`, one rung up.
  optionLarge: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: roles.ink,
  },
  // What a person types into a field. No line-height: a TextInput given one
  // drifts off its vertical centre. A numeric field adds `inlineFigure`.
  input: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    color: roles.ink,
  },
  // A search field's query, at the size of the row names it finds.
  inputLarge: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.lg,
    color: roles.ink,
  },
  // A row's name, a line of prose.
  body: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: roles.ink,
  },
  // The name a row is about when it heads a block of lines (a planned
  // session's title, the member who trained).
  bodyStrong: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: roles.ink,
  },
  // A supporting line under a name; an empty block's one line.
  meta: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: roles.inkMuted,
  },
  // A block's one headline number.
  figureHero: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxl,
    lineHeight: uiTypography.lineHeight.xxl,
    color: roles.ink,
  },
  // A `Stat`'s headline figure: a summary card's, the records panel's.
  figureStat: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: roles.ink,
  },
  // A second headline number beside the hero.
  figureLarge: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: roles.ink,
  },
  // Every number in a row or a table, on the same line as `body`.
  figure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: roles.ink,
  },
  // Quiet figures: a date or time, counts on a supporting line, a comparison.
  figureSmall: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: roles.inkMuted,
  },
  // A number inside a line of text: the figure face at the line's size.
  inlineFigure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
  },
});

// A role's colour, when it is not the role's own.
const buildTone = (roles: UiRoles) => StyleSheet.create({
  ink: { color: roles.ink },
  muted: { color: roles.inkMuted },
  faint: { color: roles.inkFaint },
  accent: { color: roles.accent },
  gain: { color: roles.gain },
  danger: { color: roles.danger },
  // A PR: the record colour, drawn heavy (§3 "Weight per figure").
  record: { color: roles.record, fontWeight: '700' },
});

// One embedded weight up, for the row that is mine, a live session, the gym.
export const uiTextEmphasis = StyleSheet.create({
  strong: { fontWeight: '600' },
});

export type TextRoles = {
  /** The text roles, each in its own colour. */
  text: ReturnType<typeof buildText>;
  /** A role's colour, when it is not the role's own. */
  tone: ReturnType<typeof buildTone>;
};

const textRolesByRoles = new WeakMap<UiRoles, TextRoles>();

/**
 * The text roles and tones drawn in `roles`: what a module that builds its
 * styles from the roles (a `makeStyles` sheet, a helper given `roles`) spreads
 * in. One set per set of roles, the same object between theme switches.
 */
export function textRoles(roles: UiRoles): TextRoles {
  const cached = textRolesByRoles.get(roles);
  if (cached) return cached;
  const built = { text: buildText(roles), tone: buildTone(roles) };
  textRolesByRoles.set(roles, built);
  return built;
}

/**
 * The text roles and tones in the colours the app is drawn in now; a component
 * reads `const { text, tone } = useTextRoles()` where it once read `uiText` and
 * `uiTextTone`.
 */
export function useTextRoles(): TextRoles {
  return textRoles(useUiRoles());
}

// The text roles in the launch theme, for the screens not yet live
// (`ui-live-theme-guard.allowlist.json`). A live screen uses `useTextRoles()`.
export const uiText = textRoles(uiRoles).text;
export const uiTextTone = textRoles(uiRoles).tone;
