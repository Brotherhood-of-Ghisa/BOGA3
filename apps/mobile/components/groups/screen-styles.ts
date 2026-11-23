import { makeStyles, uiCardSlice, uiSpace, useUiRoles } from '@/components/ui';

/**
 * Shared page shell for the group routes: the `Screen` / `ScreenScroll` ground
 * and gutter (`paper`, `lg` gutter, `md` between blocks), for the lists that
 * cannot be a `ScreenScroll` (a `FlatList`) and the routes not yet moved onto it.
 */
export const useGroupScreenStyles = makeStyles((roles) => ({
  screen: {
    flex: 1,
    backgroundColor: roles.paper,
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
   * and each cell a slice of the card (`uiCardSlice`).
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
}));

/**
 * The styles for one cell of a `cardList`: `(index, count)` gives the cell's
 * styles, `index` of `count`.
 */
export function useCardListItemStyles() {
  const roles = useUiRoles();
  return (index: number, count: number) => uiCardSlice(roles, index, count);
}
