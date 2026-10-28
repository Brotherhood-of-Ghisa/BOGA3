import { StyleSheet } from 'react-native';

import { uiFonts, uiGeometry, uiRoles, uiTypography } from '@/components/ui/tokens';

// The text roles (`docs/specs/ui/design-language.md` §3, "Text roles"). A
// screen names what its text does — a title, a row's name, a quiet figure —
// and takes the face, weight, size and line-height from here; it never picks
// them itself. Colour is a separate choice (`uiTextTone`), and so is the one
// step of emphasis (`uiTextEmphasis`). Layout (width, alignment, flex) stays
// in the screen's own styles, listed after the role.
export const uiText = StyleSheet.create({
  // A page's own title, at the top of its scroll.
  pageTitle: {
    fontFamily: uiFonts.display.family,
    fontWeight: '800',
    fontSize: uiTypography.size.xxl,
    lineHeight: uiTypography.lineHeight.xxl,
    color: uiRoles.ink,
  },
  // A sheet's title, in its header bar.
  sheetTitle: {
    fontFamily: uiFonts.display.family,
    fontWeight: '800',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  // A card, section or tab title; a state panel's title.
  title: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
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
    color: uiRoles.inkMuted,
  },
  // A button's caps label (`ActionButton`).
  button: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    letterSpacing: uiTypography.size.sm * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.ink,
  },
  // A choice's name: a row in a card (`ListRow`/`SwitchRow` at list density),
  // a form's action row.
  option: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  // A sheet's roomy option row: `option`, one rung up.
  optionLarge: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  // What a person types into a field. No line-height: a TextInput given one
  // drifts off its vertical centre. A numeric field adds `inlineFigure`.
  input: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    color: uiRoles.ink,
  },
  // A row's name, a line of prose.
  body: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  // The name a row is about when it heads a block of lines (a planned
  // session's title, the member who trained).
  bodyStrong: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  // A supporting line under a name; an empty block's one line.
  meta: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  // A block's one headline number.
  figureHero: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxl,
    lineHeight: uiTypography.lineHeight.xxl,
    color: uiRoles.ink,
  },
  // A `Stat`'s headline figure: a summary card's, the records panel's.
  figureStat: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  // A second headline number beside the hero.
  figureLarge: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  // Every number in a row or a table, on the same line as `body`.
  figure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  // Quiet figures: a date or time, counts on a supporting line, a comparison.
  figureSmall: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  // A number inside a line of text: the figure face at the line's size.
  inlineFigure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
  },
});

// A role's colour, when it is not the role's own.
export const uiTextTone = StyleSheet.create({
  ink: { color: uiRoles.ink },
  muted: { color: uiRoles.inkMuted },
  faint: { color: uiRoles.inkFaint },
  accent: { color: uiRoles.accent },
  gain: { color: uiRoles.gain },
  danger: { color: uiRoles.danger },
  // A PR: the record colour, drawn heavy (§3 "Weight per figure").
  record: { color: uiRoles.record, fontWeight: '700' },
});

// One embedded weight up, for the row that is mine, a live session, the gym.
export const uiTextEmphasis = StyleSheet.create({
  strong: { fontWeight: '600' },
});
