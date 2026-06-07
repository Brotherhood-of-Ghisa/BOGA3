import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import { bootstrapLocalDataLayer, type LocalDatabase } from './bootstrap';
import { nowMonotonic } from './clock';
import { exerciseDefinitions, exerciseMuscleMappings, muscleGroups } from './schema';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import { notifyLocalWrite } from '@/src/sync/write-nudge';

export type ExerciseCatalogMuscleGroup = {
  id: string;
  displayName: string;
  familyName: string;
  sortOrder: number;
};

export type ExerciseCatalogExerciseMuscleMapping = {
  id: string;
  muscleGroupId: string;
  weight: number;
  role: 'primary' | 'secondary' | 'stabilizer' | null;
};

export type ExerciseCatalogExercise = {
  id: string;
  name: string;
  deletedAt: Date | null;
  mappings: ExerciseCatalogExerciseMuscleMapping[];
};

export type ListExerciseCatalogExercisesOptions = {
  includeDeleted?: boolean;
};

export type SaveExerciseCatalogExerciseInput = {
  id?: string;
  name: string;
  mappings: {
    muscleGroupId: string;
    weight: number;
    role?: 'primary' | 'secondary' | 'stabilizer' | null;
  }[];
  now?: Date;
};

export type SetExerciseCatalogExerciseDeletedStateInput = {
  id: string;
  isDeleted: boolean;
  now?: Date;
};

type DrizzleExerciseRow = {
  id: string;
  name: string;
  deletedAt: Date | null;
};

export type ExerciseCatalogStore = {
  listMuscleGroups(): Promise<ExerciseCatalogMuscleGroup[]>;
  listExercises(input: { includeDeleted: boolean }): Promise<ExerciseCatalogExercise[]>;
  saveExercise(input: {
    id?: string;
    name: string;
    mappings: {
      muscleGroupId: string;
      weight: number;
      role: 'primary' | 'secondary' | 'stabilizer' | null;
    }[];
    now: Date;
  }): Promise<ExerciseCatalogExercise>;
  setExerciseDeletedState(input: {
    id: string;
    deletedAt: Date | null;
    now: Date;
  }): Promise<void>;
};

const createLocalId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const mapExerciseGraph = (
  exerciseRow: DrizzleExerciseRow | undefined,
  mappingRows: {
    id: string;
    exerciseDefinitionId: string;
    muscleGroupId: string;
    weight: number;
    role: 'primary' | 'secondary' | 'stabilizer' | null;
  }[]
): ExerciseCatalogExercise => {
  if (!exerciseRow) {
    throw new Error('Exercise not found after save');
  }

  return {
    id: exerciseRow.id,
    name: exerciseRow.name,
    deletedAt: exerciseRow.deletedAt,
    mappings: mappingRows
      .filter((mapping) => mapping.exerciseDefinitionId === exerciseRow.id)
      .map((mapping) => ({
        id: mapping.id,
        muscleGroupId: mapping.muscleGroupId,
        weight: mapping.weight,
        role: mapping.role,
      })),
  };
};

const listExerciseGraphs = async (
  database: LocalDatabase,
  input: { includeDeleted: boolean }
): Promise<ExerciseCatalogExercise[]> => {
  const baseQuery = database
    .select({
      id: exerciseDefinitions.id,
      name: exerciseDefinitions.name,
      deletedAt: exerciseDefinitions.deletedAt,
    })
    .from(exerciseDefinitions);

  const exerciseRows = (
    input.includeDeleted
      ? baseQuery.orderBy(asc(exerciseDefinitions.name)).all()
      : baseQuery
          .where(isNull(exerciseDefinitions.deletedAt))
          .orderBy(asc(exerciseDefinitions.name))
          .all()
  ) as DrizzleExerciseRow[];

  if (exerciseRows.length === 0) {
    return [];
  }

  const exerciseIds = exerciseRows.map((row) => row.id);
  const mappingRows = database
    .select({
      id: exerciseMuscleMappings.id,
      exerciseDefinitionId: exerciseMuscleMappings.exerciseDefinitionId,
      muscleGroupId: exerciseMuscleMappings.muscleGroupId,
      weight: exerciseMuscleMappings.weight,
      role: exerciseMuscleMappings.role,
    })
    .from(exerciseMuscleMappings)
    .where(
      and(
        inArray(exerciseMuscleMappings.exerciseDefinitionId, exerciseIds),
        isNull(exerciseMuscleMappings.deletedAt)
      )
    )
    .orderBy(asc(exerciseMuscleMappings.exerciseDefinitionId), asc(exerciseMuscleMappings.muscleGroupId))
    .all();

  return exerciseRows.map((exerciseRow) => mapExerciseGraph(exerciseRow, mappingRows));
};

export const createDrizzleExerciseCatalogStore = (): ExerciseCatalogStore => ({
  async listMuscleGroups() {
    const database = await bootstrapLocalDataLayer();

    return database
      .select({
        id: muscleGroups.id,
        displayName: muscleGroups.displayName,
        familyName: muscleGroups.familyName,
        sortOrder: muscleGroups.sortOrder,
      })
      .from(muscleGroups)
      .orderBy(asc(muscleGroups.sortOrder), asc(muscleGroups.displayName))
      .all();
  },
  async listExercises(input) {
    const database = await bootstrapLocalDataLayer();
    return listExerciseGraphs(database, input);
  },
  async saveExercise(input) {
    const database = await bootstrapLocalDataLayer();
    const exerciseId = input.id ?? createLocalId('exercise-definition');

    database.transaction((tx) => {
      const existing = tx
        .select({ id: exerciseDefinitions.id })
        .from(exerciseDefinitions)
        .where(eq(exerciseDefinitions.id, exerciseId))
        .get();

      if (existing) {
        tx.update(exerciseDefinitions)
          .set({
            name: input.name,
            deletedAt: null,
            updatedAt: input.now,
            localDirty: true,
            localUpdatedAtMs: nowMonotonic(tx),
          })
          .where(eq(exerciseDefinitions.id, exerciseId))
          .run();
      } else {
        tx.insert(exerciseDefinitions)
          .values({
            id: exerciseId,
            name: input.name,
            deletedAt: null,
            createdAt: input.now,
            updatedAt: input.now,
            localDirty: true,
            localUpdatedAtMs: nowMonotonic(tx),
          })
          .run();
      }

      // Reconcile the muscle-link rows against the new payload instead of
      // hard-deleting and re-inserting. A removed link is kept as a tombstone
      // (`deleted_at` set) so the deletion pushes to the server and survives a
      // reinstall; its row still occupies the unique
      // (exercise_definition_id, muscle_group_id) slot, so a link to the same
      // muscle group is revived in place rather than inserted afresh (which
      // would collide). The whole set rides the same push batch.
      const existingMappings = tx
        .select({
          id: exerciseMuscleMappings.id,
          muscleGroupId: exerciseMuscleMappings.muscleGroupId,
        })
        .from(exerciseMuscleMappings)
        .where(eq(exerciseMuscleMappings.exerciseDefinitionId, exerciseId))
        .all();
      const existingMappingByMuscleGroupId = new Map(
        existingMappings.map((mapping) => [mapping.muscleGroupId, mapping.id])
      );
      const nextMuscleGroupIds = new Set(input.mappings.map((mapping) => mapping.muscleGroupId));

      for (const existing of existingMappings) {
        if (nextMuscleGroupIds.has(existing.muscleGroupId)) {
          continue;
        }
        tx.update(exerciseMuscleMappings)
          .set({
            deletedAt: input.now,
            updatedAt: input.now,
            localDirty: true,
            localUpdatedAtMs: nowMonotonic(tx),
          })
          .where(eq(exerciseMuscleMappings.id, existing.id))
          .run();
      }

      for (const mapping of input.mappings) {
        const existingMappingId = existingMappingByMuscleGroupId.get(mapping.muscleGroupId);
        if (existingMappingId) {
          tx.update(exerciseMuscleMappings)
            .set({
              weight: mapping.weight,
              role: mapping.role,
              deletedAt: null,
              updatedAt: input.now,
              localDirty: true,
              localUpdatedAtMs: nowMonotonic(tx),
            })
            .where(eq(exerciseMuscleMappings.id, existingMappingId))
            .run();
          continue;
        }

        const mappingId = createLocalId('exercise-muscle-mapping');
        tx.insert(exerciseMuscleMappings)
          .values({
            id: mappingId,
            exerciseDefinitionId: exerciseId,
            muscleGroupId: mapping.muscleGroupId,
            weight: mapping.weight,
            role: mapping.role,
            deletedAt: null,
            createdAt: input.now,
            updatedAt: input.now,
            localDirty: true,
            localUpdatedAtMs: nowMonotonic(tx),
          })
          .run();
      }
    });

    // Post-commit: the definition and its muscle-link rows were dirtied in the
    // transaction above; one nudge per save asks the scheduler to push the batch
    // soon. The reads below only re-project the saved graph for the return value.
    notifyLocalWrite();

    const exerciseRow = database
      .select({
        id: exerciseDefinitions.id,
        name: exerciseDefinitions.name,
        deletedAt: exerciseDefinitions.deletedAt,
      })
      .from(exerciseDefinitions)
      .where(eq(exerciseDefinitions.id, exerciseId))
      .get() as DrizzleExerciseRow | undefined;

    const mappingRows = database
      .select({
        id: exerciseMuscleMappings.id,
        exerciseDefinitionId: exerciseMuscleMappings.exerciseDefinitionId,
        muscleGroupId: exerciseMuscleMappings.muscleGroupId,
        weight: exerciseMuscleMappings.weight,
        role: exerciseMuscleMappings.role,
      })
      .from(exerciseMuscleMappings)
      .where(
        and(
          eq(exerciseMuscleMappings.exerciseDefinitionId, exerciseId),
          isNull(exerciseMuscleMappings.deletedAt)
        )
      )
      .orderBy(asc(exerciseMuscleMappings.muscleGroupId))
      .all();

    return mapExerciseGraph(exerciseRow, mappingRows);
  },
  async setExerciseDeletedState(input) {
    const database = await bootstrapLocalDataLayer();

    database.transaction((tx) => {
      tx.update(exerciseDefinitions)
        .set({
          deletedAt: input.deletedAt,
          updatedAt: input.now,
          localDirty: true,
          localUpdatedAtMs: nowMonotonic(tx),
        })
        .where(eq(exerciseDefinitions.id, input.id))
        .run();
    });

    // Post-commit: the definition row was dirtied above; nudge to push the
    // soft-delete/restore soon.
    notifyLocalWrite();
  },
});

const assertFiniteDate = (value: Date) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error('now must be a valid Date');
  }
};

const deriveRoleFromWeight = (weight: number): 'primary' | 'secondary' => (weight > 0.75 ? 'primary' : 'secondary');

export const createExerciseCatalogRepository = (store: ExerciseCatalogStore = createDrizzleExerciseCatalogStore()) => {
  const persistDeletedState = async (input: SetExerciseCatalogExerciseDeletedStateInput): Promise<void> => {
    const trimmedId = input.id.trim();
    if (!trimmedId) {
      throw new Error('Exercise id is required');
    }

    const now = input.now ?? new Date();
    assertFiniteDate(now);

    await store.setExerciseDeletedState({
      id: trimmedId,
      deletedAt: input.isDeleted ? now : null,
      now,
    });
  };

  return {
    listMuscleGroups() {
      return store.listMuscleGroups();
    },
    listExercises(options: ListExerciseCatalogExercisesOptions = {}) {
      return store.listExercises({
        includeDeleted: options.includeDeleted === true,
      });
    },
    async saveExercise(input: SaveExerciseCatalogExerciseInput): Promise<ExerciseCatalogExercise> {
    const name = input.name.trim();
    if (!name) {
      throw new Error('Exercise name is required');
    }

    if (input.mappings.length < 1) {
      throw new Error('At least one muscle link is required');
    }

    const now = input.now ?? new Date();
    assertFiniteDate(now);

    const knownMuscleIds = new Set((await store.listMuscleGroups()).map((muscleGroup) => muscleGroup.id));
    const seenMuscleIds = new Set<string>();

    const normalizedMappings = input.mappings.map((mapping, index) => {
      if (seenMuscleIds.has(mapping.muscleGroupId)) {
        throw new Error(`Duplicate muscle link at index ${index}: ${mapping.muscleGroupId}`);
      }
      seenMuscleIds.add(mapping.muscleGroupId);

      if (!knownMuscleIds.has(mapping.muscleGroupId)) {
        throw new Error(`Unknown muscle group: ${mapping.muscleGroupId}`);
      }

      if (!Number.isFinite(mapping.weight) || mapping.weight <= 0 || mapping.weight > 1) {
        throw new Error(`Invalid muscle weight for ${mapping.muscleGroupId}: ${mapping.weight}`);
      }

      return {
        muscleGroupId: mapping.muscleGroupId,
        weight: mapping.weight,
        role: mapping.role ?? deriveRoleFromWeight(mapping.weight),
      };
    });

      return store.saveExercise({
        id: input.id,
        name,
        mappings: normalizedMappings,
        now,
      });
    },
    async setExerciseDeletedState(input: SetExerciseCatalogExerciseDeletedStateInput): Promise<void> {
      await persistDeletedState(input);
    },
    async deleteExercise(id: string, now?: Date): Promise<void> {
      await persistDeletedState({
        id,
        isDeleted: true,
        now,
      });
    },
    async undeleteExercise(id: string, now?: Date): Promise<void> {
      await persistDeletedState({
        id,
        isDeleted: false,
        now,
      });
    },
  };
};

const defaultExerciseCatalogRepository = createExerciseCatalogRepository();

export const listExerciseCatalogMuscleGroups = defaultExerciseCatalogRepository.listMuscleGroups;
export const listExerciseCatalogExercises = defaultExerciseCatalogRepository.listExercises;

export const saveExerciseCatalogExercise = async (
  input: SaveExerciseCatalogExerciseInput
): Promise<ExerciseCatalogExercise> => {
  const saved = await defaultExerciseCatalogRepository.saveExercise(input);
  invalidateExerciseCatalogCache();
  return saved;
};

export const setExerciseCatalogExerciseDeletedState = async (
  input: SetExerciseCatalogExerciseDeletedStateInput
): Promise<void> => {
  await defaultExerciseCatalogRepository.setExerciseDeletedState(input);
  invalidateExerciseCatalogCache();
};

export const deleteExerciseCatalogExercise = async (id: string, now?: Date): Promise<void> => {
  await defaultExerciseCatalogRepository.deleteExercise(id, now);
  invalidateExerciseCatalogCache();
};

export const undeleteExerciseCatalogExercise = async (id: string, now?: Date): Promise<void> => {
  await defaultExerciseCatalogRepository.undeleteExercise(id, now);
  invalidateExerciseCatalogCache();
};
