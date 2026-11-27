import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { bootstrapLocalDataLayer } from '@/src/data/bootstrap';

import {
  joinedMeetIds,
  joinMeetFromSession,
  leaveMeetFromSession,
  loadChallengeExerciseIds,
  offeredMeets,
  readCachedMeetCandidates,
  sessionMeetFailureMessage,
  subscribeSessionMeetLinks,
  type SessionMeetCandidate,
  type SessionMeetPlacement,
  type SessionMeetResult,
  type SessionMeetTimes,
} from './session-meets';

/** How often a session's offered meets are re-derived from the clock (a window opens or closes). */
export const SESSION_MEET_CLOCK_MS = 15_000;

const NO_EXERCISES: ReadonlySet<string> = new Set();

export type SessionMeetRow = SessionMeetCandidate & { joined: boolean };

// `owner` names the (user, session) the read was for, so a snapshot never outlives a change of either.
type Snapshot = { owner: string; candidates: SessionMeetCandidate[]; joined: Set<string> };
const EMPTY: Snapshot = { owner: '', candidates: [], joined: new Set() };

/**
 * The meets a session can be joined to, with whether each is joined, and the
 * Join/Leave that write the synced link. Reads only the cached meet lists and
 * the local links: it never fetches and never needs a connection, and a read
 * that fails leaves the rows empty rather than blocking the screen.
 */
export function useSessionMeets({
  userId,
  sessionId,
  times,
  placement,
}: {
  userId: string | null;
  sessionId: string | null;
  times: SessionMeetTimes | null;
  placement: SessionMeetPlacement;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [now, setNow] = useState(Date.now);
  const [busyMeetId, setBusyMeetId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A failed read leaves no offer rather than blocking the screen.
  const read = useCallback(async (): Promise<Snapshot | null> => {
    if (!userId || !sessionId) return null;
    try {
      const database = await bootstrapLocalDataLayer();
      return { owner: `${userId}|${sessionId}`, candidates: readCachedMeetCandidates(database, userId), joined: await joinedMeetIds(sessionId) };
    } catch {
      return EMPTY;
    }
  }, [userId, sessionId]);
  const reload = useCallback(() => read().then((next) => {
    if (next && alive.current) setSnapshot(next);
  }), [read]);

  // Re-read on mount, when a link changes, and on the clock tick, so a meet list
  // cached while this screen stayed mounted (the Train tab) shows up.
  useEffect(() => {
    void reload();
    return subscribeSessionMeetLinks(() => void reload());
  }, [reload]);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      void reload();
    }, SESSION_MEET_CLOCK_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const startedAtMs = times?.startedAt.getTime();
  const completedAtMs = times?.completedAt?.getTime() ?? null;
  const status = times?.status;
  const rows = useMemo<SessionMeetRow[]>(() => {
    if (startedAtMs === undefined || !status || snapshot.owner !== `${userId}|${sessionId}`) return [];
    const session: SessionMeetTimes = {
      status,
      startedAt: new Date(startedAtMs),
      completedAt: completedAtMs === null ? null : new Date(completedAtMs),
    };
    return offeredMeets(snapshot.candidates, session, placement, now)
      .map((candidate) => ({ ...candidate, joined: snapshot.joined.has(candidate.meet.meet_id) }));
  }, [snapshot, userId, sessionId, startedAtMs, completedAtMs, status, placement, now]);

  const change = useCallback(async (row: SessionMeetRow, write: typeof joinMeetFromSession): Promise<SessionMeetResult | null> => {
    if (!sessionId || busyMeetId) return null;
    setBusyMeetId(row.meet.meet_id);
    setMessage(null);
    const result = await write(sessionId, row.meet);
    if (alive.current) {
      setBusyMeetId(null);
      setMessage(result.ok ? null : sessionMeetFailureMessage(result.failure));
    }
    await reload();
    return result;
  }, [sessionId, busyMeetId, reload]);

  return {
    rows,
    busyMeetId,
    message,
    join: (row: SessionMeetRow) => change(row, joinMeetFromSession),
    leave: (row: SessionMeetRow) => change(row, leaveMeetFromSession),
  };
}

/**
 * The session's exercise definitions that are challenge exercises of a joined
 * meet, re-read on mount, when a link changes and on the clock tick. A failed read tags nothing.
 */
export function useSessionChallengeExercises(
  userId: string | null,
  sessionId: string | null,
  definitionIds: readonly string[],
): ReadonlySet<string> {
  const [read, setRead] = useState<{ owner: string; ids: ReadonlySet<string> }>({ owner: '', ids: new Set() });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const key = definitionIds.join('\u0000');
  const reload = useCallback(() => {
    if (!userId || !sessionId) return Promise.resolve();
    const owner = `${userId}|${sessionId}|${key}`;
    return loadChallengeExerciseIds(userId, sessionId, key ? key.split('\u0000') : [])
      .catch(() => new Set<string>())
      .then((ids) => {
        if (alive.current) setRead({ owner, ids });
      });
  }, [userId, sessionId, key]);
  useEffect(() => {
    void reload();
    const unsubscribe = subscribeSessionMeetLinks(() => void reload());
    const timer = setInterval(() => void reload(), SESSION_MEET_CLOCK_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [reload]);
  return userId && sessionId && read.owner === `${userId}|${sessionId}|${key}` ? read.ids : NO_EXERCISES;
}
