import { useCallback, useEffect, useRef, useState } from 'react';

import { getCompetitionStream } from '@/src/groups/api';
import type { CompetitionStreamItemWire, CompetitionStreamWire } from '@/src/groups/competition-wire';
import { completedSessionsFromStream, type GroupWeekLatestSession } from '@/src/groups/week-summary-view-model';

/** One older page of a group's stream; the default reads it online. */
export type GroupStreamPageLoader = (groupId: string, before: string | null) => Promise<CompetitionStreamWire>;

// Pages read for one step before giving up on finding a completed session:
// the stream also carries records, lead changes and membership events.
const PAGES_PER_STEP = 3;

type Loaded = { items: CompetitionStreamItemWire[]; cursor: string | null; hasMore: boolean };

const emptyLoaded = (): Loaded => ({ items: [], cursor: null, hasMore: true });
const freshSteps = (key: string) => ({ key, index: 0, loaded: emptyLoaded(), loading: false, failed: false });

export type GroupSessionSteps = {
  /** 0 is the card's own latest activity; past it, the older completed session shown. */
  index: number;
  session: GroupWeekLatestSession | null;
  canOlder: boolean;
  loading: boolean;
  failed: boolean;
  older: () => void;
  newer: () => void;
};

/**
 * Steps Today's group card back through the group's completed sessions,
 * past the session its latest activity shows (`currentSessionId`). The older
 * sessions come from the group's stream, read online only when the arrow
 * first asks for one, a page at a time.
 */
export function useGroupSessionSteps(
  groupId: string,
  currentSessionId: string | null,
  loadPage: GroupStreamPageLoader = getCompetitionStream,
): GroupSessionSteps {
  // Another group, or a newer latest session, starts again from the latest:
  // pages read before it would skip what was shared since.
  const key = `${groupId} ${currentSessionId ?? ''}`;
  const [state, setState] = useState(() => freshSteps(key));
  if (state.key !== key) setState(freshSteps(key));
  const current = state.key === key ? state : freshSteps(key);
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  const sessions = completedSessionsFromStream(current.loaded.items).filter((session) => session.session_id !== currentSessionId);
  const { index, loaded, loading, failed } = current;

  const older = useCallback(() => {
    if (index < sessions.length) {
      setState((previous) => ({ ...previous, index: previous.index + 1 }));
      return;
    }
    if (!loaded.hasMore || loading) return;
    setState((previous) => ({ ...previous, loading: true, failed: false }));
    void (async () => {
      let next = loaded;
      try {
        for (let page = 0; page < PAGES_PER_STEP && next.hasMore; page += 1) {
          const result = await loadPage(groupId, next.cursor);
          next = { items: [...next.items, ...result.items], cursor: result.next_cursor, hasMore: result.has_more && result.next_cursor !== null };
          const found = completedSessionsFromStream(next.items).filter((session) => session.session_id !== currentSessionId);
          if (found.length > index) break;
        }
      } catch {
        if (keyRef.current === key) setState((previous) => ({ ...previous, loading: false, failed: true }));
        return;
      }
      if (keyRef.current !== key) return;
      const found = completedSessionsFromStream(next.items).filter((session) => session.session_id !== currentSessionId);
      setState((previous) => ({
        ...previous,
        loaded: next,
        loading: false,
        index: found.length > index ? index + 1 : index,
      }));
    })();
  }, [currentSessionId, groupId, index, key, loadPage, loaded, loading, sessions.length]);

  const newer = useCallback(() => setState((previous) => ({ ...previous, index: Math.max(0, previous.index - 1), failed: false })), []);

  return {
    index,
    session: index > 0 ? (sessions[index - 1] ?? null) : null,
    canOlder: !loading && (index < sessions.length || loaded.hasMore),
    loading,
    failed,
    older,
    newer,
  };
}
