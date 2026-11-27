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

export type SessionMeetRow = SessionMeetCandidate & { joined: boolean };

type Snapshot = { candidates: SessionMeetCandidate[]; joined: Set<string> };
const EMPTY: Snapshot = { candidates: [], joined: new Set() };

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

  const reload = useCallback(async () => {
    if (!userId || !sessionId) {
      setSnapshot(EMPTY);
      return;
    }
    try {
      const database = await bootstrapLocalDataLayer();
      const next = { candidates: readCachedMeetCandidates(database, userId), joined: await joinedMeetIds(sessionId) };
      if (alive.current) setSnapshot(next);
    } catch {
      if (alive.current) setSnapshot(EMPTY);
    }
  }, [userId, sessionId]);

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
    if (startedAtMs === undefined || !status) return [];
    const session: SessionMeetTimes = {
      status,
      startedAt: new Date(startedAtMs),
      completedAt: completedAtMs === null ? null : new Date(completedAtMs),
    };
    return offeredMeets(snapshot.candidates, session, placement, now)
      .map((candidate) => ({ ...candidate, joined: snapshot.joined.has(candidate.meet.meet_id) }));
  }, [snapshot, startedAtMs, completedAtMs, status, placement, now]);

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
  const [tagged, setTagged] = useState<ReadonlySet<string>>(new Set());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const key = definitionIds.join('\u0000');
  const reload = useCallback(async () => {
    if (!userId || !sessionId) {
      setTagged(new Set());
      return;
    }
    try {
      const next = await loadChallengeExerciseIds(userId, sessionId, key ? key.split('\u0000') : []);
      if (alive.current) setTagged(next);
    } catch {
      if (alive.current) setTagged(new Set());
    }
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
  return tagged;
}
