import { formatSessionListCompactDuration } from '@/src/data';

export type SessionListItem = {
  id: string;
  startedAt: string;
  status: 'active' | 'completed';
  completedAt: string | null;
  durationSec: number | null;
  durationDisplay: string;
  gymName: string | null;
  exerciseCount: number;
  setCount: number;
  totalWeight: number;
  deletedAt: string | null;
};

export type SessionListDataClient = {
  loadSessions(input: { showDeletedSessions: boolean }): Promise<SessionListItem[]>;
  startSession(): Promise<void>;
  completeActiveSession(sessionId: string): Promise<void>;
  discardActiveSession(sessionId: string): Promise<void>;
  setCompletedSessionDeletedState(sessionId: string, isDeleted: boolean): Promise<void>;
  appendCompletedSessionAsPlanned(sessionId: string): Promise<void>;
};

export const DEFAULT_SESSION_LIST_ITEMS: SessionListItem[] = [
  {
    id: 'session-active-1',
    startedAt: '2026-02-20T17:30:00.000Z',
    status: 'active',
    completedAt: null,
    durationSec: 2700,
    durationDisplay: '45m',
    gymName: 'Westside Barbell Club',
    exerciseCount: 4,
    setCount: 14,
    totalWeight: 6125,
    deletedAt: null,
  },
  {
    id: 'session-completed-1',
    startedAt: '2026-02-19T16:00:00.000Z',
    status: 'completed',
    completedAt: '2026-02-19T16:58:00.000Z',
    durationSec: 3480,
    durationDisplay: '58m',
    gymName: 'Westside Barbell Club',
    exerciseCount: 5,
    setCount: 18,
    totalWeight: 9420,
    deletedAt: null,
  },
  {
    id: 'session-completed-2',
    startedAt: '2026-02-17T18:10:00.000Z',
    status: 'completed',
    completedAt: '2026-02-17T19:15:00.000Z',
    durationSec: 3900,
    durationDisplay: '1h 5m',
    gymName: 'Downtown Fitness',
    exerciseCount: 4,
    setCount: 16,
    totalWeight: 7840,
    deletedAt: '2026-02-18T08:00:00.000Z',
  },
];

export const formatCompactDuration = formatSessionListCompactDuration;
