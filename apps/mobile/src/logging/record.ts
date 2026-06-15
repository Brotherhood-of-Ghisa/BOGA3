import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { getLoggingUserId } from './currentUser';
import { sanitizeContext } from './sanitize';
import { nextLogSeq } from './buffer';
import type { LogEventParams, LogRecord } from './types';

const normalizeOptionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

const readExpoConfigValue = (key: string): string | null => {
  const expoConfig = Constants.expoConfig as
    | {
        extra?: Record<string, unknown>;
        version?: string | null;
      }
    | null
    | undefined;
  const value = key === 'version' ? expoConfig?.version : expoConfig?.extra?.[key];
  return normalizeOptionalString(value);
};

const captureClientMetadata = () => ({
  clientPlatform: Platform.OS,
  clientAppVersion:
    normalizeOptionalString(Application.nativeApplicationVersion) ?? readExpoConfigValue('version'),
  clientBuildNumber: normalizeOptionalString(Application.nativeBuildVersion),
  clientVariant: readExpoConfigValue('env'),
});

/**
 * Build an immutable log record from a call site's params, capturing the
 * timestamp, user id, and client metadata NOW (at log time) so a later flush
 * preserves when the event actually happened. An explicit `userId` (including
 * `null`) is honoured; otherwise the current authenticated user is mirrored
 * from the auth service synchronously — no session round-trip.
 */
export const buildRecord = ({
  level,
  source = 'app',
  event,
  message,
  userId,
  context,
}: LogEventParams): LogRecord => ({
  seq: nextLogSeq(),
  createdAt: new Date().toISOString(),
  level,
  source,
  event,
  message: message ?? null,
  userId: userId === undefined ? getLoggingUserId() : userId,
  ...captureClientMetadata(),
  context: sanitizeContext(context),
});

/**
 * Synthetic record emitted when the pending queue overflowed and dropped
 * entries — so the loss is visible in the backend rather than silent.
 */
export const buildDropNotice = (droppedCount: number): LogRecord => ({
  seq: nextLogSeq(),
  createdAt: new Date().toISOString(),
  level: 'warn',
  source: 'app',
  event: 'logging.dropped',
  message: `Dropped ${droppedCount} buffered log entries before flush (pending queue overflow).`,
  userId: getLoggingUserId(),
  ...captureClientMetadata(),
  context: { droppedCount },
});

/** Map a record to the `app_logs` insert payload (DB column names). */
export const toInsertRow = (record: LogRecord) => ({
  created_at: record.createdAt,
  level: record.level,
  source: record.source,
  event: record.event,
  message: record.message,
  user_id: record.userId,
  client_platform: record.clientPlatform,
  client_app_version: record.clientAppVersion,
  client_build_number: record.clientBuildNumber,
  client_runtime_version: null,
  client_update_id: null,
  client_channel: null,
  client_variant: record.clientVariant,
  context: record.context,
});
