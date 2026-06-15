import type { LogRecord } from './types';

/**
 * In-memory log buffer. Two structures with deliberately different retention:
 *
 *   - `recent` — a bounded ring of ALL levels, overwrite-oldest. Ephemeral
 *     display history that feeds the dev-only in-app viewer.
 *   - `pending` — a bounded FIFO of `warn`/`error` only, not yet persisted to
 *     Supabase. Held until a flush inserts them; on overflow the oldest are
 *     dropped and counted (the count surfaces as a synthetic `logging.dropped`
 *     record on the next flush — a dropped log is never silently swallowed).
 *
 * Everything is process-local and lost on app kill; Phase 1 has no on-disk
 * persistence by design (a crash that kills the JS runtime loses un-flushed
 * entries — capturing those needs a native store and is out of scope here).
 */
const RECENT_CAPACITY = 500;
const PENDING_CAPACITY = 200;

const recent: LogRecord[] = [];
const pending: LogRecord[] = [];
let droppedSinceFlush = 0;
let seqCounter = 0;

const subscribers = new Set<() => void>();

const notify = () => {
  for (const subscriber of subscribers) {
    subscriber();
  }
};

/** Assign the next monotonic sequence id (used when a record is built). */
export const nextLogSeq = (): number => {
  seqCounter += 1;
  return seqCounter;
};

/**
 * Record a log entry. Always appended to `recent`; additionally queued for
 * flush when it is a `warn`/`error`. Notifies viewer subscribers once.
 */
export const pushLog = (record: LogRecord): void => {
  recent.push(record);
  if (recent.length > RECENT_CAPACITY) {
    recent.splice(0, recent.length - RECENT_CAPACITY);
  }

  if (record.level === 'warn' || record.level === 'error') {
    pending.push(record);
    if (pending.length > PENDING_CAPACITY) {
      const overflow = pending.length - PENDING_CAPACITY;
      pending.splice(0, overflow);
      droppedSinceFlush += overflow;
    }
  }

  notify();
};

/** Newest-last snapshot of the display ring (viewer reverses for newest-first). */
export const getRecentLogs = (): LogRecord[] => recent.slice();

/** The leading `count` un-flushed warn/error records, without removing them. */
export const peekPendingLogs = (count: number): LogRecord[] => pending.slice(0, count);

/** Drop the leading `count` records after a successful flush. */
export const removePendingLogs = (count: number): void => {
  pending.splice(0, count);
};

/** Read and reset the overflow-drop counter (emitted as a notice on flush). */
export const drainDroppedCount = (): number => {
  const dropped = droppedSinceFlush;
  droppedSinceFlush = 0;
  return dropped;
};

export const subscribeToLogs = (subscriber: () => void): (() => void) => {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
};

/** Viewer "clear" — wipes the display ring only; un-flushed entries survive. */
export const clearRecentLogs = (): void => {
  recent.length = 0;
  notify();
};

export const __resetLogBufferForTests = (): void => {
  recent.length = 0;
  pending.length = 0;
  droppedSinceFlush = 0;
  seqCounter = 0;
  subscribers.clear();
};
