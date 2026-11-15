import { and, desc, eq, isNull, ne } from 'drizzle-orm';

import { bootstrapLocalDataLayer } from './bootstrap';
import { nowMonotonic, type Transaction } from './clock';
import { injuries, muscleGroups, type Injury } from './schema';
import { notifyLocalWrite } from '@/src/sync/write-nudge';
import { invalidateInjuries } from './injury-invalidation';

export type InjuryStatus = 'acute' | 'managing' | 'monitoring' | 'resolved';
export type InjurySide = 'left' | 'right' | 'bilateral';

export const INJURY_LABEL_MAX_LENGTH = 100;
export const INJURY_NOTES_MAX_LENGTH = 1000;
export const INJURY_CONTRAINDICATIONS_MAX_LENGTH = 500;

export const VALID_INJURY_STATUSES: readonly InjuryStatus[] = [
  'acute',
  'managing',
  'monitoring',
  'resolved',
] as const;

export const VALID_INJURY_SIDES: readonly InjurySide[] = [
  'left',
  'right',
  'bilateral',
] as const;

export type InjuryView = {
  id: string;
  muscleGroupId: string | null;
  muscleGroupName: string | null;
  side: InjurySide | null;
  status: InjuryStatus;
  painScore: number | null;
  label: string;
  notes: string | null;
  contraindications: string | null;
  startedAt: Date;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type InjuryInput = {
  id?: string;
  muscleGroupId?: string | null;
  side?: InjurySide | null;
  status?: InjuryStatus;
  painScore?: number | null;
  label: string;
  notes?: string | null;
  contraindications?: string | null;
  startedAt?: Date;
  resolvedAt?: Date | null;
  now?: Date;
};

export class InjuryInputError extends Error {}

type ValidatedInjuryInput = {
  label: string;
  muscleGroupId: string | null;
  side: InjurySide | null;
  status: InjuryStatus;
  painScore: number | null;
  notes: string | null;
  contraindications: string | null;
  startedAt: Date;
  resolvedAt: Date | null;
};

export function validateInjuryInput(input: InjuryInput, now: Date): ValidatedInjuryInput {
  const label = input.label?.trim() ?? '';
  if (label.length === 0) {
    throw new InjuryInputError('Give the injury a label.');
  }
  if (label.length > INJURY_LABEL_MAX_LENGTH) {
    throw new InjuryInputError(`Keep the label to ${INJURY_LABEL_MAX_LENGTH} characters.`);
  }

  const status = input.status ?? 'acute';
  if (!VALID_INJURY_STATUSES.includes(status)) {
    throw new InjuryInputError('Choose a valid status.');
  }

  const side = input.side ?? null;
  if (side !== null && !VALID_INJURY_SIDES.includes(side)) {
    throw new InjuryInputError('Choose a valid side.');
  }

  const painScore = input.painScore ?? null;
  if (painScore !== null) {
    if (!Number.isInteger(painScore) || painScore < 0 || painScore > 10) {
      throw new InjuryInputError('Pain rating must be a whole number between 0 and 10.');
    }
  }

  const startedAt = input.startedAt ?? now;
  if (startedAt.getTime() > now.getTime()) {
    throw new InjuryInputError('The started date cannot be in the future.');
  }

  let resolvedAt: Date | null = null;
  if (status === 'resolved') {
    resolvedAt = input.resolvedAt ?? now;
    if (resolvedAt.getTime() > now.getTime()) {
      throw new InjuryInputError('The resolved date cannot be in the future.');
    }
    if (resolvedAt.getTime() < startedAt.getTime()) {
      throw new InjuryInputError('The resolved date cannot be earlier than the started date.');
    }
  }

  const notes = input.notes?.trim() || null;
  if (notes && notes.length > INJURY_NOTES_MAX_LENGTH) {
    throw new InjuryInputError(`Keep notes to ${INJURY_NOTES_MAX_LENGTH} characters.`);
  }

  const contraindications = input.contraindications?.trim() || null;
  if (contraindications && contraindications.length > INJURY_CONTRAINDICATIONS_MAX_LENGTH) {
    throw new InjuryInputError(
      `Keep contraindications to ${INJURY_CONTRAINDICATIONS_MAX_LENGTH} characters.`
    );
  }

  return {
    label,
    muscleGroupId: input.muscleGroupId ?? null,
    side,
    status,
    painScore,
    notes,
    contraindications,
    startedAt,
    resolvedAt,
  };
}

const newInjuryId = (now: Date): string =>
  `injury-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

type ReadTx = Pick<Transaction, 'select'>;

const toView = (row: Injury, muscleGroupName: string | null): InjuryView => ({
  id: row.id,
  muscleGroupId: row.muscleGroupId,
  muscleGroupName,
  side: (row.side as InjurySide) ?? null,
  status: row.status as InjuryStatus,
  painScore: row.painScore,
  label: row.label,
  notes: row.notes,
  contraindications: row.contraindications,
  startedAt: row.startedAt,
  resolvedAt: row.resolvedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const STATUS_PRIORITY: Record<InjuryStatus, number> = {
  acute: 0,
  managing: 1,
  monitoring: 2,
  resolved: 3,
};

export type ListInjuriesOptions = {
  status?: 'active' | 'resolved' | 'all';
  muscleGroupId?: string;
};

/**
 * Reads live injuries. Active injuries are ordered by severity (acute > managing > monitoring),
 * then newest started date. Resolved injuries are ordered by newest resolved date.
 */
export const readInjuries = (database: ReadTx, options: ListInjuriesOptions = {}): InjuryView[] => {
  const statusFilter = options.status ?? 'all';
  const live = isNull(injuries.deletedAt);

  const baseWhere =
    statusFilter === 'active'
      ? and(live, ne(injuries.status, 'resolved'))
      : statusFilter === 'resolved'
      ? and(live, eq(injuries.status, 'resolved'))
      : live;

  const finalWhere = options.muscleGroupId
    ? and(baseWhere, eq(injuries.muscleGroupId, options.muscleGroupId))
    : baseWhere;

  const rows = database
    .select({
      injury: injuries,
      muscleGroupName: muscleGroups.displayName,
    })
    .from(injuries)
    .leftJoin(muscleGroups, eq(muscleGroups.id, injuries.muscleGroupId))
    .where(finalWhere)
    .orderBy(desc(injuries.startedAt), desc(injuries.id))
    .all();

  const views = rows.map(({ injury, muscleGroupName }) => toView(injury, muscleGroupName));

  // Sort active by priority first, then date; resolved by resolvedAt desc
  return views.sort((a, b) => {
    if (a.status === 'resolved' && b.status === 'resolved') {
      const aResolved = a.resolvedAt?.getTime() ?? 0;
      const bResolved = b.resolvedAt?.getTime() ?? 0;
      return bResolved - aResolved;
    }
    const priorityDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (priorityDiff !== 0) return priorityDiff;
    return b.startedAt.getTime() - a.startedAt.getTime();
  });
};

export const listInjuries = async (options: ListInjuriesOptions = {}): Promise<InjuryView[]> => {
  const database = await bootstrapLocalDataLayer();
  return readInjuries(database, options);
};

export const readInjury = async (id: string): Promise<InjuryView | null> => {
  const database = await bootstrapLocalDataLayer();
  const row = database
    .select({
      injury: injuries,
      muscleGroupName: muscleGroups.displayName,
    })
    .from(injuries)
    .leftJoin(muscleGroups, eq(muscleGroups.id, injuries.muscleGroupId))
    .where(and(eq(injuries.id, id), isNull(injuries.deletedAt)))
    .get();

  return row ? toView(row.injury, row.muscleGroupName) : null;
};

export const saveInjury = async (input: InjuryInput): Promise<InjuryView> => {
  const now = input.now ?? new Date();
  const valid = validateInjuryInput(input, now);
  const database = await bootstrapLocalDataLayer();

  const saved = database.transaction((tx) => {
    let muscleGroupName: string | null = null;
    if (valid.muscleGroupId) {
      const mg = tx
        .select({ id: muscleGroups.id, name: muscleGroups.displayName })
        .from(muscleGroups)
        .where(eq(muscleGroups.id, valid.muscleGroupId))
        .get();
      if (mg) {
        muscleGroupName = mg.name;
      }
    }

    const monotonicTime = nowMonotonic(tx as Transaction);

    if (input.id) {
      const existing = tx
        .select()
        .from(injuries)
        .where(and(eq(injuries.id, input.id), isNull(injuries.deletedAt)))
        .get();

      if (!existing) {
        throw new InjuryInputError('This injury is no longer available.');
      }

      tx.update(injuries)
        .set({
          muscleGroupId: valid.muscleGroupId,
          side: valid.side,
          status: valid.status,
          painScore: valid.painScore,
          label: valid.label,
          notes: valid.notes,
          contraindications: valid.contraindications,
          startedAt: valid.startedAt,
          resolvedAt: valid.resolvedAt,
          updatedAt: now,
          localDirty: true,
          localUpdatedAtMs: monotonicTime,
        })
        .where(eq(injuries.id, input.id))
        .run();

      const updated = tx.select().from(injuries).where(eq(injuries.id, input.id)).get();
      if (!updated) throw new Error('Could not update the injury.');
      return toView(updated, muscleGroupName);
    }

    const id = newInjuryId(now);
    tx.insert(injuries)
      .values({
        id,
        muscleGroupId: valid.muscleGroupId,
        side: valid.side,
        status: valid.status,
        painScore: valid.painScore,
        label: valid.label,
        notes: valid.notes,
        contraindications: valid.contraindications,
        startedAt: valid.startedAt,
        resolvedAt: valid.resolvedAt,
        createdAt: now,
        updatedAt: now,
        localDirty: true,
        localUpdatedAtMs: monotonicTime,
      })
      .run();

    const created = tx.select().from(injuries).where(eq(injuries.id, id)).get();
    if (!created) throw new Error('Could not create the injury.');
    return toView(created, muscleGroupName);
  });

  notifyLocalWrite();
  invalidateInjuries();
  return saved;
};

export const updateInjuryStatus = async (
  id: string,
  status: InjuryStatus,
  options: { painScore?: number | null; now?: Date } = {}
): Promise<InjuryView> => {
  const now = options.now ?? new Date();
  const database = await bootstrapLocalDataLayer();

  const updated = database.transaction((tx) => {
    const existing = tx
      .select({
        injury: injuries,
        muscleGroupName: muscleGroups.displayName,
      })
      .from(injuries)
      .leftJoin(muscleGroups, eq(muscleGroups.id, injuries.muscleGroupId))
      .where(and(eq(injuries.id, id), isNull(injuries.deletedAt)))
      .get();

    if (!existing) {
      throw new InjuryInputError('This injury is no longer available.');
    }

    const painScore =
      options.painScore !== undefined ? options.painScore : existing.injury.painScore;
    if (painScore !== null && (!Number.isInteger(painScore) || painScore < 0 || painScore > 10)) {
      throw new InjuryInputError('Pain rating must be a whole number between 0 and 10.');
    }

    const resolvedAt = status === 'resolved' ? (existing.injury.resolvedAt ?? now) : null;
    const monotonicTime = nowMonotonic(tx as Transaction);

    tx.update(injuries)
      .set({
        status,
        painScore,
        resolvedAt,
        updatedAt: now,
        localDirty: true,
        localUpdatedAtMs: monotonicTime,
      })
      .where(eq(injuries.id, id))
      .run();

    const row = tx.select().from(injuries).where(eq(injuries.id, id)).get();
    if (!row) throw new Error('Could not update the injury status.');
    return toView(row, existing.muscleGroupName);
  });

  notifyLocalWrite();
  invalidateInjuries();
  return updated;
};

export const resolveInjury = async (id: string, now = new Date()): Promise<InjuryView> => {
  return updateInjuryStatus(id, 'resolved', { now });
};

export const removeInjury = async (id: string, now = new Date()): Promise<void> => {
  const database = await bootstrapLocalDataLayer();
  const removed = database.transaction((tx) => {
    const existing = tx
      .select({ deletedAt: injuries.deletedAt })
      .from(injuries)
      .where(eq(injuries.id, id))
      .get();

    if (!existing || existing.deletedAt) return false;

    tx.update(injuries)
      .set({
        deletedAt: now,
        updatedAt: now,
        localDirty: true,
        localUpdatedAtMs: nowMonotonic(tx as Transaction),
      })
      .where(eq(injuries.id, id))
      .run();

    return true;
  });

  if (removed) {
    notifyLocalWrite();
    invalidateInjuries();
  }
};
