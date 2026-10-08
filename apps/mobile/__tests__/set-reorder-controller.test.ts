/* eslint-disable import/first */

/**
 * The drag controller's state rules (`use-set-reorder`): a drag renders its
 * own order, a cancellation restores the original, a commit keeps the overlay
 * until the screen clears it after the write, and an accessibility move
 * returns the exact permutation. The persistence itself is the screen's, so
 * the write path is covered in the screen suite.
 */
import { act, renderHook } from '@testing-library/react-native';

import { useSetReorder } from '@/components/exercise-page/use-set-reorder';

const ORDER = ['a', 'b', 'c'];

describe('set reorder controller', () => {
  it('a drag renders its order under the pointer and a cancellation restores the original', () => {
    const { result } = renderHook(() => useSetReorder(ORDER));
    const register = (ids: string[]) =>
      ids.forEach((id, index) => result.current.registerLayout({ id, y: index * 44, height: 40 }));

    act(() => {
      register(ORDER);
      result.current.setAnchor(0);
      result.current.beginDrag('a');
    });
    expect(result.current.draggingId).toBe('a');
    expect(result.current.dragOrder).toEqual(['a', 'b', 'c']);

    act(() => result.current.updateDragPointer(70)); // past b's midpoint
    expect(result.current.dragOrder).toEqual(['b', 'a', 'c']);

    act(() => result.current.endDrag(false));
    expect(result.current.draggingId).toBeNull();
    expect(result.current.dragOrder).toBeNull(); // the persisted order again
  });

  it('a committed drag keeps the overlay until the screen clears it', () => {
    const { result } = renderHook(() => useSetReorder(ORDER));
    act(() => {
      ORDER.forEach((id, index) => result.current.registerLayout({ id, y: index * 44, height: 40 }));
      result.current.setAnchor(0);
      result.current.beginDrag('a');
    });
    act(() => result.current.updateDragPointer(200));
    act(() => result.current.endDrag(true));
    expect(result.current.dragOrder).toEqual(['b', 'c', 'a']);

    act(() => result.current.clearDrag());
    expect(result.current.dragOrder).toBeNull();
  });

  it('a scrolled page re-anchors at drag start: the same pointer reads the same rows', () => {
    const { result } = renderHook(() => useSetReorder(ORDER));
    act(() => {
      ORDER.forEach((id, index) => result.current.registerLayout({ id, y: index * 44, height: 40 }));
      result.current.setAnchor(0);
      result.current.beginDrag('a');
    });
    act(() => result.current.updateDragPointer(70));
    expect(result.current.dragOrder).toEqual(['b', 'a', 'c']);

    // The page scrolls 300pt down: the same on-screen position now reports a
    // pointer 300pt larger. Re-anchoring at drag start makes the same local
    // position compute the same insertion index.
    act(() => {
      result.current.endDrag(false);
      result.current.setAnchor(300);
      result.current.beginDrag('a');
    });
    act(() => result.current.updateDragPointer(370));
    expect(result.current.dragOrder).toEqual(['b', 'a', 'c']);

    // A stale anchor would misread: 370 against 0 lands two rows past the
    // list's own layout — the wrong order the drag-start re-measure prevents.
    act(() => {
      result.current.endDrag(false);
      result.current.setAnchor(0);
      result.current.beginDrag('a');
    });
    act(() => result.current.updateDragPointer(370));
    expect(result.current.dragOrder).toEqual(['b', 'c', 'a']); // wrong: off by the scroll
  });

  it('an accessibility move returns the permutation and announces nothing itself', () => {
    const { result } = renderHook(() => useSetReorder(ORDER));
    expect(result.current.moveByStep('a', 1)).toEqual(['b', 'a', 'c']);
    expect(result.current.moveByStep('a', -1)).toEqual(ORDER); // boundary: unchanged
    expect(result.current.announcement).toBeNull();

    act(() => result.current.announce('Set moved to position 1 of 3'));
    expect(result.current.announcement).toBe('Set moved to position 1 of 3');
  });
});
