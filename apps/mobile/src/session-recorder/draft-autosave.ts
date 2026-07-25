export const DEFAULT_DRAFT_AUTOSAVE_POLICY = {
  textDebounceMs: 3_000,
  maxDirtyMs: 10_000,
} as const;

export type DraftAutosaveLifecycleTrigger = 'screen-blur' | 'route-change' | 'app-background';

export type DraftAutosaveWriteReason =
  | 'text-debounce'
  | 'structural-change'
  | 'input-commit'
  | 'max-interval'
  | 'dispose'
  | `lifecycle-${DraftAutosaveLifecycleTrigger}`;

type AutosaveOptions = {
  persistDraft(reason: DraftAutosaveWriteReason): Promise<void> | void;
  onError?: (error: unknown) => void;
  policy?: {
    textDebounceMs?: number;
    maxDirtyMs?: number;
  };
};

export type DraftAutosaveController = {
  markTextMutation(): void;
  markStructuralMutation(): Promise<void>;
  flushInputCommit(): Promise<void>;
  flushForLifecycle(trigger: DraftAutosaveLifecycleTrigger): Promise<void>;
  flushNow(): Promise<void>;
  dispose(options?: { flushDirty?: boolean }): Promise<void>;
  isDirty(): boolean;
};

export const createDraftAutosaveController = (options: AutosaveOptions): DraftAutosaveController => {
  const policy = {
    textDebounceMs: options.policy?.textDebounceMs ?? DEFAULT_DRAFT_AUTOSAVE_POLICY.textDebounceMs,
    maxDirtyMs: options.policy?.maxDirtyMs ?? DEFAULT_DRAFT_AUTOSAVE_POLICY.maxDirtyMs,
  };

  let dirty = false;
  let changeToken = 0;
  let disposed = false;
  let textDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxDirtyTimer: ReturnType<typeof setTimeout> | null = null;
  let writeQueue = Promise.resolve();

  const clearTextDebounce = () => {
    if (!textDebounceTimer) {
      return;
    }

    clearTimeout(textDebounceTimer);
    textDebounceTimer = null;
  };

  const clearMaxDirty = () => {
    if (!maxDirtyTimer) {
      return;
    }

    clearTimeout(maxDirtyTimer);
    maxDirtyTimer = null;
  };

  const clearTimers = () => {
    clearTextDebounce();
    clearMaxDirty();
  };

  const queuePersist = (reason: DraftAutosaveWriteReason, token?: number) => {
    writeQueue = writeQueue
      .then(async () => {
        if (disposed || !dirty) {
          return;
        }

        if (token !== undefined && token !== changeToken) {
          return;
        }

        dirty = false;
        clearTimers();
        await options.persistDraft(reason);
      })
      .catch((error) => {
        options.onError?.(error);
      });

    return writeQueue;
  };

  const markDirty = () => {
    if (dirty) {
      return;
    }

    dirty = true;
    maxDirtyTimer = setTimeout(() => {
      void queuePersist('max-interval');
    }, policy.maxDirtyMs);
  };

  const markTextMutation = () => {
    if (disposed) {
      return;
    }

    changeToken += 1;
    const token = changeToken;

    markDirty();
    clearTextDebounce();
    textDebounceTimer = setTimeout(() => {
      void queuePersist('text-debounce', token);
    }, policy.textDebounceMs);
  };

  const markStructuralMutation = () => {
    if (disposed) {
      return Promise.resolve();
    }

    changeToken += 1;
    markDirty();
    return queuePersist('structural-change');
  };

  const flushForLifecycle = (trigger: DraftAutosaveLifecycleTrigger) => {
    if (disposed) {
      return Promise.resolve();
    }

    clearTextDebounce();
    return queuePersist(`lifecycle-${trigger}`);
  };

  const flushInputCommit = () => {
    if (disposed) {
      return Promise.resolve();
    }

    clearTextDebounce();
    return queuePersist('input-commit');
  };

  const flushNow = () => {
    if (disposed) {
      return Promise.resolve();
    }

    return queuePersist('max-interval');
  };

  const dispose = (disposeOptions: { flushDirty?: boolean } = {}) => {
    if (disposed) {
      return Promise.resolve();
    }

    clearTimers();

    if (!disposeOptions.flushDirty || !dirty) {
      disposed = true;
      dirty = false;
      return Promise.resolve();
    }

    return queuePersist('dispose').finally(() => {
      disposed = true;
      dirty = false;
      clearTimers();
    });
  };

  return {
    markTextMutation,
    markStructuralMutation,
    flushInputCommit,
    flushForLifecycle,
    flushNow,
    dispose,
    isDirty: () => dirty,
  };
};
