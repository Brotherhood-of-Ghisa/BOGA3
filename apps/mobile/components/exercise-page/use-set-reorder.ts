import { useCallback, useEffect, useRef, useState } from 'react';

import {
  insertionIndexForDrag,
  moveIdByStep,
  reorderToIndex,
  type SetRowLayout,
} from './set-reorder-geometry';

/**
 * The recorder set list's drag controller: view state only — the lifted row,
 * the order the rows render in while a drag is live, and the announced result
 * of an accessibility move. The screen turns a dropped order into the
 * `reorderSessionExerciseSets` write; a cancelled drag or a failed write
 * simply clears the overlay, which restores the persisted order.
 */
export type UseSetReorder = {
  /** The dragged set, or null. */
  draggingId: string | null;
  /** The render order while a drag is live; null when idle. */
  dragOrder: string[] | null;
  /** Polite announcement of an accessibility move's result, or null. */
  announcement: string | null;
  /** Row layouts in the current render order; measured by the list. */
  registerLayout: (layout: SetRowLayout) => void;
  beginDrag: (id: string) => void;
  updateDrag: (pointerY: number) => void;
  /** Ends the drag; `commit` false cancels back to the original order. */
  endDrag: (commit: boolean) => void;
  /** Clears the overlay after the screen's write settles either way. */
  clearDrag: () => void;
  /** The accessibility move: one step earlier or later in the current order. */
  moveByStep: (id: string, step: -1 | 1) => string[];
  /** Sets (or clears) the polite reorder announcement. */
  announce: (text: string | null) => void;
};

export const useSetReorder = (currentOrder: string[]): UseSetReorder => {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const layoutsRef = useRef(new Map<string, SetRowLayout>());
  const orderRef = useRef(currentOrder);

  // The controller's callers pass a fresh order each render; reading it
  // lazily (inside the callbacks) keeps the latest without a ref write
  // during render.
  useEffect(() => {
    orderRef.current = currentOrder;
  }, [currentOrder]);

  const registerLayout = useCallback((layout: SetRowLayout) => {
    layoutsRef.current.set(layout.id, layout);
  }, []);

  const beginDrag = useCallback((id: string) => {
    setAnnouncement(null);
    setDraggingId(id);
    setDragOrder([...orderRef.current]);
  }, []);

  const updateDrag = useCallback(
    (pointerY: number) => {
      const dragged = draggingId;
      const order = dragOrder;
      if (dragged === null || order === null) return;
      const layoutOrder = order
        .map((id) => layoutsRef.current.get(id))
        .filter((layout): layout is SetRowLayout => layout !== undefined);
      const target = insertionIndexForDrag(layoutOrder, dragged, pointerY);
      const fromIndex = order.indexOf(dragged);
      if (target !== fromIndex) {
        setDragOrder(reorderToIndex(order, fromIndex, target));
      }
    },
    [dragOrder, draggingId],
  );

  const endDrag = useCallback((commit: boolean) => {
    if (!commit) {
      setDraggingId(null);
      setDragOrder(null);
    }
    // A committed drag keeps the overlay until the write clears it, so the
    // rows never flash back to the old order mid-save.
  }, []);

  const clearDrag = useCallback(() => {
    setDraggingId(null);
    setDragOrder(null);
  }, []);

  const moveByStep = useCallback(
    (id: string, step: -1 | 1) => moveIdByStep(orderRef.current, id, step),
    [],
  );

  return {
    draggingId,
    dragOrder,
    announcement,
    registerLayout,
    beginDrag,
    updateDrag,
    endDrag,
    clearDrag,
    moveByStep,
    announce: setAnnouncement,
  };
};
