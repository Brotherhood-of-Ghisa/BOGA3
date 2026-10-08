/**
 * The set reorder's pure decision rules (the playlist-style ordered-row
 * pattern), mirroring `swipe-set-row.test.ts`: the permutation moving a row,
 * one-step moves at boundaries, and the insertion index the pointer's
 * midline picks. The gesture itself is native; the screen test covers what
 * each row offers.
 */
import { insertionIndexForDrag, moveIdByStep, reorderToIndex } from '@/components/exercise-page/set-reorder-geometry';

const IDS = ['a', 'b', 'c', 'd'];
const layouts = (heights: number[] = [40, 40, 40, 40]) =>
  heights.map((height, index) => ({ id: IDS[index], y: index * 44, height }));

describe('set reorder geometry', () => {
  it('reorderToIndex moves a row and is exact at the boundaries', () => {
    expect(reorderToIndex(IDS, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(reorderToIndex(IDS, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(reorderToIndex(IDS, 1, 1)).toBe(IDS);
    expect(reorderToIndex(IDS, -1, 1)).toBe(IDS);
    expect(reorderToIndex(IDS, 1, 4)).toBe(IDS);
  });

  it('moveIdByStep steps one row and no-ops at a boundary', () => {
    expect(moveIdByStep(IDS, 'a', 1)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveIdByStep(IDS, 'b', -1)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveIdByStep(IDS, 'a', -1)).toBe(IDS);
    expect(moveIdByStep(IDS, 'd', 1)).toBe(IDS);
    expect(moveIdByStep(IDS, 'x', 1)).toBe(IDS);
  });

  it('insertionIndexForDrag settles on the row whose midpoint the pointer crosses', () => {
    // Rows at y 0/44/88/132, 40pt tall; midpoints at 20/64/108/152.
    expect(insertionIndexForDrag(layouts(), 'a', 30)).toBe(0); // still over itself
    expect(insertionIndexForDrag(layouts(), 'a', 70)).toBe(1); // past b's midpoint
    expect(insertionIndexForDrag(layouts(), 'a', 200)).toBe(3); // bottom boundary
    expect(insertionIndexForDrag(layouts(), 'd', 0)).toBe(0); // top boundary
    expect(insertionIndexForDrag(layouts(), 'd', 10)).toBe(0); // above a's midpoint
    expect(insertionIndexForDrag(layouts(), 'd', 30)).toBe(1); // below a's midpoint, above b's
    expect(insertionIndexForDrag(layouts(), 'c', 10)).toBe(0); // two rows up
  });
});
