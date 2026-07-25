import { createDraftAutosaveController } from '@/src/session-recorder/draft-autosave';
import {
  createSessionRecorderLifecycleHelpers,
  shouldFlushOnAppStateChange,
} from '@/src/session-recorder/lifecycle-helpers';

const flushAsyncWork = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('draft autosave controller', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('debounces text writes to 3s instead of writing on each mutation', async () => {
    const persistDraft = jest.fn().mockResolvedValue(undefined);
    const autosave = createDraftAutosaveController({ persistDraft });

    autosave.markTextMutation();
    jest.advanceTimersByTime(1_000);
    autosave.markTextMutation();
    jest.advanceTimersByTime(1_000);
    autosave.markTextMutation();

    expect(persistDraft).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(2_999);
    await flushAsyncWork();
    expect(persistDraft).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(1);
    await flushAsyncWork();
    expect(persistDraft).toHaveBeenCalledTimes(1);
    expect(persistDraft).toHaveBeenCalledWith('text-debounce');
  });

  it('writes immediately for structural mutations', async () => {
    const persistDraft = jest.fn().mockResolvedValue(undefined);
    const autosave = createDraftAutosaveController({ persistDraft });

    await autosave.markStructuralMutation();
    await flushAsyncWork();

    expect(persistDraft).toHaveBeenCalledTimes(1);
    expect(persistDraft).toHaveBeenCalledWith('structural-change');
  });

  it('flushes immediately on lifecycle trigger before debounce timer fires', async () => {
    const persistDraft = jest.fn().mockResolvedValue(undefined);
    const autosave = createDraftAutosaveController({ persistDraft });

    autosave.markTextMutation();
    jest.advanceTimersByTime(1_000);

    await autosave.flushForLifecycle('screen-blur');
    await flushAsyncWork();

    expect(persistDraft).toHaveBeenCalledTimes(1);
    expect(persistDraft).toHaveBeenCalledWith('lifecycle-screen-blur');

    jest.advanceTimersByTime(10_000);
    await flushAsyncWork();

    expect(persistDraft).toHaveBeenCalledTimes(1);
  });

  it('flushes pending text immediately when an input is committed', async () => {
    const persistDraft = jest.fn().mockResolvedValue(undefined);
    const autosave = createDraftAutosaveController({ persistDraft });

    autosave.markTextMutation();
    jest.advanceTimersByTime(1_000);

    await autosave.flushInputCommit();
    await flushAsyncWork();

    expect(persistDraft).toHaveBeenCalledTimes(1);
    expect(persistDraft).toHaveBeenCalledWith('input-commit');

    jest.advanceTimersByTime(10_000);
    await flushAsyncWork();

    expect(persistDraft).toHaveBeenCalledTimes(1);
  });

  it('enforces the 10s dirty-state max flush interval during sustained typing', async () => {
    const persistDraft = jest.fn().mockResolvedValue(undefined);
    const autosave = createDraftAutosaveController({ persistDraft });

    autosave.markTextMutation();
    jest.advanceTimersByTime(2_000);
    autosave.markTextMutation();
    jest.advanceTimersByTime(2_000);
    autosave.markTextMutation();
    jest.advanceTimersByTime(2_000);
    autosave.markTextMutation();
    jest.advanceTimersByTime(2_000);
    autosave.markTextMutation();
    jest.advanceTimersByTime(2_000);
    await flushAsyncWork();

    expect(persistDraft).toHaveBeenCalledTimes(1);
    expect(persistDraft).toHaveBeenCalledWith('max-interval');
  });
});

describe('session recorder lifecycle helpers', () => {
  it('maps RN-like lifecycle events to autosave flush helpers', async () => {
    const flushForLifecycle = jest.fn().mockResolvedValue(undefined);
    const lifecycle = createSessionRecorderLifecycleHelpers({ flushForLifecycle });

    await lifecycle.onScreenBlur();
    await lifecycle.onRouteChange();
    await lifecycle.onAppStateChange('background');
    await lifecycle.onAppStateChange('active');

    expect(flushForLifecycle).toHaveBeenCalledTimes(3);
    expect(flushForLifecycle).toHaveBeenNthCalledWith(1, 'screen-blur');
    expect(flushForLifecycle).toHaveBeenNthCalledWith(2, 'route-change');
    expect(flushForLifecycle).toHaveBeenNthCalledWith(3, 'app-background');
  });

  it('identifies inactive/background app states as flush triggers', () => {
    expect(shouldFlushOnAppStateChange('active')).toBe(false);
    expect(shouldFlushOnAppStateChange('inactive')).toBe(true);
    expect(shouldFlushOnAppStateChange('background')).toBe(true);
  });
});
