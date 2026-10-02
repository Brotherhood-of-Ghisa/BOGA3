import {
  __resetCycleErrorSignalForTests,
  clearCycleError,
  getCycleErrorCode,
  markCycleError,
  subscribeToCycleErrorCode,
} from '@/src/sync/cycle-error-signal';

describe('cycle-error signal', () => {
  beforeEach(() => {
    __resetCycleErrorSignalForTests();
  });

  it('starts clear', () => {
    expect(getCycleErrorCode()).toBeNull();
  });

  it('records and overwrites the latest non-auth failure code', () => {
    markCycleError('INTERNAL');
    expect(getCycleErrorCode()).toBe('INTERNAL');

    markCycleError('FK_VIOLATION');
    expect(getCycleErrorCode()).toBe('FK_VIOLATION');

    markCycleError('LOCAL_FK_VIOLATION');
    expect(getCycleErrorCode()).toBe('LOCAL_FK_VIOLATION');
  });

  it('clears the code on a clean cycle', () => {
    markCycleError('INTERNAL');
    clearCycleError();
    expect(getCycleErrorCode()).toBeNull();
  });

  it('notifies subscribers only on an actual change', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToCycleErrorCode(listener);

    markCycleError('INTERNAL');
    expect(listener).toHaveBeenCalledTimes(1);

    // Re-marking the same code is a no-op.
    markCycleError('INTERNAL');
    expect(listener).toHaveBeenCalledTimes(1);

    clearCycleError();
    expect(listener).toHaveBeenCalledTimes(2);

    // Clearing an already-clear code is a no-op.
    clearCycleError();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    markCycleError('FK_VIOLATION');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
