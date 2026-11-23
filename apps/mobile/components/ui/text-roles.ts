import { StyleSheet } from 'react-native';

import { useUiGround, type UiGround } from '@/components/ui/ground';
import { contrastRatio } from '@/components/ui/lch';
import type { UiRoles } from '@/components/ui/theme';
import { useUiRoles } from '@/components/ui/theme-context';
import { uiFonts, uiGeometry, uiTypography } from '@/components/ui/tokens';

// The text roles (`docs/specs/ui/design-language.md` §3, "Text roles"). A
// screen names what its text does — a title, a row's name, a quiet figure —
// and takes the face, weight, size and line-height from here; it never picks
// them itself. Colour is a separate choice (`useUiTextTone()`), and so is the one
// step of emphasis (`uiTextEmphasis`). Layout (width, alignment, flex) stays
// in the screen's own styles, listed after the role.
const buildText = (roles: UiRoles) =>
  StyleSheet.create({
    // A page's own title, at the top of its scroll: on the page, so `pageInk`.
    pageTitle: {
      fontFamily: uiFonts.display.family,
      fontWeight: '800',
      fontSize: uiTypography.size.xxl,
      lineHeight: uiTypography.lineHeight.xxl,
      color: roles.pageInk,
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
const buildTone = (roles: UiRoles) =>
  StyleSheet.create({
    ink: { color: roles.ink },
    muted: { color: roles.inkMuted },
    faint: { color: roles.inkFaint },
    // Text drawn straight on the page, not on a card.
    page: { color: roles.pageInk },
    pageMuted: { color: roles.pageInkMuted },
    pageFaint: { color: roles.pageInkFaint },
    accent: { color: roles.accent },
    gain: { color: roles.gain },
    danger: { color: roles.danger },
    // A PR: the record colour, drawn heavy (§3 "Weight per figure").
    record: { color: roles.record, fontWeight: '700' },
  });

// One sheet per set of roles, so a theme switch builds each once and a hook
// returns the same object between switches (as `makeStyles` does).
function cachedBy<T>(build: (roles: UiRoles) => T): (roles: UiRoles) => T {
  const sheets = new WeakMap<UiRoles, T>();
  return (roles) => {
    const cached = sheets.get(roles);
    if (cached) return cached;
    const sheet = build(roles);
    sheets.set(roles, sheet);
    return sheet;
  };
}

// The text roles drawn in `roles`: what a `makeStyles` builder takes
// (`uiTextFor(roles).label`) where a helper has the roles in hand.
export const uiTextFor = cachedBy(buildText);

// A role's colour, when it is not the role's own, drawn in `roles`.
export const uiTextToneFor = cachedBy(buildTone);

// The text roles in the colours the app is drawn in now, for a component to read
// in render (`const text = useUiText(); style={text.label}`).
export function useUiText() {
  return uiTextFor(useUiRoles());
}

// `uiTextToneFor`, in the colours the app is drawn in now.
export function useUiTextTone() {
  return uiTextToneFor(useUiRoles());
}

// A coloured word drawn straight on the page: its own colour where that clears
// `floor` on the page, else `pageInk`. Every preset's page holds its coloured
// words (`design-language.md` §2); Ink + paper's dark page holds none, so there
// a coloured word is drawn in the page ink and its sign, glyph or words carry
// what the colour did.
export function pageWordColour(roles: UiRoles, colour: string, floor = 4.5): string {
  return readsOnPage(roles, colour, floor) ? colour : roles.pageInk;
}

// The inks and coloured words for the page, cached per theme as the tones are.
const buildPageTone = (roles: UiRoles) =>
  StyleSheet.create({
    ink: { color: roles.pageInk },
    muted: { color: roles.pageInkMuted },
    faint: { color: roles.pageInkFaint },
    accent: { color: pageWordColour(roles, roles.accent) },
    danger: { color: pageWordColour(roles, roles.danger) },
    record: { color: pageWordColour(roles, roles.record), fontWeight: '700' },
  });
const pageToneFor = cachedBy(buildPageTone);

// The tones for words on the ground the caller sits on (`ground.tsx`): the
// page inks and page-safe coloured words on the page, the inks and the roles
// themselves on a card or a sheet.
export function useUiGroundTone() {
  const roles = useUiRoles();
  const tone = uiTextToneFor(roles);
  return useUiGround() === 'page'
    ? pageToneFor(roles)
    : { ink: tone.ink, muted: tone.muted, faint: tone.faint, accent: tone.accent, danger: tone.danger, record: tone.record };
}

// The three inks as colours, for a glyph, a mark or a line drawn on `ground`.
export function groundInks(roles: UiRoles, ground: UiGround): { ink: string; inkMuted: string; inkFaint: string } {
  return ground === 'page'
    ? { ink: roles.pageInk, inkMuted: roles.pageInkMuted, inkFaint: roles.pageInkFaint }
    : { ink: roles.ink, inkMuted: roles.inkMuted, inkFaint: roles.inkFaint };
}

// `groundInks` on the ground the caller sits on.
export function useUiGroundInks() {
  return groundInks(useUiRoles(), useUiGround());
}

// A selected pill on `ground`: an `ink` pill with its `onInk` label, set off
// from the unselected `surface` pills by its fill. Its edge is `ink` where
// that stands off the ground, and `pageInk` where it does not (Ink + paper's
// page, as dark as `ink`), so the pill keeps its outline there. `edge` is a
// role, for `uiEdge`'s `tone`.
export function selectedPill(roles: UiRoles, ground: UiGround): { fill: string; label: string; edge: 'ink' | 'pageInk' } {
  const edge = ground === 'page' && !readsOnPage(roles, roles.ink, 3) ? 'pageInk' : 'ink';
  return { fill: roles.ink, label: roles.onInk, edge };
}

/** Whether `colour` clears `floor` on the page. */
export function readsOnPage(roles: UiRoles, colour: string, floor: number): boolean {
  return contrastRatio(colour, roles.paper) >= floor;
}

// One embedded weight up, for the row that is mine, a live session, the gym.
export const uiTextEmphasis = StyleSheet.create({
  strong: { fontWeight: '600' },
});
