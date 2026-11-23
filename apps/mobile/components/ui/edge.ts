import type { BoxShadowValue, ViewStyle } from 'react-native';

import { edgeShades, type ThemeMode, type UiRoles } from '@/components/ui/theme';
import { uiBorder } from '@/components/ui/tokens';

// The edge (`docs/specs/ui/design-language.md` §4): how a card or a control
// stands off the ground it sits on, and how a track sinks into it. It is the
// only place a shadow is set — `scripts/check-ui-guardrails.js` fails on any
// `shadow*`, `boxShadow` or `elevation` elsewhere — so every bordered
// primitive draws the same one. Spread a variant into a `makeStyles` sheet,
// which hands over the drawn mode:
//
//   const useStyles = makeStyles((roles, mode) => ({ card: { ...uiEdge(roles, mode), backgroundColor: roles.surface } }));
//
// A style that recolours the hairline (`danger` on an invalid field) follows
// the edge and sets `borderColor` alone.

// The lift: 1pt down, 2pt soft, in the mode's `lift` shade.
const LIFT = { offsetX: 0, offsetY: 1, blurRadius: 2 } as const;
// The well's inner shade: from the top edge, softer in dark.
const WELL: Record<ThemeMode, Omit<BoxShadowValue, 'color'>> = {
  light: { offsetX: 0, offsetY: 1, blurRadius: 2, inset: true },
  dark: { offsetX: 0, offsetY: 1, blurRadius: 3, inset: true },
};

/** A card's or a control's edge: the `rule` hairline and a lift. */
export function uiEdge(roles: UiRoles, mode: ThemeMode): ViewStyle {
  return { ...uiHairline(roles), boxShadow: [{ ...LIFT, color: edgeShades(roles.ink, mode).lift }] };
}

/** The hairline alone, for an edge that must not read as pressable or lifted: a static `Tag`. */
export function uiHairline(roles: UiRoles): ViewStyle {
  return { borderWidth: uiBorder.width, borderColor: roles.rule };
}

/** A sunken track: the `well` ground and its inner shade (a segmented control, a slider, a bar's empty track). */
export function uiWell(roles: UiRoles, mode: ThemeMode): ViewStyle {
  return { backgroundColor: roles.well, boxShadow: [{ ...WELL[mode], color: edgeShades(roles.ink, mode).well }] };
}
