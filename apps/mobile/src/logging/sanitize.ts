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

/**
 * Recursively strip sensitive keys (passwords, tokens, sessions, …) from a log
 * context before it leaves the call site. Runs at log time so neither the
 * backend nor the in-app viewer ever holds the raw values. Depth- and
 * array-bounded to keep a pathological object from blowing up the buffer.
 */
export const sanitizeContext = (
  context: Record<string, unknown> | undefined
): Record<string, unknown> | null => {
  if (!context) {
    return null;
  }

  return sanitizeContextValue(context, 0) as Record<string, unknown>;
};
