export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSource = 'app' | 'backend' | 'database' | 'sync' | 'auth';

export type LogEventParams = {
  level: LogLevel;
  source?: LogSource;
  event: string;
  message?: string;
  userId?: string | null;
  context?: Record<string, unknown>;
};

/**
 * A captured log entry. Built once at log time (see `record.ts`) so the
 * timestamp, user id, and client metadata reflect when the event happened —
 * not when it is later flushed to the backend. Held in the in-memory buffer
 * (see `buffer.ts`) where it feeds both the dev viewer and the Supabase flush.
 */
export type LogRecord = {
  /** Monotonic id, assigned on push; used to identify entries in the viewer. */
  seq: number;
  /** ISO-8601 event time, captured at log time and sent as `created_at`. */
  createdAt: string;
  level: LogLevel;
  source: LogSource;
  event: string;
  message: string | null;
  userId: string | null;
  clientPlatform: string;
  clientAppVersion: string | null;
  clientBuildNumber: string | null;
  clientVariant: string | null;
  /** Already sanitized (sensitive keys dropped) — safe for the viewer too. */
  context: Record<string, unknown> | null;
};
