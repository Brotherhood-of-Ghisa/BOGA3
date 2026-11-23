import type { ViewStyle } from 'react-native';

import type { UiRoles } from '@/components/ui/theme';
import { uiBorder, uiGeometry } from '@/components/ui/tokens';

// The shapes a chart or a status draws (`docs/specs/ui/design-language.md` §4):
// a bar's fill, a dot, a ring. They are data, not containers, so they are not
// on a primitive; but outside `components/ui` no style sets a radius or a
// border (`scripts/check-ui-guardrails.js`), so the shape comes from here.
export const uiMark = {
  /** A bar's fill, or a cell of a chart: the control corner. */
  bar: { borderRadius: uiGeometry.radius.control } as ViewStyle,
  /** A filled circle of `size`: a dot, a marker, a disc. */
  round: (size: number): ViewStyle => ({ width: size, height: size, borderRadius: size / 2 }),
  /** A circle of `size` drawn as an outline in `colour`, `width` thick. */
  ring: (colour: string, size: number, width: number = uiBorder.width): ViewStyle => ({
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: width,
    borderColor: colour,
  }),
};

/**
 * One cell of a card a list draws across its rows (a paged `FlatList` cannot sit
 * inside one `Card`): the `surface`, the side hairlines, and the card corners and
 * top / bottom hairline on the first / last cell. `index` of `count`.
 */
export function uiCardSlice(roles: UiRoles, index: number, count: number): ViewStyle {
  const cap = (side: 'Top' | 'Bottom'): ViewStyle => ({
    [`border${side}Width`]: uiBorder.width,
    [`border${side}LeftRadius`]: uiGeometry.radius.card,
    [`border${side}RightRadius`]: uiGeometry.radius.card,
  });
  return {
    overflow: 'hidden',
    backgroundColor: roles.surface,
    borderLeftWidth: uiBorder.width,
    borderRightWidth: uiBorder.width,
    borderColor: roles.rule,
    ...(index === 0 ? cap('Top') : {}),
    ...(index === count - 1 ? cap('Bottom') : {}),
  };
}
