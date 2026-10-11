import { randomUUID } from 'node:crypto';

export type AgentSession = {
  access: 'training_read_only';
  authorized: true;
  client_id: string;
  expires_at: number;
  scopes: string[];
};

type ApiEnvelope = {
  data: unknown;
  meta: {
    api_version: string;
    request_id: string;
  };
};

type ApiErrorEnvelope = {
  error?: {
    code?: unknown;
    message?: unknown;
    request_id?: unknown;
  };
};

export class BogaAgentApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = 'BogaAgentApiError';
  }
}

export type BogaAgentApiOptions = {
  baseUrl: URL;
  fetchImplementation?: typeof fetch;
  timeoutMs: number;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseSession = (value: unknown): AgentSession => {
  if (
    !isObject(value) ||
    value.authorized !== true ||
    value.access !== 'training_read_only' ||
    typeof value.client_id !== 'string' ||
    value.client_id.length === 0 ||
    typeof value.expires_at !== 'number' ||
    !Number.isSafeInteger(value.expires_at) ||
    !Array.isArray(value.scopes) ||
    !value.scopes.every((scope) => typeof scope === 'string')
  ) {
    throw new BogaAgentApiError(
      502,
      'INVALID_UPSTREAM_RESPONSE',
      'BoGa returned an invalid agent session.',
      null,
    );
  }
  return value as AgentSession;
};

export class BogaAgentApi {
  readonly #baseUrl: URL;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: BogaAgentApiOptions) {
    this.#baseUrl = new URL(options.baseUrl.href);
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#timeoutMs = options.timeoutMs;
  }

  async verifySession(accessToken: string): Promise<AgentSession> {
    return parseSession(await this.#get('v1/agent/session', accessToken));
  }

  async getTrainingProfile(accessToken: string): Promise<Record<string, unknown>> {
    return this.#getObject('v1/agent/profile', accessToken);
  }

  async searchExercises(
    accessToken: string,
    input: {
      cursor?: string;
      equipment?: string;
      limit?: number;
      muscle?: string;
      query?: string;
    },
  ): Promise<Record<string, unknown>> {
    return this.#getObject('v1/agent/exercises', accessToken, input);
  }

  async getExerciseContext(
    accessToken: string,
    input: { exercise_id: string; recent_sessions?: number },
  ): Promise<Record<string, unknown>> {
    return this.#getObject(
      `v1/agent/exercises/${encodeURIComponent(input.exercise_id)}/context`,
      accessToken,
      { recent_sessions: input.recent_sessions },
    );
  }

  async getRecentWorkouts(
    accessToken: string,
    input: { cursor?: string; limit?: number },
  ): Promise<Record<string, unknown>> {
    return this.#getObject('v1/agent/workouts/recent', accessToken, input);
  }

  async getExerciseHistory(
    accessToken: string,
    input: { cursor?: string; exercise_id: string; limit?: number },
  ): Promise<Record<string, unknown>> {
    return this.#getObject(
      `v1/agent/exercises/${encodeURIComponent(input.exercise_id)}/history`,
      accessToken,
      { cursor: input.cursor, limit: input.limit },
    );
  }

  async getWorkoutDetail(
    accessToken: string,
    input: { cursor?: string; limit?: number; session_id: string },
  ): Promise<Record<string, unknown>> {
    return this.#getObject(
      `v1/agent/workouts/${encodeURIComponent(input.session_id)}`,
      accessToken,
      { cursor: input.cursor, limit: input.limit },
    );
  }

  async getUpcomingSessionPlans(
    accessToken: string,
    input: { cursor?: string; include_unscheduled?: boolean; limit?: number },
  ): Promise<Record<string, unknown>> {
    return this.#getObject(
      'v1/agent/session-plans',
      accessToken,
      {
        cursor: input.cursor,
        include_unscheduled: input.include_unscheduled,
        limit: input.limit,
      },
    );
  }

  async createSessionPlan(
    accessToken: string,
    input: {
      idempotency_key: string;
      plan: {
        exercises: Array<{
          exercise_definition_id?: string;
          name: string;
          sets: Array<{
            target_reps: number;
            target_set_type?: string;
            target_weight_value?: string;
          }>;
        }>;
        gym_id?: string;
        scheduled_for?: number;
        title: string;
      };
    },
  ): Promise<Record<string, unknown>> {
    return this.#postObject(
      'v1/agent/session-plans',
      accessToken,
      input.idempotency_key,
      input.plan,
    );
  }

  async createTrainingProgramme(
    accessToken: string,
    input: {
      idempotency_key: string;
      programme: {
        description?: string;
        name: string;
        plans: Array<{
          exercises: Array<{
            exercise_definition_id?: string;
            name: string;
            sets: Array<{
              target_reps: number;
              target_set_type?: string;
              target_weight_value?: string;
            }>;
          }>;
          gym_id?: string;
          scheduled_for?: number;
          title: string;
        }>;
      };
    },
  ): Promise<Record<string, unknown>> {
    return this.#postObject(
      'v1/agent/programmes',
      accessToken,
      input.idempotency_key,
      input.programme,
    );
  }

  async #getObject(
    relativePath: string,
    accessToken: string,
    query: Record<string, string | number | boolean | undefined> = {},
  ): Promise<Record<string, unknown>> {
    const value = await this.#get(relativePath, accessToken, query);
    if (!isObject(value)) {
      throw new BogaAgentApiError(
        502,
        'INVALID_UPSTREAM_RESPONSE',
        'BoGa returned an invalid response.',
        null,
      );
    }
    return value;
  }

  async #postObject(
    relativePath: string,
    accessToken: string,
    idempotencyKey: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const value = await this.#post(relativePath, accessToken, idempotencyKey, body);
    if (!isObject(value)) {
      throw new BogaAgentApiError(
        502,
        'INVALID_UPSTREAM_RESPONSE',
        'BoGa returned an invalid response.',
        null,
      );
    }
    return value;
  }

  async #post(
    relativePath: string,
    accessToken: string,
    idempotencyKey: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    if (!accessToken.trim()) {
      throw new BogaAgentApiError(401, 'UNAUTHORIZED', 'Authentication required.', null);
    }
    if (!idempotencyKey.trim()) {
      throw new BogaAgentApiError(400, 'INVALID_ARGUMENT', 'Idempotency key is required.', null);
    }
    const url = new URL(relativePath, this.#baseUrl);
    const requestId = randomUUID();
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.#timeoutMs);

    let response: Response;
    try {
      response = await this.#fetch(url, {
        body: JSON.stringify(body),
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
          'x-request-id': requestId,
        },
        method: 'POST',
        redirect: 'error',
        signal: abortController.signal,
      });
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError'
        ? 'BoGa agent API timed out.'
        : 'BoGa agent API is unavailable.';
      throw new BogaAgentApiError(502, 'UPSTREAM_UNAVAILABLE', message, requestId);
    } finally {
      clearTimeout(timeout);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new BogaAgentApiError(
        502,
        'INVALID_UPSTREAM_RESPONSE',
        'BoGa returned an invalid response.',
        response.headers.get('x-request-id') ?? requestId,
      );
    }

    if (!response.ok) {
      const errorPayload = isObject(payload) ? payload as ApiErrorEnvelope : {};
      const details = isObject(errorPayload.error) ? errorPayload.error : {};
      throw new BogaAgentApiError(
        response.status,
        typeof details.code === 'string' ? details.code : 'UPSTREAM_ERROR',
        typeof details.message === 'string'
          ? details.message
          : 'The BoGa agent request failed.',
        typeof details.request_id === 'string'
          ? details.request_id
          : response.headers.get('x-request-id') ?? requestId,
      );
    }

    if (
      !isObject(payload) ||
      !('data' in payload) ||
      !isObject(payload.meta) ||
      typeof payload.meta.api_version !== 'string' ||
      typeof payload.meta.request_id !== 'string'
    ) {
      throw new BogaAgentApiError(
        502,
        'INVALID_UPSTREAM_RESPONSE',
        'BoGa returned an invalid response.',
        response.headers.get('x-request-id') ?? requestId,
      );
    }
    return (payload as ApiEnvelope).data;
  }

  async #get(
    relativePath: string,
    accessToken: string,
    query: Record<string, string | number | boolean | undefined> = {},
  ): Promise<unknown> {
    if (!accessToken.trim()) {
      throw new BogaAgentApiError(401, 'UNAUTHORIZED', 'Authentication required.', null);
    }
    const url = new URL(relativePath, this.#baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const requestId = randomUUID();
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.#timeoutMs);

    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${accessToken}`,
          'x-request-id': requestId,
        },
        method: 'GET',
        redirect: 'error',
        signal: abortController.signal,
      });
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError'
        ? 'BoGa agent API timed out.'
        : 'BoGa agent API is unavailable.';
      throw new BogaAgentApiError(502, 'UPSTREAM_UNAVAILABLE', message, requestId);
    } finally {
      clearTimeout(timeout);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new BogaAgentApiError(
        502,
        'INVALID_UPSTREAM_RESPONSE',
        'BoGa returned an invalid response.',
        response.headers.get('x-request-id') ?? requestId,
      );
    }

    if (!response.ok) {
      const errorPayload = isObject(payload) ? payload as ApiErrorEnvelope : {};
      const details = isObject(errorPayload.error) ? errorPayload.error : {};
      throw new BogaAgentApiError(
        response.status,
        typeof details.code === 'string' ? details.code : 'UPSTREAM_ERROR',
        typeof details.message === 'string'
          ? details.message
          : 'The BoGa agent request failed.',
        typeof details.request_id === 'string'
          ? details.request_id
          : response.headers.get('x-request-id') ?? requestId,
      );
    }

    if (
      !isObject(payload) ||
      !('data' in payload) ||
      !isObject(payload.meta) ||
      typeof payload.meta.api_version !== 'string' ||
      typeof payload.meta.request_id !== 'string'
    ) {
      throw new BogaAgentApiError(
        502,
        'INVALID_UPSTREAM_RESPONSE',
        'BoGa returned an invalid response.',
        response.headers.get('x-request-id') ?? requestId,
      );
    }
    return (payload as ApiEnvelope).data;
  }
}
