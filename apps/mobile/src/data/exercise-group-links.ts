import { asc, eq, isNull } from 'drizzle-orm';

import { bootstrapLocalDataLayer } from './bootstrap';
import { nowMonotonic } from './clock';
import { exerciseGroupLinks } from './schema';
import { notifyLocalWrite } from '@/src/sync/write-nudge';

// Local repository for a member's exercise → group-exercise links (Sync v2
// entity `exercise_group_links`, contract §A.2.10). Links are the member's own
// synced rows, so linking works offline and reaches the server on the next
// cycle. Every write dirties the row in the same transaction (§B.7.2).

export type ExerciseGroupLinkRecord = {
  id: string;
  exerciseDefinitionId: string;
  groupId: string;
  groupExerciseId: string;
  createdAt: Date;
  updatedAt: Date;
};

const requireId = (value: string, label: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
};

/**
 * The deterministic link id: one row per (group, personal exercise), so a
 * personal exercise links to at most one group exercise per group. Relinking
 * reuses this id, which is the contract's undelete path (§A.1.1.3).
 */
export const exerciseGroupLinkId = (groupId: string, exerciseDefinitionId: string): string =>
  `${groupId}:${exerciseDefinitionId}`;

const linkColumns = {
  id: exerciseGroupLinks.id,
  exerciseDefinitionId: exerciseGroupLinks.exerciseDefinitionId,
  groupId: exerciseGroupLinks.groupId,
  groupExerciseId: exerciseGroupLinks.groupExerciseId,
  createdAt: exerciseGroupLinks.createdAt,
  updatedAt: exerciseGroupLinks.updatedAt,
};

/**
 * Links a personal exercise to a group exercise. Creates the row, retargets a
 * live link to a different group exercise in the same group, or undeletes a
 * tombstoned link under the same id. Relinking to the current live target is a
 * no-op (nothing is dirtied or pushed).
 */
export const linkExercise = async (
  exerciseDefinitionId: string,
  groupId: string,
  groupExerciseId: string,
  now: Date = new Date(),
): Promise<ExerciseGroupLinkRecord> => {
  const definitionId = requireId(exerciseDefinitionId, 'exerciseDefinitionId');
  const group = requireId(groupId, 'groupId');
  const target = requireId(groupExerciseId, 'groupExerciseId');
  const id = exerciseGroupLinkId(group, definitionId);
  const database = await bootstrapLocalDataLayer();

  const wrote = database.transaction((tx) => {
    const existing = tx
      .select({
        groupExerciseId: exerciseGroupLinks.groupExerciseId,
        deletedAt: exerciseGroupLinks.deletedAt,
      })
      .from(exerciseGroupLinks)
      .where(eq(exerciseGroupLinks.id, id))
      .get();

    if (!existing) {
      tx.insert(exerciseGroupLinks)
        .values({
          id,
          exerciseDefinitionId: definitionId,
          groupId: group,
          groupExerciseId: target,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
          localDirty: true,
          localUpdatedAtMs: nowMonotonic(tx),
        })
        .run();
      return true;
    }

    if (existing.deletedAt === null && existing.groupExerciseId === target) {
      return false;
    }

    tx.update(exerciseGroupLinks)
      .set({
        groupExerciseId: target,
        deletedAt: null,
        updatedAt: now,
        localDirty: true,
        localUpdatedAtMs: nowMonotonic(tx),
      })
      .where(eq(exerciseGroupLinks.id, id))
      .run();
    return true;
  });

  if (wrote) {
    notifyLocalWrite();
  }

  const link = database
    .select(linkColumns)
    .from(exerciseGroupLinks)
    .where(eq(exerciseGroupLinks.id, id))
    .get();
  if (!link) {
    throw new Error(`Exercise group link ${id} was not found after link`);
  }
  return link;
};

/**
 * Unlinks a personal exercise from its group exercise in a group by
 * tombstoning the row (`deleted_at`), so the unlink syncs under LWW and a later
 * relink undeletes the same id. A missing or already-unlinked row is a no-op.
 */
export const unlinkExercise = async (
  exerciseDefinitionId: string,
  groupId: string,
  now: Date = new Date(),
): Promise<void> => {
  const id = exerciseGroupLinkId(
    requireId(groupId, 'groupId'),
    requireId(exerciseDefinitionId, 'exerciseDefinitionId'),
  );
  const database = await bootstrapLocalDataLayer();

  const wrote = database.transaction((tx) => {
    const existing = tx
      .select({ deletedAt: exerciseGroupLinks.deletedAt })
      .from(exerciseGroupLinks)
      .where(eq(exerciseGroupLinks.id, id))
      .get();
    if (!existing || existing.deletedAt !== null) {
      return false;
    }

    tx.update(exerciseGroupLinks)
      .set({
        deletedAt: now,
        updatedAt: now,
        localDirty: true,
        localUpdatedAtMs: nowMonotonic(tx),
      })
      .where(eq(exerciseGroupLinks.id, id))
      .run();
    return true;
  });

  if (wrote) {
    notifyLocalWrite();
  }
};

/** Lists the member's live (not unlinked) links, ordered by group then exercise. */
export const listLinks = async (): Promise<ExerciseGroupLinkRecord[]> => {
  const database = await bootstrapLocalDataLayer();
  return database
    .select(linkColumns)
    .from(exerciseGroupLinks)
    .where(isNull(exerciseGroupLinks.deletedAt))
    .orderBy(asc(exerciseGroupLinks.groupId), asc(exerciseGroupLinks.exerciseDefinitionId))
    .all();
};
