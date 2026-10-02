/**
 * The one best-1RM-set rule (spec 05, "Exercise session facts", ties): the
 * facts and the in-memory PR readers both call it.
 */
import { ordinaryLoadContext } from '@/src/exercise-calculations/analytics';
import {
  eligibleSetsByBlockInSessionOrder,
  pickBestEstimatedOneRepMaxSet,
  type BestSetSetInput,
} from '@/src/exercise-calculations/best-set';

const set = (id: string, orderIndex: number, weightValue: string, repsValue = '5', extra: Partial<BestSetSetInput> = {}) =>
  ({ id, orderIndex, weightValue, repsValue, ...extra });
const block = (id: string, orderIndex: number, sets: BestSetSetInput[]) =>
  ({ id, orderIndex, loadContext: ordinaryLoadContext(), sets });

const best = (blocks: ReturnType<typeof block>[]) =>
  pickBestEstimatedOneRepMaxSet(eligibleSetsByBlockInSessionOrder(blocks).flat());

describe('best estimated 1RM set', () => {
  it('orders blocks then sets by position, ids breaking ties, and drops deleted and ineligible sets', () => {
    const byBlock = eligibleSetsByBlockInSessionOrder([
      block('b2', 1, [set('b2-s0', 0, '100')]),
      block('b1', 0, [
        set('b1-z', 1, '90'),
        set('b1-a', 1, '80'),
        set('b1-s0', 0, '70'),
        set('b1-deleted', 2, '200', '5', { deletedAt: new Date(0) }),
        set('b1-unperformed', 3, '200', '5', { performanceStatus: 'unperformed' }),
        set('b1-no-reps', 4, '100', ''),
      ]),
    ]);

    expect(byBlock.map((sets) => sets.map((entry) => entry.set.id)))
      .toEqual([['b1-s0', 'b1-a', 'b1-z'], ['b2-s0']]);
  });

  it('takes the strictly greater 1RM, so the first set in session order keeps a tie', () => {
    const picked = best([
      block('b1', 0, [set('b1-s0', 0, '80'), set('b1-s1', 1, '130')]),
      block('b2', 1, [set('b2-s0', 0, '130'), set('b2-s1', 1, '120')]),
    ]);

    expect(picked).toMatchObject({ set: { id: 'b1-s1' }, block: { id: 'b1' }, enteredWeightKg: 130 });
    expect(picked!.estimatedOneRepMaxKg).toBe(picked!.metric.estimatedOneRepMaxKg);
  });

  it('returns null when no set has a 1RM', () => {
    expect(best([block('b1', 0, [set('b1-blank', 0, '', '')])])).toBeNull();
    expect(best([])).toBeNull();
  });
});
