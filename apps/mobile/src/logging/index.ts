export { logEvent } from './logEvent';
export type { LogEventParams, LogLevel, LogSource, LogRecord } from './types';

// Auth mirrors the signed-in user here and triggers a flush on login.
export { setLoggingUserId } from './currentUser';
export { flushLogs, startLogFlushLoop, stopLogFlushLoop } from './flush';

// Dev-only in-app log viewer reads the buffer through these.
export { getRecentLogs, subscribeToLogs, clearRecentLogs } from './buffer';
