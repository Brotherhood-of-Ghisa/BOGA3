import { and, eq, inArray, isNull } from 'drizzle-orm';

import { bootstrapLocalDataLayer } from './bootstrap';
import { nowMonotonic } from './clock';
import { exerciseSets, gyms, sessionExercises, sessions } from './schema';
import { notifyLocalWrite } from '@/src/sync/write-nudge';

type SessionLifecycleStatus = 'active' | 'completed';

export type SessionListStoreRecord = {
  id: string;
  status: SessionLifecycleStatus;
  startedAt: Date;
  completedAt: Date | null;
  durationSec: number | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  gymName: string | null;
  exerciseCount: number;
  setCount: number;
};

export type SessionListStore = {
  listSessionRecords(): Promise<SessionListStoreRecord[]>;
  setSessionDeletedState(input: {
    sessionId: string;
    deletedAt: Date | null;
    updatedAt: Date;
  }): Promise<void>;
};

export type SessionListSummary = {
  id: string;
  status: 'active' | 'completed';
  startedAt: Date;
  completedAt: Date | null;
  durationSec: number | null;
  compactDuration: string;
  deletedAt: Date | null;
  gymName: string | null;
  exerciseCount: number;
  setCount: number;
};

export type SessionListBuckets = {
  active: SessionListSummary | null;
  completed: SessionListSummary[];
};

export type ListSessionBucketsOptions = {
  includeDeleted?: boolean;
};

export type SetSessionDeletedStateOptions = {
  now?: Date;
};

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

export const formatCompactDuration = (durationSec: number | null): string => {
  if (!durationSec || durationSec <= 0) {
    return '0m';
  }

  const totalMinutes = Math.floor(durationSec / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${totalMinutes}m`;
  }

  if (minutes <= 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
};

const normalizeCount = (value: number | null | undefined) => (typeof value === 'number' && value > 0 ? value : 0);

const normalizeSessionLifecycleStatus = (status: string): SessionLifecycleStatus =>
  status === 'completed' ? 'completed' : 'active';

const mapStoreSessionRow = (row: typeof sessions.$inferSelect, gymName: string | null): Omit<SessionListStoreRecord, 'exerciseCount' | 'setCount'> => {
  const startedAt = toDate(row.startedAt);
  const createdAt = toDate(row.createdAt);
  const updatedAt = toDate(row.updatedAt);

  if (!startedAt || !createdAt || !updatedAt) {
    throw new Error(`Session ${row.id} contains invalid timestamp values`);
  }

  return {
    id: row.id,
    status: normalizeSessionLifecycleStatus(row.status as string),
    startedAt,
    completedAt: toDate(row.completedAt),
    durationSec: row.durationSec,
    deletedAt: toDate(row.deletedAt),
    createdAt,
    updatedAt,
    gymName,
  };
};

export const createDrizzleSessionListStore = (): SessionListStore => ({
  async listSessionRecords() {
    const database = await bootstrapLocalDataLayer();

    const sessionRows = database
      .select({
        session: sessions,
        gymName: gyms.name,
      })
      .from(sessions)
      .leftJoin(gyms, eq(sessions.gymId, gyms.id))
      .all();

    const sessionIds = sessionRows.map((row) => row.session.id);
    const exerciseRows =
      sessionIds.length > 0
        ? database
            .select({
              id: sessionExercises.id,
              sessionId: sessionExercises.sessionId,
            })
            .from(sessionExercises)
            .where(
              and(
                inArray(sessionExercises.sessionId, sessionIds),
                // Don't count exercises the user removed (kept as tombstones).
                isNull(sessionExercises.deletedAt)
              )
            )
            .all()
        : [];

    const exerciseCountBySessionId = new Map<string, number>();
    const sessionIdByExerciseId = new Map<string, string>();
    for (const exerciseRow of exerciseRows) {
      sessionIdByExerciseId.set(exerciseRow.id, exerciseRow.sessionId);
      exerciseCountBySessionId.set(
        exerciseRow.sessionId,
        (exerciseCountBySessionId.get(exerciseRow.sessionId) ?? 0) + 1
      );
    }

    const exerciseIds = exerciseRows.map((row) => row.id);
    const setRows =
      exerciseIds.length > 0
        ? database
            .select({
              sessionExerciseId: exerciseSets.sessionExerciseId,
            })
            .from(exerciseSets)
            .where(
              and(
                inArray(exerciseSets.sessionExerciseId, exerciseIds),
                // Don't count sets the user removed (kept as tombstones).
                isNull(exerciseSets.deletedAt)
              )
            )
            .all()
        : [];

    const setCountBySessionId = new Map<string, number>();
    for (const setRow of setRows) {
      const sessionId = sessionIdByExerciseId.get(setRow.sessionExerciseId);
      if (!sessionId) {
        continue;
      }

      setCountBySessionId.set(sessionId, (setCountBySessionId.get(sessionId) ?? 0) + 1);
    }

    return sessionRows.map((row) => {
      const mapped = mapStoreSessionRow(row.session, row.gymName ?? null);
      return {
        ...mapped,
        exerciseCount: normalizeCount(exerciseCountBySessionId.get(row.session.id)),
        setCount: normalizeCount(setCountBySessionId.get(row.session.id)),
      };
    });
  },
  async setSessionDeletedState(input) {
    const database = await bootstrapLocalDataLayer();
    database.transaction((tx) => {
      tx.update(sessions)
        .set({
          deletedAt: input.deletedAt,
          updatedAt: input.updatedAt,
          localDirty: true,
          localUpdatedAtMs: nowMonotonic(tx),
        })
        .where(eq(sessions.id, input.sessionId))
        .run();
    });

    // Post-commit: the session row is dirtied above; nudge the scheduler to push
    // the soft-delete/restore soon rather than on the next foreground/backstop.
    notifyLocalWrite();
  },
});

const compareMostRecent = (left: SessionListStoreRecord, right: SessionListStoreRecord) => {
  const updatedDelta = right.updatedAt.getTime() - left.updatedAt.getTime();
  if (updatedDelta !== 0) {
    return updatedDelta;
  }

  const createdDelta = right.createdAt.getTime() - left.createdAt.getTime();
  if (createdDelta !== 0) {
    return createdDelta;
  }

  const startedDelta = right.startedAt.getTime() - left.startedAt.getTime();
  if (startedDelta !== 0) {
    return startedDelta;
  }

  return left.id.localeCompare(right.id);
};

const compareCompletedDesc = (left: SessionListStoreRecord, right: SessionListStoreRecord) => {
  const leftCompletedAt = left.completedAt?.getTime() ?? 0;
  const rightCompletedAt = right.completedAt?.getTime() ?? 0;
  const completedDelta = rightCompletedAt - leftCompletedAt;
  if (completedDelta !== 0) {
    return completedDelta;
  }

  const startedDelta = right.startedAt.getTime() - left.startedAt.getTime();
  if (startedDelta !== 0) {
    return startedDelta;
  }

  return left.id.localeCompare(right.id);
};

const toSummary = (record: SessionListStoreRecord): SessionListSummary => ({
  id: record.id,
  status: record.status === 'completed' ? 'completed' : 'active',
  startedAt: record.startedAt,
  completedAt: record.completedAt,
  durationSec: record.durationSec,
  compactDuration: formatCompactDuration(record.durationSec),
  deletedAt: record.deletedAt,
  gymName: record.gymName,
  exerciseCount: record.exerciseCount,
  setCount: record.setCount,
});

export const createSessionListRepository = (store: SessionListStore = createDrizzleSessionListStore()) => ({
  async listBuckets(options: ListSessionBucketsOptions = {}): Promise<SessionListBuckets> {
    const includeDeleted = options.includeDeleted ?? false;
    const records = await store.listSessionRecords();

    const activeCandidates = records
      .filter((record) => record.status === 'active' && record.deletedAt === null)
      .sort(compareMostRecent);

    const active = activeCandidates.length > 0 ? toSummary(activeCandidates[0]) : null;

    const completed = records
      .filter((record) => record.status === 'completed')
      .filter((record) => record.completedAt !== null)
      .filter((record) => includeDeleted || record.deletedAt === null)
      .sort(compareCompletedDesc)
      .map(toSummary);

    return {
      active,
      completed,
    };
  },
  async setDeletedState(sessionId: string, isDeleted: boolean, options: SetSessionDeletedStateOptions = {}) {
    const now = options.now ?? new Date();
    ensureDate(now, 'now');

    await store.setSessionDeletedState({
      sessionId,
      deletedAt: isDeleted ? now : null,
      updatedAt: now,
    });
  },
});

const defaultSessionListRepository = createSessionListRepository();

export const listSessionListBuckets = defaultSessionListRepository.listBuckets;
export const setSessionDeletedState = defaultSessionListRepository.setDeletedState;
