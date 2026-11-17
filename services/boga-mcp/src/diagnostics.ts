import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const requestContext = new AsyncLocalStorage<{ request_id: string }>();
let windowStart = 0;
let count = 0;
let suppressed = 0;
// Hard per-process ceiling; no request bodies, raw claims or exception messages.
export const diagnostic = (event: string, fields: Record<string, unknown> = {}): void => {
  try {
    const now = Date.now();
    if (now - windowStart >= 60_000) { windowStart = now; count = 0; }
    if (++count > 6000) { suppressed++; return; }
    console.log(JSON.stringify({ ...fields, service: 'boga-mcp', event,
      request_id: requestContext.getStore()?.request_id, timestamp: new Date(now).toISOString(),
      suppressed_since_last: suppressed }));
    suppressed = 0;
  } catch { /* Diagnostics must never affect authentication. */ }
};

export const privateTag = (kind: string, value: string): string | undefined => {
  const key = process.env.AUTH_DIAGNOSTIC_HMAC_KEY;
  if (!key || key.length < 32) return undefined;
  return createHmac('sha256', key).update(`${kind}:${value}`).digest('hex').slice(0, 24);
};

export const requestDiagnostics: RequestHandler = (req, res, next) => {
  // Always generate IDs: arbitrary caller IDs can contain personal/secret data.
  const request_id = randomUUID();
  requestContext.run({ request_id }, () => {
    const start = performance.now();
    res.set('x-request-id', request_id);
    const endpoint = ['/mcp', '/health'].includes(req.path) ? req.path
      : req.path.startsWith('/.well-known/') ? 'oauth_metadata' : 'other';
    diagnostic('http.request', { method: req.method, endpoint,
      authorization_present: Boolean(req.headers.authorization),
      bearer_present: /^Bearer \S+/i.test(req.headers.authorization ?? '') });
    res.on('finish', () => requestContext.run({ request_id }, () => {
      const operation = ['initialize', 'tools/list', 'tools/call'].includes(req.body?.method)
        ? req.body.method : 'other';
      const tool = req.body?.params?.name;
      const tool_name = ['get_training_profile', 'search_exercises', 'list_muscles', 'create_exercise', 'update_exercise', 'delete_exercise', 'restore_exercise', 'get_exercise_context', 'get_recent_workouts', 'get_training_status', 'get_recent_activities', 'list_notes', 'add_note', 'remove_note', 'get_active_injuries', 'log_injury', 'update_injury_status', 'set_muscle_targets', 'get_exercise_history', 'get_workout_detail', 'get_upcoming_session_plans', 'create_session_plan', 'create_training_programme', 'get_active_workout', 'create_workout', 'start_workout', 'log_sets', 'update_set', 'delete_set', 'finish_workout'].includes(tool) ? tool : undefined;
      diagnostic('http.response', { method: req.method, endpoint, operation, tool_name,
        status: res.statusCode, latency_ms: Math.round(performance.now() - start) });
    }));
    next();
  });
};
