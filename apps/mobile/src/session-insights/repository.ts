import { and, asc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";

import { bootstrapLocalDataLayer } from "@/src/data/bootstrap";
import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  exerciseSets,
  sessionExercises,
  sessions,
  muscleGroups,
} from "@/src/data/schema";
import { normalizeSessionSetPerformanceStatus } from "@/src/session-recorder/set-semantics";

import {
  deriveCompletedSessionInsights,
  type CompletedSessionInsights,
  type PersonalRecordSessionInput,
  type SessionInsightExerciseInput,
  type SessionInsightSetInput,
} from "./calculations";

export type SessionInsightSessionRow = Omit<
  PersonalRecordSessionInput,
  "exercises"
>;
export type SessionInsightExerciseRow = Omit<
  SessionInsightExerciseInput,
  "sets"
> & {
  sessionId: string;
};
export type SessionInsightSetRow = SessionInsightSetInput & {
  sessionExerciseId: string;
};

export type SessionInsightsStore = {
  loadTargetSession(
    sessionId: string,
  ): Promise<SessionInsightSessionRow | null>;
  loadEarlierCompletedSessions(input: {
    completedAt: Date;
    targetSessionId: string;
  }): Promise<SessionInsightSessionRow[]>;
  loadSessionExercises(
    sessionIds: string[],
  ): Promise<SessionInsightExerciseRow[]>;
  loadExerciseSets(
    sessionExerciseIds: string[],
  ): Promise<SessionInsightSetRow[]>;
  loadMuscleCatalog?(): Promise<{
    definitions: {
      id: string;
      loadInputMode: "total_load" | "per_side_load";
    }[];
    mappings: {
      exerciseDefinitionId: string;
      muscleGroupId: string;
      role: "primary" | "secondary" | "stabilizer" | null;
      weight?: number;
    }[];
    groups: {
      id: string;
      displayName: string;
      familyName: string;
      sortOrder: number;
    }[];
  }>;
};

export type CompletedSessionInsightsRepository = {
  loadInsights(sessionId: string): Promise<CompletedSessionInsights | null>;
};

const toSessionRow = (
  row: typeof sessions.$inferSelect,
): SessionInsightSessionRow => ({
  sessionId: row.id,
  status: row.status === "completed" ? "completed" : "active",
  completedAt: row.completedAt,
  deletedAt: row.deletedAt,
});

export const createDrizzleSessionInsightsStore = (): SessionInsightsStore => ({
  async loadMuscleCatalog() {
    const database = await bootstrapLocalDataLayer();
    return {
      definitions: database
        .select({
          id: exerciseDefinitions.id,
          loadInputMode: exerciseDefinitions.loadInputMode,
        })
        .from(exerciseDefinitions)
        .all(),
      mappings: database
        .select({
          exerciseDefinitionId: exerciseMuscleMappings.exerciseDefinitionId,
          muscleGroupId: exerciseMuscleMappings.muscleGroupId,
          role: exerciseMuscleMappings.role,
          weight: exerciseMuscleMappings.weight,
        })
        .from(exerciseMuscleMappings)
        .where(isNull(exerciseMuscleMappings.deletedAt))
        .all(),
      groups: database
        .select({
          id: muscleGroups.id,
          displayName: muscleGroups.displayName,
          familyName: muscleGroups.familyName,
          sortOrder: muscleGroups.sortOrder,
        })
        .from(muscleGroups)
        .all(),
    };
  },
  async loadTargetSession(sessionId) {
    const database = await bootstrapLocalDataLayer();
    const row = database
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();
    return row ? toSessionRow(row) : null;
  },

  async loadEarlierCompletedSessions({ completedAt, targetSessionId }) {
    const database = await bootstrapLocalDataLayer();
    return database
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.status, "completed"),
          isNull(sessions.deletedAt),
          isNotNull(sessions.completedAt),
          or(
            lt(sessions.completedAt, completedAt),
            and(
              eq(sessions.completedAt, completedAt),
              lt(sessions.id, targetSessionId),
            ),
          ),
        ),
      )
      .orderBy(asc(sessions.completedAt), asc(sessions.id))
      .all()
      .map(toSessionRow);
  },

  async loadSessionExercises(sessionIds) {
    if (sessionIds.length === 0) return [];
    const database = await bootstrapLocalDataLayer();
    return database
      .select({
        id: sessionExercises.id,
        sessionId: sessionExercises.sessionId,
        orderIndex: sessionExercises.orderIndex,
        exerciseDefinitionId: sessionExercises.exerciseDefinitionId,
        capturedExerciseName: sessionExercises.name,
        currentExerciseName: exerciseDefinitions.name,
        deletedAt: sessionExercises.deletedAt,
      })
      .from(sessionExercises)
      .leftJoin(
        exerciseDefinitions,
        eq(sessionExercises.exerciseDefinitionId, exerciseDefinitions.id),
      )
      .where(
        and(
          inArray(sessionExercises.sessionId, sessionIds),
          isNull(sessionExercises.deletedAt),
        ),
      )
      .orderBy(asc(sessionExercises.orderIndex), asc(sessionExercises.id))
      .all()
      .map(({ capturedExerciseName, currentExerciseName, ...row }) => ({
        ...row,
        exerciseName: currentExerciseName ?? capturedExerciseName,
      }));
  },

  async loadExerciseSets(sessionExerciseIds) {
    if (sessionExerciseIds.length === 0) return [];
    const database = await bootstrapLocalDataLayer();
    return database
      .select({
        id: exerciseSets.id,
        sessionExerciseId: exerciseSets.sessionExerciseId,
        orderIndex: exerciseSets.orderIndex,
        weightValue: exerciseSets.weightValue,
        repsValue: exerciseSets.repsValue,
        setType: exerciseSets.setType,
        performanceStatus: exerciseSets.performanceStatus,
        deletedAt: exerciseSets.deletedAt,
      })
      .from(exerciseSets)
      .where(
        and(
          inArray(exerciseSets.sessionExerciseId, sessionExerciseIds),
          isNull(exerciseSets.deletedAt),
        ),
      )
      .orderBy(asc(exerciseSets.orderIndex), asc(exerciseSets.id))
      .all()
      .map((row) => ({
        ...row,
        performanceStatus: normalizeSessionSetPerformanceStatus(
          row.performanceStatus,
        ),
      }));
  },
});

const buildSessionGraphs = (
  sessionRows: SessionInsightSessionRow[],
  exerciseRows: SessionInsightExerciseRow[],
  setRows: SessionInsightSetRow[],
): PersonalRecordSessionInput[] => {
  const setsByExerciseId = new Map<string, SessionInsightSetInput[]>();
  for (const set of setRows) {
    const bucket = setsByExerciseId.get(set.sessionExerciseId) ?? [];
    const { sessionExerciseId: _sessionExerciseId, ...setInput } = set;
    bucket.push(setInput);
    setsByExerciseId.set(set.sessionExerciseId, bucket);
  }

  const exercisesBySessionId = new Map<string, SessionInsightExerciseInput[]>();
  for (const exercise of exerciseRows) {
    const bucket = exercisesBySessionId.get(exercise.sessionId) ?? [];
    const { sessionId: _sessionId, ...exerciseInput } = exercise;
    bucket.push({
      ...exerciseInput,
      sets: setsByExerciseId.get(exercise.id) ?? [],
    });
    exercisesBySessionId.set(exercise.sessionId, bucket);
  }

  return sessionRows.map((session) => ({
    ...session,
    exercises: exercisesBySessionId.get(session.sessionId) ?? [],
  }));
};

export const createCompletedSessionInsightsRepository = (
  store: SessionInsightsStore = createDrizzleSessionInsightsStore(),
): CompletedSessionInsightsRepository => ({
  async loadInsights(sessionId) {
    const target = await store.loadTargetSession(sessionId);
    if (
      !target ||
      target.status !== "completed" ||
      target.completedAt === null ||
      (target.deletedAt ?? null) !== null
    ) {
      return null;
    }

    const history = await store.loadEarlierCompletedSessions({
      completedAt: target.completedAt,
      targetSessionId: target.sessionId,
    });
    const sessionRows = [target, ...history];
    const exerciseRows = await store.loadSessionExercises(
      sessionRows.map((session) => session.sessionId),
    );
    const setRows = await store.loadExerciseSets(
      exerciseRows.map((exercise) => exercise.id),
    );
    const graphs = buildSessionGraphs(sessionRows, exerciseRows, setRows);
    const targetGraph = graphs.find(
      (session) => session.sessionId === target.sessionId,
    );
    if (!targetGraph) return null;
    const catalog = await store.loadMuscleCatalog?.();

    return deriveCompletedSessionInsights({
      targetSession: targetGraph,
      historicalSessions: graphs.filter(
        (session) => session.sessionId !== target.sessionId,
      ),
      exerciseDefinitions: catalog?.definitions,
      muscleMappings: catalog?.mappings,
      muscleGroups: catalog?.groups,
    });
  },
});

const defaultCompletedSessionInsightsRepository =
  createCompletedSessionInsightsRepository();

export const loadCompletedSessionInsights =
  defaultCompletedSessionInsightsRepository.loadInsights;
