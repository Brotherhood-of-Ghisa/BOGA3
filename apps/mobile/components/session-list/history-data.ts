import { useCallback, useEffect, useRef, useState } from 'react';

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
  isFocused: boolean;
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
  isFocused,
}: UseSessionListDataInput): UseSessionListDataResult {
  const [sessions, setSessions] = useState<SessionListItem[]>(
    dataClient ? [] : initialSessions
  );
  const [isLoadingSessions, setIsLoadingSessions] = useState(
    Boolean(dataClient && isFocused)
  );
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const isMountedRef = useRef(true);
  const showDeletedSessionsRef = useRef(showDeletedSessions);

  showDeletedSessionsRef.current = showDeletedSessions;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, []);

  const reloadSessions = useCallback(async () => {
    if (!dataClient) {
      return;
    }

    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;

    if (isMountedRef.current) {
      setIsLoadingSessions(true);
      setLoadErrorMessage(null);
    }

    try {
      const loadedSessions = await dataClient.loadSessions({
        showDeletedSessions: showDeletedSessionsRef.current,
      });
      if (!isMountedRef.current || requestGenerationRef.current !== requestGeneration) {
        return;
      }
      setSessions(loadedSessions);
    } catch (error) {
      if (!isMountedRef.current || requestGenerationRef.current !== requestGeneration) {
        return;
      }
      setLoadErrorMessage(error instanceof Error ? error.message : 'Unable to load sessions');
    } finally {
      if (isMountedRef.current && requestGenerationRef.current === requestGeneration) {
        setIsLoadingSessions(false);
      }
    }
  }, [dataClient]);

  useEffect(() => {
    if (!dataClient || !isFocused) {
      return;
    }

    void reloadSessions();

    return () => {
      requestGenerationRef.current += 1;
    };
  }, [dataClient, isFocused, reloadSessions, showDeletedSessions]);

  return {
    sessions,
    setSessions,
    isLoadingSessions,
    loadErrorMessage,
    reloadSessions,
  };
}
