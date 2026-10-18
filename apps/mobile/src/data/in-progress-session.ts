import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import type { Transaction } from './clock';
import { gyms, sessions } from './schema';

type ReadTx = Pick<Transaction, 'select'>;

/**
 * The workout in progress: the most recent active, non-deleted session — the
 * one the recorder opens. Should sync leave a second active row, only this one
 * is read.
 */
export const selectInProgressSessionRow = (
  database: ReadTx
): { id: string; startedAt: Date; gymId: string | null; gymName: string | null } | null =>
  database
    .select({ id: sessions.id, startedAt: sessions.startedAt, gymId: sessions.gymId, gymName: gyms.name })
    .from(sessions)
    .leftJoin(gyms, eq(gyms.id, sessions.gymId))
    .where(and(eq(sessions.status, 'active'), isNull(sessions.deletedAt)))
    .orderBy(desc(sessions.updatedAt), desc(sessions.createdAt), desc(sessions.startedAt), asc(sessions.id))
    .limit(1)
    .get() ?? null;

/**
 * Where personal Progress dates the workout in progress
 * (`training-metrics-contract.md` §2): where finishing it now would date it.
 * The instant before `now`, so it falls inside every window that ends now.
 */
export const inProgressSessionDate = (now: Date): Date => new Date(now.getTime() - 1);

/**
 * The workout in progress, dated for a read of `[start, end)` made at `now`;
 * null when there is none or its date falls outside the window. Its sets count
 * like any session's: only confirmed performed ones.
 */
export const selectDatedInProgressSession = (
  database: ReadTx,
  { start, end, now }: { start: Date; end: Date; now: Date }
): { id: string; startedAt: Date; completedAt: Date; gymId: string | null; gymName: string | null } | null => {
  const completedAt = inProgressSessionDate(now);
  if (completedAt < start || completedAt >= end) return null;
  const row = selectInProgressSessionRow(database);
  return row ? { ...row, completedAt } : null;
};
