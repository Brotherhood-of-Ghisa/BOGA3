/**
 * Pure geometry and ordering for the recorder's set reordering (the
 * playlist-style drag): no React, no gesture runtime — the gesture shell and
 * the screen compose these, and the tests assert them directly.
 */

export type SetRowLayout = {
  id: string;
  /** Top edge within the set list, in the list's own coordinates. */
  y: number;
  height: number;
};

/** The permutation of `ids` moving the item at `fromIndex` to `toIndex`. */
export const reorderToIndex = (ids: string[], fromIndex: number, toIndex: number): string[] => {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= ids.length ||
    toIndex >= ids.length ||
    fromIndex === toIndex
  ) {
    return ids;
  }
  const next = [...ids];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
};

/** One step earlier/later in the current order, or the same order at a boundary. */
export const moveIdByStep = (ids: string[], id: string, step: -1 | 1): string[] => {
  const fromIndex = ids.indexOf(id);
  return reorderToIndex(ids, fromIndex, fromIndex + step);
};

/**
 * The index the dragged row would settle at, given the live row layouts and
 * the pointer's vertical position (the drag's midline, not its top edge). The
 * row under the pointer's midline decides: before its midpoint lands earlier,
 * after it lands later.
 */
export const insertionIndexForDrag = (
  layouts: SetRowLayout[],
  draggedId: string,
  pointerY: number,
): number => {
  const dragged = layouts.find((layout) => layout.id === draggedId);
  if (!dragged) return layouts.indexOf(layouts[0]);
  const draggedIndex = layouts.indexOf(dragged);
  const midline = pointerY;
  let target = draggedIndex;
  for (let index = 0; index < layouts.length; index += 1) {
    if (index === draggedIndex) continue;
    const layout = layouts[index];
    const midpoint = layout.y + layout.height / 2;
    if (index < draggedIndex && midline < midpoint) {
      target = Math.min(target, index);
    }
    if (index > draggedIndex && midline > midpoint) {
      target = Math.max(target, index);
    }
  }
  return target;
};
