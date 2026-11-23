import type { BoxShadowValue, ViewStyle } from 'react-native';

import { edgeShades, type ThemeMode, type UiRoles } from '@/components/ui/theme';
import { uiBorder, uiGeometry } from '@/components/ui/tokens';

// The edge (`docs/specs/ui/design-language.md` §4): how a card or a control
// stands off the ground it sits on, and how a track sinks into it. It is the
// only place a shadow is set — `scripts/check-ui-guardrails.js` fails on any
// `shadow*`, `boxShadow` or `elevation` elsewhere — so every bordered
// primitive draws the same one. Spread a variant into a `makeStyles` sheet,
// which hands over the drawn mode:
//
//   const useStyles = makeStyles((roles, mode) => ({ card: { ...uiEdge(roles, mode), backgroundColor: roles.surface } }));
//
// Outside `components/ui` no style sets a border, a radius or a shadow
// (`scripts/check-ui-guardrails.js`), so the options carry what a screen needs:
// the `shape` (the corner) and the `tone` of the hairline (`danger` on an
// invalid field, `accent` on the planned card) — a card is `Card`, a pill that
// is not a primitive is `uiEdge(roles, mode, { shape: 'pill' })`.

export type EdgeShape = 'card' | 'control' | 'pill';
export type EdgeTone = 'rule' | 'ruleSoft' | 'accent' | 'danger' | 'ink' | 'record' | 'recordRule' | 'onInk';
export type EdgeOptions = {
  shape?: EdgeShape;
  tone?: EdgeTone;
  // An absent or unavailable thing: a dashed hairline.
  dashed?: boolean;
};

// The lift: 1pt down, 2pt soft, in the mode's `lift` shade.
const LIFT = { offsetX: 0, offsetY: 1, blurRadius: 2 } as const;
// The well's inner shade: from the top edge, softer in dark.
const WELL: Record<ThemeMode, Omit<BoxShadowValue, 'color'>> = {
  light: { offsetX: 0, offsetY: 1, blurRadius: 2, inset: true },
  dark: { offsetX: 0, offsetY: 1, blurRadius: 3, inset: true },
};

const corner = (shape: EdgeShape | undefined): ViewStyle => (shape ? { borderRadius: uiGeometry.radius[shape] } : {});

/** A card's or a control's edge: the `rule` hairline and a lift. */
export function uiEdge(roles: UiRoles, mode: ThemeMode, options: EdgeOptions = {}): ViewStyle {
  return { ...uiHairline(roles, options), boxShadow: [{ ...LIFT, color: edgeShades(roles.ink, mode).lift }] };
}

/** The hairline alone, for an edge that must not read as pressable or lifted: a static `Tag`, a colour sample. */
export function uiHairline(roles: UiRoles, { shape, tone = 'rule', dashed = false }: EdgeOptions = {}): ViewStyle {
  return {
    borderWidth: uiBorder.width,
    borderColor: roles[tone],
    ...(dashed ? { borderStyle: 'dashed' as const } : {}),
    ...corner(shape),
  };
}

/** A sunken track: the `well` ground and its inner shade (a segmented control, a slider, a bar's empty track). */
export function uiWell(roles: UiRoles, mode: ThemeMode, options: Pick<EdgeOptions, 'shape'> = {}): ViewStyle {
  return {
    backgroundColor: roles.well,
    boxShadow: [{ ...WELL[mode], color: edgeShades(roles.ink, mode).well }],
    ...corner(options.shape),
  };
}
