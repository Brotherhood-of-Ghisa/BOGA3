import { and, asc, eq, isNull } from 'drizzle-orm';

import { bootstrapLocalDataLayer } from './bootstrap';
import { nowMonotonic } from './clock';
import { exerciseTagDefinitions, sessionExercises, sessionExerciseTags } from './schema';

export type ExerciseTagDefinitionRecord = {
  id: string;
  exerciseDefinitionId: string;
  name: string;
  normalizedName: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SessionExerciseScopeRecord = {
  sessionExerciseId: string;
  exerciseDefinitionId: string | null;
};

export type TagDefinitionScopeRecord = {
  tagDefinitionId: string;
  exerciseDefinitionId: string;
};

export type SessionExerciseAssignedTag = {
  assignmentId: string;
  sessionExerciseId: string;
  tagDefinitionId: string;
  exerciseDefinitionId: string;
  name: string;
  normalizedName: string;
  deletedAt: Date | null;
  assignedAt: Date;
};

export type ExerciseTagStore = {
  listTagDefinitions(input: {
    exerciseDefinitionId: string;
    includeDeleted: boolean;
  }): Promise<ExerciseTagDefinitionRecord[]>;
  createTagDefinition(input: {
    exerciseDefinitionId: string;
    name: string;
    normalizedName: string;
    now: Date;
  }): Promise<ExerciseTagDefinitionRecord>;
  renameTagDefinition(input: {
    id: string;
    name: string;
    normalizedName: string;
    now: Date;
  }): Promise<ExerciseTagDefinitionRecord | null>;
  setTagDefinitionDeletedState(input: {
    id: string;
    deletedAt: Date | null;
    now: Date;
  }): Promise<void>;
  loadSessionExerciseScope(sessionExerciseId: string): Promise<SessionExerciseScopeRecord | null>;
  loadTagDefinitionScope(tagDefinitionId: string): Promise<TagDefinitionScopeRecord | null>;
  createTagAssignment(input: {
    sessionExerciseId: string;
    tagDefinitionId: string;
    now: Date;
  }): Promise<void>;
  removeTagAssignment(input: {
    sessionExerciseId: string;
    tagDefinitionId: string;
  }): Promise<void>;
  listAssignedTags(input: {
    sessionExerciseId: string;
  }): Promise<SessionExerciseAssignedTag[]>;
};

export type ExerciseTagDomainErrorCode =
  | 'tag_name_required'
  | 'tag_name_duplicate'
  | 'tag_definition_not_found'
  | 'session_exercise_not_found'
  | 'invalid_cross_definition_assignment'
  | 'duplicate_session_exercise_assignment';

export class ExerciseTagDomainError extends Error {
  readonly code: ExerciseTagDomainErrorCode;

  constructor(code: ExerciseTagDomainErrorCode, message: string) {
    super(message);
    this.name = 'ExerciseTagDomainError';
    this.code = code;
  }
}

const createLocalId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const ensureValidDate = (value: Date, label: string) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid Date`);
  }
};

const requireId = (value: string, label: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
};

const normalizeTagName = (name: string): { name: string; normalizedName: string } => {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new ExerciseTagDomainError('tag_name_required', 'Tag name is required');
  }

  return {
    name: trimmedName,
    normalizedName: trimmedName.toLowerCase(),
  };
};

const isUniqueConstraintError = (error: unknown, requiredMessageParts: string[]) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('unique constraint failed') && requiredMessageParts.every((part) => message.includes(part));
};

const isTagDefinitionNameUniqueError = (error: unknown) =>
  isUniqueConstraintError(error, [
    'exercise_tag_definitions.exercise_definition_id',
    'exercise_tag_definitions.normalized_name',
  ]);

const isSessionExerciseTagUniqueError = (error: unknown) =>
  isUniqueConstraintError(error, [
    'session_exercise_tags.session_exercise_id',
    'session_exercise_tags.exercise_tag_definition_id',
  ]);

export const createDrizzleExerciseTagStore = (): ExerciseTagStore => ({
  async listTagDefinitions(input) {
    const database = await bootstrapLocalDataLayer();
    const baseQuery = database
      .select({
        id: exerciseTagDefinitions.id,
        exerciseDefinitionId: exerciseTagDefinitions.exerciseDefinitionId,
        name: exerciseTagDefinitions.name,
        normalizedName: exerciseTagDefinitions.normalizedName,
        deletedAt: exerciseTagDefinitions.deletedAt,
        createdAt: exerciseTagDefinitions.createdAt,
        updatedAt: exerciseTagDefinitions.updatedAt,
      })
      .from(exerciseTagDefinitions);

    return (input.includeDeleted
      ? baseQuery
          .where(eq(exerciseTagDefinitions.exerciseDefinitionId, input.exerciseDefinitionId))
          .orderBy(
            asc(exerciseTagDefinitions.normalizedName),
            asc(exerciseTagDefinitions.name),
            asc(exerciseTagDefinitions.id)
          )
          .all()
      : baseQuery
          .where(
            and(
              eq(exerciseTagDefinitions.exerciseDefinitionId, input.exerciseDefinitionId),
              isNull(exerciseTagDefinitions.deletedAt)
            )
          )
          .orderBy(
            asc(exerciseTagDefinitions.normalizedName),
            asc(exerciseTagDefinitions.name),
            asc(exerciseTagDefinitions.id)
          )
          .all()) as ExerciseTagDefinitionRecord[];
  },
  async createTagDefinition(input) {
    const database = await bootstrapLocalDataLayer();
    const tagDefinitionId = createLocalId('exercise-tag-definition');

    database.transaction((tx) => {
      tx.insert(exerciseTagDefinitions)
        .values({
          id: tagDefinitionId,
          exerciseDefinitionId: input.exerciseDefinitionId,
          name: input.name,
          normalizedName: input.normalizedName,
          deletedAt: null,
          createdAt: input.now,
          updatedAt: input.now,
          localDirty: true,
          localUpdatedAtMs: nowMonotonic(tx),
        })
        .run();
    });

    const tagDefinition = database
      .select({
        id: exerciseTagDefinitions.id,
        exerciseDefinitionId: exerciseTagDefinitions.exerciseDefinitionId,
        name: exerciseTagDefinitions.name,
        normalizedName: exerciseTagDefinitions.normalizedName,
        deletedAt: exerciseTagDefinitions.deletedAt,
        createdAt: exerciseTagDefinitions.createdAt,
        updatedAt: exerciseTagDefinitions.updatedAt,
      })
      .from(exerciseTagDefinitions)
      .where(eq(exerciseTagDefinitions.id, tagDefinitionId))
      .get() as ExerciseTagDefinitionRecord | undefined;

    if (!tagDefinition) {
      throw new Error(`Tag definition ${tagDefinitionId} was not found after create`);
    }

    return tagDefinition;
  },
  async renameTagDefinition(input) {
    const database = await bootstrapLocalDataLayer();

    database.transaction((tx) => {
      tx.update(exerciseTagDefinitions)
        .set({
          name: input.name,
          normalizedName: input.normalizedName,
          updatedAt: input.now,
          localDirty: true,
          localUpdatedAtMs: nowMonotonic(tx),
        })
        .where(eq(exerciseTagDefinitions.id, input.id))
        .run();
    });

    const tagDefinition = database
      .select({
        id: exerciseTagDefinitions.id,
        exerciseDefinitionId: exerciseTagDefinitions.exerciseDefinitionId,
        name: exerciseTagDefinitions.name,
        normalizedName: exerciseTagDefinitions.normalizedName,
        deletedAt: exerciseTagDefinitions.deletedAt,
        createdAt: exerciseTagDefinitions.createdAt,
        updatedAt: exerciseTagDefinitions.updatedAt,
      })
      .from(exerciseTagDefinitions)
      .where(eq(exerciseTagDefinitions.id, input.id))
      .get() as ExerciseTagDefinitionRecord | undefined;

    return tagDefinition ?? null;
  },
  async setTagDefinitionDeletedState(input) {
    const database = await bootstrapLocalDataLayer();

    database.transaction((tx) => {
      tx.update(exerciseTagDefinitions)
        .set({
          deletedAt: input.deletedAt,
          updatedAt: input.now,
          localDirty: true,
          localUpdatedAtMs: nowMonotonic(tx),
        })
        .where(eq(exerciseTagDefinitions.id, input.id))
        .run();
    });
  },
  async loadSessionExerciseScope(sessionExerciseId) {
    const database = await bootstrapLocalDataLayer();
    const row = database
      .select({
        sessionExerciseId: sessionExercises.id,
        exerciseDefinitionId: sessionExercises.exerciseDefinitionId,
      })
      .from(sessionExercises)
      .where(eq(sessionExercises.id, sessionExerciseId))
      .get();

    return row ?? null;
  },
  async loadTagDefinitionScope(tagDefinitionId) {
    const database = await bootstrapLocalDataLayer();
    const row = database
      .select({
        tagDefinitionId: exerciseTagDefinitions.id,
        exerciseDefinitionId: exerciseTagDefinitions.exerciseDefinitionId,
      })
      .from(exerciseTagDefinitions)
      .where(eq(exerciseTagDefinitions.id, tagDefinitionId))
      .get();

    return row ?? null;
  },
  async createTagAssignment(input) {
    const database = await bootstrapLocalDataLayer();
    const assignmentId = createLocalId('session-exercise-tag');

    // Mark the new `session_exercise_tags` row dirty and stamp the monotonic
    // last-write-wins timestamp inside the SAME transaction as the insert, so
    // the counter persist (nowMonotonic → sync_runtime_state.last_emitted_ms)
    // is atomic with the row write and the sync cycle picks it up.
    database.transaction((tx) => {
      tx.insert(sessionExerciseTags)
        .values({
          id: assignmentId,
          sessionExerciseId: input.sessionExerciseId,
          exerciseTagDefinitionId: input.tagDefinitionId,
          localDirty: true,
          localUpdatedAtMs: nowMonotonic(tx),
          createdAt: input.now,
        })
        .run();
    });
  },
  async removeTagAssignment(input) {
    const database = await bootstrapLocalDataLayer();

    database
      .delete(sessionExerciseTags)
      .where(
        and(
          eq(sessionExerciseTags.sessionExerciseId, input.sessionExerciseId),
          eq(sessionExerciseTags.exerciseTagDefinitionId, input.tagDefinitionId)
        )
      )
      .run();
  },
  async listAssignedTags(input) {
    const database = await bootstrapLocalDataLayer();

    return database
      .select({
        assignmentId: sessionExerciseTags.id,
        sessionExerciseId: sessionExerciseTags.sessionExerciseId,
        tagDefinitionId: exerciseTagDefinitions.id,
        exerciseDefinitionId: exerciseTagDefinitions.exerciseDefinitionId,
        name: exerciseTagDefinitions.name,
        normalizedName: exerciseTagDefinitions.normalizedName,
        deletedAt: exerciseTagDefinitions.deletedAt,
        assignedAt: sessionExerciseTags.createdAt,
      })
      .from(sessionExerciseTags)
      .innerJoin(
        exerciseTagDefinitions,
        eq(sessionExerciseTags.exerciseTagDefinitionId, exerciseTagDefinitions.id)
      )
      .where(eq(sessionExerciseTags.sessionExerciseId, input.sessionExerciseId))
      .orderBy(
        asc(exerciseTagDefinitions.normalizedName),
        asc(exerciseTagDefinitions.name),
        asc(sessionExerciseTags.id)
      )
      .all() as SessionExerciseAssignedTag[];
  },
});

export type ListTagDefinitionsOptions = {
  includeDeleted?: boolean;
};

export type CreateTagDefinitionInput = {
  exerciseDefinitionId: string;
  name: string;
  now?: Date;
};

export type RenameTagDefinitionInput = {
  tagDefinitionId: string;
  name: string;
  now?: Date;
};

export type SetTagDefinitionDeletedStateInput = {
  tagDefinitionId: string;
  isDeleted: boolean;
  now?: Date;
};

export type AttachTagToSessionExerciseInput = {
  sessionExerciseId: string;
  tagDefinitionId: string;
  now?: Date;
};

export type RemoveTagFromSessionExerciseInput = {
  sessionExerciseId: string;
  tagDefinitionId: string;
};

export const createExerciseTagRepository = (store: ExerciseTagStore = createDrizzleExerciseTagStore()) => {
  const ensureNow = (value: Date | undefined) => {
    const now = value ?? new Date();
    ensureValidDate(now, 'now');
    return now;
  };

  const persistDeletedState = async (input: SetTagDefinitionDeletedStateInput) => {
    const tagDefinitionId = requireId(input.tagDefinitionId, 'tagDefinitionId');
    const now = ensureNow(input.now);

    await store.setTagDefinitionDeletedState({
      id: tagDefinitionId,
      deletedAt: input.isDeleted ? now : null,
      now,
    });
  };

  return {
    async listTagDefinitions(
      exerciseDefinitionId: string,
      options: ListTagDefinitionsOptions = {}
    ): Promise<ExerciseTagDefinitionRecord[]> {
      return store.listTagDefinitions({
        exerciseDefinitionId: requireId(exerciseDefinitionId, 'exerciseDefinitionId'),
        includeDeleted: options.includeDeleted === true,
      });
    },
    async listTagSuggestions(exerciseDefinitionId: string): Promise<ExerciseTagDefinitionRecord[]> {
      return store.listTagDefinitions({
        exerciseDefinitionId: requireId(exerciseDefinitionId, 'exerciseDefinitionId'),
        includeDeleted: false,
      });
    },
    async createTagDefinition(input: CreateTagDefinitionInput): Promise<ExerciseTagDefinitionRecord> {
      const exerciseDefinitionId = requireId(input.exerciseDefinitionId, 'exerciseDefinitionId');
      const normalizedName = normalizeTagName(input.name);
      const now = ensureNow(input.now);

      try {
        return await store.createTagDefinition({
          exerciseDefinitionId,
          name: normalizedName.name,
          normalizedName: normalizedName.normalizedName,
          now,
        });
      } catch (error) {
        if (isTagDefinitionNameUniqueError(error)) {
          throw new ExerciseTagDomainError(
            'tag_name_duplicate',
            `Tag name already exists for exercise definition ${exerciseDefinitionId}`
          );
        }
        throw error;
      }
    },
    async renameTagDefinition(input: RenameTagDefinitionInput): Promise<ExerciseTagDefinitionRecord> {
      const tagDefinitionId = requireId(input.tagDefinitionId, 'tagDefinitionId');
      const normalizedName = normalizeTagName(input.name);
      const now = ensureNow(input.now);

      try {
        const renamed = await store.renameTagDefinition({
          id: tagDefinitionId,
          name: normalizedName.name,
          normalizedName: normalizedName.normalizedName,
          now,
        });

        if (!renamed) {
          throw new ExerciseTagDomainError('tag_definition_not_found', `Tag definition ${tagDefinitionId} was not found`);
        }

        return renamed;
      } catch (error) {
        if (isTagDefinitionNameUniqueError(error)) {
          throw new ExerciseTagDomainError('tag_name_duplicate', `Tag name already exists for this exercise definition`);
        }
        throw error;
      }
    },
    async setTagDefinitionDeletedState(input: SetTagDefinitionDeletedStateInput): Promise<void> {
      await persistDeletedState(input);
    },
    async deleteTagDefinition(tagDefinitionId: string, now?: Date): Promise<void> {
      await persistDeletedState({
        tagDefinitionId,
        isDeleted: true,
        now,
      });
    },
    async undeleteTagDefinition(tagDefinitionId: string, now?: Date): Promise<void> {
      await persistDeletedState({
        tagDefinitionId,
        isDeleted: false,
        now,
      });
    },
    async attachTagToSessionExercise(input: AttachTagToSessionExerciseInput): Promise<void> {
      const sessionExerciseId = requireId(input.sessionExerciseId, 'sessionExerciseId');
      const tagDefinitionId = requireId(input.tagDefinitionId, 'tagDefinitionId');
      const now = ensureNow(input.now);

      const [sessionExerciseScope, tagDefinitionScope] = await Promise.all([
        store.loadSessionExerciseScope(sessionExerciseId),
        store.loadTagDefinitionScope(tagDefinitionId),
      ]);

      if (!sessionExerciseScope) {
        throw new ExerciseTagDomainError('session_exercise_not_found', `Session exercise ${sessionExerciseId} was not found`);
      }

      if (!tagDefinitionScope) {
        throw new ExerciseTagDomainError('tag_definition_not_found', `Tag definition ${tagDefinitionId} was not found`);
      }

      if (
        !sessionExerciseScope.exerciseDefinitionId ||
        sessionExerciseScope.exerciseDefinitionId !== tagDefinitionScope.exerciseDefinitionId
      ) {
        throw new ExerciseTagDomainError(
          'invalid_cross_definition_assignment',
          'Tag definition does not belong to the same exercise definition as the logged session exercise'
        );
      }

      try {
        await store.createTagAssignment({
          sessionExerciseId,
          tagDefinitionId,
          now,
        });
      } catch (error) {
        if (isSessionExerciseTagUniqueError(error)) {
          throw new ExerciseTagDomainError(
            'duplicate_session_exercise_assignment',
            'Tag is already assigned to the logged session exercise'
          );
        }
        throw error;
      }
    },
    async removeTagFromSessionExercise(input: RemoveTagFromSessionExerciseInput): Promise<void> {
      await store.removeTagAssignment({
        sessionExerciseId: requireId(input.sessionExerciseId, 'sessionExerciseId'),
        tagDefinitionId: requireId(input.tagDefinitionId, 'tagDefinitionId'),
      });
    },
    async listAssignedTagsForSessionExercise(sessionExerciseId: string): Promise<SessionExerciseAssignedTag[]> {
      return store.listAssignedTags({
        sessionExerciseId: requireId(sessionExerciseId, 'sessionExerciseId'),
      });
    },
  };
};

const defaultExerciseTagRepository = createExerciseTagRepository();

export const listExerciseTagDefinitions = defaultExerciseTagRepository.listTagDefinitions;
export const listExerciseTagSuggestions = defaultExerciseTagRepository.listTagSuggestions;
export const createExerciseTagDefinition = defaultExerciseTagRepository.createTagDefinition;
export const renameExerciseTagDefinition = defaultExerciseTagRepository.renameTagDefinition;
export const setExerciseTagDefinitionDeletedState = defaultExerciseTagRepository.setTagDefinitionDeletedState;
export const deleteExerciseTagDefinition = defaultExerciseTagRepository.deleteTagDefinition;
export const undeleteExerciseTagDefinition = defaultExerciseTagRepository.undeleteTagDefinition;
export const attachExerciseTagToSessionExercise = defaultExerciseTagRepository.attachTagToSessionExercise;
export const removeExerciseTagFromSessionExercise = defaultExerciseTagRepository.removeTagFromSessionExercise;
export const listSessionExerciseAssignedTags = defaultExerciseTagRepository.listAssignedTagsForSessionExercise;
