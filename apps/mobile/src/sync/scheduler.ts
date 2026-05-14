import { flushSyncOutbox, setSyncNetworkOnline, type SyncFlushResult } from './engine';
import { isBootstrapInProgress as isRuntimeBootstrapInProgress } from './runtime';

export const SYNC_GENERAL_CADENCE_MS = 60_000;
export const SYNC_SESSION_RECORDER_CADENCE_MS = 10_000;
export const SESSION_RECORDER_ROUTE_SEGMENT = 'session-recorder';

export type SyncCadenceContext = 'general' | 'session-recorder';

type TimerHandle = ReturnType<typeof setTimeout>;

export type SyncScheduler = {
  start(): void;
  stop(): void;
  setContext(context: SyncCadenceContext): void;
  setOnline(isOnline: boolean): void;
  getContext(): SyncCadenceContext;
  isRunning(): boolean;
};

const normalizeFirstRouteSegment = (pathname: string): string | null => {
  const [pathWithoutQueryOrHash] = pathname.split(/[?#]/, 1);
  const trimmed = pathWithoutQueryOrHash.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) {
    return null;
  }

  const [firstSegment] = trimmed.split('/', 1);
  return firstSegment || null;
};

export const syncCadenceContextFromPathname = (pathname: string | null | undefined): SyncCadenceContext => {
  // Route-coupling contract:
  // if '/session-recorder' is renamed, update this constant and
  // docs/specs/ui/navigation-contract.md + docs/specs/tech/client-sync-engine.md.
  if (
    typeof pathname === 'string' &&
    normalizeFirstRouteSegment(pathname) === SESSION_RECORDER_ROUTE_SEGMENT
  ) {
    return 'session-recorder';
  }

  return 'general';
};

const cadenceForContext = (context: SyncCadenceContext) =>
  context === 'session-recorder' ? SYNC_SESSION_RECORDER_CADENCE_MS : SYNC_GENERAL_CADENCE_MS;

export const createSyncScheduler = (options: {
  flush?: () => Promise<SyncFlushResult>;
  setTimeoutFn?: (fn: () => void, delayMs: number) => TimerHandle;
  clearTimeoutFn?: (handle: TimerHandle) => void;
  isBootstrapInProgress?: () => boolean;
} = {}): SyncScheduler => {
  const flush = options.flush ?? (() => flushSyncOutbox());
  const setTimeoutFn = options.setTimeoutFn ?? ((fn, delayMs) => setTimeout(fn, delayMs));
  const clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle));
  const isBootstrapInProgress = options.isBootstrapInProgress ?? isRuntimeBootstrapInProgress;

  let running = false;
  let context: SyncCadenceContext = 'general';
  let online = true;
  let timer: TimerHandle | null = null;

  const clearTimer = () => {
    if (!timer) {
      return;
    }
    clearTimeoutFn(timer);
    timer = null;
  };

  const scheduleNextTick = () => {
    if (!running) {
      return;
    }

    clearTimer();
    timer = setTimeoutFn(() => {
      void tick();
    }, cadenceForContext(context));
  };

  const tick = async () => {
    if (!running) {
      return;
    }

    // Bug 4 fix: skip the flush while a bootstrap convergence loop is
    // active. The bootstrap owns the engine's single in-flight slot and a
    // scheduler tick during bootstrap would race for it, returning
    // {status: 'in_flight'} to whichever loser ran second.
    if (!isBootstrapInProgress()) {
      await flush();
    }
    scheduleNextTick();
  };

  return {
    start() {
      if (running) {
        return;
      }

      running = true;
      scheduleNextTick();
    },
    stop() {
      running = false;
      clearTimer();
    },
    setContext(nextContext) {
      if (context === nextContext) {
        return;
      }

      context = nextContext;
      if (running) {
        scheduleNextTick();
      }
    },
    setOnline(isOnline) {
      if (online === isOnline) {
        return;
      }

      const wasOnline = online;
      online = isOnline;
      setSyncNetworkOnline(isOnline);

      if (!running) {
        return;
      }

      if (!wasOnline && isOnline && !isBootstrapInProgress()) {
        void flush();
      }

      scheduleNextTick();
    },
    getContext() {
      return context;
    },
    isRunning() {
      return running;
    },
  };
};

const defaultSyncScheduler = createSyncScheduler();

export const startDefaultSyncScheduler = () => {
  defaultSyncScheduler.start();
};

export const stopDefaultSyncScheduler = () => {
  defaultSyncScheduler.stop();
};

export const setDefaultSyncCadenceContext = (context: SyncCadenceContext) => {
  defaultSyncScheduler.setContext(context);
};

export const setDefaultSyncCadenceContextFromPathname = (pathname: string | null | undefined) => {
  defaultSyncScheduler.setContext(syncCadenceContextFromPathname(pathname));
};

export const setDefaultSyncOnline = (isOnline: boolean) => {
  defaultSyncScheduler.setOnline(isOnline);
};
