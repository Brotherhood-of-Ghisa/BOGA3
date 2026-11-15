// Injuries and physical limitations for the coach: `GET/POST /v1/agent/injuries`,
// and `PATCH /v1/agent/injuries/:id`.
// Pure: the routes read owner-filtered rows and these rules parse the caller's input,
// normalize fields, and project rows with muscle group display names and ISO timestamps.

export const CANONICAL_MUSCLE_GROUP_IDS = [
  'chest',
  'serratus_anterior',
  'delts_front',
  'delts_lateral',
  'delts_rear',
  'rotator_cuff',
  'back_lats',
  'back_upper',
  'traps_upper',
  'traps_lower',
  'spinal_erectors',
  'biceps',
  'brachialis',
  'triceps',
  'forearms_grip',
  'abs_rectus',
  'abs_obliques',
  'quads',
  'hamstrings',
  'glutes_max',
  'hip_abductors',
  'adductors',
  'hip_flexors',
  'calves',
  'tibialis_anterior',
] as const;

export const CANONICAL_MUSCLE_SET: ReadonlySet<string> = new Set(CANONICAL_MUSCLE_GROUP_IDS);

export const DEFAULT_INJURY_LIMIT = 20;
export const MAX_INJURY_LIMIT = 50;
export const MAX_ID_LENGTH = 200;
export const MAX_LABEL_LENGTH = 100;
export const MAX_NOTES_LENGTH = 1000;
export const MAX_CONTRAINDICATIONS_LENGTH = 500;

export const INJURY_STATUSES: ReadonlySet<string> = new Set(['acute', 'managing', 'monitoring', 'resolved']);
export const INJURY_WRITE_STATUSES: ReadonlySet<string> = new Set(['acute', 'managing', 'monitoring']);
export const INJURY_SIDES: ReadonlySet<string> = new Set(['left', 'right', 'bilateral']);

export const INJURY_COLUMNS =
  'id,muscle_group_id,side,status,pain_score,label,notes,contraindications,started_at,resolved_at,created_at,updated_at';

export type InjuryRow = {
  id: string;
  muscle_group_id: string | null;
  side: string | null;
  status: string;
  pain_score: number | null;
  label: string;
  notes: string | null;
  contraindications: string | null;
  started_at: number;
  resolved_at: number | null;
  created_at: number;
  updated_at: number;
};

export class InjuryInputError extends Error {
  constructor(
    message: string,
    readonly code: string = 'INVALID_ARGUMENT',
    readonly status: number = 400,
  ) {
    super(message);
    this.name = 'InjuryInputError';
  }
}

type JsonObject = Record<string, unknown>;

const fail = (message: string, code = 'INVALID_ARGUMENT', status = 400): never => {
  throw new InjuryInputError(message, code, status);
};

export const parseInjuryQuery = (url: URL) => {
  const allowed = new Set(['status', 'include_resolved', 'limit', 'cursor']);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) {
      fail(`Unsupported query parameter: ${key}`);
    }
  }

  const rawStatus = url.searchParams.get('status');
  if (rawStatus !== null && !INJURY_STATUSES.has(rawStatus)) {
    fail('status must be one of: acute, managing, monitoring, resolved.');
  }

  const rawIncludeResolved = url.searchParams.get('include_resolved');
  let includeResolved = false;
  if (rawIncludeResolved !== null) {
    if (rawIncludeResolved === 'true' || rawIncludeResolved === '1') {
      includeResolved = true;
    } else if (rawIncludeResolved === 'false' || rawIncludeResolved === '0') {
      includeResolved = false;
    } else {
      fail('include_resolved must be a boolean.');
    }
  }

  return {
    status: rawStatus,
    include_resolved: includeResolved,
  };
};

export type InjuryCursor = { started_at: number; id: string };

export const injuryCursorFrom = (value: JsonObject): InjuryCursor => {
  const { started_at: startedAt, id } = value;
  if (
    typeof startedAt !== 'number' ||
    !Number.isSafeInteger(startedAt) ||
    typeof id !== 'string' ||
    id.length === 0 ||
    id.length > MAX_ID_LENGTH
  ) {
    return fail('Cursor is invalid.', 'INVALID_CURSOR');
  }
  return { started_at: startedAt, id };
};

export const injuryCursorOf = (row: InjuryRow): JsonObject => ({
  kind: 'injury',
  started_at: row.started_at,
  id: row.id,
});

const quote = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export const injuryKeysetFilter = (cursor: InjuryCursor): string => {
  const id = quote(cursor.id);
  return `started_at.lt.${cursor.started_at},and(started_at.eq.${cursor.started_at},id.lt.${id})`;
};

const toIsoDate = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return null;
};

export const projectInjury = (
  row: InjuryRow | JsonObject,
  muscleNames: ReadonlyMap<string, string>,
): JsonObject => {
  const muscleId = (row.muscle_group_id as string | null) ?? null;
  return {
    id: row.id,
    muscle_group_id: muscleId,
    muscle_group_name: muscleId === null ? null : muscleNames.get(muscleId) ?? null,
    side: (row.side as string | null) ?? null,
    status: row.status,
    pain_score: (row.pain_score as number | null) ?? null,
    label: row.label,
    notes: (row.notes as string | null) ?? null,
    contraindications: (row.contraindications as string | null) ?? null,
    started_at: toIsoDate(row.started_at),
    resolved_at: toIsoDate(row.resolved_at),
    created_at: toIsoDate(row.created_at),
    updated_at: toIsoDate(row.updated_at),
  };
};

export const injuryMuscleIds = (rows: readonly (InjuryRow | JsonObject)[]): string[] => [
  ...new Set(
    rows.flatMap((row) => (row.muscle_group_id ? [row.muscle_group_id as string] : [])),
  ),
];

const readLabel = (value: unknown): string => {
  if (typeof value !== 'string') fail('Give the injury a label.');
  const trimmed = value.trim();
  if (trimmed.length === 0) fail('Give the injury a label.');
  if (trimmed.length > MAX_LABEL_LENGTH) fail(`label must be at most ${MAX_LABEL_LENGTH} characters.`);
  return trimmed;
};

const readMuscleGroupId = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    fail('muscle_group_id must be a string or null.');
  }
  if (!CANONICAL_MUSCLE_SET.has(value)) {
    fail(
      'muscle_group_id must be one of the 25 canonical muscle groups or null.',
      'INVALID_ANATOMY_REFERENCE',
      400,
    );
  }
  return value;
};

const readSide = (value: unknown): 'left' | 'right' | 'bilateral' | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !INJURY_SIDES.has(value)) {
    fail('side must be left, right, bilateral, or null.');
  }
  return value as 'left' | 'right' | 'bilateral';
};

const readPainScore = (value: unknown): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10) {
    fail('Pain rating must be a whole number between 0 and 10.');
  }
  return value;
};

const readNotes = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail('notes must be text.');
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_NOTES_LENGTH) fail(`notes must be at most ${MAX_NOTES_LENGTH} characters.`);
  return trimmed;
};

const readContraindications = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail('contraindications must be text.');
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_CONTRAINDICATIONS_LENGTH) {
    fail(`contraindications must be at most ${MAX_CONTRAINDICATIONS_LENGTH} characters.`);
  }
  return trimmed;
};

const readStartedAt = (value: unknown): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail('started_at must be an ISO 8601 string.');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail('started_at must be a valid ISO 8601 string.');
  if (parsed > Date.now()) fail('The started date cannot be in the future.');
  return parsed;
};

const ADD_KEYS = new Set([
  'label',
  'muscle_group_id',
  'side',
  'status',
  'pain_score',
  'notes',
  'contraindications',
  'started_at',
]);

export type InjuryAdd = {
  injury: {
    label: string;
    muscle_group_id: string | null;
    side: 'left' | 'right' | 'bilateral' | null;
    status: string;
    pain_score: number | null;
    notes: string | null;
    contraindications: string | null;
    started_at?: number;
  };
  hashed: {
    label: string;
    muscle_group_id: string | null;
    side: 'left' | 'right' | 'bilateral' | null;
    status: string;
    pain_score: number | null;
    notes: string | null;
    contraindications: string | null;
    started_at: string | null;
  };
};

export const normalizeInjuryAdd = (input: JsonObject): InjuryAdd => {
  for (const key of Object.keys(input)) {
    if (!ADD_KEYS.has(key)) fail(`Unsupported field: ${key}`);
  }

  const label = readLabel(input.label);
  const muscleGroupId = readMuscleGroupId(input.muscle_group_id);
  const side = readSide(input.side);

  let status = 'acute';
  if (input.status !== undefined && input.status !== null) {
    if (typeof input.status !== 'string' || !INJURY_WRITE_STATUSES.has(input.status)) {
      fail('status must be one of: acute, managing, monitoring.');
    }
    status = input.status;
  }

  const painScore = readPainScore(input.pain_score);
  const notes = readNotes(input.notes);
  const contraindications = readContraindications(input.contraindications);
  const rawStartedAt = typeof input.started_at === 'string' ? input.started_at : null;
  const startedAtMs = readStartedAt(input.started_at);

  return {
    injury: {
      label,
      muscle_group_id: muscleGroupId,
      side,
      status,
      pain_score: painScore,
      notes,
      contraindications,
      ...(startedAtMs !== null ? { started_at: startedAtMs } : {}),
    },
    hashed: {
      label,
      muscle_group_id: muscleGroupId,
      side,
      status,
      pain_score: painScore,
      notes,
      contraindications,
      started_at: rawStartedAt,
    },
  };
};

const UPDATE_KEYS = new Set([
  'status',
  'pain_score',
  'notes',
  'contraindications',
  'label',
  'side',
  'muscle_group_id',
]);

export type InjuryUpdate = {
  injury_id: string;
  changes: {
    status?: string;
    pain_score?: number | null;
    notes?: string | null;
    contraindications?: string | null;
    label?: string;
    side?: 'left' | 'right' | 'bilateral' | null;
    muscle_group_id?: string | null;
  };
};

export const normalizeInjuryUpdate = (input: JsonObject, injuryId: string): InjuryUpdate => {
  if (injuryId.length === 0 || injuryId.length > MAX_ID_LENGTH) {
    fail('injury_id is invalid.');
  }

  const keys = Object.keys(input);
  if (keys.length === 0) {
    fail('At least one field must be updated.');
  }

  for (const key of keys) {
    if (!UPDATE_KEYS.has(key)) fail(`Unsupported field: ${key}`);
  }

  const changes: InjuryUpdate['changes'] = {};

  if ('status' in input) {
    const val = input.status;
    if (typeof val !== 'string' || !INJURY_STATUSES.has(val)) {
      fail('status must be one of: acute, managing, monitoring, resolved.');
    }
    changes.status = val;
  }

  if ('pain_score' in input) {
    changes.pain_score = readPainScore(input.pain_score);
  }

  if ('notes' in input) {
    changes.notes = readNotes(input.notes);
  }

  if ('contraindications' in input) {
    changes.contraindications = readContraindications(input.contraindications);
  }

  if ('label' in input) {
    changes.label = readLabel(input.label);
  }

  if ('side' in input) {
    changes.side = readSide(input.side);
  }

  if ('muscle_group_id' in input) {
    changes.muscle_group_id = readMuscleGroupId(input.muscle_group_id);
  }

  return {
    injury_id: injuryId,
    changes,
  };
};
