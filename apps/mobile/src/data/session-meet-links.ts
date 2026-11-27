import { and, asc, eq, isNull } from 'drizzle-orm';

import { bootstrapLocalDataLayer } from './bootstrap';
import { nowMonotonic, type Transaction } from './clock';
import { sessionMeetLinks, sessions } from './schema';
import { notifyLocalWrite } from '@/src/sync/write-nudge';

// Local repository for a member's session → meet links (Sync v2 entity
// `session_meet_links`, sync-v2 contract "Per-entity rules"). Links are the
// member's own synced rows, so joining a session to a meet works offline and
// reaches the server on the next cycle. Every write dirties the row in the same
// transaction (contract "Dirty-bit lifecycle").
//
// The server decides whether a link counts ([[meets.linking]]: shared session,
// current member, meet not cancelled, overlap). This repository only refuses a
// session that can no longer overlap the meet window, which no later write can
// fix, so the app never attaches one.

export type SessionMeetLinkRecord = {
  id: string;
  sessionId: string;
  meetId: string;
  createdAt: Date;
  updatedAt: Date;
};

/** The meet window a join is checked against, as the meet read carries it. */
export type MeetWindow = {
  meetId: string;
  startsAtMs: number;
  endsAtMs: number;
};

type SessionTimes = {
  status: 'active' | 'completed';
  startedAt: Date;
  completedAt: Date | null;
};

/** A join refused because the session cannot overlap the meet window. */
export class SessionMeetWindowError extends Error {
  constructor(sessionId: string, meetId: string) {
    super(`Session ${sessionId} does not overlap meet ${meetId}`);
    this.name = 'SessionMeetWindowError';
  }
}

const requireId = (value: string, label: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
};

// Meet ids are server UUIDs; the server matches them as lowercase text.
const normalizeMeetId = (meetId: string): string => requireId(meetId, 'meetId').toLowerCase();

/**
 * The deterministic link id: one row per (meet, session), so a re-join after a
 * leave undeletes the same row ("LWW and undelete"). Inputs are normalized as
 * the repository stores them.
 */
export const sessionMeetLinkId = (meetId: string, sessionId: string): string =>
  `${normalizeMeetId(meetId)}:${requireId(sessionId, 'sessionId')}`;

/**
 * Whether a session can still overlap a meet window: it starts before the meet
 * ends, and it is still running or it ended after the meet started. A running
 * session that started before the meet can overlap once the meet starts. A
 * completed session without `completedAt` ends where it started, as on the
 * server.
 */
export const sessionCanOverlapMeet = (session: SessionTimes, window: MeetWindow): boolean => {
  const startedAtMs = session.startedAt.getTime();
  if (startedAtMs >= window.endsAtMs) {
    return false;
  }
  if (session.completedAt === null && session.status === 'active') {
    return true;
  }
  const endedAtMs = session.completedAt?.getTime() ?? startedAtMs;
  return endedAtMs > window.startsAtMs;
};

const linkColumns = {
  id: sessionMeetLinks.id,
  sessionId: sessionMeetLinks.sessionId,
  meetId: sessionMeetLinks.meetId,
  createdAt: sessionMeetLinks.createdAt,
  updatedAt: sessionMeetLinks.updatedAt,
};

const readLiveSession = (tx: Transaction, sessionId: string): SessionTimes => {
  const session = tx
    .select({ status: sessions.status, startedAt: sessions.startedAt, completedAt: sessions.completedAt })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), isNull(sessions.deletedAt)))
    .get();
  if (!session) {
    throw new Error(`Session ${sessionId} was not found`);
  }
  return session;
};

const tombstone = (tx: Transaction, id: string, now: Date): void => {
  tx.update(sessionMeetLinks)
    .set({ deletedAt: now, updatedAt: now, localDirty: true, localUpdatedAtMs: nowMonotonic(tx) })
    .where(eq(sessionMeetLinks.id, id))
    .run();
};

const joinInTransaction = (tx: Transaction, sessionId: string, window: MeetWindow, now: Date): boolean => {
  const meetId = normalizeMeetId(window.meetId);
  if (!sessionCanOverlapMeet(readLiveSession(tx, sessionId), window)) {
    throw new SessionMeetWindowError(sessionId, meetId);
  }
  const id = sessionMeetLinkId(meetId, sessionId);
  const existing = tx
    .select({ deletedAt: sessionMeetLinks.deletedAt })
    .from(sessionMeetLinks)
    .where(eq(sessionMeetLinks.id, id))
    .get();

  if (!existing) {
    tx.insert(sessionMeetLinks)
      .values({
        id,
        sessionId,
        meetId,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
        localDirty: true,
        localUpdatedAtMs: nowMonotonic(tx),
      })
      .run();
    return true;
  }
  if (existing.deletedAt === null) {
    return false;
  }
  tx.update(sessionMeetLinks)
    .set({ deletedAt: null, updatedAt: now, localDirty: true, localUpdatedAtMs: nowMonotonic(tx) })
    .where(eq(sessionMeetLinks.id, id))
    .run();
  return true;
};

/**
 * Joins one of the member's live sessions to a meet: creates the link, or
 * undeletes a left one under the same id. Joining an already-joined session is
 * a no-op (nothing is dirtied or pushed). Throws `SessionMeetWindowError` when
 * the session cannot overlap the meet window, and an `Error` when the session
 * is missing or deleted.
 */
export const joinSessionToMeet = async (
  sessionId: string,
  window: MeetWindow,
  now: Date = new Date(),
): Promise<SessionMeetLinkRecord> => {
  const session = requireId(sessionId, 'sessionId');
  const database = await bootstrapLocalDataLayer();
  const wrote = database.transaction((tx) => joinInTransaction(tx, session, window, now));
  if (wrote) {
    notifyLocalWrite();
  }
  const id = sessionMeetLinkId(window.meetId, session);
  const link = database.select(linkColumns).from(sessionMeetLinks).where(eq(sessionMeetLinks.id, id)).get();
  if (!link) {
    throw new Error(`Session meet link ${id} was not found after join`);
  }
  return link;
};

/**
 * Leaves a meet for one session by tombstoning its link, so the leave syncs
 * under LWW and a re-join undeletes the same id. Returns whether it wrote; a
 * missing or already-left link returns false.
 */
export const leaveSessionMeet = async (sessionId: string, meetId: string, now: Date = new Date()): Promise<boolean> => {
  const id = sessionMeetLinkId(meetId, sessionId);
  const database = await bootstrapLocalDataLayer();
  const wrote = database.transaction((tx) => {
    const existing = tx
      .select({ deletedAt: sessionMeetLinks.deletedAt })
      .from(sessionMeetLinks)
      .where(eq(sessionMeetLinks.id, id))
      .get();
    if (!existing || existing.deletedAt !== null) {
      return false;
    }
    tombstone(tx, id, now);
    return true;
  });
  if (wrote) {
    notifyLocalWrite();
  }
  return wrote;
};

/**
 * Tombstones every live link the member holds to a meet (leaving the meet
 * itself). The server never writes these rows, so this is the only way a leave
 * reaches them. Returns how many links it left.
 */
export const leaveMeetSessions = async (meetId: string, now: Date = new Date()): Promise<number> => {
  const meet = normalizeMeetId(meetId);
  const database = await bootstrapLocalDataLayer();
  const left = database.transaction((tx) => {
    const live = tx
      .select({ id: sessionMeetLinks.id })
      .from(sessionMeetLinks)
      .where(and(eq(sessionMeetLinks.meetId, meet), isNull(sessionMeetLinks.deletedAt)))
      .all();
    for (const { id } of live) {
      tombstone(tx, id, now);
    }
    return live.length;
  });
  if (left > 0) {
    notifyLocalWrite();
  }
  return left;
};

/** The live links of one session, ordered by meet. */
export const listMeetLinksForSession = async (sessionId: string): Promise<SessionMeetLinkRecord[]> => {
  const session = requireId(sessionId, 'sessionId');
  const database = await bootstrapLocalDataLayer();
  return database
    .select(linkColumns)
    .from(sessionMeetLinks)
    .where(and(eq(sessionMeetLinks.sessionId, session), isNull(sessionMeetLinks.deletedAt)))
    .orderBy(asc(sessionMeetLinks.meetId))
    .all();
};

/** The member's live links to one meet, ordered by session. */
export const listSessionLinksForMeet = async (meetId: string): Promise<SessionMeetLinkRecord[]> => {
  const meet = normalizeMeetId(meetId);
  const database = await bootstrapLocalDataLayer();
  return database
    .select(linkColumns)
    .from(sessionMeetLinks)
    .where(and(eq(sessionMeetLinks.meetId, meet), isNull(sessionMeetLinks.deletedAt)))
    .orderBy(asc(sessionMeetLinks.sessionId))
    .all();
};
