import { useEffect, useState } from 'react';

import {
  completeSessionDraft,
  appendCompletedSessionAsPlanned as appendCompletedSessionAsPlannedDraft,
  listSessionListBuckets,
  persistSessionDraftSnapshot,
  setSessionDeletedState,
} from '@/src/data';

import type { SessionListDataClient, SessionListItem } from './types';

type RepositorySummary =
  | Awaited<ReturnType<typeof listSessionListBuckets>>['completed'][number]
  | Awaited<ReturnType<typeof listSessionListBuckets>>['active'];

export const mapRepositorySummaryToSessionListItem = (
  summary: RepositorySummary
): SessionListItem | null => {
  if (!summary) {
    return null;
  }

  return {
    id: summary.id,
    startedAt: summary.startedAt.toISOString(),
    status: summary.status,
    completedAt: summary.completedAt ? summary.completedAt.toISOString() : null,
    durationSec: summary.durationSec,
    durationDisplay: summary.compactDuration,
    gymName: summary.gymName,
    exerciseCount: summary.exerciseCount,
    setCount: summary.setCount,
    totalWeight: 0,
    deletedAt: summary.deletedAt ? summary.deletedAt.toISOString() : null,
  };
};

export const DEFAULT_SESSION_LIST_DATA_CLIENT: SessionListDataClient = {
  async loadSessions({ showDeletedSessions }) {
    const buckets = await listSessionListBuckets({
      includeDeleted: showDeletedSessions,
    });

    const active = mapRepositorySummaryToSessionListItem(buckets.active);
    const completed = buckets.completed
      .map((summary) => mapRepositorySummaryToSessionListItem(summary))
      .filter((summary): summary is SessionListItem => summary !== null);

    return active ? [active, ...completed] : completed;
  },
  async startSession() {
    await persistSessionDraftSnapshot({
      gymId: null,
      startedAt: new Date(),
      status: 'active',
      exercises: [],
    });
  },
  async completeActiveSession(sessionId) {
    await completeSessionDraft(sessionId);
  },
  async discardActiveSession(sessionId) {
    await setSessionDeletedState(sessionId, true);
  },
  async setCompletedSessionDeletedState(sessionId, isDeleted) {
    await setSessionDeletedState(sessionId, isDeleted);
  },
  async appendCompletedSessionAsPlanned(sessionId) {
    await appendCompletedSessionAsPlannedDraft(sessionId);
  },
};

export type UseSessionListDataInput = {
  dataClient?: SessionListDataClient;
  initialSessions: SessionListItem[];
  showDeletedSessions: boolean;
  reloadToken: number;
};

export type UseSessionListDataResult = {
  sessions: SessionListItem[];
  setSessions: React.Dispatch<React.SetStateAction<SessionListItem[]>>;
  isLoadingSessions: boolean;
  loadErrorMessage: string | null;
  reloadSessions: () => Promise<void>;
};

export function useSessionListData({
  dataClient,
  initialSessions,
  showDeletedSessions,
  reloadToken,
}: UseSessionListDataInput): UseSessionListDataResult {
  const [sessions, setSessions] = useState<SessionListItem[]>(
    dataClient ? [] : initialSessions
  );
  const [isLoadingSessions, setIsLoadingSessions] = useState(Boolean(dataClient));
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!dataClient) {
      return;
    }

    let isCancelled = false;

    setIsLoadingSessions(true);
    setLoadErrorMessage(null);

    dataClient
      .loadSessions({ showDeletedSessions })
      .then((loadedSessions) => {
        if (isCancelled) {
          return;
        }

        setSessions(loadedSessions);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }

        setLoadErrorMessage(error instanceof Error ? error.message : 'Unable to load sessions');
      })
      .finally(() => {
        if (isCancelled) {
          return;
        }

        setIsLoadingSessions(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [dataClient, showDeletedSessions, reloadToken]);

  const reloadSessions = async () => {
    if (!dataClient) {
      return;
    }

    setIsLoadingSessions(true);
    setLoadErrorMessage(null);

    try {
      const loadedSessions = await dataClient.loadSessions({ showDeletedSessions });
      setSessions(loadedSessions);
    } catch (error) {
      setLoadErrorMessage(error instanceof Error ? error.message : 'Unable to load sessions');
    } finally {
      setIsLoadingSessions(false);
    }
  };

  return {
    sessions,
    setSessions,
    isLoadingSessions,
    loadErrorMessage,
    reloadSessions,
  };
}
