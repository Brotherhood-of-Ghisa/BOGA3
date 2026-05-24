import type { SupabaseClient } from '@supabase/supabase-js';

import { bootstrapLocalDataLayer, type LocalDatabase } from '@/src/data/bootstrap';
import { seedSystemExerciseCatalog } from '@/src/data/exercise-catalog-seeds';
import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  exerciseSets,
  exerciseTagDefinitions,
  gyms,
  sessionExercises,
  sessionExerciseTags,
  sessions,
} from '@/src/data/schema';
import { logEvent } from '@/src/logging';
import { normalizeSessionSetType, type SessionSetTypeValue } from '@/src/data/set-types';

import { enqueueSyncEventsTx, type QueuedSyncEventInput } from './outbox';

type MergeReadTx = Pick<LocalDatabase, 'select'>;
type MergeWriteTx = Pick<LocalDatabase, 'delete' | 'insert' | 'select' | 'update'>;

type GymRow = {
  id: string;
  name: string;
  deletedAtMs: number | null;
  latitude: number | null;
  longitude: number | null;
  coordinateAccuracyM: number | null;
  coordinatesUpdatedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

type SessionRow = {
  id: string;
  gymId: string | null;
  status: 'active' | 'completed';
  startedAtMs: number;
  completedAtMs: number | null;
  durationSec: number | null;
  deletedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

type SessionExerciseRow = {
  id: string;
  sessionId: string;
  exerciseDefinitionId: string | null;
  orderIndex: number;
  name: string;
  machineName: string | null;
  deletedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

type ExerciseSetRow = {
  id: string;
  sessionExerciseId: string;
  orderIndex: number;
  weightValue: string;
  repsValue: string;
  setType: SessionSetTypeValue;
  deletedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

type ExerciseDefinitionRow = {
  id: string;
  name: string;
  deletedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

type ExerciseMuscleMappingRow = {
  id: string;
  exerciseDefinitionId: string;
  muscleGroupId: string;
  weight: number;
  role: 'primary' | 'secondary' | 'stabilizer' | null;
  createdAtMs: number;
  updatedAtMs: number;
};

type ExerciseTagDefinitionRow = {
  id: string;
  exerciseDefinitionId: string;
  name: string;
  normalizedName: string;
  deletedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

type SessionExerciseTagRow = {
  id: string;
  sessionExerciseId: string;
  exerciseTagDefinitionId: string;
  createdAtMs: number;
};

type ProjectionState = {
  gyms: GymRow[];
  sessions: SessionRow[];
  sessionExercises: SessionExerciseRow[];
  exerciseSets: ExerciseSetRow[];
  exerciseDefinitions: ExerciseDefinitionRow[];
  exerciseMuscleMappings: ExerciseMuscleMappingRow[];
  exerciseTagDefinitions: ExerciseTagDefinitionRow[];
  sessionExerciseTags: SessionExerciseTagRow[];
};

export type SyncBootstrapRemoteState = ProjectionState;

type MergeSelection<T> = {
  merged: T[];
  localSelections: T[];
};

type MergePlan = {
  mergedState: ProjectionState;
  localSelections: ProjectionState;
};

export type SyncBootstrapMergeResult = {
  convergenceEventsQueued: number;
  mergedCounts: Record<keyof ProjectionState, number>;
};

export type SyncBootstrapConvergenceResult = {
  status: 'converged' | 'not_converged';
  attempts: number;
  totalSentCount: number;
  lastFlushResult:
    | { status: 'idle' }
    | {
        status:
          | 'in_flight'
          | 'disabled'
          | 'offline'
          | 'blocked'
          | 'backoff'
          | 'failure_retry_scheduled'
          | 'failure_blocked'
          | 'transport_failure';
      };
};

const isFiniteEpochMs = (value: number) => Number.isFinite(value) && value >= 0;

const normalizeEpochMs = (value: unknown, label: string): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!isFiniteEpochMs(numeric)) {
    throw new Error(`${label} must be a finite epoch millisecond number`);
  }
  return Math.floor(numeric);
};

const normalizeOptionalEpochMs = (value: unknown, label: string): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return normalizeEpochMs(value, label);
};

const normalizeOptionalFiniteNumber = (value: unknown, label: string): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} must be a finite number`);
  }
  return numeric;
};

const normalizeGymCoordinateFields = (row: Record<string, unknown>) => {
  const latitude = normalizeOptionalFiniteNumber(row.latitude, 'gyms.latitude');
  const longitude = normalizeOptionalFiniteNumber(row.longitude, 'gyms.longitude');
  const coordinateAccuracyM = normalizeOptionalFiniteNumber(
    row.coordinate_accuracy_m,
    'gyms.coordinate_accuracy_m'
  );
  const coordinatesUpdatedAtMs = normalizeOptionalEpochMs(
    row.coordinates_updated_at,
    'gyms.coordinates_updated_at'
  );

  const allMissing =
    latitude === null && longitude === null && coordinateAccuracyM === null && coordinatesUpdatedAtMs === null;
  const allPresent =
    latitude !== null && longitude !== null && coordinateAccuracyM !== null && coordinatesUpdatedAtMs !== null;

  if (!allMissing && !allPresent) {
    throw new Error('gym coordinate fields must be all null or all non-null');
  }
  if (latitude !== null && (latitude < -90 || latitude > 90)) {
    throw new Error('gyms.latitude must be between -90 and 90');
  }
  if (longitude !== null && (longitude < -180 || longitude > 180)) {
    throw new Error('gyms.longitude must be between -180 and 180');
  }
  if (coordinateAccuracyM !== null && coordinateAccuracyM < 0) {
    throw new Error('gyms.coordinate_accuracy_m must be non-negative');
  }

  return {
    latitude,
    longitude,
    coordinateAccuracyM,
    coordinatesUpdatedAtMs,
  };
};

const normalizeString = (value: unknown, label: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} must be non-empty`);
  }

  return trimmed;
};

const normalizeOptionalString = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeStatus = (value: unknown): SessionRow['status'] => {
  return value === 'completed' ? 'completed' : 'active';
};

const normalizeOptionalRole = (value: unknown): ExerciseMuscleMappingRow['role'] => {
  if (value === 'primary' || value === 'secondary' || value === 'stabilizer') {
    return value;
  }
  return null;
};

const normalizeDurationSec = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return Math.floor(numeric);
};

const parseRemoteGym = (row: Record<string, unknown>): GymRow => ({
  id: normalizeString(row.id, 'gyms.id'),
  name: normalizeString(row.name, 'gyms.name'),
  ...normalizeGymCoordinateFields(row),
  deletedAtMs: normalizeOptionalEpochMs(row.deleted_at, 'gyms.deleted_at'),
  createdAtMs: normalizeEpochMs(row.created_at, 'gyms.created_at'),
  updatedAtMs: normalizeEpochMs(row.updated_at, 'gyms.updated_at'),
});

const parseRemoteSession = (row: Record<string, unknown>): SessionRow => ({
  id: normalizeString(row.id, 'sessions.id'),
  gymId: normalizeOptionalString(row.gym_id),
  status: normalizeStatus(row.status),
  startedAtMs: normalizeEpochMs(row.started_at, 'sessions.started_at'),
  completedAtMs: normalizeOptionalEpochMs(row.completed_at, 'sessions.completed_at'),
  durationSec: normalizeDurationSec(row.duration_sec),
  deletedAtMs: normalizeOptionalEpochMs(row.deleted_at, 'sessions.deleted_at'),
  createdAtMs: normalizeEpochMs(row.created_at, 'sessions.created_at'),
  updatedAtMs: normalizeEpochMs(row.updated_at, 'sessions.updated_at'),
});

const parseRemoteSessionExercise = (row: Record<string, unknown>): SessionExerciseRow => ({
  id: normalizeString(row.id, 'session_exercises.id'),
  sessionId: normalizeString(row.session_id, 'session_exercises.session_id'),
  exerciseDefinitionId: normalizeOptionalString(row.exercise_definition_id),
  orderIndex: Math.max(0, Math.floor(Number(row.order_index) || 0)),
  name: normalizeString(row.name, 'session_exercises.name'),
  machineName: normalizeOptionalString(row.machine_name),
  deletedAtMs: normalizeOptionalEpochMs(row.deleted_at, 'session_exercises.deleted_at'),
  createdAtMs: normalizeEpochMs(row.created_at, 'session_exercises.created_at'),
  updatedAtMs: normalizeEpochMs(row.updated_at, 'session_exercises.updated_at'),
});

const parseRemoteExerciseSet = (row: Record<string, unknown>): ExerciseSetRow => ({
  id: normalizeString(row.id, 'exercise_sets.id'),
  sessionExerciseId: normalizeString(row.session_exercise_id, 'exercise_sets.session_exercise_id'),
  orderIndex: Math.max(0, Math.floor(Number(row.order_index) || 0)),
  weightValue: typeof row.weight_value === 'string' ? row.weight_value : String(row.weight_value ?? ''),
  repsValue: typeof row.reps_value === 'string' ? row.reps_value : String(row.reps_value ?? ''),
  setType: normalizeSessionSetType(row.set_type),
  deletedAtMs: normalizeOptionalEpochMs(row.deleted_at, 'exercise_sets.deleted_at'),
  createdAtMs: normalizeEpochMs(row.created_at, 'exercise_sets.created_at'),
  updatedAtMs: normalizeEpochMs(row.updated_at, 'exercise_sets.updated_at'),
});

const parseRemoteExerciseDefinition = (row: Record<string, unknown>): ExerciseDefinitionRow => ({
  id: normalizeString(row.id, 'exercise_definitions.id'),
  name: normalizeString(row.name, 'exercise_definitions.name'),
  deletedAtMs: normalizeOptionalEpochMs(row.deleted_at, 'exercise_definitions.deleted_at'),
  createdAtMs: normalizeEpochMs(row.created_at, 'exercise_definitions.created_at'),
  updatedAtMs: normalizeEpochMs(row.updated_at, 'exercise_definitions.updated_at'),
});

const parseRemoteExerciseMuscleMapping = (row: Record<string, unknown>): ExerciseMuscleMappingRow => {
  const weight = Number(row.weight);
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error('exercise_muscle_mappings.weight must be a positive number');
  }

  return {
    id: normalizeString(row.id, 'exercise_muscle_mappings.id'),
    exerciseDefinitionId: normalizeString(
      row.exercise_definition_id,
      'exercise_muscle_mappings.exercise_definition_id'
    ),
    muscleGroupId: normalizeString(row.muscle_group_id, 'exercise_muscle_mappings.muscle_group_id'),
    weight,
    role: normalizeOptionalRole(row.role),
    createdAtMs: normalizeEpochMs(row.created_at, 'exercise_muscle_mappings.created_at'),
    updatedAtMs: normalizeEpochMs(row.updated_at, 'exercise_muscle_mappings.updated_at'),
  };
};

const parseRemoteExerciseTagDefinition = (row: Record<string, unknown>): ExerciseTagDefinitionRow => ({
  id: normalizeString(row.id, 'exercise_tag_definitions.id'),
  exerciseDefinitionId: normalizeString(
    row.exercise_definition_id,
    'exercise_tag_definitions.exercise_definition_id'
  ),
  name: normalizeString(row.name, 'exercise_tag_definitions.name'),
  normalizedName: normalizeString(row.normalized_name, 'exercise_tag_definitions.normalized_name'),
  deletedAtMs: normalizeOptionalEpochMs(row.deleted_at, 'exercise_tag_definitions.deleted_at'),
  createdAtMs: normalizeEpochMs(row.created_at, 'exercise_tag_definitions.created_at'),
  updatedAtMs: normalizeEpochMs(row.updated_at, 'exercise_tag_definitions.updated_at'),
});

const parseRemoteSessionExerciseTag = (row: Record<string, unknown>): SessionExerciseTagRow => ({
  id: normalizeString(row.id, 'session_exercise_tags.id'),
  sessionExerciseId: normalizeString(row.session_exercise_id, 'session_exercise_tags.session_exercise_id'),
  exerciseTagDefinitionId: normalizeString(
    row.exercise_tag_definition_id,
    'session_exercise_tags.exercise_tag_definition_id'
  ),
  createdAtMs: normalizeEpochMs(row.created_at, 'session_exercise_tags.created_at'),
});

const selectRows = async (
  promise: PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>,
  label: string
): Promise<Record<string, unknown>[]> => {
  const { data, error } = await promise;

  if (error) {
    throw new Error(`Unable to fetch remote ${label}: ${error.message}`);
  }

  return data ?? [];
};

const selectExerciseSetRows = async (
  appPublicClient: ReturnType<SupabaseClient['schema']>
): Promise<Record<string, unknown>[]> => {
  const preferredColumns =
    'id,session_exercise_id,order_index,weight_value,reps_value,set_type,deleted_at,created_at,updated_at';
  const fallbackColumns = 'id,session_exercise_id,order_index,weight_value,reps_value,deleted_at,created_at,updated_at';

  const { data, error } = await appPublicClient.from('exercise_sets').select(preferredColumns);
  if (!error) {
    return data ?? [];
  }

  const normalizedMessage = error.message.toLowerCase();
  const missingSetTypeColumn = normalizedMessage.includes('set_type') && normalizedMessage.includes('does not exist');
  if (!missingSetTypeColumn) {
    throw new Error(`Unable to fetch remote exercise_sets: ${error.message}`);
  }

  const fallbackRows = await selectRows(appPublicClient.from('exercise_sets').select(fallbackColumns), 'exercise_sets');
  return fallbackRows.map((row) => ({
    ...row,
    set_type: null,
  }));
};

export const fetchRemoteSyncProjectionState = async (client: SupabaseClient): Promise<SyncBootstrapRemoteState> => {
  const appPublicClient = client.schema('app_public');

  let remoteRows: [
    Record<string, unknown>[],
    Record<string, unknown>[],
    Record<string, unknown>[],
    Record<string, unknown>[],
    Record<string, unknown>[],
    Record<string, unknown>[],
    Record<string, unknown>[],
    Record<string, unknown>[],
  ];

  try {
    remoteRows = await Promise.all([
      selectRows(
        appPublicClient
          .from('gyms')
          .select('id,name,latitude,longitude,coordinate_accuracy_m,coordinates_updated_at,deleted_at,created_at,updated_at'),
        'gyms'
      ),
      selectRows(
        appPublicClient
          .from('sessions')
          .select('id,gym_id,status,started_at,completed_at,duration_sec,deleted_at,created_at,updated_at'),
        'sessions'
      ),
      selectRows(
        appPublicClient
          .from('session_exercises')
          .select(
            'id,session_id,exercise_definition_id,order_index,name,machine_name,deleted_at,created_at,updated_at'
          ),
        'session_exercises'
      ),
      selectExerciseSetRows(appPublicClient),
      selectRows(
        appPublicClient
          .from('exercise_definitions')
          .select('id,name,deleted_at,created_at,updated_at'),
        'exercise_definitions'
      ),
      selectRows(
        appPublicClient
          .from('exercise_muscle_mappings')
          .select('id,exercise_definition_id,muscle_group_id,weight,role,created_at,updated_at'),
        'exercise_muscle_mappings'
      ),
      selectRows(
        appPublicClient
          .from('exercise_tag_definitions')
          .select('id,exercise_definition_id,name,normalized_name,deleted_at,created_at,updated_at'),
        'exercise_tag_definitions'
      ),
      selectRows(
        appPublicClient
          .from('session_exercise_tags')
          .select('id,session_exercise_id,exercise_tag_definition_id,created_at'),
        'session_exercise_tags'
      ),
    ]);
  } catch (error) {
    void logEvent({
      level: 'error',
      source: 'sync',
      event: 'sync.bootstrap_remote_fetch_failed',
      message: error instanceof Error ? error.message : 'Unable to fetch remote sync projection state.',
    });
    throw error;
  }

  const [
    remoteGyms,
    remoteSessions,
    remoteSessionExercises,
    remoteExerciseSets,
    remoteExerciseDefinitions,
    remoteExerciseMuscleMappings,
    remoteExerciseTagDefinitions,
    remoteSessionExerciseTags,
  ] = remoteRows;

  return {
    gyms: remoteGyms.map(parseRemoteGym),
    sessions: remoteSessions.map(parseRemoteSession),
    sessionExercises: remoteSessionExercises.map(parseRemoteSessionExercise),
    exerciseSets: remoteExerciseSets.map(parseRemoteExerciseSet),
    exerciseDefinitions: remoteExerciseDefinitions.map(parseRemoteExerciseDefinition),
    exerciseMuscleMappings: remoteExerciseMuscleMappings.map(parseRemoteExerciseMuscleMapping),
    exerciseTagDefinitions: remoteExerciseTagDefinitions.map(parseRemoteExerciseTagDefinition),
    sessionExerciseTags: remoteSessionExerciseTags.map(parseRemoteSessionExerciseTag),
  };
};

const readLocalProjectionState = (tx: MergeReadTx): ProjectionState => ({
  gyms: tx
    .select()
    .from(gyms)
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      deletedAtMs: null,
      latitude: row.latitude,
      longitude: row.longitude,
      coordinateAccuracyM: row.coordinateAccuracyM,
      coordinatesUpdatedAtMs: row.coordinatesUpdatedAt ? row.coordinatesUpdatedAt.getTime() : null,
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    })),
  sessions: tx
    .select()
    .from(sessions)
    .all()
    .map((row) => ({
      id: row.id,
      gymId: row.gymId,
      status: row.status,
      startedAtMs: row.startedAt.getTime(),
      completedAtMs: row.completedAt ? row.completedAt.getTime() : null,
      durationSec: row.durationSec,
      deletedAtMs: row.deletedAt ? row.deletedAt.getTime() : null,
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    })),
  sessionExercises: tx
    .select()
    .from(sessionExercises)
    .all()
    .map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      exerciseDefinitionId: row.exerciseDefinitionId,
      orderIndex: row.orderIndex,
      name: row.name,
      machineName: row.machineName ?? null,
      deletedAtMs: null,
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    })),
  exerciseSets: tx
    .select()
    .from(exerciseSets)
    .all()
    .map((row) => ({
      id: row.id,
      sessionExerciseId: row.sessionExerciseId,
      orderIndex: row.orderIndex,
      weightValue: row.weightValue,
      repsValue: row.repsValue,
      setType: normalizeSessionSetType(row.setType),
      deletedAtMs: null,
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    })),
  exerciseDefinitions: tx
    .select()
    .from(exerciseDefinitions)
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      deletedAtMs: row.deletedAt ? row.deletedAt.getTime() : null,
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    })),
  exerciseMuscleMappings: tx
    .select()
    .from(exerciseMuscleMappings)
    .all()
    .map((row) => ({
      id: row.id,
      exerciseDefinitionId: row.exerciseDefinitionId,
      muscleGroupId: row.muscleGroupId,
      weight: row.weight,
      role: row.role,
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    })),
  exerciseTagDefinitions: tx
    .select()
    .from(exerciseTagDefinitions)
    .all()
    .map((row) => ({
      id: row.id,
      exerciseDefinitionId: row.exerciseDefinitionId,
      name: row.name,
      normalizedName: row.normalizedName,
      deletedAtMs: row.deletedAt ? row.deletedAt.getTime() : null,
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    })),
  sessionExerciseTags: tx
    .select()
    .from(sessionExerciseTags)
    .all()
    .map((row) => ({
      id: row.id,
      sessionExerciseId: row.sessionExerciseId,
      exerciseTagDefinitionId: row.exerciseTagDefinitionId,
      createdAtMs: row.createdAt.getTime(),
    })),
});

const mergeByKey = <T>(input: {
  local: T[];
  remote: T[];
  keyOf: (row: T) => string;
  updatedAtMsOf: (row: T) => number;
  includeRemote?: (row: T) => boolean;
}): MergeSelection<T> => {
  const includeRemote = input.includeRemote ?? (() => true);
  const remoteByKey = new Map<string, T>();
  for (const row of input.remote) {
    if (!includeRemote(row)) {
      continue;
    }
    remoteByKey.set(input.keyOf(row), row);
  }

  const mergedByKey = new Map<string, T>();
  const localSelections: T[] = [];

  for (const localRow of input.local) {
    const key = input.keyOf(localRow);
    const remoteRow = remoteByKey.get(key);

    if (!remoteRow) {
      mergedByKey.set(key, localRow);
      localSelections.push(localRow);
      continue;
    }

    if (input.updatedAtMsOf(remoteRow) > input.updatedAtMsOf(localRow)) {
      mergedByKey.set(key, remoteRow);
      remoteByKey.delete(key);
      continue;
    }

    mergedByKey.set(key, localRow);
    localSelections.push(localRow);
    remoteByKey.delete(key);
  }

  for (const [key, remoteRow] of remoteByKey.entries()) {
    mergedByKey.set(key, remoteRow);
  }

  return {
    merged: [...mergedByKey.values()],
    localSelections,
  };
};

const mappingPairKey = (row: ExerciseMuscleMappingRow) => `${row.exerciseDefinitionId}:${row.muscleGroupId}`;
const assignmentPairKey = (row: SessionExerciseTagRow) =>
  `${row.sessionExerciseId}:${row.exerciseTagDefinitionId}`;

const sortProjectionRows = (state: ProjectionState): ProjectionState => ({
  gyms: [...state.gyms].sort((left, right) => left.id.localeCompare(right.id)),
  sessions: [...state.sessions].sort((left, right) => left.id.localeCompare(right.id)),
  sessionExercises: [...state.sessionExercises].sort((left, right) => {
    const sessionDelta = left.sessionId.localeCompare(right.sessionId);
    if (sessionDelta !== 0) {
      return sessionDelta;
    }

    const orderDelta = left.orderIndex - right.orderIndex;
    if (orderDelta !== 0) {
      return orderDelta;
    }

    return left.id.localeCompare(right.id);
  }),
  exerciseSets: [...state.exerciseSets].sort((left, right) => {
    const exerciseDelta = left.sessionExerciseId.localeCompare(right.sessionExerciseId);
    if (exerciseDelta !== 0) {
      return exerciseDelta;
    }

    const orderDelta = left.orderIndex - right.orderIndex;
    if (orderDelta !== 0) {
      return orderDelta;
    }

    return left.id.localeCompare(right.id);
  }),
  exerciseDefinitions: [...state.exerciseDefinitions].sort((left, right) => left.id.localeCompare(right.id)),
  exerciseMuscleMappings: [...state.exerciseMuscleMappings].sort((left, right) => {
    const pairDelta = mappingPairKey(left).localeCompare(mappingPairKey(right));
    if (pairDelta !== 0) {
      return pairDelta;
    }

    return left.id.localeCompare(right.id);
  }),
  exerciseTagDefinitions: [...state.exerciseTagDefinitions].sort((left, right) => left.id.localeCompare(right.id)),
  sessionExerciseTags: [...state.sessionExerciseTags].sort((left, right) => {
    const pairDelta = assignmentPairKey(left).localeCompare(assignmentPairKey(right));
    if (pairDelta !== 0) {
      return pairDelta;
    }

    return left.id.localeCompare(right.id);
  }),
});

const buildMergePlan = (input: { local: ProjectionState; remote: ProjectionState }): MergePlan => {
  const mergedGyms = mergeByKey({
    local: input.local.gyms,
    remote: input.remote.gyms,
    keyOf: (row) => row.id,
    updatedAtMsOf: (row) => row.updatedAtMs,
    includeRemote: (row) => row.deletedAtMs === null,
  });

  const gymIds = new Set(mergedGyms.merged.map((row) => row.id));

  const mergedSessions = mergeByKey({
    local: input.local.sessions,
    remote: input.remote.sessions,
    keyOf: (row) => row.id,
    updatedAtMsOf: (row) => row.updatedAtMs,
  });

  const sanitizedSessions = mergedSessions.merged.map((row) => ({
    ...row,
    gymId: row.gymId && gymIds.has(row.gymId) ? row.gymId : null,
  }));

  const mergedExerciseDefinitions = mergeByKey({
    local: input.local.exerciseDefinitions,
    remote: input.remote.exerciseDefinitions,
    keyOf: (row) => row.id,
    updatedAtMsOf: (row) => row.updatedAtMs,
  });

  const exerciseDefinitionIds = new Set(mergedExerciseDefinitions.merged.map((row) => row.id));
  const sessionIds = new Set(sanitizedSessions.map((row) => row.id));

  const mergedSessionExercisesBase = mergeByKey({
    local: input.local.sessionExercises,
    remote: input.remote.sessionExercises,
    keyOf: (row) => row.id,
    updatedAtMsOf: (row) => row.updatedAtMs,
    includeRemote: (row) => row.deletedAtMs === null,
  });

  const sessionExerciseById = new Map<string, SessionExerciseRow>();
  for (const row of mergedSessionExercisesBase.merged) {
    if (!sessionIds.has(row.sessionId)) {
      continue;
    }

    sessionExerciseById.set(row.id, {
      ...row,
      exerciseDefinitionId:
        row.exerciseDefinitionId && exerciseDefinitionIds.has(row.exerciseDefinitionId)
          ? row.exerciseDefinitionId
          : null,
    });
  }

  const filteredSessionExercises = [...sessionExerciseById.values()];
  const sessionExerciseIds = new Set(filteredSessionExercises.map((row) => row.id));
  const sessionExerciseKeySet = new Set(filteredSessionExercises.map((row) => row.id));

  const filteredLocalSessionExercises = mergedSessionExercisesBase.localSelections.filter((row) =>
    sessionExerciseKeySet.has(row.id)
  );

  const mergedExerciseSetsBase = mergeByKey({
    local: input.local.exerciseSets,
    remote: input.remote.exerciseSets,
    keyOf: (row) => row.id,
    updatedAtMsOf: (row) => row.updatedAtMs,
    includeRemote: (row) => row.deletedAtMs === null,
  });

  const filteredExerciseSets = mergedExerciseSetsBase.merged.filter((row) =>
    sessionExerciseIds.has(row.sessionExerciseId)
  );
  const exerciseSetIdSet = new Set(filteredExerciseSets.map((row) => row.id));
  const filteredLocalExerciseSets = mergedExerciseSetsBase.localSelections.filter((row) =>
    exerciseSetIdSet.has(row.id)
  );

  const mergedExerciseMuscleMappingsBase = mergeByKey({
    local: input.local.exerciseMuscleMappings,
    remote: input.remote.exerciseMuscleMappings,
    keyOf: mappingPairKey,
    updatedAtMsOf: (row) => row.updatedAtMs,
  });

  const filteredExerciseMuscleMappings = mergedExerciseMuscleMappingsBase.merged.filter((row) =>
    exerciseDefinitionIds.has(row.exerciseDefinitionId)
  );
  const exerciseMuscleMappingKeySet = new Set(filteredExerciseMuscleMappings.map(mappingPairKey));
  const filteredLocalExerciseMuscleMappings = mergedExerciseMuscleMappingsBase.localSelections.filter((row) =>
    exerciseMuscleMappingKeySet.has(mappingPairKey(row))
  );

  const mergedExerciseTagDefinitionsBase = mergeByKey({
    local: input.local.exerciseTagDefinitions,
    remote: input.remote.exerciseTagDefinitions,
    keyOf: (row) => row.id,
    updatedAtMsOf: (row) => row.updatedAtMs,
  });

  const filteredExerciseTagDefinitions = mergedExerciseTagDefinitionsBase.merged.filter((row) =>
    exerciseDefinitionIds.has(row.exerciseDefinitionId)
  );
  const exerciseTagDefinitionIds = new Set(filteredExerciseTagDefinitions.map((row) => row.id));
  const exerciseTagDefinitionIdSet = new Set(filteredExerciseTagDefinitions.map((row) => row.id));
  const filteredLocalExerciseTagDefinitions = mergedExerciseTagDefinitionsBase.localSelections.filter((row) =>
    exerciseTagDefinitionIdSet.has(row.id)
  );

  const mergedSessionExerciseTagsBase = mergeByKey({
    local: input.local.sessionExerciseTags,
    remote: input.remote.sessionExerciseTags,
    keyOf: assignmentPairKey,
    updatedAtMsOf: (row) => row.createdAtMs,
  });

  const filteredSessionExerciseTags = mergedSessionExerciseTagsBase.merged.filter(
    (row) =>
      sessionExerciseIds.has(row.sessionExerciseId) &&
      exerciseTagDefinitionIds.has(row.exerciseTagDefinitionId)
  );
  const sessionExerciseTagKeySet = new Set(filteredSessionExerciseTags.map(assignmentPairKey));
  const filteredLocalSessionExerciseTags = mergedSessionExerciseTagsBase.localSelections.filter((row) =>
    sessionExerciseTagKeySet.has(assignmentPairKey(row))
  );

  const localSessionIdSet = new Set(mergedSessions.localSelections.map((row) => row.id));
  const filteredLocalSessions = sanitizedSessions.filter((row) => localSessionIdSet.has(row.id));

  const localGymIdSet = new Set(mergedGyms.localSelections.map((row) => row.id));
  const filteredLocalGyms = mergedGyms.merged.filter((row) => localGymIdSet.has(row.id));

  const localExerciseDefinitionIdSet = new Set(mergedExerciseDefinitions.localSelections.map((row) => row.id));
  const filteredLocalExerciseDefinitions = mergedExerciseDefinitions.merged.filter((row) =>
    localExerciseDefinitionIdSet.has(row.id)
  );

  return {
    mergedState: sortProjectionRows({
      gyms: mergedGyms.merged,
      sessions: sanitizedSessions,
      sessionExercises: filteredSessionExercises,
      exerciseSets: filteredExerciseSets,
      exerciseDefinitions: mergedExerciseDefinitions.merged,
      exerciseMuscleMappings: filteredExerciseMuscleMappings,
      exerciseTagDefinitions: filteredExerciseTagDefinitions,
      sessionExerciseTags: filteredSessionExerciseTags,
    }),
    localSelections: sortProjectionRows({
      gyms: filteredLocalGyms,
      sessions: filteredLocalSessions,
      sessionExercises: filteredLocalSessionExercises,
      exerciseSets: filteredLocalExerciseSets,
      exerciseDefinitions: filteredLocalExerciseDefinitions,
      exerciseMuscleMappings: filteredLocalExerciseMuscleMappings,
      exerciseTagDefinitions: filteredLocalExerciseTagDefinitions,
      sessionExerciseTags: filteredLocalSessionExerciseTags,
    }),
  };
};

const buildConvergenceEvents = (state: ProjectionState): QueuedSyncEventInput[] => {
  const events: QueuedSyncEventInput[] = [];

  for (const row of state.exerciseDefinitions) {
    events.push({
      entityType: 'exercise_definitions',
      entityId: row.id,
      eventType: row.deletedAtMs === null ? 'upsert' : 'delete',
      occurredAt: new Date(row.updatedAtMs),
      payload:
        row.deletedAtMs === null
          ? {
              id: row.id,
              name: row.name,
              deleted_at_ms: null,
              created_at_ms: row.createdAtMs,
              updated_at_ms: row.updatedAtMs,
            }
          : {
              id: row.id,
              deleted_at_ms: row.deletedAtMs,
              updated_at_ms: row.updatedAtMs,
            },
    });
  }

  for (const row of state.exerciseMuscleMappings) {
    const entityId = `${row.exerciseDefinitionId}:${row.muscleGroupId}`;
    events.push({
      entityType: 'exercise_muscle_mappings',
      entityId,
      eventType: 'attach',
      occurredAt: new Date(row.updatedAtMs),
      payload: {
        id: entityId,
        row_id: row.id,
        exercise_definition_id: row.exerciseDefinitionId,
        muscle_group_id: row.muscleGroupId,
        weight: row.weight,
        role: row.role,
        created_at_ms: row.createdAtMs,
        updated_at_ms: row.updatedAtMs,
      },
    });
  }

  for (const row of state.exerciseTagDefinitions) {
    events.push({
      entityType: 'exercise_tag_definitions',
      entityId: row.id,
      eventType: row.deletedAtMs === null ? 'upsert' : 'delete',
      occurredAt: new Date(row.updatedAtMs),
      payload:
        row.deletedAtMs === null
          ? {
              id: row.id,
              exercise_definition_id: row.exerciseDefinitionId,
              name: row.name,
              normalized_name: row.normalizedName,
              deleted_at_ms: null,
              created_at_ms: row.createdAtMs,
              updated_at_ms: row.updatedAtMs,
            }
          : {
              id: row.id,
              deleted_at_ms: row.deletedAtMs,
              updated_at_ms: row.updatedAtMs,
            },
    });
  }

  for (const row of state.gyms) {
    events.push({
      entityType: 'gyms',
      entityId: row.id,
      eventType: 'upsert',
      occurredAt: new Date(row.updatedAtMs),
      payload: {
        id: row.id,
        name: row.name,
        latitude: row.latitude,
        longitude: row.longitude,
        coordinate_accuracy_m: row.coordinateAccuracyM,
        coordinates_updated_at_ms: row.coordinatesUpdatedAtMs,
        created_at_ms: row.createdAtMs,
        updated_at_ms: row.updatedAtMs,
      },
    });
  }

  for (const row of state.sessions) {
    events.push({
      entityType: 'sessions',
      entityId: row.id,
      eventType: row.deletedAtMs === null ? 'upsert' : 'delete',
      occurredAt: new Date(row.updatedAtMs),
      payload:
        row.deletedAtMs === null
          ? {
              id: row.id,
              gym_id: row.gymId,
              status: row.status,
              started_at_ms: row.startedAtMs,
              completed_at_ms: row.completedAtMs,
              duration_sec: row.durationSec,
              deleted_at_ms: null,
              created_at_ms: row.createdAtMs,
              updated_at_ms: row.updatedAtMs,
            }
          : {
              id: row.id,
              deleted_at_ms: row.deletedAtMs,
              updated_at_ms: row.updatedAtMs,
            },
    });
  }

  for (const row of state.sessionExercises) {
    events.push({
      entityType: 'session_exercises',
      entityId: row.id,
      eventType: 'upsert',
      occurredAt: new Date(row.updatedAtMs),
      payload: {
        id: row.id,
        session_id: row.sessionId,
        exercise_definition_id: row.exerciseDefinitionId,
        order_index: row.orderIndex,
        name: row.name,
        machine_name: row.machineName,
        created_at_ms: row.createdAtMs,
        updated_at_ms: row.updatedAtMs,
      },
    });
  }

  for (const row of state.exerciseSets) {
    events.push({
      entityType: 'exercise_sets',
      entityId: row.id,
      eventType: 'upsert',
      occurredAt: new Date(row.updatedAtMs),
      payload: {
        id: row.id,
        session_exercise_id: row.sessionExerciseId,
        order_index: row.orderIndex,
        weight_value: row.weightValue,
        reps_value: row.repsValue,
        set_type: row.setType,
        created_at_ms: row.createdAtMs,
        updated_at_ms: row.updatedAtMs,
      },
    });
  }

  for (const row of state.sessionExerciseTags) {
    const entityId = `${row.sessionExerciseId}:${row.exerciseTagDefinitionId}`;
    events.push({
      entityType: 'session_exercise_tags',
      entityId,
      eventType: 'attach',
      occurredAt: new Date(row.createdAtMs),
      payload: {
        id: entityId,
        row_id: row.id,
        session_exercise_id: row.sessionExerciseId,
        exercise_tag_definition_id: row.exerciseTagDefinitionId,
        created_at_ms: row.createdAtMs,
      },
    });
  }

  return events;
};

const applyMergePlanTx = (tx: MergeWriteTx, input: { mergePlan: MergePlan; now: Date }): SyncBootstrapMergeResult => {
  tx.delete(sessionExerciseTags).run();
  tx.delete(exerciseSets).run();
  tx.delete(sessionExercises).run();
  tx.delete(sessions).run();
  tx.delete(gyms).run();
  tx.delete(exerciseTagDefinitions).run();
  tx.delete(exerciseMuscleMappings).run();
  tx.delete(exerciseDefinitions).run();

  const { mergedState } = input.mergePlan;

  if (mergedState.gyms.length > 0) {
    tx.insert(gyms)
      .values(
        mergedState.gyms.map((row) => ({
          id: row.id,
          name: row.name,
          latitude: row.latitude,
          longitude: row.longitude,
          coordinateAccuracyM: row.coordinateAccuracyM,
          coordinatesUpdatedAt: row.coordinatesUpdatedAtMs === null ? null : new Date(row.coordinatesUpdatedAtMs),
          createdAt: new Date(row.createdAtMs),
          updatedAt: new Date(row.updatedAtMs),
        }))
      )
      .run();
  }

  if (mergedState.exerciseDefinitions.length > 0) {
    tx.insert(exerciseDefinitions)
      .values(
        mergedState.exerciseDefinitions.map((row) => ({
          id: row.id,
          name: row.name,
          deletedAt: row.deletedAtMs === null ? null : new Date(row.deletedAtMs),
          createdAt: new Date(row.createdAtMs),
          updatedAt: new Date(row.updatedAtMs),
        }))
      )
      .run();
  }

  if (mergedState.sessions.length > 0) {
    tx.insert(sessions)
      .values(
        mergedState.sessions.map((row) => ({
          id: row.id,
          gymId: row.gymId,
          status: row.status,
          startedAt: new Date(row.startedAtMs),
          completedAt: row.completedAtMs === null ? null : new Date(row.completedAtMs),
          durationSec: row.durationSec,
          deletedAt: row.deletedAtMs === null ? null : new Date(row.deletedAtMs),
          createdAt: new Date(row.createdAtMs),
          updatedAt: new Date(row.updatedAtMs),
        }))
      )
      .run();
  }

  if (mergedState.sessionExercises.length > 0) {
    tx.insert(sessionExercises)
      .values(
        mergedState.sessionExercises.map((row) => ({
          id: row.id,
          sessionId: row.sessionId,
          exerciseDefinitionId: row.exerciseDefinitionId,
          orderIndex: row.orderIndex,
          name: row.name,
          machineName: row.machineName,
          createdAt: new Date(row.createdAtMs),
          updatedAt: new Date(row.updatedAtMs),
        }))
      )
      .run();
  }

  if (mergedState.exerciseSets.length > 0) {
    tx.insert(exerciseSets)
      .values(
        mergedState.exerciseSets.map((row) => ({
          id: row.id,
          sessionExerciseId: row.sessionExerciseId,
          orderIndex: row.orderIndex,
          weightValue: row.weightValue,
          repsValue: row.repsValue,
          setType: row.setType,
          createdAt: new Date(row.createdAtMs),
          updatedAt: new Date(row.updatedAtMs),
        }))
      )
      .run();
  }

  if (mergedState.exerciseMuscleMappings.length > 0) {
    tx.insert(exerciseMuscleMappings)
      .values(
        mergedState.exerciseMuscleMappings.map((row) => ({
          id: row.id,
          exerciseDefinitionId: row.exerciseDefinitionId,
          muscleGroupId: row.muscleGroupId,
          weight: row.weight,
          role: row.role,
          createdAt: new Date(row.createdAtMs),
          updatedAt: new Date(row.updatedAtMs),
        }))
      )
      .run();
  }

  if (mergedState.exerciseTagDefinitions.length > 0) {
    tx.insert(exerciseTagDefinitions)
      .values(
        mergedState.exerciseTagDefinitions.map((row) => ({
          id: row.id,
          exerciseDefinitionId: row.exerciseDefinitionId,
          name: row.name,
          normalizedName: row.normalizedName,
          deletedAt: row.deletedAtMs === null ? null : new Date(row.deletedAtMs),
          createdAt: new Date(row.createdAtMs),
          updatedAt: new Date(row.updatedAtMs),
        }))
      )
      .run();
  }

  if (mergedState.sessionExerciseTags.length > 0) {
    tx.insert(sessionExerciseTags)
      .values(
        mergedState.sessionExerciseTags.map((row) => ({
          id: row.id,
          sessionExerciseId: row.sessionExerciseId,
          exerciseTagDefinitionId: row.exerciseTagDefinitionId,
          createdAt: new Date(row.createdAtMs),
        }))
      )
      .run();
  }

  const convergenceEvents = buildConvergenceEvents(input.mergePlan.localSelections);
  if (convergenceEvents.length > 0) {
    enqueueSyncEventsTx(tx, convergenceEvents, { now: input.now });
  }

  return {
    convergenceEventsQueued: convergenceEvents.length,
    mergedCounts: {
      gyms: mergedState.gyms.length,
      sessions: mergedState.sessions.length,
      sessionExercises: mergedState.sessionExercises.length,
      exerciseSets: mergedState.exerciseSets.length,
      exerciseDefinitions: mergedState.exerciseDefinitions.length,
      exerciseMuscleMappings: mergedState.exerciseMuscleMappings.length,
      exerciseTagDefinitions: mergedState.exerciseTagDefinitions.length,
      sessionExerciseTags: mergedState.sessionExerciseTags.length,
    },
  };
};

const ensureValidDate = (value: Date, label: string) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid Date`);
  }
};

export const mergeRemoteProjectionIntoLocalState = async (input: {
  remoteState: SyncBootstrapRemoteState;
  now?: Date;
}): Promise<SyncBootstrapMergeResult> => {
  const now = input.now ?? new Date();
  ensureValidDate(now, 'now');

  const database = await bootstrapLocalDataLayer();

  const result = database.transaction((tx) => {
    const localState = readLocalProjectionState(tx);
    const mergePlan = buildMergePlan({
      local: localState,
      remote: input.remoteState,
    });

    return applyMergePlanTx(tx, {
      mergePlan,
      now,
    });
  });

  // The merge transaction wipes the seeded exercise catalog tables (see
  // applyMergePlanTx). Re-seed the system exercise catalog after the merge
  // commits so a fresh user (with empty remote projection) does not end up
  // with an empty catalog until the next app launch. The seeder is
  // idempotent (uses onConflictDoUpdate) and opens its own transaction, so
  // it must run outside the merge transaction.
  seedSystemExerciseCatalog(database, now);

  return result;
};

export const runSyncBootstrapMerge = async (input: {
  client: SupabaseClient;
  now?: Date;
}): Promise<SyncBootstrapMergeResult> => {
  const remoteState = await fetchRemoteSyncProjectionState(input.client);
  return mergeRemoteProjectionIntoLocalState({
    remoteState,
    now: input.now,
  });
};

export const __privateForTests = {
  buildMergePlan,
  buildConvergenceEvents,
};
