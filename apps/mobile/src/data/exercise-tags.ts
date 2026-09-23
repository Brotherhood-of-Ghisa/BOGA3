import { and, asc, eq, isNull } from 'drizzle-orm';

import { bootstrapLocalDataLayer } from './bootstrap';
import { exerciseTagDefinitions, sessionExerciseTags } from './schema';

/**
 * Exercise tags are read-only in the app: the tag editor went with the old
 * recorder (redesign 6b, D4). The synced tag tables stay, and completed
 * sessions and exercise history still show the tags a session carries.
 */

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

/** The live (non-tombstoned) tags on one session exercise, ordered by name. */
export const listSessionExerciseAssignedTags = async (
  sessionExerciseId: string
): Promise<SessionExerciseAssignedTag[]> => {
  const id = sessionExerciseId.trim();
  if (!id) {
    throw new Error('sessionExerciseId is required');
  }

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
    .innerJoin(exerciseTagDefinitions, eq(sessionExerciseTags.exerciseTagDefinitionId, exerciseTagDefinitions.id))
    .where(and(eq(sessionExerciseTags.sessionExerciseId, id), isNull(sessionExerciseTags.deletedAt)))
    .orderBy(
      asc(exerciseTagDefinitions.normalizedName),
      asc(exerciseTagDefinitions.name),
      asc(sessionExerciseTags.id)
    )
    .all() as SessionExerciseAssignedTag[];
};
