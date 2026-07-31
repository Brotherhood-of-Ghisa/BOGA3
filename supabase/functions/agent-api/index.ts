import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.98.0';

import {
  computeExerciseVolume,
  computeMaxRepsByWeight,
  estimateExerciseOneRepMax,
  parseSetReps,
  parseSetWeight,
  type CalculationSetInput,
} from '../../../apps/mobile/src/exercise-calculations/index.ts';

const API_VERSION = 'v1';
const DEFAULT_EXERCISE_LIMIT = 20;
const MAX_EXERCISE_LIMIT = 50;
const DEFAULT_RECENT_SESSIONS = 5;
const MAX_RECENT_SESSIONS = 20;
const DEFAULT_WORKOUT_LIMIT = 10;
const MAX_WORKOUT_LIMIT = 25;
const MAX_CONTEXT_BLOCKS = 500;
const MAX_RESPONSE_BYTES = 256 * 1024;
const RATE_LIMIT_REQUESTS = 120;
const RATE_LIMIT_WINDOW_MS = 60_000;
const ISO_DATE_MIN_MS = -8_640_000_000_000_000;
const ISO_DATE_MAX_MS = 8_640_000_000_000_000;

const CORS_HEADERS = {
  'access-control-allow-headers': 'authorization, content-type, x-request-id',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-origin': '*',
};

type JsonObject = Record<string, unknown>;

type AuthenticatedAgent = {
  accessToken: string;
  clientId: string;
  expiresAt: number;
  scopes: string[];
  userId: string;
};

type RateWindow = {
  count: number;
  resetAt: number;
};

type ExerciseDefinitionRow = {
  id: string;
  load_input_mode: string;
  name: string;
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

type SessionRow = {
  completed_at: number | null;
  duration_sec: number | null;
  gym_id: string | null;
  id: string;
  started_at: number;
};

type SetRow = {
  id: string;
  order_index: number;
  performance_status: string | null;
  reps_value: string;
  session_exercise_id: string;
  set_type: string | null;
  weight_value: string;
};

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const rateWindows = new Map<string, RateWindow>();

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

const createServerClient = (key: string): SupabaseClient =>
  createClient(getSupabaseUrl(), key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
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

const authenticateAgent = async (request: Request): Promise<AuthenticatedAgent> => {
  const accessToken = extractBearerToken(request);
  const authClient = createServerClient(getAnonKey());
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(accessToken);

  if (error || !user) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
  }

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

  const grantResponse = await fetch(`${getSupabaseUrl()}/auth/v1/user/oauth/grants`, {
    headers: {
      apikey: getAnonKey(),
      authorization: `Bearer ${accessToken}`,
    },
  });
  if (!grantResponse.ok) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Agent authorization required.');
  }
  const grants = normalizeGrantRows(await grantResponse.json());
  if (!grants.some((grant) => grantClientId(grant) === clientId)) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Agent authorization required.');
  }

  return {
    accessToken,
    clientId,
    expiresAt: expiry,
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

const routeToolName = (path: string): string => {
  if (path === '/v1/agent/session') return 'mcp_session';
  if (path === '/v1/agent/profile') return 'get_training_profile';
  if (path === '/v1/agent/exercises') return 'search_exercises';
  if (path === '/v1/agent/workouts/recent') return 'get_recent_workouts';
  if (/^\/v1\/agent\/exercises\/[^/]+\/context$/.test(path)) {
    return 'get_exercise_context';
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

const enforceRateLimit = (agent: AuthenticatedAgent): void => {
  const key = `${agent.userId}:${agent.clientId}`;
  const now = Date.now();
  const existing = rateWindows.get(key);
  if (!existing || existing.resetAt <= now) {
    rateWindows.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  existing.count += 1;
  if (existing.count > RATE_LIMIT_REQUESTS) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many agent requests. Try again shortly.');
  }
};

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
  const headers = apiError.status === 401
    ? { 'www-authenticate': 'Bearer realm="boga-agent-api"' }
    : {};
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

const getTrainingProfile = async (
  client: SupabaseClient,
  userId: string,
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
    training_preferences: {},
  };
};

const searchExercises = async (
  client: SupabaseClient,
  userId: string,
  url: URL,
): Promise<JsonObject> => {
  rejectUnexpectedQuery(url, new Set(['query', 'muscle', 'equipment', 'limit', 'cursor']));
  const query = parseOptionalText(url.searchParams.get('query'), 120, 'query');
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
    .select('id,name,load_input_mode')
    .eq('owner_user_id', userId)
    .is('deleted_at', null)
    .order('name')
    .order('id')
    .limit(limit + 1);
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

  const { data, error } = await definitionsQuery.returns<ExerciseDefinitionRow[]>();
  throwDatabaseError(error);
  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const exerciseIds = page.map((row) => row.id);
  const [mappings, equipmentByExercise] = await Promise.all([
    loadMappings(client, userId, exerciseIds),
    loadEquipmentByExercise(client, userId, exerciseIds),
  ]);

  return {
    exercises: page.map((row) => ({
      id: row.id,
      name: row.name,
      load_input_mode: row.load_input_mode,
      muscles: mappings.get(row.id) ?? [],
      equipment: equipmentByExercise.get(row.id) ?? [],
    })),
    next_cursor: hasMore && page.length > 0
      ? encodeCursor({
        kind: 'exercise',
        name: page[page.length - 1].name,
        id: page[page.length - 1].id,
      })
      : null,
  };
};

const loadSessionsById = async (
  client: SupabaseClient,
  userId: string,
  sessionIds: string[],
): Promise<SessionRow[]> => {
  const rows: SessionRow[] = [];
  for (const ids of chunk(uniqueStrings(sessionIds, MAX_CONTEXT_BLOCKS), 100)) {
    const { data, error } = await client
      .schema('app_public')
      .from('sessions')
      .select('id,gym_id,started_at,completed_at,duration_sec')
      .eq('owner_user_id', userId)
      .eq('status', 'completed')
      .is('deleted_at', null)
      .in('id', ids)
      .limit(100)
      .returns<SessionRow[]>();
    throwDatabaseError(error);
    rows.push(...(data ?? []));
  }
  return rows;
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

const calculationInputsFor = (sets: SetRow[]): CalculationSetInput[] =>
  sets.map((set) => ({
    weightValue: set.weight_value,
    repsValue: set.reps_value,
    setType: set.set_type,
  }));

const getExerciseContext = async (
  client: SupabaseClient,
  userId: string,
  exerciseId: string,
  url: URL,
): Promise<JsonObject> => {
  rejectUnexpectedQuery(url, new Set(['recent_sessions']));
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
    .select('id,name,load_input_mode')
    .eq('owner_user_id', userId)
    .eq('id', exerciseId)
    .is('deleted_at', null)
    .maybeSingle<ExerciseDefinitionRow>();
  throwDatabaseError(definitionError);
  if (!definition) {
    throw new ApiError(404, 'NOT_FOUND', 'Exercise not found.');
  }

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
    loadSessionsById(client, userId, boundedBlocks.map((row) => row.session_id)),
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
    .map((session) => {
      const sessionBlocks = blocksBySession.get(session.id) ?? [];
      const blockSets = sessionBlocks
        .flatMap((block) => setsByBlock.get(block.id) ?? [])
        .filter(
          (set) =>
            parseSetWeight(set.weight_value) !== null &&
            parseSetReps(set.reps_value) !== null,
        );
      const inputs = calculationInputsFor(blockSets);
      return {
        session,
        sessionBlocks,
        sets: blockSets,
        volume: computeExerciseVolume(inputs),
        estimatedOneRepMax: estimateExerciseOneRepMax(inputs),
      };
    })
    .filter((row) => row.sets.length > 0);

  const allSets = performanceRows.flatMap((row) => row.sets);
  const allInputs = calculationInputsFor(allSets);
  const maxRepsByWeight = computeMaxRepsByWeight(allInputs);
  const topWeight = maxRepsByWeight[0] ?? null;
  const bestOneRepMax = performanceRows.reduce<number | null>((best, row) => {
    if (row.estimatedOneRepMax === null) return best;
    return best === null ? row.estimatedOneRepMax : Math.max(best, row.estimatedOneRepMax);
  }, null);
  const maxSessionVolume = performanceRows.reduce<number | null>(
    (best, row) => best === null ? row.volume : Math.max(best, row.volume),
    null,
  );

  return {
    exercise: {
      id: definition.id,
      name: definition.name,
      load_input_mode: definition.load_input_mode,
      muscles: mappings.get(exerciseId) ?? [],
      equipment: equipmentByExercise.get(exerciseId) ?? [],
    },
    recent_performances: performanceRows.slice(0, recentSessions).map((row) => ({
      session_id: row.session.id,
      started_at: toIsoTimestamp(row.session.started_at),
      completed_at: toIsoTimestamp(row.session.completed_at),
      duration_seconds: row.session.duration_sec,
      volume: { value: row.volume, unit: 'kg_reps' },
      estimated_one_rep_max: row.estimatedOneRepMax === null
        ? null
        : { value: row.estimatedOneRepMax, unit: 'kg' },
      sets: row.sets.map((set) => {
        const weight = parseSetWeight(set.weight_value);
        const reps = parseSetReps(set.reps_value);
        const outcome = set.performance_status === 'skipped'
          ? 'skipped'
          : weight !== null && reps !== null
          ? 'completed'
          : 'incomplete';
        return {
          id: set.id,
          order_index: set.order_index,
          load: weight === null ? null : { value: weight, unit: 'kg' },
          reps,
          set_type: set.set_type,
          performance_status: set.performance_status,
          outcome,
        };
      }),
    })),
    personal_records: {
      estimated_one_rep_max: bestOneRepMax === null
        ? null
        : { value: bestOneRepMax, unit: 'kg' },
      top_weight: topWeight === null
        ? null
        : { value: topWeight.weight, reps: topWeight.maxReps, unit: 'kg' },
      max_session_volume: maxSessionVolume === null
        ? null
        : { value: maxSessionVolume, unit: 'kg_reps' },
    },
    volume_series: performanceRows.slice(0, 12).reverse().map((row) => ({
      completed_at: toIsoTimestamp(row.session.completed_at),
      value: row.volume,
      unit: 'kg_reps',
    })),
    last_performed_at: performanceRows.length > 0
      ? toIsoTimestamp(performanceRows[0].session.completed_at)
      : null,
    training_notes: [],
    unavailable_fields: ['failed_set_semantics', 'user_authored_training_notes'],
    history_truncated: historyTruncated || setResult.truncated,
  };
};

const getRecentWorkouts = async (
  client: SupabaseClient,
  userId: string,
  url: URL,
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
    .select('id,gym_id,started_at,completed_at,duration_sec')
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
  const page = rows.slice(0, limit);
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
  const setResult = await loadSetsByBlock(client, userId, (blocks ?? []).map((row) => row.id));

  const gymIds = uniqueStrings(page.map((row) => row.gym_id), 50);
  const { data: gyms, error: gymError } = gymIds.length === 0
    ? { data: [] as Array<{ id: string; name: string }>, error: null }
    : await client
      .schema('app_public')
      .from('gyms')
      .select('id,name')
      .eq('owner_user_id', userId)
      .in('id', gymIds)
      .limit(50)
      .returns<Array<{ id: string; name: string }>>();
  throwDatabaseError(gymError);
  const gymById = new Map((gyms ?? []).map((row) => [row.id, row.name]));

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
    workouts: page.map((session) => {
      const workoutBlocks = blocksBySession.get(session.id) ?? [];
      const workoutSets = workoutBlocks.flatMap((block) => setsByBlock.get(block.id) ?? []);
      const validSetCount = workoutSets.reduce((count, set) =>
        parseSetWeight(set.weight_value) !== null && parseSetReps(set.reps_value) !== null
          ? count + 1
          : count, 0);
      return {
        id: session.id,
        started_at: toIsoTimestamp(session.started_at),
        completed_at: toIsoTimestamp(session.completed_at),
        duration_seconds: session.duration_sec,
        gym: session.gym_id
          ? { id: session.gym_id, name: gymById.get(session.gym_id) ?? null }
          : null,
        exercise_count: workoutBlocks.length,
        completed_set_count: validSetCount,
        total_volume: {
          value: computeExerciseVolume(calculationInputsFor(workoutSets)),
          unit: 'kg_reps',
        },
        exercises: workoutBlocks.slice(0, 50).map((block) => ({
          id: block.id,
          exercise_id: block.exercise_definition_id,
          name: block.name,
          equipment: block.machine_name,
          set_count: (setsByBlock.get(block.id) ?? []).length,
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

const dispatchAgentRequest = async (
  request: Request,
  agent: AuthenticatedAgent,
  client: SupabaseClient,
): Promise<JsonObject> => {
  const url = new URL(request.url);
  const path = canonicalAgentPath(url);
  rejectIdentityInputs(url);
  rejectRequestBody(request);

  if (path === '/v1/agent/session') {
    rejectUnexpectedQuery(url, new Set());
    return {
      authorized: true,
      access: 'training_read_only',
      client_id: agent.clientId,
      expires_at: agent.expiresAt,
      scopes: agent.scopes,
    };
  }
  if (path === '/v1/agent/profile') {
    rejectUnexpectedQuery(url, new Set());
    return getTrainingProfile(client, agent.userId);
  }
  if (path === '/v1/agent/exercises') {
    return searchExercises(client, agent.userId, url);
  }
  if (path === '/v1/agent/workouts/recent') {
    return getRecentWorkouts(client, agent.userId, url);
  }
  const contextMatch = /^\/v1\/agent\/exercises\/([^/]+)\/context$/.exec(path);
  if (contextMatch) {
    let exerciseId: string;
    try {
      exerciseId = decodeURIComponent(contextMatch[1]);
    } catch {
      throw new ApiError(400, 'INVALID_ARGUMENT', 'exercise_id is invalid.');
    }
    return getExerciseContext(client, agent.userId, exerciseId, url);
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
  if (request.method !== 'GET') {
    return errorResponse(requestId, new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET.'));
  }

  const startedAt = performance.now();
  let agent: AuthenticatedAgent | null = null;
  let serviceClient: SupabaseClient | null = null;
  let response: Response;
  const path = canonicalAgentPath(new URL(request.url));
  try {
    agent = await authenticateAgent(request);
    enforceRateLimit(agent);
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
      routeToolName(path),
      requestId,
      response.status,
      performance.now() - startedAt,
    );
  }
  return response;
};

Deno.serve(handleRequest);
