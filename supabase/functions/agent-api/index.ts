import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.98.0';

import { summarizeVolume } from '../../../apps/mobile/src/exercise-calculations/load-metrics.ts';
import { createRecordBook } from '../../../apps/mobile/src/exercise-calculations/records.ts';
import { isSessionSetType } from '../../../apps/mobile/src/data/set-types.ts';
import { isRestTimerSec } from '../../../apps/mobile/src/exercise-core/rest-timer.ts';
import {
  AUTH_RETRY_AFTER_SECONDS, authUpstreamFetch, isTokenRejection,
} from './auth-upstream.ts';
import {
  ExerciseEditError, normalizeExerciseCreate, normalizeExerciseRevision, normalizeExerciseUpdate,
} from './exercise-edit.ts';
import {
  GymBucketError, gymBucketFromCursor, gymBucketFromParam, rankGymBuckets,
  type GymBucketRank,
} from './gym-buckets.ts';
import {
  buildTrainingStatus, rankFavouriteExercises, resolveStatusTimeZone, STATUS_READ_DAYS, trainingStatusWindow,
  type StatusBlockRow, type StatusDefinitionRow, type StatusMappingRow, type StatusMuscleRow,
  type StatusSessionRow, type StatusSetRow, type StatusSettingsRow, type StatusTraining,
} from './training-status.ts';
import {
  METRIC_REVISION, exerciseLoadPayload, projectTrainingSets, sessionWeightPayload, volumePayload,
  type ExerciseLoadRow, type SessionWeightRow, type EnteredSetRow,
} from './training-metrics.ts';

const API_VERSION = 'v1';
const DEFAULT_EXERCISE_LIMIT = 20;
const MAX_EXERCISE_LIMIT = 50;
const DEFAULT_RECENT_SESSIONS = 5;
const MAX_RECENT_SESSIONS = 20;
/** The longest `gym_buckets` list a split exercise reports, newest first. */
const MAX_GYM_BUCKETS = 50;
const DEFAULT_WORKOUT_LIMIT = 10;
const MAX_WORKOUT_LIMIT = 25;
const DEFAULT_SET_LIMIT = 20;
const MAX_SET_LIMIT = 100;
const MAX_CONTEXT_BLOCKS = 500;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;
const RATE_LIMIT_REQUESTS = 120;
const RATE_LIMIT_WINDOW_MS = 60_000;
const WRITE_RATE_LIMIT_REQUESTS = 30;
const DEFAULT_PLAN_LIMIT = 20;
const MAX_PLAN_LIMIT = 50;
const MIN_PROGRAMME_PLANS = 2;
const MAX_PROGRAMME_PLANS = 50;
const MAX_PLAN_BLOCKS = 30;
const MAX_PLAN_SETS = 30;
const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const ISO_DATE_MIN_MS = -8_640_000_000_000_000;
const ISO_DATE_MAX_MS = 8_640_000_000_000_000;

const CORS_HEADERS = {
  'access-control-allow-headers': 'authorization, content-type, x-request-id, idempotency-key',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-origin': '*',
};

type JsonObject = Record<string, unknown>;

type AuthenticatedAgent = {
  accessToken: string;
  clientId: string;
  expiresAt: number;
  grantedAt: string;
  scopes: string[];
  userId: string;
};

type RateWindow = {
  count: number;
  resetAt: number;
};

type ExerciseDefinitionRow = ExerciseLoadRow & {
  id: string;
  load_input_mode: string;
  name: string;
  split_by_gym: boolean;
  /** The exercise's own rest timer in seconds; null uses the device's global timer. */
  rest_timer_sec: number | null;
};

/** The revision an exercise edit must quote is the definition's LWW stamp. */
type CatalogExerciseRow = ExerciseDefinitionRow & {
  client_updated_at_ms: number;
  deleted_at: number | null;
};

type MappingRow = {
  exercise_definition_id: string;
  muscle_group_id: string;
  role: string | null;
  weight: number;
};

type MuscleGroupRow = {
  display_name: string;
  family_name: string;
  id: string;
};

type SessionExerciseRow = {
  exercise_definition_id: string | null;
  id: string;
  machine_name: string | null;
  name: string;
  order_index: number;
  session_id: string;
};

type SessionRow = SessionWeightRow & {
  completed_at: number | null;
  duration_sec: number | null;
  gym_id: string | null;
  id: string;
  started_at: number;
};

type SetRow = EnteredSetRow & { session_exercise_id: string };

/** An out-of-range stored value reads as null, as the app ignores it ([[timer.rest-default]]). */
const projectRestTimerSec = (value: number | null): number | null => (isRestTimerSec(value) ? value : null);

const EXERCISE_COLUMNS = 'id,name,load_input_mode,bodyweight_contribution,split_by_gym,rest_timer_sec';
/** Catalog reads add what an exercise edit needs: its revision and deleted state. */
const CATALOG_EXERCISE_COLUMNS = `${EXERCISE_COLUMNS},client_updated_at_ms,deleted_at`;
const SESSION_COLUMNS = 'id,gym_id,started_at,completed_at,duration_sec';

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

const rateWindows = new Map<string, RateWindow>();
const writeRateWindows = new Map<string, RateWindow>();
// Exercise edits count apart from plan writes, so curating a catalog does not
// use up a coach's plan-writing allowance (and the reverse).
const exerciseWriteRateWindows = new Map<string, RateWindow>();

const getRequiredEnv = (name: string): string => {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing required Edge Function environment variable: ${name}`);
  }
  return value;
};

const getSupabaseUrl = () => getRequiredEnv('SUPABASE_URL').replace(/\/+$/, '');
const getAnonKey = () =>
  Deno.env.get('SUPABASE_ANON_KEY')?.trim() ||
  Deno.env.get('SUPABASE_PUBLISHABLE_KEY')?.trim() ||
  getRequiredEnv('ANON_KEY');
const getServiceRoleKey = () => getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');

const createServerClient = (key: string, fetchImpl?: typeof fetch): SupabaseClient =>
  createClient(getSupabaseUrl(), key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
  });

const extractBearerToken = (request: Request): string => {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
  }
  return match[1];
};

const decodeValidatedJwtPayload = (token: string): JsonObject => {
  const segments = token.split('.');
  if (segments.length !== 3) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
  }

  try {
    const padded = segments[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(
      Math.ceil(segments[1].length / 4) * 4,
      '=',
    );
    return JSON.parse(atob(padded)) as JsonObject;
  } catch {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
  }
};

const normalizeGrantRows = (value: unknown): JsonObject[] => {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is JsonObject =>
      typeof entry === 'object' && entry !== null
    );
  }
  if (typeof value === 'object' && value !== null) {
    const candidates = (value as JsonObject).grants;
    if (Array.isArray(candidates)) {
      return normalizeGrantRows(candidates);
    }
  }
  return [];
};

const grantClientId = (grant: JsonObject): string | null => {
  if (typeof grant.client_id === 'string') {
    return grant.client_id;
  }
  if (typeof grant.client === 'object' && grant.client !== null) {
    const id = (grant.client as JsonObject).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
};

const grantGrantedAt = (grant: JsonObject): string | null => {
  const value = grant.granted_at;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

const authUnavailable = (step: string, status: unknown): ApiError => {
  console.error('[agent-api] Supabase Auth unavailable', { step, status: status ?? null });
  return new ApiError(
    503,
    'UPSTREAM_UNAVAILABLE',
    'Authorization could not be verified. Try again shortly.',
    AUTH_RETRY_AFTER_SECONDS,
  );
};

const getValidatedUser = async (accessToken: string): Promise<{ id: string }> => {
  let result;
  try {
    result = await createServerClient(getAnonKey(), authUpstreamFetch).auth.getUser(accessToken);
  } catch {
    throw authUnavailable('user', null);
  }
  const { data: { user }, error } = result;
  if (error && !isTokenRejection(error.status)) {
    throw authUnavailable('user', error.status);
  }
  if (error || !user) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
  }
  return user;
};

const fetchActiveGrants = async (accessToken: string): Promise<JsonObject[]> => {
  let response: Response;
  try {
    response = await authUpstreamFetch(`${getSupabaseUrl()}/auth/v1/user/oauth/grants`, {
      headers: {
        apikey: getAnonKey(),
        authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw authUnavailable('grants', null);
  }
  if (isTokenRejection(response.status)) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Agent authorization required.');
  }
  if (!response.ok) {
    throw authUnavailable('grants', response.status);
  }
  try {
    return normalizeGrantRows(await response.json());
  } catch {
    throw authUnavailable('grants', response.status);
  }
};

const authenticateAgent = async (request: Request): Promise<AuthenticatedAgent> => {
  const accessToken = extractBearerToken(request);
  const user = await getValidatedUser(accessToken);

  // Decode claims only after Supabase Auth has validated the token and live
  // session. Identity still comes from the validated Auth user, never from an
  // unverified caller field.
  const claims = decodeValidatedJwtPayload(accessToken);
  const clientId = claims.client_id;
  const subject = claims.sub;
  const expiry = claims.exp;
  const rawScope = claims.scope;
  if (
    typeof clientId !== 'string' ||
    clientId.trim().length === 0 ||
    typeof subject !== 'string' ||
    subject !== user.id ||
    typeof expiry !== 'number' ||
    expiry * 1000 <= Date.now()
  ) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Agent authorization required.');
  }

  const grants = await fetchActiveGrants(accessToken);
  const matchedGrant = grants.find((grant) => grantClientId(grant) === clientId);
  const grantedAt = matchedGrant ? grantGrantedAt(matchedGrant) : null;
  if (!grantedAt) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Agent authorization required.');
  }

  return {
    accessToken,
    clientId,
    expiresAt: expiry,
    grantedAt,
    scopes: typeof rawScope === 'string'
      ? rawScope.split(/\s+/).filter((scope) => scope.length > 0)
      : [],
    userId: user.id,
  };
};

const requestIdFor = (request: Request): string => {
  const supplied = request.headers.get('x-request-id')?.trim() ?? '';
  return /^[A-Za-z0-9._:-]{1,100}$/.test(supplied) ? supplied : crypto.randomUUID();
};

const canonicalAgentPath = (url: URL): string => {
  const marker = `/${API_VERSION}/agent`;
  const markerIndex = url.pathname.indexOf(marker);
  return markerIndex >= 0 ? url.pathname.slice(markerIndex) : url.pathname;
};

const routeToolName = (path: string, method: string): string => {
  if (path === '/v1/agent/session') return 'mcp_session';
  if (path === '/v1/agent/profile') return 'get_training_profile';
  if (path === '/v1/agent/exercises') {
    return method === 'POST' ? 'create_exercise' : 'search_exercises';
  }
  if (path === '/v1/agent/muscles') return 'list_muscles';
  if (method === 'POST' && /^\/v1\/agent\/exercises\/[^/]+\/delete$/.test(path)) return 'delete_exercise';
  if (method === 'POST' && /^\/v1\/agent\/exercises\/[^/]+\/restore$/.test(path)) return 'restore_exercise';
  if (method === 'POST' && /^\/v1\/agent\/exercises\/[^/]+$/.test(path)) return 'update_exercise';
  if (path === '/v1/agent/workouts/recent') return 'get_recent_workouts';
  if (path === '/v1/agent/training-status') return 'get_training_status';
  if (path === '/v1/agent/session-plans') {
    return method === 'POST' ? 'create_session_plan' : 'get_upcoming_session_plans';
  }
  if (path === '/v1/agent/programmes') return 'create_training_programme';
  if (/^\/v1\/agent\/exercises\/[^/]+\/context$/.test(path)) {
    return 'get_exercise_context';
  }
  if (/^\/v1\/agent\/exercises\/[^/]+\/history$/.test(path)) {
    return 'get_exercise_history';
  }
  if (/^\/v1\/agent\/workouts\/[^/]+$/.test(path)) {
    return 'get_workout_detail';
  }
  return 'unknown_agent_route';
};

const rejectIdentityInputs = (url: URL): void => {
  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized === 'userid' || normalized === 'owneruserid') {
      throw new ApiError(400, 'INVALID_ARGUMENT', 'User identity is derived from the token.');
    }
  }
};

const rejectUnexpectedQuery = (url: URL, allowed: ReadonlySet<string>): void => {
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) {
      throw new ApiError(400, 'INVALID_ARGUMENT', `Unsupported query parameter: ${key}`);
    }
  }
};

const rejectRequestBody = (request: Request): void => {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > 0) {
    throw new ApiError(400, 'INVALID_ARGUMENT', 'GET routes do not accept a request body.');
  }
};

const enforceRateLimit = (
  windows: Map<string, RateWindow>,
  agent: AuthenticatedAgent,
  limit: number,
): void => {
  const key = `${agent.userId}:${agent.clientId}`;
  const now = Date.now();
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  existing.count += 1;
  if (existing.count > limit) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many agent requests. Try again shortly.');
  }
};

const enforceReadRateLimit = (agent: AuthenticatedAgent): void =>
  enforceRateLimit(rateWindows, agent, RATE_LIMIT_REQUESTS);

const enforceWriteRateLimit = (agent: AuthenticatedAgent): void =>
  enforceRateLimit(writeRateWindows, agent, WRITE_RATE_LIMIT_REQUESTS);

const enforceExerciseWriteRateLimit = (agent: AuthenticatedAgent): void =>
  enforceRateLimit(exerciseWriteRateWindows, agent, WRITE_RATE_LIMIT_REQUESTS);

const parseBoundedInteger = (
  raw: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number => {
  if (raw === null || raw === '') {
    return fallback;
  }
  if (!/^\d+$/.test(raw)) {
    throw new ApiError(400, 'INVALID_ARGUMENT', `${label} must be an integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ApiError(
      400,
      'INVALID_ARGUMENT',
      `${label} must be between ${minimum} and ${maximum}.`,
    );
  }
  return value;
};

const parseOptionalText = (raw: string | null, maximum: number, label: string): string | null => {
  if (raw === null) return null;
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length === 0) return null;
  if (value.length > maximum) {
    throw new ApiError(400, 'INVALID_ARGUMENT', `${label} is too long.`);
  }
  return value;
};

const encodeCursor = (value: JsonObject): string => {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const decodeCursor = (raw: string | null, expectedKind: string): JsonObject | null => {
  if (raw === null || raw === '') return null;
  if (raw.length > 500 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new ApiError(400, 'INVALID_CURSOR', 'Cursor is invalid.');
  }
  try {
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    const value = JSON.parse(new TextDecoder().decode(bytes)) as JsonObject;
    if (value.kind !== expectedKind) {
      throw new Error('kind');
    }
    return value;
  } catch {
    throw new ApiError(400, 'INVALID_CURSOR', 'Cursor is invalid.');
  }
};

const postgrestQuote = (value: string): string =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const toIsoTimestamp = (value: number | null): string | null => {
  if (
    value === null ||
    !Number.isFinite(value) ||
    value < ISO_DATE_MIN_MS ||
    value > ISO_DATE_MAX_MS
  ) {
    return null;
  }
  return new Date(value).toISOString();
};

const jsonResponse = (
  requestId: string,
  status: number,
  body: JsonObject,
  extraHeaders: Record<string, string> = {},
): Response => {
  const json = JSON.stringify(body);
  if (new TextEncoder().encode(json).byteLength > MAX_RESPONSE_BYTES) {
    if (status >= 400) {
      throw new Error('Error response exceeded maximum size.');
    }
    return jsonResponse(requestId, 413, {
      error: {
        code: 'RESPONSE_TOO_LARGE',
        message: 'The bounded response could not be produced.',
        request_id: requestId,
      },
    });
  }
  return new Response(json, {
    status,
    headers: {
      ...CORS_HEADERS,
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-request-id': requestId,
      ...extraHeaders,
    },
  });
};

const successResponse = (requestId: string, data: unknown): Response =>
  jsonResponse(requestId, 200, {
    data,
    meta: {
      api_version: API_VERSION,
      request_id: requestId,
    },
  });

const errorResponse = (requestId: string, error: unknown): Response => {
  const apiError = error instanceof ApiError
    ? error
    : new ApiError(500, 'INTERNAL', 'The agent request could not be completed.');
  const headers: Record<string, string> = apiError.status === 401
    ? { 'www-authenticate': 'Bearer realm="boga-agent-api"' }
    : {};
  if (apiError.retryAfterSeconds !== undefined) {
    headers['retry-after'] = String(apiError.retryAfterSeconds);
  }
  return jsonResponse(
    requestId,
    apiError.status,
    {
      error: {
        code: apiError.code,
        message: apiError.message,
        request_id: requestId,
      },
    },
    headers,
  );
};

const throwDatabaseError = (error: { message?: string } | null): void => {
  if (error) {
    console.error('[agent-api] database operation failed', {
      message: error.message ?? 'unknown database error',
    });
    throw new ApiError(500, 'INTERNAL', 'The agent request could not be completed.');
  }
};

const uniqueStrings = (values: Array<string | null | undefined>, limit = 50): string[] =>
  Array.from(
    new Set(
      values
        .map((value) => value?.trim() ?? '')
        .filter((value) => value.length > 0),
    ),
  )
    .sort((left, right) => left.localeCompare(right))
    .slice(0, limit);

const chunk = <T>(values: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
};

const loadMappings = async (
  client: SupabaseClient,
  userId: string,
  exerciseIds: string[],
): Promise<Map<string, JsonObject[]>> => {
  const output = new Map<string, JsonObject[]>();
  if (exerciseIds.length === 0) return output;

  const { data: mappings, error: mappingError } = await client
    .schema('app_public')
    .from('exercise_muscle_mappings')
    .select('exercise_definition_id,muscle_group_id,weight,role')
    .eq('owner_user_id', userId)
    .is('deleted_at', null)
    .in('exercise_definition_id', exerciseIds)
    .limit(1000)
    .returns<MappingRow[]>();
  throwDatabaseError(mappingError);

  const muscleIds = uniqueStrings((mappings ?? []).map((row) => row.muscle_group_id), 500);
  const { data: muscles, error: muscleError } = muscleIds.length === 0
    ? { data: [] as MuscleGroupRow[], error: null }
    : await client
      .schema('app_public')
      .from('muscle_groups')
      .select('id,display_name,family_name')
      .eq('owner_user_id', userId)
      .is('deleted_at', null)
      .in('id', muscleIds)
      .limit(500)
      .returns<MuscleGroupRow[]>();
  throwDatabaseError(muscleError);
  const muscleById = new Map((muscles ?? []).map((row) => [row.id, row]));

  for (const mapping of mappings ?? []) {
    const muscle = muscleById.get(mapping.muscle_group_id);
    if (!muscle) continue;
    const bucket = output.get(mapping.exercise_definition_id) ?? [];
    bucket.push({
      id: muscle.id,
      name: muscle.display_name,
      family: muscle.family_name,
      role: mapping.role,
      weight: mapping.weight,
    });
    output.set(mapping.exercise_definition_id, bucket);
  }
  for (const bucket of output.values()) {
    bucket.sort((left, right) =>
      String(left.name).localeCompare(String(right.name))
    );
  }
  return output;
};

const loadEquipmentByExercise = async (
  client: SupabaseClient,
  userId: string,
  exerciseIds: string[],
): Promise<Map<string, string[]>> => {
  const output = new Map<string, string[]>();
  if (exerciseIds.length === 0) return output;
  const { data, error } = await client
    .schema('app_public')
    .from('session_exercises')
    .select('exercise_definition_id,machine_name')
    .eq('owner_user_id', userId)
    .is('deleted_at', null)
    .in('exercise_definition_id', exerciseIds)
    .not('machine_name', 'is', null)
    .limit(1000)
    .returns<Array<{ exercise_definition_id: string | null; machine_name: string | null }>>();
  throwDatabaseError(error);

  const collected = new Map<string, Array<string | null>>();
  for (const row of data ?? []) {
    if (!row.exercise_definition_id) continue;
    const values = collected.get(row.exercise_definition_id) ?? [];
    values.push(row.machine_name);
    collected.set(row.exercise_definition_id, values);
  }
  for (const [exerciseId, values] of collected) {
    output.set(exerciseId, uniqueStrings(values, 20));
  }
  return output;
};

const loadBodyweightCalculationsEnabled = async (
  client: SupabaseClient,
  userId: string,
): Promise<boolean> => {
  const { data, error } = await client
    .schema('app_public')
    .from('user_settings')
    .select('bodyweight_calculations_enabled')
    .eq('owner_user_id', userId)
    .eq('id', 'settings')
    .is('deleted_at', null)
    .maybeSingle<{ bodyweight_calculations_enabled: boolean }>();
  throwDatabaseError(error);
  return data?.bodyweight_calculations_enabled === true;
};

const getTrainingProfile = async (
  client: SupabaseClient,
  userId: string,
  bodyweightCalculationsEnabled: boolean,
): Promise<JsonObject> => {
  const { data: profile, error: profileError } = await client
    .schema('app_public')
    .from('user_profiles')
    .select('training_unit,time_zone')
    .eq('id', userId)
    .maybeSingle<{ training_unit: string; time_zone: string }>();
  throwDatabaseError(profileError);

  const { data: gyms, error: gymError } = await client
    .schema('app_public')
    .from('gyms')
    .select('id,name')
    .eq('owner_user_id', userId)
    .is('deleted_at', null)
    .order('name')
    .order('id')
    .limit(50)
    .returns<Array<{ id: string; name: string }>>();
  throwDatabaseError(gymError);

  const { data: machines, error: machineError } = await client
    .schema('app_public')
    .from('session_exercises')
    .select('machine_name')
    .eq('owner_user_id', userId)
    .is('deleted_at', null)
    .not('machine_name', 'is', null)
    .limit(500)
    .returns<Array<{ machine_name: string | null }>>();
  throwDatabaseError(machineError);

  const loadUnit = profile?.training_unit === 'kg' ? 'kg' : 'kg';
  return {
    units: {
      load: loadUnit,
      volume: `${loadUnit}_reps`,
    },
    timezone: profile?.time_zone?.trim() || 'UTC',
    active_gyms: gyms ?? [],
    available_equipment: uniqueStrings((machines ?? []).map((row) => row.machine_name)),
    training_preferences: {
      bodyweight_calculations_enabled: bodyweightCalculationsEnabled,
    },
  };
};

/**
 * The catalog view of exercises: what coaching reads plus what an edit needs —
 * the per-gym split flag, the revision to quote and the deleted state.
 */
const projectCatalogExercises = async (
  client: SupabaseClient,
  userId: string,
  rows: CatalogExerciseRow[],
  bodyweightCalculationsEnabled: boolean,
): Promise<JsonObject[]> => {
  const exerciseIds = rows.map((row) => row.id);
  const [mappings, equipmentByExercise] = await Promise.all([
    loadMappings(client, userId, exerciseIds),
    loadEquipmentByExercise(client, userId, exerciseIds),
  ]);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    ...exerciseLoadPayload(row, bodyweightCalculationsEnabled),
    split_by_gym: row.split_by_gym === true,
    rest_timer_sec: projectRestTimerSec(row.rest_timer_sec),
    deleted: row.deleted_at !== null,
    revision: Number(row.client_updated_at_ms),
    muscles: mappings.get(row.id) ?? [],
    equipment: equipmentByExercise.get(row.id) ?? [],
  }));
};

/**
 * The owner's muscle taxonomy: the ids an exercise's muscles must name. Each
 * entry carries the user's setup: the `report_group` key it reports under
 * (null = the entry is its own muscle) and whether that muscle is `tracked`.
 */
const listMuscles = async (client: SupabaseClient, userId: string): Promise<JsonObject> => {
  const { data, error } = await client
    .schema('app_public')
    .from('muscle_groups')
    .select('id,display_name,family_name,sort_order,report_group,tracked')
    .eq('owner_user_id', userId)
    .is('deleted_at', null)
    .order('sort_order')
    .order('id')
    .limit(500)
    .returns<Array<MuscleGroupRow & { sort_order: number; report_group: string | null; tracked: number }>>();
  throwDatabaseError(error);
  return {
    muscles: (data ?? []).map((row) => ({
      id: row.id,
      name: row.display_name,
      family: row.family_name,
      report_group: row.report_group,
      tracked: row.tracked !== 0,
    })),
  };
};

const searchExercises = async (
  client: SupabaseClient,
  userId: string,
  url: URL,
  bodyweightCalculationsEnabled: boolean,
): Promise<JsonObject> => {
  rejectUnexpectedQuery(url, new Set(['query', 'muscle', 'equipment', 'limit', 'cursor', 'include_deleted']));
  const query = parseOptionalText(url.searchParams.get('query'), 120, 'query');
  const includeDeleted = parseOptionalBoolean(url.searchParams.get('include_deleted'), false, 'include_deleted');
  const muscle = parseOptionalText(url.searchParams.get('muscle'), 80, 'muscle');
  const equipment = parseOptionalText(url.searchParams.get('equipment'), 80, 'equipment');
  const limit = parseBoundedInteger(
    url.searchParams.get('limit'),
    DEFAULT_EXERCISE_LIMIT,
    1,
    MAX_EXERCISE_LIMIT,
    'limit',
  );
  const cursor = decodeCursor(url.searchParams.get('cursor'), 'exercise');

  let allowedIds: Set<string> | null = null;
  if (muscle) {
    const pattern = `%${muscle.replace(/[%_]/g, '\\$&')}%`;
    const { data: matchingMuscles, error } = await client
      .schema('app_public')
      .from('muscle_groups')
      .select('id')
      .eq('owner_user_id', userId)
      .is('deleted_at', null)
      .or(`display_name.ilike.${postgrestQuote(pattern)},family_name.ilike.${postgrestQuote(pattern)}`)
      .limit(100)
      .returns<Array<{ id: string }>>();
    throwDatabaseError(error);
    const muscleIds = (matchingMuscles ?? []).map((row) => row.id);
    if (muscleIds.length === 0) {
      return { exercises: [], next_cursor: null };
    }
    const { data: mappingRows, error: mappingError } = await client
      .schema('app_public')
      .from('exercise_muscle_mappings')
      .select('exercise_definition_id')
      .eq('owner_user_id', userId)
      .is('deleted_at', null)
      .in('muscle_group_id', muscleIds)
      .limit(1000)
      .returns<Array<{ exercise_definition_id: string }>>();
    throwDatabaseError(mappingError);
    allowedIds = new Set((mappingRows ?? []).map((row) => row.exercise_definition_id));
  }

  if (equipment) {
    const { data: equipmentRows, error } = await client
      .schema('app_public')
      .from('session_exercises')
      .select('exercise_definition_id')
      .eq('owner_user_id', userId)
      .is('deleted_at', null)
      .not('exercise_definition_id', 'is', null)
      .ilike('machine_name', `%${equipment.replace(/[%_]/g, '\\$&')}%`)
      .limit(1000)
      .returns<Array<{ exercise_definition_id: string | null }>>();
    throwDatabaseError(error);
    const equipmentIds = new Set(
      (equipmentRows ?? [])
        .map((row) => row.exercise_definition_id)
        .filter((id): id is string => typeof id === 'string'),
    );
    allowedIds = allowedIds === null
      ? equipmentIds
      : new Set(Array.from(allowedIds).filter((id) => equipmentIds.has(id)));
  }

  if (allowedIds !== null && allowedIds.size === 0) {
    return { exercises: [], next_cursor: null };
  }

  let definitionsQuery = client
    .schema('app_public')
    .from('exercise_definitions')
    .select(CATALOG_EXERCISE_COLUMNS)
    .eq('owner_user_id', userId)
    .order('name')
    .order('id')
    .limit(limit + 1);
  if (!includeDeleted) {
    definitionsQuery = definitionsQuery.is('deleted_at', null);
  }
  if (query) {
    definitionsQuery = definitionsQuery.ilike('name', `%${query.replace(/[%_]/g, '\\$&')}%`);
  }
  if (allowedIds !== null) {
    definitionsQuery = definitionsQuery.in('id', Array.from(allowedIds).slice(0, 1000));
  }
  if (cursor) {
    if (typeof cursor.name !== 'string' || typeof cursor.id !== 'string') {
      throw new ApiError(400, 'INVALID_CURSOR', 'Cursor is invalid.');
    }
    definitionsQuery = definitionsQuery.or(
      `name.gt.${postgrestQuote(cursor.name)},and(name.eq.${postgrestQuote(cursor.name)},id.gt.${postgrestQuote(cursor.id)})`,
    );
  }

  const { data, error } = await definitionsQuery.returns<CatalogExerciseRow[]>();
  throwDatabaseError(error);
  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  return {
    exercises: await projectCatalogExercises(client, userId, page, bodyweightCalculationsEnabled),
    next_cursor: hasMore && page.length > 0
      ? encodeCursor({
        kind: 'exercise',
        name: page[page.length - 1].name,
        id: page[page.length - 1].id,
      })
      : null,
  };
};

// Resolve only already-authorized session IDs in one owner-filtered server call.
const attachSessionWeightContexts = async <T extends { id: string }>(
  client: SupabaseClient, userId: string, rows: T[], calculationsEnabled: boolean,
): Promise<Array<T & SessionWeightRow>> => {
  if (rows.length === 0) return rows;
  if (!calculationsEnabled) {
    return rows.map(row => ({ ...row, body_weight_kg: null, body_weight_source: null,
      body_weight_measurement_id: null, body_weight_measured_at: null }));
  }
  const { data, error } = await client.schema('app_public').rpc('session_weight_contexts', {
    p_owner: userId, p_session_ids: rows.map(row => row.id),
  });
  throwDatabaseError(error);
  const byId = new Map((data as (SessionWeightRow & { session_id: string })[])
    .map(context => [context.session_id, context]));
  return rows.map(row => {
    const context = byId.get(row.id);
    if (!context) throw new ApiError(503, 'CONTEXT_UNAVAILABLE', 'Session context is unavailable.');
    return { ...row, ...context };
  });
};

const loadSessionsById = async (
  client: SupabaseClient,
  userId: string,
  sessionIds: string[],
  bodyweightCalculationsEnabled: boolean,
): Promise<SessionRow[]> => {
  const rows: SessionRow[] = [];
  for (const ids of chunk(uniqueStrings(sessionIds, MAX_CONTEXT_BLOCKS), 100)) {
    const { data, error } = await client
      .schema('app_public')
      .from('sessions')
      .select(SESSION_COLUMNS)
      .eq('owner_user_id', userId)
      .eq('status', 'completed')
      .is('deleted_at', null)
      .in('id', ids)
      .limit(100)
      .returns<SessionRow[]>();
    throwDatabaseError(error);
    rows.push(...(data ?? []));
  }
  return attachSessionWeightContexts(client, userId, rows, bodyweightCalculationsEnabled);
};

const loadSetsByBlock = async (
  client: SupabaseClient,
  userId: string,
  blockIds: string[],
): Promise<{ rows: SetRow[]; truncated: boolean }> => {
  const rows: SetRow[] = [];
  let truncated = false;
  for (const ids of chunk(uniqueStrings(blockIds, MAX_CONTEXT_BLOCKS), 80)) {
    const { data, error } = await client
      .schema('app_public')
      .from('exercise_sets')
      .select(
        'id,session_exercise_id,order_index,weight_value,reps_value,set_type,performance_status',
      )
      .eq('owner_user_id', userId)
      .is('deleted_at', null)
      .is('performance_status', null)
      .in('session_exercise_id', ids)
      .order('order_index')
      .order('id')
      .limit(1000)
      .returns<SetRow[]>();
    throwDatabaseError(error);
    if ((data?.length ?? 0) === 1000) truncated = true;
    rows.push(...(data ?? []));
  }
  return { rows, truncated };
};

const loadAllSetsForBlocks = async (
  client: SupabaseClient,
  userId: string,
  blockIds: string[],
): Promise<SetRow[]> => {
  const rows: SetRow[] = [];
  for (const ids of chunk(blockIds, 80)) {
    let offset = 0;
    const batchLimit = 1000;
    while (true) {
      const { data, error } = await client
        .schema('app_public')
        .from('exercise_sets')
        .select(
          'id,session_exercise_id,order_index,weight_value,reps_value,set_type,performance_status',
        )
        .eq('owner_user_id', userId)
        .is('deleted_at', null)
        .is('performance_status', null)
        .in('session_exercise_id', ids)
        .order('order_index')
        .order('id')
        .range(offset, offset + batchLimit - 1)
        .returns<SetRow[]>();
      throwDatabaseError(error);
      const batch = data ?? [];
      rows.push(...batch);
      if (batch.length < batchLimit) break;
      offset += batchLimit;
    }
  }
  return rows;
};

const loadGymNames = async (
  client: SupabaseClient, userId: string, gymIds: string[],
): Promise<Map<string, string>> => {
  if (gymIds.length === 0) return new Map();
  const { data, error } = await client
    .schema('app_public')
    .from('gyms')
    .select('id,name')
    .eq('owner_user_id', userId)
    .in('id', gymIds)
    // Every requested id, so no gym in the list reports a null name.
    .limit(gymIds.length)
    .returns<Array<{ id: string; name: string }>>();
  throwDatabaseError(error);
  return new Map((data ?? []).map((row) => [row.id, row.name]));
};

const loadDefinitionsById = async (
  client: SupabaseClient, userId: string, exerciseIds: string[],
): Promise<Map<string, ExerciseDefinitionRow>> => {
  const rows: ExerciseDefinitionRow[] = [];
  for (const ids of chunk(uniqueStrings(exerciseIds, MAX_CONTEXT_BLOCKS), 100)) {
    const { data, error } = await client.schema('app_public').from('exercise_definitions')
      .select(EXERCISE_COLUMNS).eq('owner_user_id', userId).is('deleted_at', null)
      .in('id', ids).limit(100).returns<ExerciseDefinitionRow[]>();
    throwDatabaseError(error);
    rows.push(...(data ?? []));
  }
  return new Map(rows.map(row => [row.id, row]));
};

/** Rethrows a gym-bucket rule's rejection as the API error it is. */
const asApiError = <T>(read: () => T): T => {
  try {
    return read();
  } catch (error) {
    if (error instanceof GymBucketError) throw new ApiError(400, error.code, error.message);
    throw error;
  }
};

/** The requested gym, or undefined when the request named none (the whole exercise). */
const parseGymBucket = (
  url: URL, definition: ExerciseDefinitionRow,
): string | undefined => {
  const raw = url.searchParams.get('gym_bucket');
  if (raw === null) return undefined;
  if (!definition.split_by_gym) {
    throw new ApiError(
      400,
      'INVALID_ARGUMENT',
      'gym_bucket applies only to an exercise tracked separately per gym.',
    );
  }
  const value = parseOptionalText(raw, 200, 'gym_bucket');
  if (value === null) {
    throw new ApiError(400, 'INVALID_ARGUMENT', 'gym_bucket must name a gym.');
  }
  return asApiError(() => gymBucketFromParam(value));
};

/** Gym names for a response's gym fields, and which named gyms the user owns. */
type GymNamer = {
  owns: (gymId: string) => boolean;
  field: (gymId: string | null) => JsonObject | null;
};

const loadGymNamer = async (
  client: SupabaseClient, userId: string, gymIds: Array<string | null | undefined>,
): Promise<GymNamer> => {
  const names = await loadGymNames(client, userId, uniqueStrings(gymIds, gymIds.length));
  return {
    owns: (gymId) => names.has(gymId),
    // A null gym is a session with no gym, not an unknown one.
    field: (gymId) => gymId === null ? null : { id: gymId, name: names.get(gymId) ?? null },
  };
};

/**
 * The split fields on a split exercise: the selected gym, if any, and every
 * gym. `summarize` adds the figures a route can state per gym, so one response
 * shows every gym side by side beside the whole exercise.
 */
const gymBucketFields = (
  namer: GymNamer, selected: string | undefined,
  ranked?: GymBucketRank[],
  summarize?: (gymId: string) => JsonObject,
): JsonObject => {
  // A named gym nobody owns and one owned by somebody else are the same 404,
  // as everywhere else in this API — and a 200 holding an empty bucket would
  // read as "trained there, nothing recorded".
  if (selected !== undefined && !namer.owns(selected)) {
    throw new ApiError(404, 'NOT_FOUND', 'Gym not found.');
  }
  const listed = (ranked ?? []).slice(0, MAX_GYM_BUCKETS);
  return {
    // Only a response whose figures or rows come from one gym names it.
    ...(selected === undefined ? {} : { gym: namer.field(selected) }),
    // Only the route that states per-gym figures carries the inventory.
    ...(ranked === undefined ? {} : {
      gym_buckets: listed.map((entry) => ({
        gym: namer.field(entry.gymId),
        last_performed_at: toIsoTimestamp(entry.lastPerformedAt),
        ...(summarize ? summarize(entry.gymId) : {}),
      })),
      // Never drop buckets silently.
      ...(ranked.length > listed.length ? { gym_buckets_truncated: true } : {}),
    }),
  };
};

const getExerciseContext = async (
  client: SupabaseClient,
  userId: string,
  exerciseId: string,
  url: URL,
  bodyweightCalculationsEnabled: boolean,
): Promise<JsonObject> => {
  rejectUnexpectedQuery(url, new Set(['recent_sessions', 'gym_bucket']));
  if (exerciseId.length === 0 || exerciseId.length > 200) {
    throw new ApiError(400, 'INVALID_ARGUMENT', 'exercise_id is invalid.');
  }
  const recentSessions = parseBoundedInteger(
    url.searchParams.get('recent_sessions'),
    DEFAULT_RECENT_SESSIONS,
    1,
    MAX_RECENT_SESSIONS,
    'recent_sessions',
  );

  const { data: definition, error: definitionError } = await client
    .schema('app_public')
    .from('exercise_definitions')
    .select(EXERCISE_COLUMNS)
    .eq('owner_user_id', userId)
    .eq('id', exerciseId)
    .is('deleted_at', null)
    .maybeSingle<ExerciseDefinitionRow>();
  throwDatabaseError(definitionError);
  if (!definition) {
    throw new ApiError(404, 'NOT_FOUND', 'Exercise not found.');
  }
  const requestedBucket = parseGymBucket(url, definition);

  const { data: blocks, error: blockError } = await client
    .schema('app_public')
    .from('session_exercises')
    .select('id,session_id,exercise_definition_id,order_index,name,machine_name')
    .eq('owner_user_id', userId)
    .eq('exercise_definition_id', exerciseId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(MAX_CONTEXT_BLOCKS + 1)
    .returns<SessionExerciseRow[]>();
  throwDatabaseError(blockError);
  const historyTruncated = (blocks?.length ?? 0) > MAX_CONTEXT_BLOCKS;
  const boundedBlocks = (blocks ?? []).slice(0, MAX_CONTEXT_BLOCKS);

  const [sessions, setResult, mappings, equipmentByExercise] = await Promise.all([
    loadSessionsById(client, userId, boundedBlocks.map((row) => row.session_id),
      bodyweightCalculationsEnabled && definition.bodyweight_contribution > 0),
    loadSetsByBlock(client, userId, boundedBlocks.map((row) => row.id)),
    loadMappings(client, userId, [exerciseId]),
    loadEquipmentByExercise(client, userId, [exerciseId]),
  ]);
  const completedSessions = sessions
    .filter((row): row is SessionRow & { completed_at: number } => row.completed_at !== null)
    .sort((left, right) =>
      right.completed_at - left.completed_at || left.id.localeCompare(right.id)
    );
  const completedById = new Map(completedSessions.map((row) => [row.id, row]));
  const blocksBySession = new Map<string, SessionExerciseRow[]>();
  for (const block of boundedBlocks) {
    if (!completedById.has(block.session_id)) continue;
    const bucket = blocksBySession.get(block.session_id) ?? [];
    bucket.push(block);
    blocksBySession.set(block.session_id, bucket);
  }
  for (const bucket of blocksBySession.values()) {
    bucket.sort((left, right) =>
      left.order_index - right.order_index || left.id.localeCompare(right.id)
    );
  }

  const setsByBlock = new Map<string, SetRow[]>();
  for (const set of setResult.rows) {
    const bucket = setsByBlock.get(set.session_exercise_id) ?? [];
    bucket.push(set);
    setsByBlock.set(set.session_exercise_id, bucket);
  }

  const performanceRows = completedSessions
    .filter((session) => blocksBySession.has(session.id))
    .map((session) => ({
      session,
      ...projectTrainingSets((blocksBySession.get(session.id) ?? [])
        .flatMap(block => setsByBlock.get(block.id) ?? []), definition, session, bodyweightCalculationsEnabled),
    }))
    // A session with only warm-ups for this exercise has no stat footprint.
    .filter(row => row.workingSetCount > 0);

  // A split exercise reports the whole exercise unless the request names a gym;
  // then every figure below comes from that gym's sessions alone. Gyms are
  // ranked over the sessions these figures count — working sets only — so a
  // listed gym always holds the records beside it.
  const rankedGyms = rankGymBuckets(performanceRows.map((row) => row.session));
  const rankedBuckets = definition.split_by_gym ? rankedGyms : [];
  const bucketRows = requestedBucket === undefined
    ? performanceRows
    : performanceRows.filter((row) => row.session.gym_id === requestedBucket);
  const recentRows = bucketRows.slice(0, recentSessions);
  const seriesRows = bucketRows.slice(0, 12).reverse();
  const historyIncomplete = historyTruncated || setResult.truncated;

  // The app's record book (`records.ts`): ties keep the earliest session and a
  // zero is never a record. A bounded history has no complete volume record.
  const recordsOf = (rows: typeof performanceRows): JsonObject => {
    const records = createRecordBook();
    for (const row of [...rows].sort((left, right) =>
      left.session.completed_at - right.session.completed_at || left.session.id.localeCompare(right.session.id))) {
      const total = row.volumeCoverage.totalVolumeKgReps;
      records.add({
        oneRepMax: row.estimatedOneRepMax === null ? null : { value: row.estimatedOneRepMax },
        weight: row.topWeightSet,
        volume: total === null || historyIncomplete ? null : { value: total },
      });
    }
    const bestOneRepMax = records.holders.oneRepMax?.value ?? null;
    const topWeight = records.holders.weight;
    const maxSessionVolume = records.holders.volume?.value ?? null;
    return {
      estimated_one_rep_max: bestOneRepMax === null
        ? null
        : { value: bestOneRepMax, unit: 'kg' },
      top_weight: topWeight === null
        ? null
        : { value: topWeight.weight, reps: topWeight.reps, unit: 'kg' },
      max_session_volume: maxSessionVolume === null
        ? null
        : { value: maxSessionVolume, unit: 'kg_reps' },
    };
  };

  // Every gym's records travel with the gym list, so one call shows each gym
  // beside the others and the whole exercise. A split exercise's performances
  // and volume points name their gym, since the whole exercise mixes them.
  const gymNamer = await loadGymNamer(client, userId, [
    requestedBucket,
    ...rankedGyms.slice(0, MAX_GYM_BUCKETS).map((entry) => entry.gymId),
    ...[...recentRows, ...seriesRows].map((row) => row.session.gym_id),
  ]);
  const namer = definition.split_by_gym ? gymNamer : null;
  const gymOf = (row: typeof performanceRows[number]): JsonObject =>
    namer === null ? {} : { gym: namer.field(row.session.gym_id) };
  // Where the exercise is trained, split or not, so a coach can judge whether
  // it should be tracked per gym: sessions holding a working set, per gym.
  const gymUsage = {
    gyms: rankedGyms.slice(0, MAX_GYM_BUCKETS).map((entry) => ({
      gym: gymNamer.field(entry.gymId),
      session_count: performanceRows.filter((row) => row.session.gym_id === entry.gymId).length,
      last_performed_at: toIsoTimestamp(entry.lastPerformedAt),
    })),
    no_gym_session_count: performanceRows.filter((row) => row.session.gym_id === null).length,
    complete: !historyIncomplete && rankedGyms.length <= MAX_GYM_BUCKETS,
  };
  const splitFields = namer === null
    ? {}
    : gymBucketFields(namer, requestedBucket, rankedBuckets, (gymId) => {
      const rows = performanceRows.filter((row) => row.session.gym_id === gymId);
      return { session_count: rows.length, personal_records: recordsOf(rows) };
    });
  return {
    metric_revision: METRIC_REVISION,
    exercise: {
      id: definition.id,
      name: definition.name,
      ...exerciseLoadPayload(definition, bodyweightCalculationsEnabled),
      muscles: mappings.get(exerciseId) ?? [],
      equipment: equipmentByExercise.get(exerciseId) ?? [],
      split_by_gym: definition.split_by_gym,
      rest_timer_sec: projectRestTimerSec(definition.rest_timer_sec),
      gym_usage: gymUsage,
      ...splitFields,
    },
    recent_performances: recentRows.map((row) => ({
      session_id: row.session.id,
      ...gymOf(row),
      started_at: toIsoTimestamp(row.session.started_at),
      completed_at: toIsoTimestamp(row.session.completed_at),
      duration_seconds: row.session.duration_sec,
      ...(row.usesBodyweightContext ? { session_body_weight: sessionWeightPayload(row.session) } : {}),
      volume: volumePayload(row.volumeCoverage, historyIncomplete),
      estimated_one_rep_max: row.estimatedOneRepMax === null
        ? null : { value: row.estimatedOneRepMax, unit: 'kg' },
      sets: row.sets,
    })),
    personal_records: {
      ...recordsOf(bucketRows),
      history_truncated: historyIncomplete,
      excluded_incomplete_volume_sessions: bucketRows.filter(row => !row.volumeCoverage.complete || historyIncomplete).length,
    },
    volume_series: seriesRows.map((row) => ({
      completed_at: toIsoTimestamp(row.session.completed_at),
      ...gymOf(row),
      ...volumePayload(row.volumeCoverage, historyIncomplete),
    })),
    last_performed_at: bucketRows.length > 0
      ? toIsoTimestamp(bucketRows[0].session.completed_at)
      : null,
    training_notes: [],
    unavailable_fields: ['failed_set_semantics', 'user_authored_training_notes'],
    history_truncated: historyIncomplete,
  };
};

const getRecentWorkouts = async (
  client: SupabaseClient,
  userId: string,
  url: URL,
  bodyweightCalculationsEnabled: boolean,
): Promise<JsonObject> => {
  rejectUnexpectedQuery(url, new Set(['limit', 'cursor']));
  const limit = parseBoundedInteger(
    url.searchParams.get('limit'),
    DEFAULT_WORKOUT_LIMIT,
    1,
    MAX_WORKOUT_LIMIT,
    'limit',
  );
  const cursor = decodeCursor(url.searchParams.get('cursor'), 'workout');

  let sessionsQuery = client
    .schema('app_public')
    .from('sessions')
    .select(SESSION_COLUMNS)
    .eq('owner_user_id', userId)
    .eq('status', 'completed')
    .is('deleted_at', null)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .order('id')
    .limit(limit + 1);
  if (cursor) {
    if (
      typeof cursor.completed_at !== 'number' ||
      !Number.isSafeInteger(cursor.completed_at) ||
      typeof cursor.id !== 'string'
    ) {
      throw new ApiError(400, 'INVALID_CURSOR', 'Cursor is invalid.');
    }
    sessionsQuery = sessionsQuery.or(
      `completed_at.lt.${cursor.completed_at},and(completed_at.eq.${cursor.completed_at},id.gt.${postgrestQuote(cursor.id)})`,
    );
  }
  const { data, error } = await sessionsQuery.returns<SessionRow[]>();
  throwDatabaseError(error);
  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = await attachSessionWeightContexts(client, userId, rows.slice(0, limit), bodyweightCalculationsEnabled);
  const sessionIds = page.map((row) => row.id);

  const { data: blocks, error: blockError } = sessionIds.length === 0
    ? { data: [] as SessionExerciseRow[], error: null }
    : await client
      .schema('app_public')
      .from('session_exercises')
      .select('id,session_id,exercise_definition_id,order_index,name,machine_name')
      .eq('owner_user_id', userId)
      .is('deleted_at', null)
      .in('session_id', sessionIds)
      .order('order_index')
      .order('id')
      .limit(500)
      .returns<SessionExerciseRow[]>();
  throwDatabaseError(blockError);
  const blocksTruncated = (blocks?.length ?? 0) === 500;
  const [setResult, definitionsById] = await Promise.all([
    loadSetsByBlock(client, userId, (blocks ?? []).map((row) => row.id)),
    loadDefinitionsById(client, userId, (blocks ?? []).flatMap(row => row.exercise_definition_id ? [row.exercise_definition_id] : [])),
  ]);

  const gymById = await loadGymNames(client, userId, uniqueStrings(page.map((row) => row.gym_id), 50));

  const blocksBySession = new Map<string, SessionExerciseRow[]>();
  for (const block of blocks ?? []) {
    const bucket = blocksBySession.get(block.session_id) ?? [];
    bucket.push(block);
    blocksBySession.set(block.session_id, bucket);
  }
  const setsByBlock = new Map<string, SetRow[]>();
  for (const set of setResult.rows) {
    const bucket = setsByBlock.get(set.session_exercise_id) ?? [];
    bucket.push(set);
    setsByBlock.set(set.session_exercise_id, bucket);
  }

  return {
    metric_revision: METRIC_REVISION,
    workouts: page.map((session) => {
      const workoutBlocks = blocksBySession.get(session.id) ?? [];
      const projections = workoutBlocks.map(block => projectTrainingSets(
        setsByBlock.get(block.id) ?? [], definitionsById.get(block.exercise_definition_id ?? '') ?? null, session,
        bodyweightCalculationsEnabled,
      ));
      const coverage = summarizeVolume(projections.flatMap(row => row.workingMetrics));
      const usesBodyweightContext = projections.some(row => row.usesBodyweightContext);
      return {
        id: session.id,
        started_at: toIsoTimestamp(session.started_at),
        completed_at: toIsoTimestamp(session.completed_at),
        duration_seconds: session.duration_sec,
        gym: session.gym_id
          ? { id: session.gym_id, name: gymById.get(session.gym_id) ?? null }
          : null,
        exercise_count: projections.filter(row => row.workingSetCount > 0).length,
        completed_set_count: coverage.eligibleSetCount,
        ...(usesBodyweightContext ? { session_body_weight: sessionWeightPayload(session) } : {}),
        total_volume: volumePayload(coverage, blocksTruncated || setResult.truncated),
        exercises: workoutBlocks.slice(0, 50).map((block, index) => ({
          id: block.id,
          exercise_id: block.exercise_definition_id,
          name: block.name,
          equipment: block.machine_name,
          set_count: projections[index].workingSetCount,
          ...(definitionsById.has(block.exercise_definition_id ?? '')
            ? exerciseLoadPayload(
              definitionsById.get(block.exercise_definition_id ?? '')!, bodyweightCalculationsEnabled,
            )
            : {}),
          volume: volumePayload(projections[index].volumeCoverage, setResult.truncated),
        })),
        truncated: workoutBlocks.length > 50 || blocksTruncated || setResult.truncated,
      };
    }),
    next_cursor: hasMore && page.length > 0
      ? encodeCursor({
        kind: 'workout',
        completed_at: page[page.length - 1].completed_at,
        id: page[page.length - 1].id,
      })
      : null,
  };
};

const getExerciseHistory = async (
  client: SupabaseClient,
  userId: string,
  exerciseId: string,
  url: URL,
  bodyweightCalculationsEnabled: boolean,
): Promise<JsonObject> => {
  rejectUnexpectedQuery(url, new Set(['limit', 'cursor', 'gym_bucket']));
  if (exerciseId.length === 0 || exerciseId.length > 200) {
    throw new ApiError(400, 'INVALID_ARGUMENT', 'exercise_id is invalid.');
  }
  const limit = parseBoundedInteger(
    url.searchParams.get('limit'),
    DEFAULT_SET_LIMIT,
    1,
    MAX_SET_LIMIT,
    'limit',
  );
  const cursor = decodeCursor(url.searchParams.get('cursor'), 'exercise_history');

  const { data: definition, error: definitionError } = await client
    .schema('app_public')
    .from('exercise_definitions')
    .select(EXERCISE_COLUMNS)
    .eq('owner_user_id', userId)
    .eq('id', exerciseId)
    .is('deleted_at', null)
    .maybeSingle<ExerciseDefinitionRow>();
  throwDatabaseError(definitionError);
  if (!definition) {
    throw new ApiError(404, 'NOT_FOUND', 'Exercise not found.');
  }
  const requestedBucket = parseGymBucket(url, definition);
  // The cursor carries its own bucket, so draining it keeps paging that bucket
  // even when the caller does not repeat `gym_bucket` — otherwise page two
  // would silently switch buckets and apply page one's keyset filter to it.
  // An unsplit exercise has no buckets, so its cursor's filter lapses unread.
  const cursorBucket = cursor && definition.split_by_gym
    ? asApiError(() => gymBucketFromCursor(cursor.gym_bucket))
    : undefined;
  if (cursorBucket !== undefined && requestedBucket !== undefined
    && cursorBucket !== requestedBucket) {
    throw new ApiError(
      400, 'INVALID_ARGUMENT', 'gym_bucket does not match the cursor; drop one of them.',
    );
  }
  // A page is one page of sets across every gym, each set carrying its own, so
  // paging never partitions by gym. `gym_bucket` is an optional filter, and
  // only a filtered stream pins a bucket in its cursor.
  // The flag can be turned off between pages, and an unsplit exercise has no
  // buckets to filter by, so its cursor's filter lapses with it.
  const filterBucket = !definition.split_by_gym
    ? undefined
    : (cursorBucket === undefined ? requestedBucket : cursorBucket);
  // The exercise descriptor names the filtered bucket when there is one. The
  // per-bucket inventory is the context route's: here every gym's sets are in
  // the page already, each carrying its own gym.
  const exerciseField = async (pageNamer?: GymNamer): Promise<JsonObject> => ({
    id: definition.id,
    name: definition.name,
    ...exerciseLoadPayload(definition, bodyweightCalculationsEnabled),
    split_by_gym: definition.split_by_gym,
    ...(definition.split_by_gym
      ? gymBucketFields(pageNamer ?? await loadGymNamer(client, userId, [filterBucket]), filterBucket)
      : {}),
  });

  // Load all non-deleted session_exercises for this exercise definition
  const { data: blocks, error: blockError } = await client
    .schema('app_public')
    .from('session_exercises')
    .select('id,session_id,order_index,name,machine_name')
    .eq('owner_user_id', userId)
    .eq('exercise_definition_id', exerciseId)
    .is('deleted_at', null)
    .limit(5000)
    .returns<SessionExerciseRow[]>();
  throwDatabaseError(blockError);
  const allBlocks = blocks ?? [];

  if (allBlocks.length === 0) {
    return {
      metric_revision: METRIC_REVISION,
      exercise: await exerciseField(),
      sets: [],
      next_cursor: null,
    };
  }

  const sessionIds = uniqueStrings(allBlocks.map((b) => b.session_id), 5000);
  const { data: sessions, error: sessionError } = await client
    .schema('app_public')
    .from('sessions')
    .select(SESSION_COLUMNS)
    .eq('owner_user_id', userId)
    .eq('status', 'completed')
    .is('deleted_at', null)
    .not('completed_at', 'is', null)
    .in('id', sessionIds)
    .limit(5000)
    .returns<SessionRow[]>();
  throwDatabaseError(sessionError);

  const completedSessions = (sessions ?? []).filter(
    (s): s is SessionRow & { completed_at: number } => s.completed_at !== null,
  );
  if (completedSessions.length === 0) {
    return {
      metric_revision: METRIC_REVISION,
      exercise: await exerciseField(),
      sets: [],
      next_cursor: null,
    };
  }

  const completedById = new Map(completedSessions.map((s) => [s.id, s]));
  const qualifyingBlocks = allBlocks.filter((b) => completedById.has(b.session_id));
  const blockById = new Map(qualifyingBlocks.map((b) => [b.id, b]));
  const qualifyingBlockIds = qualifyingBlocks.map((b) => b.id);

  const { rows: setRows } = await loadAllSetsForBlocks(client, userId, qualifyingBlockIds).then(
    (rows) => ({ rows }),
  );

  type HistorySortableItem = {
    set: SetRow;
    block: SessionExerciseRow;
    session: SessionRow & { completed_at: number };
  };

  const allItems: HistorySortableItem[] = [];
  for (const set of setRows) {
    const block = blockById.get(set.session_exercise_id);
    if (!block) continue;
    const session = completedById.get(block.session_id);
    if (!session) continue;
    allItems.push({ set, block, session });
  }

  const bucketItems = filterBucket === undefined
    ? allItems
    : allItems.filter((item) => item.session.gym_id === filterBucket);

  bucketItems.sort((a, b) => {
    if (a.session.completed_at !== b.session.completed_at) {
      return b.session.completed_at - a.session.completed_at;
    }
    const cmpSession = a.session.id.localeCompare(b.session.id);
    if (cmpSession !== 0) return cmpSession;
    if (a.block.order_index !== b.block.order_index) {
      return a.block.order_index - b.block.order_index;
    }
    if (a.set.order_index !== b.set.order_index) {
      return a.set.order_index - b.set.order_index;
    }
    return a.set.id.localeCompare(b.set.id);
  });

  let filteredItems = bucketItems;
  if (cursor) {
    if (
      typeof cursor.session_completed_at !== 'number' ||
      !Number.isSafeInteger(cursor.session_completed_at) ||
      typeof cursor.session_id !== 'string' ||
      typeof cursor.exercise_order !== 'number' ||
      typeof cursor.set_order !== 'number' ||
      typeof cursor.set_id !== 'string'
    ) {
      throw new ApiError(400, 'INVALID_CURSOR', 'Cursor is invalid.');
    }
    filteredItems = bucketItems.filter((item) => {
      if (item.session.completed_at < cursor.session_completed_at) return true;
      if (item.session.completed_at > cursor.session_completed_at) return false;
      const cmpS = item.session.id.localeCompare(cursor.session_id);
      if (cmpS > 0) return true;
      if (cmpS < 0) return false;
      if (item.block.order_index > cursor.exercise_order) return true;
      if (item.block.order_index < cursor.exercise_order) return false;
      if (item.set.order_index > cursor.set_order) return true;
      if (item.set.order_index < cursor.set_order) return false;
      return item.set.id.localeCompare(cursor.set_id) > 0;
    });
  }

  const hasMore = filteredItems.length > limit;
  const pageItems = filteredItems.slice(0, limit);

  const neededSessions = uniqueStrings(pageItems.map((item) => item.session.id), 100);
  const sessionRowsForContext = completedSessions.filter((s) => neededSessions.includes(s.id));
  const sessionsWithContext = await attachSessionWeightContexts(
    client,
    userId,
    sessionRowsForContext,
    bodyweightCalculationsEnabled && definition.bodyweight_contribution > 0,
  );
  const contextSessionById = new Map(sessionsWithContext.map((s) => [s.id, s]));

  const pageNamer = definition.split_by_gym
    ? await loadGymNamer(client, userId, [filterBucket, ...pageItems.map((item) => item.session.gym_id)])
    : undefined;

  const projectedSets = pageItems.flatMap((item) => {
    const sessionWithContext = contextSessionById.get(item.session.id) ?? item.session;
    const projected = projectTrainingSets(
      [item.set],
      definition,
      sessionWithContext,
      bodyweightCalculationsEnabled,
    );
    const setPayload = projected.sets[0];
    if (!setPayload) return [];
    return [{
      ...setPayload,
      session_id: item.session.id,
      session_completed_at: toIsoTimestamp(item.session.completed_at),
      exercise_order: item.block.order_index,
      exercise_name: item.block.name,
      equipment: item.block.machine_name,
      // A split exercise's sets carry the gym they belong to, so one page can
      // span gyms without the reader having to guess which is which.
      ...(pageNamer === undefined ? {} : { gym: pageNamer.field(item.session.gym_id) }),
    }];
  });

  const lastItem = pageItems[pageItems.length - 1];
  return {
    metric_revision: METRIC_REVISION,
    exercise: await exerciseField(pageNamer),
    sets: projectedSets,
    next_cursor: hasMore && lastItem
      ? encodeCursor({
        kind: 'exercise_history',
        ...(filterBucket === undefined ? {} : { gym_bucket: filterBucket }),
        session_completed_at: lastItem.session.completed_at,
        session_id: lastItem.session.id,
        exercise_order: lastItem.block.order_index,
        set_order: lastItem.set.order_index,
        set_id: lastItem.set.id,
      })
      : null,
  };
};

/** Status reads: sets of the profile's last 56 days, then the favourites' history. */
const STATUS_MAX_SESSIONS = 200;
const STATUS_MAX_HISTORY_BLOCKS = 2000;
const STATUS_ROW_LIMIT = 1000;
const STATUS_MAX_MUSCLES = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

type StatusRead<T> = { rows: T[]; truncated: boolean };

const loadStatusSessions = async (
  client: SupabaseClient, userId: string, sessionIds: string[], calculationsEnabled: boolean,
): Promise<StatusSessionRow[]> => {
  const rows: Array<{ id: string; completed_at: number }> = [];
  for (const ids of chunk([...new Set(sessionIds)], 100)) {
    const { data, error } = await client.schema('app_public').from('sessions')
      .select('id,completed_at').eq('owner_user_id', userId).eq('status', 'completed')
      .is('deleted_at', null).not('completed_at', 'is', null).in('id', ids).limit(100)
      .returns<Array<{ id: string; completed_at: number }>>();
    throwDatabaseError(error);
    rows.push(...(data ?? []));
  }
  return attachSessionWeightContexts(client, userId, rows, calculationsEnabled);
};

const loadStatusBlocks = async (
  client: SupabaseClient, userId: string, sessionIds: string[],
): Promise<StatusRead<StatusBlockRow>> => {
  const rows: StatusBlockRow[] = [];
  let truncated = false;
  for (const ids of chunk(sessionIds, 100)) {
    const { data, error } = await client.schema('app_public').from('session_exercises')
      .select('id,session_id,exercise_definition_id,order_index').eq('owner_user_id', userId)
      .is('deleted_at', null).in('session_id', ids).limit(STATUS_ROW_LIMIT).returns<StatusBlockRow[]>();
    throwDatabaseError(error);
    if ((data?.length ?? 0) >= STATUS_ROW_LIMIT) truncated = true;
    rows.push(...(data ?? []));
  }
  return { rows, truncated };
};

const loadStatusSets = async (
  client: SupabaseClient, userId: string, blockIds: string[],
): Promise<StatusRead<StatusSetRow>> => {
  const rows: StatusSetRow[] = [];
  let truncated = false;
  for (const ids of chunk(blockIds, 40)) {
    const { data, error } = await client.schema('app_public').from('exercise_sets')
      .select('id,session_exercise_id,order_index,weight_value,reps_value,set_type,performance_status')
      .eq('owner_user_id', userId).is('deleted_at', null).is('performance_status', null)
      .in('session_exercise_id', ids).order('order_index').order('id').limit(STATUS_ROW_LIMIT)
      .returns<StatusSetRow[]>();
    throwDatabaseError(error);
    if ((data?.length ?? 0) >= STATUS_ROW_LIMIT) truncated = true;
    rows.push(...(data ?? []));
  }
  return { rows, truncated };
};

const definitionIdsOf = (blocks: StatusBlockRow[]): string[] =>
  [...new Set(blocks.flatMap((block) => block.exercise_definition_id ? [block.exercise_definition_id] : []))];

/** Every definition the blocks name, deleted ones included: their sets still count for muscles. */
const loadStatusDefinitions = async (
  client: SupabaseClient, userId: string, exerciseIds: string[],
): Promise<Map<string, StatusDefinitionRow>> => {
  const rows: StatusDefinitionRow[] = [];
  for (const ids of chunk(exerciseIds, 100)) {
    const { data, error } = await client.schema('app_public').from('exercise_definitions')
      .select('id,name,load_input_mode,bodyweight_contribution,deleted_at').eq('owner_user_id', userId)
      .in('id', ids).limit(100).returns<StatusDefinitionRow[]>();
    throwDatabaseError(error);
    rows.push(...(data ?? []));
  }
  return new Map(rows.map((row) => [row.id, row]));
};

const loadStatusMappings = async (
  client: SupabaseClient, userId: string, exerciseIds: string[],
): Promise<StatusRead<StatusMappingRow>> => {
  const rows: StatusMappingRow[] = [];
  let truncated = false;
  for (const ids of chunk(exerciseIds, 100)) {
    const { data, error } = await client.schema('app_public').from('exercise_muscle_mappings')
      .select('exercise_definition_id,muscle_group_id,role').eq('owner_user_id', userId)
      .is('deleted_at', null).in('exercise_definition_id', ids).limit(STATUS_ROW_LIMIT)
      .returns<StatusMappingRow[]>();
    throwDatabaseError(error);
    if ((data?.length ?? 0) >= STATUS_ROW_LIMIT) truncated = true;
    rows.push(...(data ?? []));
  }
  return { rows, truncated };
};

/** One owner-filtered read of performed training from session ids. */
const loadStatusTraining = async (
  client: SupabaseClient, userId: string, sessionIds: string[], calculationsEnabled: boolean,
) => {
  const sessions = await loadStatusSessions(client, userId, sessionIds, calculationsEnabled);
  const blocks = await loadStatusBlocks(client, userId, sessions.map((row) => row.id));
  const sets = await loadStatusSets(client, userId, blocks.rows.map((row) => row.id));
  return { training: { sessions, blocks: blocks.rows, sets: sets.rows }, truncated: blocks.truncated || sets.truncated };
};

/** The favourites' sessions over all time, newest-edited blocks first, up to the cap. */
const loadFavouriteHistory = async (
  client: SupabaseClient, userId: string, exerciseIds: string[], calculationsEnabled: boolean,
) => {
  if (exerciseIds.length === 0) {
    return { training: { sessions: [], blocks: [], sets: [] } as StatusTraining, complete: true };
  }
  const { data, error } = await client.schema('app_public').from('session_exercises')
    .select('id,session_id,exercise_definition_id,order_index').eq('owner_user_id', userId)
    .is('deleted_at', null).in('exercise_definition_id', exerciseIds)
    .order('updated_at', { ascending: false }).order('id').limit(STATUS_MAX_HISTORY_BLOCKS + 1)
    .returns<StatusBlockRow[]>();
  throwDatabaseError(error);
  const blocks = (data ?? []).slice(0, STATUS_MAX_HISTORY_BLOCKS);
  const [sessions, sets] = await Promise.all([
    loadStatusSessions(client, userId, blocks.map((row) => row.session_id), calculationsEnabled),
    loadStatusSets(client, userId, blocks.map((row) => row.id)),
  ]);
  return {
    training: { sessions, blocks, sets: sets.rows },
    complete: (data?.length ?? 0) <= STATUS_MAX_HISTORY_BLOCKS && !sets.truncated,
  };
};

const getTrainingStatus = async (
  client: SupabaseClient,
  userId: string,
  url: URL,
  bodyweightCalculationsEnabled: boolean,
): Promise<JsonObject> => {
  rejectUnexpectedQuery(url, new Set());
  const now = new Date();
  const [profile, settings, muscles] = await Promise.all([
    client.schema('app_public').from('user_profiles').select('time_zone').eq('id', userId)
      .maybeSingle<{ time_zone: string | null }>(),
    client.schema('app_public').from('user_settings')
      .select('weekly_working_set_target,muscle_target_mode,muscle_target_overrides,count_secondary_muscles,client_updated_at_ms')
      .eq('owner_user_id', userId).eq('id', 'settings').is('deleted_at', null).maybeSingle<StatusSettingsRow>(),
    client.schema('app_public').from('muscle_groups')
      .select('id,display_name,family_name,sort_order,report_group,tracked').eq('owner_user_id', userId)
      .is('deleted_at', null).order('sort_order').order('id').limit(STATUS_MAX_MUSCLES)
      .returns<StatusMuscleRow[]>(),
  ]);
  throwDatabaseError(profile.error);
  throwDatabaseError(settings.error);
  throwDatabaseError(muscles.error);
  const timeZone = resolveStatusTimeZone(profile.data?.time_zone);

  // A margin past 56 days: the builder keeps the sessions inside the profile's calendar window.
  const { data: recent, error: recentError } = await client.schema('app_public').from('sessions')
    .select('id').eq('owner_user_id', userId).eq('status', 'completed').is('deleted_at', null)
    .gte('completed_at', now.getTime() - (STATUS_READ_DAYS + 2) * DAY_MS)
    .order('completed_at', { ascending: false }).order('id').limit(STATUS_MAX_SESSIONS + 1)
    .returns<Array<{ id: string }>>();
  throwDatabaseError(recentError);
  const sessionIds = (recent ?? []).slice(0, STATUS_MAX_SESSIONS).map((row) => row.id);
  const recentRead = await loadStatusTraining(client, userId, sessionIds, bodyweightCalculationsEnabled);
  const exerciseIds = definitionIdsOf(recentRead.training.blocks);
  const [definitions, mappings] = await Promise.all([
    loadStatusDefinitions(client, userId, exerciseIds),
    loadStatusMappings(client, userId, exerciseIds),
  ]);
  const window = trainingStatusWindow(now, timeZone);
  const favourites = rankFavouriteExercises(
    recentRead.training, definitions, bodyweightCalculationsEnabled, window, timeZone,
  );
  const history = await loadFavouriteHistory(
    client, userId, favourites.map((favourite) => favourite.exerciseId), bodyweightCalculationsEnabled,
  );
  return buildTrainingStatus({
    now, timeZone,
    settings: settings.data,
    muscleRows: muscles.data ?? [],
    mappings: mappings.rows,
    training: recentRead.training,
    definitions,
    favourites,
    history: history.training,
    historyComplete: history.complete,
    calculationsEnabled: bodyweightCalculationsEnabled,
    complete: (recent?.length ?? 0) <= STATUS_MAX_SESSIONS && !recentRead.truncated && !mappings.truncated
      && (muscles.data?.length ?? 0) < STATUS_MAX_MUSCLES,
  });
};

const getWorkoutDetail = async (
  client: SupabaseClient,
  userId: string,
  sessionId: string,
  url: URL,
  bodyweightCalculationsEnabled: boolean,
): Promise<JsonObject> => {
  rejectUnexpectedQuery(url, new Set(['limit', 'cursor']));
  if (sessionId.length === 0 || sessionId.length > 200) {
    throw new ApiError(400, 'INVALID_ARGUMENT', 'session_id is invalid.');
  }
  const limit = parseBoundedInteger(
    url.searchParams.get('limit'),
    DEFAULT_SET_LIMIT,
    1,
    MAX_SET_LIMIT,
    'limit',
  );
  const cursor = decodeCursor(url.searchParams.get('cursor'), 'workout_detail');

  const { data: sessionData, error: sessionError } = await client
    .schema('app_public')
    .from('sessions')
    .select(SESSION_COLUMNS)
    .eq('owner_user_id', userId)
    .eq('id', sessionId)
    .eq('status', 'completed')
    .is('deleted_at', null)
    .not('completed_at', 'is', null)
    .maybeSingle<SessionRow>();
  throwDatabaseError(sessionError);
  if (!sessionData) {
    throw new ApiError(404, 'NOT_FOUND', 'Workout not found.');
  }

  const [sessionWithContext] = await attachSessionWeightContexts(
    client,
    userId,
    [sessionData],
    bodyweightCalculationsEnabled,
  );

  const { data: blocks, error: blockError } = await client
    .schema('app_public')
    .from('session_exercises')
    .select('id,session_id,exercise_definition_id,order_index,name,machine_name')
    .eq('owner_user_id', userId)
    .eq('session_id', sessionId)
    .is('deleted_at', null)
    .order('order_index')
    .order('id')
    .limit(500)
    .returns<SessionExerciseRow[]>();
  throwDatabaseError(blockError);
  const workoutBlocks = blocks ?? [];

  const [setResult, definitionsById] = await Promise.all([
    loadSetsByBlock(client, userId, workoutBlocks.map((b) => b.id)),
    loadDefinitionsById(
      client,
      userId,
      workoutBlocks.flatMap((b) => (b.exercise_definition_id ? [b.exercise_definition_id] : [])),
    ),
  ]);

  const gymName = sessionWithContext.gym_id
    ? (
      await client
        .schema('app_public')
        .from('gyms')
        .select('name')
        .eq('owner_user_id', userId)
        .eq('id', sessionWithContext.gym_id)
        .maybeSingle<{ name: string }>()
    ).data?.name ?? null
    : null;

  const setsByBlock = new Map<string, SetRow[]>();
  for (const set of setResult.rows) {
    const bucket = setsByBlock.get(set.session_exercise_id) ?? [];
    bucket.push(set);
    setsByBlock.set(set.session_exercise_id, bucket);
  }

  const projections = workoutBlocks.map((block) =>
    projectTrainingSets(
      setsByBlock.get(block.id) ?? [],
      definitionsById.get(block.exercise_definition_id ?? '') ?? null,
      sessionWithContext,
      bodyweightCalculationsEnabled,
    )
  );
  const coverage = summarizeVolume(projections.flatMap((row) => row.workingMetrics));
  const usesBodyweightContext = projections.some((row) => row.usesBodyweightContext);

  type WorkoutDetailSortableSet = {
    setPayload: ReturnType<typeof projectTrainingSets>['sets'][number];
    block: SessionExerciseRow;
    setOrder: number;
  };

  const allDetailSets: WorkoutDetailSortableSet[] = [];
  workoutBlocks.forEach((block, index) => {
    const proj = projections[index];
    for (const setPayload of proj.sets) {
      allDetailSets.push({
        setPayload,
        block,
        setOrder: setPayload.order_index,
      });
    }
  });

  allDetailSets.sort((a, b) => {
    if (a.block.order_index !== b.block.order_index) {
      return a.block.order_index - b.block.order_index;
    }
    if (a.setOrder !== b.setOrder) {
      return a.setOrder - b.setOrder;
    }
    return a.setPayload.id.localeCompare(b.setPayload.id);
  });

  let filteredDetailSets = allDetailSets;
  if (cursor) {
    if (
      typeof cursor.exercise_order !== 'number' ||
      typeof cursor.set_order !== 'number' ||
      typeof cursor.set_id !== 'string'
    ) {
      throw new ApiError(400, 'INVALID_CURSOR', 'Cursor is invalid.');
    }
    filteredDetailSets = allDetailSets.filter((item) => {
      if (item.block.order_index > cursor.exercise_order) return true;
      if (item.block.order_index < cursor.exercise_order) return false;
      if (item.setOrder > cursor.set_order) return true;
      if (item.setOrder < cursor.set_order) return false;
      return item.setPayload.id.localeCompare(cursor.set_id) > 0;
    });
  }

  const hasMore = filteredDetailSets.length > limit;
  const pagedDetailSets = filteredDetailSets.slice(0, limit);
  const lastDetailSet = pagedDetailSets[pagedDetailSets.length - 1];

  return {
    metric_revision: METRIC_REVISION,
    workout: {
      id: sessionWithContext.id,
      started_at: toIsoTimestamp(sessionWithContext.started_at),
      completed_at: toIsoTimestamp(sessionWithContext.completed_at),
      duration_seconds: sessionWithContext.duration_sec,
      gym: sessionWithContext.gym_id
        ? { id: sessionWithContext.gym_id, name: gymName }
        : null,
      exercise_count: projections.filter((row) => row.workingSetCount > 0).length,
      completed_set_count: coverage.eligibleSetCount,
      ...(usesBodyweightContext ? { session_body_weight: sessionWeightPayload(sessionWithContext) } : {}),
      total_volume: volumePayload(coverage, setResult.truncated),
      exercises: workoutBlocks.map((block, index) => ({
        id: block.id,
        exercise_id: block.exercise_definition_id,
        name: block.name,
        equipment: block.machine_name,
        set_count: projections[index].workingSetCount,
        ...(definitionsById.has(block.exercise_definition_id ?? '')
          ? exerciseLoadPayload(
            definitionsById.get(block.exercise_definition_id ?? '')!,
            bodyweightCalculationsEnabled,
          )
          : {}),
        volume: volumePayload(projections[index].volumeCoverage, setResult.truncated),
      })),
      sets: pagedDetailSets.map((item) => ({
        ...item.setPayload,
        exercise_id: item.block.exercise_definition_id,
        exercise_name: item.block.name,
        exercise_order: item.block.order_index,
        equipment: item.block.machine_name,
      })),
      next_cursor: hasMore && lastDetailSet
        ? encodeCursor({
          kind: 'workout_detail',
          exercise_order: lastDetailSet.block.order_index,
          set_order: lastDetailSet.setOrder,
          set_id: lastDetailSet.setPayload.id,
        })
        : null,
      truncated: setResult.truncated,
    },
  };
};

const rejectIdentityBody = (value: unknown, depth = 0): void => {
  if (depth > 8 || typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    for (const entry of value) rejectIdentityBody(entry, depth + 1);
    return;
  }
  for (const [key, entry] of Object.entries(value as JsonObject)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized === 'userid' || normalized === 'owneruserid' || normalized === 'ownerid') {
      throw new ApiError(400, 'INVALID_ARGUMENT', 'User identity is derived from the token.');
    }
    rejectIdentityBody(entry, depth + 1);
  }
};

const readJsonBody = async (request: Request): Promise<JsonObject> => {
  const contentType = (request.headers.get('content-type') ?? '').trim().toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new ApiError(400, 'INVALID_ARGUMENT', 'Content-Type must be application/json.');
  }
  const text = await request.text();
  if (text.length === 0) {
    throw new ApiError(400, 'INVALID_ARGUMENT', 'A JSON request body is required.');
  }
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    throw new ApiError(413, 'REQUEST_TOO_LARGE', 'The request body is too large.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'INVALID_ARGUMENT', 'The request body is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError(400, 'INVALID_ARGUMENT', 'The request body must be a JSON object.');
  }
  const body = parsed as JsonObject;
  rejectIdentityBody(body);
  return body;
};

const loadPlanPermission = async (
  client: SupabaseClient,
  agent: AuthenticatedAgent,
): Promise<void> => {
  const { data, error } = await client
    .from('agent_plan_permissions')
    .select('plan_access_enabled,granted_at')
    .eq('owner_user_id', agent.userId)
    .eq('client_id', agent.clientId)
    .maybeSingle<{ granted_at: string | null; plan_access_enabled: boolean }>();
  throwDatabaseError(error);
  const liveGrant = Date.parse(agent.grantedAt);
  const storedGrant = typeof data?.granted_at === 'string' ? Date.parse(data.granted_at) : Number.NaN;
  const allowed = data?.plan_access_enabled === true
    && Number.isFinite(liveGrant)
    && Number.isFinite(storedGrant)
    && liveGrant === storedGrant;
  if (!allowed) {
    throw new ApiError(
      403,
      'PLAN_PERMISSION_REQUIRED',
      'Write access is not enabled for this coach. The person can turn it on in BoGa under Connected Agents.',
    );
  }
};

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const readIdempotencyKey = (request: Request): string => {
  const key = (request.headers.get('idempotency-key') ?? '').trim();
  if (key.length < 1 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(key)) {
    throw new ApiError(400, 'INVALID_ARGUMENT', 'A valid Idempotency-Key header is required.');
  }
  return key;
};

const asObject = (value: unknown, label: string): JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError(400, 'INVALID_ARGUMENT', `${label} must be an object.`);
  }
  return value as JsonObject;
};

const readRequiredTitle = (value: unknown, label: string): string => {
  if (typeof value !== 'string') {
    throw new ApiError(400, 'INVALID_ARGUMENT', `${label} is required.`);
  }
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 1 || trimmed.length > MAX_TITLE_LENGTH) {
    throw new ApiError(400, 'INVALID_ARGUMENT', `${label} must be 1 to ${MAX_TITLE_LENGTH} characters.`);
  }
  return trimmed;
};

const readOptionalText = (value: unknown, maximum: number, label: string): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new ApiError(400, 'INVALID_ARGUMENT', `${label} must be text.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maximum) {
    throw new ApiError(400, 'INVALID_ARGUMENT', `${label} is too long.`);
  }
  return trimmed;
};

const readOptionalEpochMs = (value: unknown, label: string): number | null => {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < ISO_DATE_MIN_MS ||
    value > ISO_DATE_MAX_MS
  ) {
    throw new ApiError(400, 'INVALID_ARGUMENT', `${label} must be an epoch-millisecond integer.`);
  }
  return value;
};

const readTargetWeight = (value: unknown, label: string): string | null => {
  if (value === undefined || value === null) return null;
  const text = typeof value === 'number'
    ? String(value)
    : typeof value === 'string' ? value.trim() : null;
  if (text === null || !/^\d{1,4}(\.\d{1,2})?$/.test(text)) {
    throw new ApiError(400, 'INVALID_ARGUMENT', `${label} must be a non-negative decimal up to 9999.99.`);
  }
  return text;
};

const readTargetReps = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 999) {
    throw new ApiError(400, 'INVALID_ARGUMENT', `${label} must be an integer between 1 and 999.`);
  }
  return value;
};

const readTargetSetType = (value: unknown, label: string): string | null => {
  const text = readOptionalText(value, 40, label);
  if (text === null) return null;
  if (!isSessionSetType(text)) {
    throw new ApiError(400, 'INVALID_ARGUMENT', `${label} is not a supported set type.`);
  }
  return text;
};

const normalizePlanInput = (value: unknown): JsonObject => {
  const input = asObject(value, 'plan');
  const title = readRequiredTitle(input.title, 'title');
  const gymId = readOptionalText(input.gym_id, 200, 'gym_id');
  const scheduledFor = readOptionalEpochMs(input.scheduled_for, 'scheduled_for');
  const exercisesRaw = input.exercises;
  if (!Array.isArray(exercisesRaw) || exercisesRaw.length < 1 || exercisesRaw.length > MAX_PLAN_BLOCKS) {
    throw new ApiError(400, 'INVALID_ARGUMENT', `exercises must contain 1 to ${MAX_PLAN_BLOCKS} blocks.`);
  }
  const exercises = exercisesRaw.map((entry, index) => {
    const block = asObject(entry, `exercises[${index}]`);
    const name = readRequiredTitle(block.name, `exercises[${index}].name`);
    const exerciseDefinitionId = readOptionalText(
      block.exercise_definition_id,
      200,
      `exercises[${index}].exercise_definition_id`,
    );
    const setsRaw = block.sets;
    if (!Array.isArray(setsRaw) || setsRaw.length < 1 || setsRaw.length > MAX_PLAN_SETS) {
      throw new ApiError(400, 'INVALID_ARGUMENT', `exercises[${index}].sets must contain 1 to ${MAX_PLAN_SETS} sets.`);
    }
    const sets = setsRaw.map((setEntry, setIndex) => {
      const set = asObject(setEntry, `exercises[${index}].sets[${setIndex}]`);
      return {
        target_reps: readTargetReps(set.target_reps, `exercises[${index}].sets[${setIndex}].target_reps`),
        target_weight_value: readTargetWeight(
          set.target_weight_value,
          `exercises[${index}].sets[${setIndex}].target_weight_value`,
        ),
        target_set_type: readTargetSetType(
          set.target_set_type,
          `exercises[${index}].sets[${setIndex}].target_set_type`,
        ),
      };
    });
    return { exercise_definition_id: exerciseDefinitionId, name, sets };
  });
  return { title, gym_id: gymId, scheduled_for: scheduledFor, exercises };
};

const normalizeProgrammeInput = (value: JsonObject): JsonObject => {
  const name = readRequiredTitle(value.name, 'name');
  const description = readOptionalText(value.description, MAX_DESCRIPTION_LENGTH, 'description');
  const plansRaw = value.plans;
  if (!Array.isArray(plansRaw) || plansRaw.length < MIN_PROGRAMME_PLANS || plansRaw.length > MAX_PROGRAMME_PLANS) {
    throw new ApiError(
      400,
      'INVALID_ARGUMENT',
      `plans must contain ${MIN_PROGRAMME_PLANS} to ${MAX_PROGRAMME_PLANS} sessions.`,
    );
  }
  const plans = plansRaw.map((entry) => normalizePlanInput(entry));
  return { name, description, plans };
};

const throwPlanWriteError = (error: { message?: string } | null): void => {
  if (!error) return;
  const message = error.message ?? '';
  if (message.includes('IDEMPOTENCY_CONFLICT')) {
    throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was used with a different payload.');
  }
  if (message.includes('FOREIGN_RESOURCE_REFERENCE')) {
    throw new ApiError(400, 'FOREIGN_RESOURCE_REFERENCE', 'A referenced exercise or gym is not available.');
  }
  if (message.includes('INVALID_ARGUMENT')) {
    throw new ApiError(400, 'INVALID_ARGUMENT', 'The request could not be accepted.');
  }
  throwDatabaseError(error);
};

const parseOptionalBoolean = (raw: string | null, fallback: boolean, label: string): boolean => {
  if (raw === null || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new ApiError(400, 'INVALID_ARGUMENT', `${label} must be true or false.`);
};

type PlanRow = {
  gym_id: string | null;
  id: string;
  programme_id: string | null;
  programme_order_index: number | null;
  provenance: string;
  scheduled_for: number | null;
  title: string;
};

type PlanBlockRow = {
  exercise_definition_id: string | null;
  id: string;
  name: string;
  order_index: number;
  progress_status: string;
  resolved_at: number | null;
  session_plan_id: string;
};

type PlanSetRow = {
  id: string;
  order_index: number;
  session_plan_exercise_id: string;
  target_reps: number;
  target_set_type: string | null;
  target_weight_value: string | null;
};

const createSessionPlan = async (
  client: SupabaseClient,
  agent: AuthenticatedAgent,
  request: Request,
  body: JsonObject,
): Promise<JsonObject> => {
  const idempotencyKey = readIdempotencyKey(request);
  const plan = normalizePlanInput(body);
  const payloadSha = await sha256Hex(JSON.stringify(plan));
  const { data, error } = await client.schema('app_public').rpc('agent_create_session_plan', {
    p_owner: agent.userId,
    p_client_id: agent.clientId,
    p_idempotency_key: idempotencyKey,
    p_payload_sha256: payloadSha,
    p_plan: plan,
  });
  throwPlanWriteError(error);
  return data as JsonObject;
};

const createTrainingProgramme = async (
  client: SupabaseClient,
  agent: AuthenticatedAgent,
  request: Request,
  body: JsonObject,
): Promise<JsonObject> => {
  const idempotencyKey = readIdempotencyKey(request);
  const programme = normalizeProgrammeInput(body);
  const payloadSha = await sha256Hex(JSON.stringify(programme));
  const { data, error } = await client.schema('app_public').rpc('agent_create_training_programme', {
    p_owner: agent.userId,
    p_client_id: agent.clientId,
    p_idempotency_key: idempotencyKey,
    p_payload_sha256: payloadSha,
    p_programme: programme,
  });
  throwPlanWriteError(error);
  return data as JsonObject;
};

const throwExerciseWriteError = (error: { message?: string } | null): void => {
  if (!error) return;
  const message = error.message ?? '';
  if (message.includes('IDEMPOTENCY_CONFLICT')) {
    throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was used with a different payload.');
  }
  if (message.includes('REVISION_CONFLICT')) {
    throw new ApiError(
      409,
      'REVISION_CONFLICT',
      'The exercise changed since it was read. Search it again and retry with its current revision.',
    );
  }
  if (message.includes('EXERCISE_DELETED')) {
    throw new ApiError(409, 'EXERCISE_DELETED', 'The exercise is deleted. Restore it before editing.');
  }
  if (message.includes('UNKNOWN_MUSCLE')) {
    throw new ApiError(400, 'FOREIGN_RESOURCE_REFERENCE', 'A muscle id is not available. Use list_muscles.');
  }
  if (message.includes('NOT_FOUND')) {
    throw new ApiError(404, 'NOT_FOUND', 'Exercise not found.');
  }
  if (message.includes('INVALID_ARGUMENT')) {
    throw new ApiError(400, 'INVALID_ARGUMENT', 'The request could not be accepted.');
  }
  throwDatabaseError(error);
};

const normalizeExerciseInput = <T>(normalize: () => T): T => {
  try {
    return normalize();
  } catch (error) {
    if (error instanceof ExerciseEditError) {
      throw new ApiError(400, 'INVALID_ARGUMENT', error.message);
    }
    throw error;
  }
};

/** Reads one exercise back in its catalog view, deleted or not, for a write's response. */
const loadCatalogExercise = async (
  client: SupabaseClient,
  userId: string,
  exerciseId: string,
  bodyweightCalculationsEnabled: boolean,
): Promise<JsonObject | null> => {
  const { data, error } = await client
    .schema('app_public')
    .from('exercise_definitions')
    .select(CATALOG_EXERCISE_COLUMNS)
    .eq('owner_user_id', userId)
    .eq('id', exerciseId)
    .maybeSingle<CatalogExerciseRow>();
  throwDatabaseError(error);
  if (!data) return null;
  const [exercise] = await projectCatalogExercises(client, userId, [data], bodyweightCalculationsEnabled);
  return exercise;
};

type ExerciseWrite =
  | { kind: 'create' }
  | { kind: 'update'; exerciseId: string }
  | { kind: 'delete' | 'restore'; exerciseId: string };

const writeExercise = async (
  client: SupabaseClient,
  agent: AuthenticatedAgent,
  request: Request,
  write: ExerciseWrite,
): Promise<JsonObject> => {
  const idempotencyKey = readIdempotencyKey(request);
  const body = await readJsonBody(request);
  let rpc: string;
  let args: JsonObject;
  if (write.kind === 'create') {
    const exercise = normalizeExerciseInput(() => normalizeExerciseCreate(body));
    rpc = 'agent_create_exercise';
    args = { p_exercise: exercise, p_payload_sha256: await sha256Hex(JSON.stringify(exercise)) };
  } else if (write.kind === 'update') {
    const update = normalizeExerciseInput(() => normalizeExerciseUpdate(body));
    rpc = 'agent_update_exercise';
    args = {
      p_exercise_id: write.exerciseId,
      p_expected_revision: update.expected_revision,
      p_changes: update.changes,
      p_payload_sha256: await sha256Hex(JSON.stringify({ id: write.exerciseId, ...update })),
    };
  } else {
    const expectedRevision = normalizeExerciseInput(() => normalizeExerciseRevision(body));
    rpc = 'agent_set_exercise_deleted';
    args = {
      p_exercise_id: write.exerciseId,
      p_expected_revision: expectedRevision,
      p_deleted: write.kind === 'delete',
      p_payload_sha256: await sha256Hex(JSON.stringify({ id: write.exerciseId, expected_revision: expectedRevision })),
    };
  }
  const bodyweightSetting = loadBodyweightCalculationsEnabled(client, agent.userId);
  const { data, error } = await client.schema('app_public').rpc(rpc, {
    p_owner: agent.userId,
    p_client_id: agent.clientId,
    p_idempotency_key: idempotencyKey,
    ...args,
  });
  throwExerciseWriteError(error);
  const result = data as JsonObject;
  const bodyweightCalculationsEnabled = await bodyweightSetting;
  return {
    ...result,
    exercise: await loadCatalogExercise(
      client,
      agent.userId,
      String(result.exercise_id),
      bodyweightCalculationsEnabled,
    ),
  };
};

const decodeExerciseId = (raw: string): string => {
  let exerciseId: string;
  try {
    exerciseId = decodeURIComponent(raw);
  } catch {
    throw new ApiError(400, 'INVALID_ARGUMENT', 'exercise_id is invalid.');
  }
  if (exerciseId.length < 1 || exerciseId.length > 200) {
    throw new ApiError(400, 'INVALID_ARGUMENT', 'exercise_id is invalid.');
  }
  return exerciseId;
};

/** The exercise write a POST path names, or null when it is not one. */
const exerciseWriteFor = (path: string): ExerciseWrite | null => {
  if (path === '/v1/agent/exercises') return { kind: 'create' };
  const match = /^\/v1\/agent\/exercises\/([^/]+)(?:\/(delete|restore))?$/.exec(path);
  if (!match) return null;
  const exerciseId = decodeExerciseId(match[1]);
  if (match[2] === 'delete') return { kind: 'delete', exerciseId };
  if (match[2] === 'restore') return { kind: 'restore', exerciseId };
  return { kind: 'update', exerciseId };
};

const getUpcomingSessionPlans = async (
  client: SupabaseClient,
  agent: AuthenticatedAgent,
  url: URL,
): Promise<JsonObject> => {
  rejectUnexpectedQuery(url, new Set(['limit', 'cursor', 'include_unscheduled']));
  const limit = parseBoundedInteger(url.searchParams.get('limit'), DEFAULT_PLAN_LIMIT, 1, MAX_PLAN_LIMIT, 'limit');
  const includeUnscheduled = parseOptionalBoolean(url.searchParams.get('include_unscheduled'), false, 'include_unscheduled');
  const cursor = decodeCursor(url.searchParams.get('cursor'), 'session_plan');

  let query = client
    .schema('app_public')
    .from('session_plans')
    .select('id,title,scheduled_for,gym_id,provenance,programme_id,programme_order_index')
    .eq('owner_user_id', agent.userId)
    .is('deleted_at', null)
    .order('scheduled_for', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(limit + 1);

  if (!includeUnscheduled) {
    query = query.gte('scheduled_for', Date.now());
  }
  if (cursor) {
    if (typeof cursor.id !== 'string') {
      throw new ApiError(400, 'INVALID_CURSOR', 'Cursor is invalid.');
    }
    if (cursor.scheduled_for !== null && typeof cursor.scheduled_for !== 'number') {
      throw new ApiError(400, 'INVALID_CURSOR', 'Cursor is invalid.');
    }
    if (cursor.scheduled_for === null) {
      query = query.is('scheduled_for', null).gt('id', cursor.id);
    } else {
      const value = cursor.scheduled_for;
      const base = `scheduled_for.gt.${value},and(scheduled_for.eq.${value},id.gt.${postgrestQuote(cursor.id)})`;
      query = query.or(includeUnscheduled ? `${base},scheduled_for.is.null` : base);
    }
  }

  const { data, error } = await query.returns<PlanRow[]>();
  throwDatabaseError(error);
  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const planIds = page.map((row) => row.id);

  const blocks: PlanBlockRow[] = [];
  for (const ids of chunk(planIds, 25)) {
    let from = 0;
    const batchPage = 500;
    while (true) {
      const { data: batch, error: blockError } = await client
        .schema('app_public')
        .from('session_plan_exercises')
        .select('id,session_plan_id,exercise_definition_id,order_index,name,progress_status,resolved_at')
        .eq('owner_user_id', agent.userId)
        .is('deleted_at', null)
        .in('session_plan_id', ids)
        .order('order_index')
        .order('id')
        .range(from, from + batchPage - 1)
        .returns<PlanBlockRow[]>();
      throwDatabaseError(blockError);
      const batchRows = batch ?? [];
      blocks.push(...batchRows);
      if (batchRows.length < batchPage) break;
      from += batchPage;
    }
  }

  const blockIds = blocks.map((row) => row.id);
  const sets: PlanSetRow[] = [];
  for (const ids of chunk(blockIds, 50)) {
    let from = 0;
    const batchPage = 500;
    while (true) {
      const { data: batch, error: setError } = await client
        .schema('app_public')
        .from('session_plan_sets')
        .select('id,session_plan_exercise_id,order_index,target_weight_value,target_reps,target_set_type')
        .eq('owner_user_id', agent.userId)
        .is('deleted_at', null)
        .in('session_plan_exercise_id', ids)
        .order('order_index')
        .order('id')
        .range(from, from + batchPage - 1)
        .returns<PlanSetRow[]>();
      throwDatabaseError(setError);
      const batchRows = batch ?? [];
      sets.push(...batchRows);
      if (batchRows.length < batchPage) break;
      from += batchPage;
    }
  }

  const attachedBlockIds = new Set<string>();
  for (const ids of chunk(blockIds, 50)) {
    const { data: cards, error: cardError } = await client
      .schema('app_public')
      .from('session_exercises')
      .select('source_plan_exercise_id,session_id')
      .eq('owner_user_id', agent.userId)
      .is('deleted_at', null)
      .in('source_plan_exercise_id', ids)
      .limit(1000)
      .returns<Array<{ source_plan_exercise_id: string | null; session_id: string }>>();
    throwDatabaseError(cardError);
    const candidateCards = (cards ?? []).filter(
      (c): c is { source_plan_exercise_id: string; session_id: string } =>
        typeof c.source_plan_exercise_id === 'string' && typeof c.session_id === 'string',
    );
    if (candidateCards.length > 0) {
      const sessionIds = uniqueStrings(candidateCards.map((c) => c.session_id), 100);
      const { data: activeSessions, error: activeSessionsError } = await client
        .schema('app_public')
        .from('sessions')
        .select('id')
        .eq('owner_user_id', agent.userId)
        .is('deleted_at', null)
        .in('id', sessionIds)
        .limit(100)
        .returns<Array<{ id: string }>>();
      throwDatabaseError(activeSessionsError);
      const validSessionIds = new Set((activeSessions ?? []).map((s) => s.id));
      for (const card of candidateCards) {
        if (validSessionIds.has(card.session_id)) {
          attachedBlockIds.add(card.source_plan_exercise_id);
        }
      }
    }
  }

  const gymById = await loadGymNames(client, agent.userId, uniqueStrings(page.map((row) => row.gym_id), 50));

  const blocksByPlan = new Map<string, PlanBlockRow[]>();
  for (const block of blocks) {
    const bucket = blocksByPlan.get(block.session_plan_id) ?? [];
    bucket.push(block);
    blocksByPlan.set(block.session_plan_id, bucket);
  }
  const setsByBlock = new Map<string, PlanSetRow[]>();
  for (const set of sets) {
    const bucket = setsByBlock.get(set.session_plan_exercise_id) ?? [];
    bucket.push(set);
    setsByBlock.set(set.session_plan_exercise_id, bucket);
  }

  return {
    plans: page.map((plan) => {
      const planBlocks = blocksByPlan.get(plan.id) ?? [];
      let pendingCount = 0;
      let attachedCount = 0;
      let completedCount = 0;
      let skippedCount = 0;
      for (const block of planBlocks) {
        if (block.progress_status === 'completed') completedCount += 1;
        else if (block.progress_status === 'skipped') skippedCount += 1;
        else if (attachedBlockIds.has(block.id)) attachedCount += 1;
        else pendingCount += 1;
      }
      const unresolved = pendingCount + attachedCount;
      const progress = unresolved === 0 && completedCount + skippedCount > 0
        ? 'completed'
        : attachedCount + completedCount + skippedCount > 0 ? 'in_progress' : 'planned';
      const nextBlock = planBlocks.find(
        (block) => block.progress_status === 'pending' && !attachedBlockIds.has(block.id),
      ) ?? null;
      const blocksTruncated = planBlocks.length > MAX_PLAN_BLOCKS;
      return {
        id: plan.id,
        title: plan.title,
        scheduled_for: toIsoTimestamp(plan.scheduled_for),
        gym: plan.gym_id
          ? { id: plan.gym_id, name: gymById.get(plan.gym_id) ?? null }
          : null,
        provenance: plan.provenance,
        programme_id: plan.programme_id,
        programme_order_index: plan.programme_order_index,
        progress,
        next_block_id: nextBlock?.id ?? null,
        exercises: planBlocks.slice(0, MAX_PLAN_BLOCKS).map((block) => {
          const blockSets = setsByBlock.get(block.id) ?? [];
          return {
            id: block.id,
            exercise_definition_id: block.exercise_definition_id,
            name: block.name,
            order_index: block.order_index,
            progress_status: block.progress_status,
            resolved_at: toIsoTimestamp(block.resolved_at),
            sets: blockSets.slice(0, MAX_PLAN_SETS).map((set) => ({
              id: set.id,
              order_index: set.order_index,
              target_weight_value: set.target_weight_value,
              target_reps: set.target_reps,
              target_set_type: set.target_set_type,
            })),
            truncated: blockSets.length > MAX_PLAN_SETS,
          };
        }),
        truncated: blocksTruncated,
      };
    }),
    next_cursor: hasMore && page.length > 0
      ? encodeCursor({
        kind: 'session_plan',
        scheduled_for: page[page.length - 1].scheduled_for,
        id: page[page.length - 1].id,
      })
      : null,
  };
};

const dispatchAgentRequest = async (
  request: Request,
  agent: AuthenticatedAgent,
  client: SupabaseClient,
): Promise<JsonObject> => {
  const url = new URL(request.url);
  const path = canonicalAgentPath(url);
  const method = request.method;
  rejectIdentityInputs(url);
  if (method === 'GET') {
    rejectRequestBody(request);
  } else {
    rejectUnexpectedQuery(url, new Set());
  }

  if (path === '/v1/agent/session') {
    if (method !== 'GET') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET.');
    }
    rejectUnexpectedQuery(url, new Set());
    return {
      authorized: true,
      access: 'training_read_only',
      client_id: agent.clientId,
      expires_at: agent.expiresAt,
      scopes: agent.scopes,
    };
  }

  if (path === '/v1/agent/session-plans') {
    enforceWriteRateLimit(agent);
    await loadPlanPermission(client, agent);
    if (method === 'GET') {
      return getUpcomingSessionPlans(client, agent, url);
    }
    return createSessionPlan(client, agent, request, await readJsonBody(request));
  }

  if (path === '/v1/agent/programmes') {
    if (method !== 'POST') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
    }
    enforceWriteRateLimit(agent);
    await loadPlanPermission(client, agent);
    return createTrainingProgramme(client, agent, request, await readJsonBody(request));
  }

  if (method === 'POST') {
    const exerciseWrite = exerciseWriteFor(path);
    if (exerciseWrite) {
      enforceExerciseWriteRateLimit(agent);
      await loadPlanPermission(client, agent);
      return writeExercise(client, agent, request, exerciseWrite);
    }
  }

  if (method !== 'GET') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET.');
  }

  if (path === '/v1/agent/muscles') {
    rejectUnexpectedQuery(url, new Set());
    return listMuscles(client, agent.userId);
  }

  const bodyweightCalculationsEnabled = await loadBodyweightCalculationsEnabled(client, agent.userId);
  if (path === '/v1/agent/profile') {
    rejectUnexpectedQuery(url, new Set());
    return getTrainingProfile(client, agent.userId, bodyweightCalculationsEnabled);
  }
  if (path === '/v1/agent/exercises') {
    return searchExercises(client, agent.userId, url, bodyweightCalculationsEnabled);
  }
  if (path === '/v1/agent/workouts/recent') {
    return getRecentWorkouts(client, agent.userId, url, bodyweightCalculationsEnabled);
  }
  if (path === '/v1/agent/training-status') {
    return getTrainingStatus(client, agent.userId, url, bodyweightCalculationsEnabled);
  }
  const contextMatch = /^\/v1\/agent\/exercises\/([^/]+)\/context$/.exec(path);
  if (contextMatch) {
    let exerciseId: string;
    try {
      exerciseId = decodeURIComponent(contextMatch[1]);
    } catch {
      throw new ApiError(400, 'INVALID_ARGUMENT', 'exercise_id is invalid.');
    }
    return getExerciseContext(client, agent.userId, exerciseId, url, bodyweightCalculationsEnabled);
  }
  const historyMatch = /^\/v1\/agent\/exercises\/([^/]+)\/history$/.exec(path);
  if (historyMatch) {
    let exerciseId: string;
    try {
      exerciseId = decodeURIComponent(historyMatch[1]);
    } catch {
      throw new ApiError(400, 'INVALID_ARGUMENT', 'exercise_id is invalid.');
    }
    return getExerciseHistory(client, agent.userId, exerciseId, url, bodyweightCalculationsEnabled);
  }
  const workoutMatch = /^\/v1\/agent\/workouts\/([^/]+)$/.exec(path);
  if (workoutMatch) {
    let sessionId: string;
    try {
      sessionId = decodeURIComponent(workoutMatch[1]);
    } catch {
      throw new ApiError(400, 'INVALID_ARGUMENT', 'session_id is invalid.');
    }
    return getWorkoutDetail(client, agent.userId, sessionId, url, bodyweightCalculationsEnabled);
  }
  throw new ApiError(404, 'NOT_FOUND', 'Agent route not found.');
};

const recordAudit = async (
  client: SupabaseClient,
  agent: AuthenticatedAgent,
  toolName: string,
  requestId: string,
  status: number,
  durationMs: number,
): Promise<void> => {
  const { error } = await client.from('agent_access_audit').insert({
    owner_user_id: agent.userId,
    oauth_client_id: agent.clientId,
    tool_name: toolName,
    http_status: status,
    request_id: requestId,
    duration_ms: Math.max(0, Math.round(durationMs)),
  });
  if (error) {
    console.error('[agent-api] audit insert failed', {
      request_id: requestId,
      message: error.message,
    });
  }
};

const handleRequest = async (request: Request): Promise<Response> => {
  const requestId = requestIdFor(request);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    return errorResponse(requestId, new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET or POST.'));
  }

  const startedAt = performance.now();
  let agent: AuthenticatedAgent | null = null;
  let serviceClient: SupabaseClient | null = null;
  let response: Response;
  const path = canonicalAgentPath(new URL(request.url));
  try {
    agent = await authenticateAgent(request);
    enforceReadRateLimit(agent);
    serviceClient = createServerClient(getServiceRoleKey());
    const data = await dispatchAgentRequest(request, agent, serviceClient);
    response = successResponse(requestId, data);
  } catch (error) {
    if (!(error instanceof ApiError)) {
      console.error('[agent-api] request failed', {
        request_id: requestId,
        path,
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }
    response = errorResponse(requestId, error);
  }

  if (agent && serviceClient) {
    await recordAudit(
      serviceClient,
      agent,
      routeToolName(path, request.method),
      requestId,
      response.status,
      performance.now() - startedAt,
    );
  }
  return response;
};

Deno.serve(handleRequest);
