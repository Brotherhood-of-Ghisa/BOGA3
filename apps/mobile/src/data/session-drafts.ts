import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import { bootstrapLocalDataLayer, type LocalDatabase } from './bootstrap';
import { nowMonotonic } from './clock';
import { exerciseSets, sessionExercises, sessionExerciseTags, sessions } from './schema';
import { normalizeSessionSetType, type SessionSetTypeValue } from './set-types';

export type SessionDraftStatus = 'active';

export type SessionDraftSetInput = {
  id?: string;
  repsValue: string;
  weightValue: string;
  setType?: SessionSetTypeValue;
};

export type SessionDraftExerciseInput = {
  id?: string;
  exerciseDefinitionId: string;
  name: string;
  machineName?: string | null;
  sets: SessionDraftSetInput[];
};

export type PersistSessionDraftInput = {
  sessionId?: string;
  gymId: string | null;
  startedAt: Date;
  status?: SessionDraftStatus;
  exercises: SessionDraftExerciseInput[];
};

export type PersistSessionDraftResult = {
  sessionId: string;
};

export type PersistCompletedSessionInput = {
  sessionId: string;
  gymId: string | null;
  startedAt: Date;
  completedAt: Date;
  exercises: SessionDraftExerciseInput[];
};

export type PersistCompletedSessionResult = {
  sessionId: string;
  completedAt: Date;
  durationSec: number;
};

export type SessionDraftSetSnapshot = {
  id: string;
  repsValue: string;
  weightValue: string;
  setType: SessionSetTypeValue;
};

export type SessionDraftExerciseSnapshot = {
  id: string;
  exerciseDefinitionId: string;
  name: string;
  machineName: string | null;
  sets: SessionDraftSetSnapshot[];
};

export type SessionDraftSnapshot = {
  sessionId: string;
  gymId: string | null;
  status: SessionDraftStatus;
  startedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  exercises: SessionDraftExerciseSnapshot[];
};

export type SessionGraphSnapshot = {
  sessionId: string;
  gymId: string | null;
  status: SessionPersistenceRecord['status'];
  startedAt: Date;
  completedAt: Date | null;
  durationSec: number | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  exercises: SessionDraftExerciseSnapshot[];
};

export type CompletedSessionAnalysisRecord = {
  sessionId: string;
  gymId: string | null;
  startedAt: Date;
  completedAt: Date;
  durationSec: number;
};

export type ListCompletedSessionsOptions = {
  minDurationSec?: number;
  maxDurationSec?: number;
  completedAfter?: Date;
  completedBefore?: Date;
  sortBy?: 'completedAt' | 'durationSec';
  sortDirection?: 'asc' | 'desc';
  limit?: number;
};

export type CompleteSessionOptions = {
  completedAt?: Date;
  now?: Date;
};

export type CompleteSessionResult = {
  sessionId: string;
  completedAt: Date;
  durationSec: number;
  wasAlreadyCompleted: boolean;
};

export type ReopenCompletedSessionOptions = {
  now?: Date;
};

export type ReopenCompletedSessionResult = {
  sessionId: string;
};

export type SessionPersistenceRecord = {
  id: string;
  gymId: string | null;
  status: 'active' | 'completed';
  startedAt: Date;
  completedAt: Date | null;
  durationSec: number | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type StoredDraftSetRecord = {
  id: string;
  sessionExerciseId: string;
  orderIndex: number;
  repsValue: string;
  weightValue: string;
  setType: SessionSetTypeValue;
};

type StoredDraftExerciseRecord = {
  id: string;
  sessionId: string;
  exerciseDefinitionId: string;
  orderIndex: number;
  name: string;
  machineName: string | null;
};

type StoredSessionExerciseTagRecord = {
  id: string;
  sessionExerciseId: string;
  exerciseTagDefinitionId: string;
  createdAt: Date;
};

type StoredDraftGraph = {
  session: SessionPersistenceRecord;
  exercises: (StoredDraftExerciseRecord & {
    sets: StoredDraftSetRecord[];
  })[];
};

type SaveDraftGraphInput = {
  sessionId?: string;
  gymId: string | null;
  status: SessionDraftStatus;
  startedAt: Date;
  exercises: SessionDraftExerciseInput[];
  now: Date;
};

type SaveCompletedSessionGraphInput = {
  sessionId: string;
  gymId: string | null;
  startedAt: Date;
  completedAt: Date;
  durationSec: number;
  exercises: SessionDraftExerciseInput[];
  now: Date;
};

export type SessionDraftStore = {
  saveDraftGraph(input: SaveDraftGraphInput): Promise<PersistSessionDraftResult>;
  saveCompletedSessionGraph(input: SaveCompletedSessionGraphInput): Promise<PersistSessionDraftResult>;
  loadLatestDraftGraph(): Promise<StoredDraftGraph | null>;
  loadSessionGraphById(sessionId: string): Promise<StoredDraftGraph | null>;
  loadSessionById(sessionId: string): Promise<SessionPersistenceRecord | null>;
  completeSession(input: {
    sessionId: string;
    completedAt: Date;
    durationSec: number;
    updatedAt: Date;
  }): Promise<void>;
  reopenCompletedSession(input: {
    sessionId: string;
    updatedAt: Date;
  }): Promise<void>;
  listCompletedSessions(): Promise<SessionPersistenceRecord[]>;
};

const DEFAULT_DURATION_SORT = 'completedAt';
const DEFAULT_SORT_DIRECTION = 'desc';

const isValidDate = (value: Date) => !Number.isNaN(value.getTime());

const toDate = (value: Date | number | null | undefined): Date | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return isValidDate(value) ? value : null;
  }

  const converted = new Date(value);
  return isValidDate(converted) ? converted : null;
};

const ensureDate = (value: Date, label: string) => {
  if (!isValidDate(value)) {
    throw new Error(`${label} must be a valid Date`);
  }
};

const createLocalEntityId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const normalizePersistedSessionStatus = (status: string): SessionPersistenceRecord['status'] =>
  status === 'completed' ? 'completed' : 'active';

const normalizeDraftStatus = (status: SessionDraftStatus | undefined): SessionDraftStatus => status ?? 'active';

export const calculateSessionDurationSec = (startedAt: Date, completedAt: Date) => {
  ensureDate(startedAt, 'startedAt');
  ensureDate(completedAt, 'completedAt');

  const deltaMs = completedAt.getTime() - startedAt.getTime();
  return Math.max(0, Math.floor(deltaMs / 1000));
};

const assertCompletedSessionTiming = (startedAt: Date, completedAt: Date) => {
  ensureDate(startedAt, 'startedAt');
  ensureDate(completedAt, 'completedAt');

  if (completedAt.getTime() < startedAt.getTime()) {
    throw new Error('completedAt must be greater than or equal to startedAt');
  }
};

const mapSessionRow = (row: typeof sessions.$inferSelect): SessionPersistenceRecord => {
  const startedAt = toDate(row.startedAt);
  const createdAt = toDate(row.createdAt);
  const updatedAt = toDate(row.updatedAt);

  if (!startedAt || !createdAt || !updatedAt) {
    throw new Error(`Session ${row.id} contains invalid timestamp values`);
  }

  return {
    id: row.id,
    gymId: row.gymId,
    status: normalizePersistedSessionStatus(row.status as string),
    startedAt,
    completedAt: toDate(row.completedAt),
    durationSec: row.durationSec,
    deletedAt: toDate(row.deletedAt),
    createdAt,
    updatedAt,
  };
};

const mapDraftSnapshot = (graph: StoredDraftGraph): SessionDraftSnapshot => ({
  sessionId: graph.session.id,
  gymId: graph.session.gymId,
  status: 'active',
  startedAt: graph.session.startedAt,
  createdAt: graph.session.createdAt,
  updatedAt: graph.session.updatedAt,
  exercises: graph.exercises.map((exercise) => ({
    id: exercise.id,
    exerciseDefinitionId: exercise.exerciseDefinitionId,
    name: exercise.name,
    machineName: exercise.machineName,
    sets: exercise.sets.map((set) => ({
      id: set.id,
      repsValue: set.repsValue,
      weightValue: set.weightValue,
      setType: set.setType,
    })),
  })),
});

const mapSessionGraphSnapshot = (graph: StoredDraftGraph): SessionGraphSnapshot => ({
  sessionId: graph.session.id,
  gymId: graph.session.gymId,
  status: graph.session.status,
  startedAt: graph.session.startedAt,
  completedAt: graph.session.completedAt,
  durationSec: graph.session.durationSec,
  deletedAt: graph.session.deletedAt,
  createdAt: graph.session.createdAt,
  updatedAt: graph.session.updatedAt,
  exercises: graph.exercises.map((exercise) => ({
    id: exercise.id,
    exerciseDefinitionId: exercise.exerciseDefinitionId,
    name: exercise.name,
    machineName: exercise.machineName,
    sets: exercise.sets.map((set) => ({
      id: set.id,
      repsValue: set.repsValue,
      weightValue: set.weightValue,
      setType: set.setType,
    })),
  })),
});

const loadDraftGraphBySessionId = (database: LocalDatabase, sessionId: string): StoredDraftGraph | null => {
  const sessionRow = database.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!sessionRow) {
    return null;
  }

  const exerciseRows = database
    .select()
    .from(sessionExercises)
    .where(eq(sessionExercises.sessionId, sessionId))
    .orderBy(asc(sessionExercises.orderIndex))
    .all();

  const exerciseIds = exerciseRows.map((exercise) => exercise.id);
  const setRows =
    exerciseIds.length > 0
      ? database
          .select()
          .from(exerciseSets)
          .where(inArray(exerciseSets.sessionExerciseId, exerciseIds))
          .orderBy(asc(exerciseSets.orderIndex))
          .all()
      : [];

  const setsByExerciseId = setRows.reduce<Map<string, StoredDraftSetRecord[]>>((acc, row) => {
    const current = acc.get(row.sessionExerciseId) ?? [];
    current.push({
      id: row.id,
      sessionExerciseId: row.sessionExerciseId,
      orderIndex: row.orderIndex,
      repsValue: row.repsValue,
      weightValue: row.weightValue,
      setType: normalizeSessionSetType(row.setType),
    });
    acc.set(row.sessionExerciseId, current);
    return acc;
  }, new Map<string, StoredDraftSetRecord[]>());

  return {
    session: mapSessionRow(sessionRow),
    exercises: exerciseRows.map((exercise) => {
      if (!exercise.exerciseDefinitionId) {
        throw new Error(`Session exercise ${exercise.id} is missing exerciseDefinitionId`);
      }

      return {
        id: exercise.id,
        sessionId: exercise.sessionId,
        exerciseDefinitionId: exercise.exerciseDefinitionId,
        orderIndex: exercise.orderIndex,
        name: exercise.name,
        machineName: exercise.machineName,
        sets: setsByExerciseId.get(exercise.id) ?? [],
      };
    }),
  };
};

type SessionGraphWriteTx = Pick<LocalDatabase, 'select' | 'insert' | 'delete'>;

const replaceSessionExerciseGraph = (
  tx: SessionGraphWriteTx,
  input: {
    sessionId: string;
    exercises: SessionDraftExerciseInput[];
    now: Date;
    // Monotonic LWW timestamp produced once per surrounding transaction via
    // `nowMonotonic(tx)` (t2 §7.2 / §8). Every row this function writes —
    // each `session_exercises` (Layer 2), `exercise_sets` and
    // `session_exercise_tags` (Layer 3) — is stamped `localDirty: true` and
    // this value so the next sync cycle pushes the whole rebuilt graph. The
    // reorder path rewrites every sibling row here, so all touched siblings
    // dirty together and ship in the same push batch (t2 §10.1 #1 / #2).
    localUpdatedAtMs: number;
  }
) => {
  const existingExerciseRows = tx
    .select({
      id: sessionExercises.id,
      sessionId: sessionExercises.sessionId,
      exerciseDefinitionId: sessionExercises.exerciseDefinitionId,
      orderIndex: sessionExercises.orderIndex,
    })
    .from(sessionExercises)
    .where(eq(sessionExercises.sessionId, input.sessionId))
    .all();
  const existingExerciseIds = existingExerciseRows.map((row) => row.id);
  const existingExercisesById = new Map(existingExerciseRows.map((row) => [row.id, row]));
  const existingSetRows =
    existingExerciseIds.length > 0
      ? tx
          .select({
            id: exerciseSets.id,
            sessionExerciseId: exerciseSets.sessionExerciseId,
            orderIndex: exerciseSets.orderIndex,
            repsValue: exerciseSets.repsValue,
            weightValue: exerciseSets.weightValue,
            setType: exerciseSets.setType,
          })
          .from(exerciseSets)
          .where(inArray(exerciseSets.sessionExerciseId, existingExerciseIds))
          .all()
      : [];
  const existingSetsById = new Map(existingSetRows.map((row) => [row.id, row]));
  const existingTagRows =
    existingExerciseIds.length > 0
      ? (tx
          .select({
            id: sessionExerciseTags.id,
            sessionExerciseId: sessionExerciseTags.sessionExerciseId,
            exerciseTagDefinitionId: sessionExerciseTags.exerciseTagDefinitionId,
            createdAt: sessionExerciseTags.createdAt,
          })
          .from(sessionExerciseTags)
          .where(inArray(sessionExerciseTags.sessionExerciseId, existingExerciseIds))
          .all() as StoredSessionExerciseTagRecord[])
      : [];
  const existingTagsByExerciseId = existingTagRows.reduce<Map<string, StoredSessionExerciseTagRecord[]>>(
    (acc, row) => {
      const current = acc.get(row.sessionExerciseId) ?? [];
      current.push(row);
      acc.set(row.sessionExerciseId, current);
      return acc;
    },
    new Map<string, StoredSessionExerciseTagRecord[]>()
  );

  if (existingExerciseIds.length > 0) {
    // Do not rely on FK cascade state; clear tag assignments explicitly.
    tx.delete(sessionExerciseTags).where(inArray(sessionExerciseTags.sessionExerciseId, existingExerciseIds)).run();
    tx.delete(exerciseSets).where(inArray(exerciseSets.sessionExerciseId, existingExerciseIds)).run();
  }
  tx.delete(sessionExercises).where(eq(sessionExercises.sessionId, input.sessionId)).run();

  input.exercises.forEach((exercise, exerciseIndex) => {
    const sessionExerciseId = exercise.id?.trim() || createLocalEntityId('exercise');
    const exerciseDefinitionId = exercise.exerciseDefinitionId.trim();

    if (!exerciseDefinitionId) {
      throw new Error(`Exercise definition id is required for exercise at index ${exerciseIndex}`);
    }

    tx.insert(sessionExercises)
      .values({
        id: sessionExerciseId,
        sessionId: input.sessionId,
        exerciseDefinitionId,
        orderIndex: exerciseIndex,
        name: exercise.name,
        machineName: exercise.machineName ?? null,
        localDirty: true,
        localUpdatedAtMs: input.localUpdatedAtMs,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .run();

    const existingExercise = existingExercisesById.get(sessionExerciseId);

    if (existingExercise && existingExercise.exerciseDefinitionId === exerciseDefinitionId) {
      const existingTags = existingTagsByExerciseId.get(sessionExerciseId) ?? [];
      existingTags.forEach((assignment) => {
        tx.insert(sessionExerciseTags)
          .values({
            id: assignment.id,
            sessionExerciseId,
            exerciseTagDefinitionId: assignment.exerciseTagDefinitionId,
            localDirty: true,
            localUpdatedAtMs: input.localUpdatedAtMs,
            createdAt: assignment.createdAt,
          })
          .run();
      });
    }

    exercise.sets.forEach((set, setIndex) => {
      const setId = set.id?.trim() || createLocalEntityId('set');
      const existingSet = existingSetsById.get(setId);
      const nextSetType =
        set.setType === undefined ? normalizeSessionSetType(existingSet?.setType) : normalizeSessionSetType(set.setType);
      tx.insert(exerciseSets)
        .values({
          id: setId,
          sessionExerciseId,
          orderIndex: setIndex,
          repsValue: set.repsValue,
          weightValue: set.weightValue,
          setType: nextSetType,
          localDirty: true,
          localUpdatedAtMs: input.localUpdatedAtMs,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .run();
    });
  });
};

export const __replaceSessionExerciseGraphForTests = replaceSessionExerciseGraph;

export const createDrizzleSessionDraftStore = (): SessionDraftStore => ({
  async saveDraftGraph(input) {
    const database = await bootstrapLocalDataLayer();
    const sessionId = input.sessionId?.trim() || createLocalEntityId('session');

    database.transaction((tx) => {
      // One monotonic LWW timestamp for every row written in this draft-save
      // transaction — the `sessions` row plus the whole `session_exercises` /
      // `exercise_sets` / `session_exercise_tags` graph rebuilt below — so the
      // entire graph dirties together and ships in one push batch (t2 §7.2,
      // §8.3 synchronous persist into sync_runtime_state.last_emitted_ms).
      const localUpdatedAtMs = nowMonotonic(tx);

      const existingSession = tx.select().from(sessions).where(eq(sessions.id, sessionId)).get();
      if (existingSession?.status === 'completed') {
        throw new Error(`Cannot modify completed session ${sessionId}`);
      }

      if (!existingSession) {
        tx.insert(sessions)
          .values({
            id: sessionId,
            gymId: input.gymId,
            status: input.status,
            startedAt: input.startedAt,
            completedAt: null,
            durationSec: null,
            localDirty: true,
            localUpdatedAtMs,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .run();
      } else {
        tx.update(sessions)
          .set({
            gymId: input.gymId,
            status: input.status,
            startedAt: input.startedAt,
            completedAt: null,
            durationSec: null,
            localDirty: true,
            localUpdatedAtMs,
            updatedAt: input.now,
          })
          .where(eq(sessions.id, sessionId))
          .run();
      }

      replaceSessionExerciseGraph(tx, {
        sessionId,
        exercises: input.exercises,
        now: input.now,
        localUpdatedAtMs,
      });
    });

    return { sessionId };
  },
  async saveCompletedSessionGraph(input) {
    const database = await bootstrapLocalDataLayer();

    database.transaction((tx) => {
      // Single monotonic LWW timestamp for the completed-session row and the
      // whole exercise/set/tag graph rebuilt below (t2 §7.2, §8.3).
      const localUpdatedAtMs = nowMonotonic(tx);

      const existingSession = tx.select().from(sessions).where(eq(sessions.id, input.sessionId)).get();
      if (!existingSession) {
        throw new Error(`Session ${input.sessionId} does not exist`);
      }
      if (existingSession.status !== 'completed') {
        throw new Error(`Cannot update non-completed session ${input.sessionId}`);
      }

      tx.update(sessions)
        .set({
          gymId: input.gymId,
          status: 'completed',
          startedAt: input.startedAt,
          completedAt: input.completedAt,
          durationSec: input.durationSec,
          localDirty: true,
          localUpdatedAtMs,
          updatedAt: input.now,
        })
        .where(eq(sessions.id, input.sessionId))
        .run();

      replaceSessionExerciseGraph(tx, {
        sessionId: input.sessionId,
        exercises: input.exercises,
        now: input.now,
        localUpdatedAtMs,
      });
    });

    return { sessionId: input.sessionId };
  },
  async loadLatestDraftGraph() {
    const database = await bootstrapLocalDataLayer();

    const latestDraft = database
      .select()
      .from(sessions)
      .where(and(eq(sessions.status, 'active'), isNull(sessions.deletedAt)))
      .orderBy(desc(sessions.updatedAt), desc(sessions.createdAt))
      .get();
    if (!latestDraft) {
      return null;
    }

    return loadDraftGraphBySessionId(database, latestDraft.id);
  },
  async loadSessionGraphById(sessionId) {
    const database = await bootstrapLocalDataLayer();
    return loadDraftGraphBySessionId(database, sessionId);
  },
  async loadSessionById(sessionId) {
    const database = await bootstrapLocalDataLayer();
    const row = database.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    return row ? mapSessionRow(row) : null;
  },
  async completeSession(input) {
    const database = await bootstrapLocalDataLayer();
    database.transaction((tx) => {
      tx.update(sessions)
        .set({
          status: 'completed',
          completedAt: input.completedAt,
          durationSec: input.durationSec,
          localDirty: true,
          localUpdatedAtMs: nowMonotonic(tx),
          updatedAt: input.updatedAt,
        })
        .where(eq(sessions.id, input.sessionId))
        .run();
    });
  },
  async reopenCompletedSession(input) {
    const database = await bootstrapLocalDataLayer();

    database.transaction((tx) => {
      const existingSession = tx.select().from(sessions).where(eq(sessions.id, input.sessionId)).get();
      if (!existingSession) {
        throw new Error(`Session ${input.sessionId} does not exist`);
      }
      if (existingSession.status !== 'completed') {
        throw new Error(`Cannot reopen non-completed session ${input.sessionId}`);
      }

      const activeConflict = tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.status, 'active'), isNull(sessions.deletedAt)))
        .all()
        .find((row) => row.id !== input.sessionId);

      if (activeConflict) {
        throw new Error(`Cannot reopen session ${input.sessionId} while another active or draft session exists`);
      }

      tx.update(sessions)
        .set({
          status: 'active',
          completedAt: null,
          durationSec: null,
          deletedAt: null,
          localDirty: true,
          localUpdatedAtMs: nowMonotonic(tx),
          updatedAt: input.updatedAt,
        })
        .where(eq(sessions.id, input.sessionId))
        .run();
    });
  },
  async listCompletedSessions() {
    const database = await bootstrapLocalDataLayer();
    const rows = database.select().from(sessions).where(eq(sessions.status, 'completed')).all();
    const nonDeletedRows = rows.filter((row) => row.deletedAt === null);
    return nonDeletedRows.map(mapSessionRow);
  },
});

export const createSessionDraftRepository = (store: SessionDraftStore = createDrizzleSessionDraftStore()) => ({
  async persistDraftSnapshot(
    input: PersistSessionDraftInput,
    options: {
      now?: Date;
    } = {}
  ): Promise<PersistSessionDraftResult> {
    ensureDate(input.startedAt, 'startedAt');

    const now = options.now ?? new Date();
    ensureDate(now, 'now');

    return store.saveDraftGraph({
      sessionId: input.sessionId,
      gymId: input.gymId,
      startedAt: input.startedAt,
      status: normalizeDraftStatus(input.status),
      exercises: input.exercises,
      now,
    });
  },
  async loadLatestDraftSnapshot(): Promise<SessionDraftSnapshot | null> {
    const graph = await store.loadLatestDraftGraph();
    if (!graph || graph.session.status === 'completed') {
      return null;
    }

    return mapDraftSnapshot(graph);
  },
  async loadSessionSnapshotById(sessionId: string): Promise<SessionGraphSnapshot | null> {
    const graph = await store.loadSessionGraphById(sessionId);
    if (!graph) {
      return null;
    }

    return mapSessionGraphSnapshot(graph);
  },
  async persistCompletedSessionSnapshot(
    input: PersistCompletedSessionInput,
    options: {
      now?: Date;
    } = {}
  ): Promise<PersistCompletedSessionResult> {
    assertCompletedSessionTiming(input.startedAt, input.completedAt);

    const now = options.now ?? new Date();
    ensureDate(now, 'now');

    const durationSec = calculateSessionDurationSec(input.startedAt, input.completedAt);

    await store.saveCompletedSessionGraph({
      sessionId: input.sessionId,
      gymId: input.gymId,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      durationSec,
      exercises: input.exercises,
      now,
    });

    return {
      sessionId: input.sessionId,
      completedAt: input.completedAt,
      durationSec,
    };
  },
  async reopenCompletedSession(
    sessionId: string,
    options: ReopenCompletedSessionOptions = {}
  ): Promise<ReopenCompletedSessionResult> {
    const now = options.now ?? new Date();
    ensureDate(now, 'now');

    await store.reopenCompletedSession({
      sessionId,
      updatedAt: now,
    });

    return { sessionId };
  },
  async completeSession(sessionId: string, options: CompleteSessionOptions = {}): Promise<CompleteSessionResult> {
    const existingSession = await store.loadSessionById(sessionId);
    if (!existingSession) {
      throw new Error(`Session ${sessionId} does not exist`);
    }

    const now = options.now ?? new Date();
    ensureDate(now, 'now');

    const resolvedCompletedAt = existingSession.completedAt ?? options.completedAt ?? now;
    ensureDate(resolvedCompletedAt, 'completedAt');

    const resolvedDurationSec =
      existingSession.durationSec ?? calculateSessionDurationSec(existingSession.startedAt, resolvedCompletedAt);

    const needsBackfill =
      existingSession.status === 'completed' &&
      (existingSession.completedAt === null || existingSession.durationSec === null);
    const shouldWrite = existingSession.status !== 'completed' || needsBackfill;

    if (shouldWrite) {
      await store.completeSession({
        sessionId,
        completedAt: resolvedCompletedAt,
        durationSec: resolvedDurationSec,
        updatedAt: now,
      });
    }

    return {
      sessionId,
      completedAt: resolvedCompletedAt,
      durationSec: resolvedDurationSec,
      wasAlreadyCompleted: existingSession.status === 'completed' && !needsBackfill,
    };
  },
  async listCompletedSessionsForAnalysis(
    options: ListCompletedSessionsOptions = {}
  ): Promise<CompletedSessionAnalysisRecord[]> {
    const allCompleted = await store.listCompletedSessions();

    const completedAfter = options.completedAfter?.getTime();
    const completedBefore = options.completedBefore?.getTime();
    const minDurationSec = options.minDurationSec;
    const maxDurationSec = options.maxDurationSec;
    const sortBy = options.sortBy ?? DEFAULT_DURATION_SORT;
    const sortDirection = options.sortDirection ?? DEFAULT_SORT_DIRECTION;

    const filtered = allCompleted
      .filter((session): session is SessionPersistenceRecord & { completedAt: Date; durationSec: number } => {
        if (session.status !== 'completed' || session.completedAt === null || session.durationSec === null) {
          return false;
        }

        if (completedAfter !== undefined && session.completedAt.getTime() < completedAfter) {
          return false;
        }

        if (completedBefore !== undefined && session.completedAt.getTime() > completedBefore) {
          return false;
        }

        if (minDurationSec !== undefined && session.durationSec < minDurationSec) {
          return false;
        }

        if (maxDurationSec !== undefined && session.durationSec > maxDurationSec) {
          return false;
        }

        return true;
      })
      .map((session) => ({
        sessionId: session.id,
        gymId: session.gymId,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        durationSec: session.durationSec,
      }));

    filtered.sort((left, right) => {
      const leftValue = sortBy === 'durationSec' ? left.durationSec : left.completedAt.getTime();
      const rightValue = sortBy === 'durationSec' ? right.durationSec : right.completedAt.getTime();
      const base = leftValue === rightValue ? left.sessionId.localeCompare(right.sessionId) : leftValue - rightValue;
      return sortDirection === 'asc' ? base : -base;
    });

    const limit = options.limit;
    if (limit === undefined || limit < 1) {
      return filtered;
    }

    return filtered.slice(0, limit);
  },
});

const defaultSessionDraftRepository = createSessionDraftRepository();

export const persistSessionDraftSnapshot = defaultSessionDraftRepository.persistDraftSnapshot;
export const persistCompletedSessionSnapshot = defaultSessionDraftRepository.persistCompletedSessionSnapshot;
export const loadLatestSessionDraftSnapshot = defaultSessionDraftRepository.loadLatestDraftSnapshot;
export const loadSessionSnapshotById = defaultSessionDraftRepository.loadSessionSnapshotById;
export const completeSessionDraft = defaultSessionDraftRepository.completeSession;
export const reopenCompletedSessionDraft = defaultSessionDraftRepository.reopenCompletedSession;
export const listCompletedSessionsForAnalysis = defaultSessionDraftRepository.listCompletedSessionsForAnalysis;
