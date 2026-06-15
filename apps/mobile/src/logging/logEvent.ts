import { pushLog } from './buffer';
import { flushLogs } from './flush';
import { buildRecord } from './record';
import type { LogEventParams, LogRecord } from './types';

export type { LogEventParams, LogLevel, LogSource } from './types';

const emitToConsole = (record: LogRecord): void => {
  const prefix = `[${record.source}] ${record.event}`;
  const parts: unknown[] = [prefix];
  if (record.message) {
    parts.push(record.message);
  }
  if (record.context) {
    parts.push(record.context);
  }

  // Call the live console methods (not a captured reference) so debug/info land
  // on console.log and warn/error on their matching channels — and so dev tools
  // or tests that override console are respected.
  switch (record.level) {
    case 'error':
      console.error(...parts);
      break;
    case 'warn':
      console.warn(...parts);
      break;
    default:
      console.log(...parts);
      break;
  }
};

/**
 * Log an application event. Behaviour by level:
 *
 *   - ALL levels → printed to the console (visible in the Metro/Expo dev
 *     server and the in-app dev viewer) and pushed to the in-memory buffer.
 *   - `warn` / `error` → additionally queued for durable persistence to
 *     Supabase `app_logs`, flushed (batched) once signed in. A best-effort
 *     immediate flush is kicked here so errors surface promptly; the flush
 *     self-gates on auth and an in-flight guard, so this stays cheap.
 *
 * Fire-and-forget: always resolves, never throws — logging must never
 * interrupt auth, sync, or local-first app flows. The `async`/`Promise<void>`
 * signature is preserved for the existing ~30 call sites (and lets a caller
 * `await` an `info` write in tests), but no I/O is awaited here.
 */
export const logEvent = async (params: LogEventParams): Promise<void> => {
  try {
    const record = buildRecord(params);
    emitToConsole(record);
    pushLog(record);

    if (record.level === 'warn' || record.level === 'error') {
      void flushLogs();
    }
  } catch {
    // Never let logging throw into a caller.
  }
};
