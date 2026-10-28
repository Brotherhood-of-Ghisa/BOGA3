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

/** The exercise fields an agent may write; create needs name and muscles. */
export type ExerciseFields = {
  bodyweight_contribution?: number;
  load_input_mode?: 'per_side_load' | 'total_load';
  muscles?: Array<{ muscle_id: string; role: 'primary' | 'secondary' }>;
  name?: string;
  /** Whole seconds 15..600; null clears it back to the person's global rest timer. */
  rest_timer_sec?: number | null;
  split_by_gym?: boolean;
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
      include_deleted?: boolean;
      limit?: number;
      muscle?: string;
      query?: string;
    },
  ): Promise<Record<string, unknown>> {
    return this.#getObject('v1/agent/exercises', accessToken, input);
  }

  async listMuscles(accessToken: string): Promise<Record<string, unknown>> {
    return this.#getObject('v1/agent/muscles', accessToken);
  }

  async createExercise(
    accessToken: string,
    input: { idempotency_key: string; exercise: ExerciseFields & Pick<Required<ExerciseFields>, 'muscles' | 'name'> },
  ): Promise<Record<string, unknown>> {
    return this.#postObject('v1/agent/exercises', accessToken, input.idempotency_key, input.exercise);
  }

  async updateExercise(
    accessToken: string,
    input: { idempotency_key: string; exercise_id: string; expected_revision: number; changes: ExerciseFields },
  ): Promise<Record<string, unknown>> {
    return this.#postObject(
      `v1/agent/exercises/${encodeURIComponent(input.exercise_id)}`,
      accessToken,
      input.idempotency_key,
      { ...input.changes, expected_revision: input.expected_revision },
    );
  }

  async setExerciseDeleted(
    accessToken: string,
    input: { idempotency_key: string; exercise_id: string; expected_revision: number },
    deleted: boolean,
  ): Promise<Record<string, unknown>> {
    return this.#postObject(
      `v1/agent/exercises/${encodeURIComponent(input.exercise_id)}/${deleted ? 'delete' : 'restore'}`,
      accessToken,
      input.idempotency_key,
      { expected_revision: input.expected_revision },
    );
  }

  async getExerciseContext(
    accessToken: string,
    input: { exercise_id: string; gym_bucket?: string; recent_sessions?: number },
  ): Promise<Record<string, unknown>> {
    return this.#getObject(
      `v1/agent/exercises/${encodeURIComponent(input.exercise_id)}/context`,
      accessToken,
      { gym_bucket: input.gym_bucket, recent_sessions: input.recent_sessions },
    );
  }

  async getRecentWorkouts(
    accessToken: string,
    input: { cursor?: string; limit?: number },
  ): Promise<Record<string, unknown>> {
    return this.#getObject('v1/agent/workouts/recent', accessToken, input);
  }

  async getTrainingStatus(accessToken: string): Promise<Record<string, unknown>> {
    return this.#getObject('v1/agent/training-status', accessToken);
  }

  async getExerciseHistory(
    accessToken: string,
    input: { cursor?: string; exercise_id: string; gym_bucket?: string; limit?: number },
  ): Promise<Record<string, unknown>> {
    return this.#getObject(
      `v1/agent/exercises/${encodeURIComponent(input.exercise_id)}/history`,
      accessToken,
      { cursor: input.cursor, gym_bucket: input.gym_bucket, limit: input.limit },
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
    const value = await this.#request('POST', relativePath, accessToken, {
      body,
      idempotencyKey,
    });
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

  async #get(
    relativePath: string,
    accessToken: string,
    query: Record<string, string | number | boolean | undefined> = {},
  ): Promise<unknown> {
    return this.#request('GET', relativePath, accessToken, { query });
  }

  async #request(
    method: 'GET' | 'POST',
    relativePath: string,
    accessToken: string,
    options: {
      body?: Record<string, unknown>;
      idempotencyKey?: string;
      query?: Record<string, string | number | boolean | undefined>;
    } = {},
  ): Promise<unknown> {
    if (!accessToken.trim()) {
      throw new BogaAgentApiError(401, 'UNAUTHORIZED', 'Authentication required.', null);
    }
    if (method === 'POST' && (!options.idempotencyKey || !options.idempotencyKey.trim())) {
      throw new BogaAgentApiError(400, 'INVALID_ARGUMENT', 'Idempotency key is required.', null);
    }
    const url = new URL(relativePath, this.#baseUrl);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    const requestId = randomUUID();
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.#timeoutMs);

    let response: Response;
    let payload: unknown;
    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
        'x-request-id': requestId,
      };
      let requestBody: string | undefined;
      if (method === 'POST') {
        headers['content-type'] = 'application/json';
        headers['idempotency-key'] = options.idempotencyKey!;
        requestBody = JSON.stringify(options.body ?? {});
      }

      response = await this.#fetch(url, {
        body: requestBody,
        headers,
        method,
        redirect: 'error',
        signal: abortController.signal,
      });

      try {
        payload = await response.json();
      } catch (bodyError) {
        if (abortController.signal.aborted) {
          throw bodyError;
        }
        throw new BogaAgentApiError(
          502,
          'INVALID_UPSTREAM_RESPONSE',
          'BoGa returned an invalid response.',
          response.headers.get('x-request-id') ?? requestId,
        );
      }
    } catch (error) {
      if (error instanceof BogaAgentApiError) {
        throw error;
      }
      const isAbort = abortController.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError');
      const message = isAbort
        ? 'BoGa agent API timed out.'
        : 'BoGa agent API is unavailable.';
      throw new BogaAgentApiError(502, 'UPSTREAM_UNAVAILABLE', message, requestId);
    } finally {
      clearTimeout(timeout);
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
