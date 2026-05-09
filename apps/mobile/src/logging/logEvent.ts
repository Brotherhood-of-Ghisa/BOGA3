import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { getSupabaseMobileClient } from '@/src/auth/supabase';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogSource = 'app' | 'backend' | 'database' | 'sync' | 'auth';

export type LogEventParams = {
  level: LogLevel;
  source?: LogSource;
  event: string;
  message?: string;
  userId?: string | null;
  context?: Record<string, unknown>;
};

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /authorization/i,
  /^cookie$/i,
  /^session$/i,
  /^user$/i,
  /api[_-]?key/i,
  /anon[_-]?key/i,
  /service[_-]?role/i,
];

const MAX_CONTEXT_DEPTH = 5;
const MAX_ARRAY_ITEMS = 20;

const isSensitiveKey = (key: string) => SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

const sanitizeContextValue = (value: unknown, depth: number): unknown => {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (depth >= MAX_CONTEXT_DEPTH) {
    return '[truncated]';
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((entry) => {
      const sanitized = sanitizeContextValue(entry, depth + 1);
      return sanitized === undefined ? null : sanitized;
    });
  }

  if (isPlainObject(value)) {
    const sanitizedEntries = Object.entries(value).flatMap(([key, entry]) => {
      if (isSensitiveKey(key)) {
        return [];
      }

      const sanitized = sanitizeContextValue(entry, depth + 1);
      return sanitized === undefined ? [] : [[key, sanitized] as const];
    });

    return Object.fromEntries(sanitizedEntries);
  }

  return value;
};

const sanitizeContext = (context: Record<string, unknown> | undefined) => {
  if (!context) {
    return null;
  }

  return sanitizeContextValue(context, 0) as Record<string, unknown>;
};

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

export const logEvent = async ({
  level,
  source = 'app',
  event,
  message,
  userId = null,
  context,
}: LogEventParams): Promise<void> => {
  try {
    const client = getSupabaseMobileClient();
    if (!client) {
      return;
    }

    const { error } = await client.from('app_logs').insert({
      level,
      source,
      event,
      message: message ?? null,
      user_id: userId,
      client_platform: Platform.OS,
      client_app_version: normalizeOptionalString(Application.nativeApplicationVersion) ?? readExpoConfigValue('version'),
      client_build_number: normalizeOptionalString(Application.nativeBuildVersion),
      client_runtime_version: null,
      client_update_id: null,
      client_channel: null,
      client_variant: readExpoConfigValue('env'),
      context: sanitizeContext(context),
    });

    if (error) {
      throw error;
    }
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[logging] app log insert failed', error);
    }
    // Logging must never interrupt auth, sync, or local-first app flows.
  }
};
