import { useEffect, useState } from 'react';

import { getCompetitionStream } from '@/src/groups/api';
import type { CompetitionStreamItemWire, CompetitionStreamWire } from '@/src/groups/competition-wire';
import { completedSessionsFromStream, type GroupWeekLatestSession } from '@/src/groups/week-summary-view-model';

/** One page of a group's stream, newest first; the default reads it online. */
export type GroupStreamPageLoader = (groupId: string, before: string | null) => Promise<CompetitionStreamWire>;

// Pages read before settling for fewer sessions: the stream also carries
// records, lead changes and membership events.
const MAX_PAGES = 2;

export type GroupRecentSessions = {
  /** The completed sessions read, newest first; empty until read. */
  sessions: GroupWeekLatestSession[];
  failed: boolean;
};

type State = { key: string; sessions: GroupWeekLatestSession[]; failed: boolean };

/**
 * The group's latest completed sessions for Today's group card, read online
 * from its stream when the card has room for more than the week summary
 * carries (`wanted` above zero). A newer latest session (`latestSessionId`)
 * or another group reads again, so the card never misses what was shared since.
 */
export function useGroupRecentSessions(
  groupId: string,
  latestSessionId: string | null,
  wanted: number,
  loadPage: GroupStreamPageLoader = getCompetitionStream,
): GroupRecentSessions {
  const key = `${groupId} ${latestSessionId ?? ''}`;
  const [state, setState] = useState<State>({ key, sessions: [], failed: false });
  const needsRead = wanted > 0;

  useEffect(() => {
    if (!needsRead) return;
    let cancelled = false;
    void (async () => {
      let items: CompetitionStreamItemWire[] = [];
      let cursor: string | null = null;
      try {
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const result = await loadPage(groupId, cursor);
          items = [...items, ...result.items];
          cursor = result.next_cursor;
          // The latest summary session is shown already; one more than wanted covers it.
          if (completedSessionsFromStream(items).length > wanted || !result.has_more || cursor === null) break;
        }
      } catch {
        if (!cancelled) setState({ key, sessions: [], failed: true });
        return;
      }
      if (!cancelled) setState({ key, sessions: completedSessionsFromStream(items), failed: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId, key, loadPage, needsRead, wanted]);

  return state.key === key ? { sessions: state.sessions, failed: state.failed } : { sessions: [], failed: false };
}
