import { type ReactNode, useCallback, useRef } from 'react';
import { type ViewInstance, View } from 'react-native';

import { SetReorderHandle } from './set-reorder-handle';
import { moveIdByStep } from './set-reorder-geometry';
import type { UseSetReorder } from './use-set-reorder';

/** What a row needs to take part in the reorder. */
export type RowReorderProps = {
  dragHandle: ReactNode;
  /** Absent at the top boundary. */
  onMoveEarlier?: () => void;
  /** Absent at the bottom boundary. */
  onMoveLater?: () => void;
};

type SetReorderListProps<Item extends { id: string }> = {
  controller: UseSetReorder;
  /** The rows being rendered, in render order. */
  items: Item[];
  /** A committed drop or accessibility move, as the exact new permutation.
   * An accessibility move carries its announced result. */
  onReorder: (orderedIds: string[], announcement?: string) => void;
  /** Renders one row; `reorder` carries the handle and the move actions. */
  renderRow: (item: Item, index: number, reorder: RowReorderProps) => ReactNode;
  testID?: string;
};

/**
 * The set list's reorder shell (the lightweight playlist-style ordered-row
 * pattern): it measures the rows, starts drags from each row's handle, moves
 * rows under the pointer, and turns a drop or a Move earlier/later action
 * into one `onReorder` permutation for the screen to persist. The rows
 * themselves stay the screen's; nothing here knows what a set is.
 */
export function SetReorderList<Item extends { id: string }>({
  controller,
  items,
  onReorder,
  renderRow,
  testID,
}: SetReorderListProps<Item>) {
  const listRef = useRef<ViewInstance>(null);
  const pageYRef = useRef(0);

  // measureInWindow lands asynchronously; its callback refreshes both the
  // best-known anchor and the controller's.
  const measureInto = useCallback(
    (apply: (y: number) => void) => {
      listRef.current?.measureInWindow((_x: number, y: number) => {
        pageYRef.current = y;
        apply(y);
      });
    },
    [],
  );

  const beginDragAt = useCallback(
    (setId: string) => {
      // Scrolling moves the list in the window without relaying it out, so a
      // layout-time anchor is stale by the scroll offset and every pointer
      // read would land on the wrong rows: re-measure at each drag start,
      // seeding the controller with the best-known value first so the first
      // pointer events are never read against a zero.
      controller.setAnchor(pageYRef.current);
      measureInto(controller.setAnchor);
      controller.beginDrag(setId);
    },
    [controller, measureInto],
  );

  const drop = useCallback(
    (setId: string, committed: boolean) => {
      if (!committed) {
        controller.endDrag(false);
        return;
      }
      controller.endDrag(true);
      const order = controller.dragOrder;
      if (order !== null) onReorder(order);
    },
    [controller, onReorder],
  );

  const move = useCallback(
    (setId: string, step: -1 | 1, setNumber: number) => {
      const ids = items.map((item) => item.id);
      const next = moveIdByStep(ids, setId, step);
      if (next === ids) return;
      const newPosition = next.indexOf(setId) + 1;
      onReorder(next, `Set moved to position ${newPosition} of ${ids.length}`);
    },
    [items, onReorder],
  );

  const count = items.length;

  return (
    <View onLayout={() => measureInto(() => undefined)} ref={listRef} testID={testID}>
      {items.map((item, index) => {
        const rowId = item.id;
        return (
          <View
            key={rowId}
            onLayout={(event) =>
              controller.registerLayout({ id: rowId, y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height })
            }>
            {renderRow(item, index, {
              dragHandle:
                count < 2 ? null : (
                  <SetReorderHandle
                    onDragEnd={drop}
                    onDragPointer={controller.updateDragPointer}
                    onDragStart={beginDragAt}
                    setNumber={index + 1}
                    setId={rowId}
                    testID={`exercise-set-${index + 1}-reorder-handle`}
                  />
                ),
              onMoveEarlier: index > 0 ? () => move(rowId, -1, index + 1) : undefined,
              onMoveLater: index < count - 1 ? () => move(rowId, 1, index + 1) : undefined,
            })}
          </View>
        );
      })}
    </View>
  );
}
