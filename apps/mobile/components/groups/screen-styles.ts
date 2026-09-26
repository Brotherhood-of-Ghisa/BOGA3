import { StyleSheet } from 'react-native';

import { uiBorder, uiGeometry, uiRoles, uiSpace } from '@/components/ui';

/**
 * Shared page shell for the group routes: the `Screen` / `ScreenScroll` ground
 * and gutter (`paper`, `lg` gutter, `md` between blocks), for the lists that
 * cannot be a `ScreenScroll` (a `FlatList`) and the routes not yet moved onto it.
 */
export const groupScreenStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiRoles.paper,
  },
  content: {
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  header: {
    gap: uiSpace.md,
  },
  /** A row of equal-width actions. */
  actionRow: {
    flexDirection: 'row',
    gap: uiSpace.sm,
  },
  actionRowItem: {
    flex: 1,
  },
  /**
   * A paged `FlatList` whose rows read as one `Card` (the board, its history):
   * no gap between cells, the header and footer spaced by their own styles,
   * and each cell a slice of the card (`cardListItem`, plus `-First` / `-Last`).
   */
  cardListContent: {
    padding: uiSpace.lg,
  },
  cardListHeader: {
    paddingBottom: uiSpace.md,
  },
  cardListFooter: {
    paddingTop: uiSpace.md,
  },
  cardListItem: {
    overflow: 'hidden',
    borderLeftWidth: uiBorder.width,
    borderRightWidth: uiBorder.width,
    borderColor: uiRoles.rule,
    backgroundColor: uiRoles.surface,
  },
  cardListItemFirst: {
    borderTopWidth: uiBorder.width,
    borderTopLeftRadius: uiGeometry.radius.card,
    borderTopRightRadius: uiGeometry.radius.card,
  },
  cardListItemLast: {
    borderBottomWidth: uiBorder.width,
    borderBottomLeftRadius: uiGeometry.radius.card,
    borderBottomRightRadius: uiGeometry.radius.card,
  },
});

/** The styles for one cell of a `cardList` (`index` of `count`). */
export const cardListItemStyles = (index: number, count: number) => [
  groupScreenStyles.cardListItem,
  index === 0 ? groupScreenStyles.cardListItemFirst : null,
  index === count - 1 ? groupScreenStyles.cardListItemLast : null,
];
