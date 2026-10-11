/**
 * Sessions' PR lines: one record read over the span of the listed
 * completions, each fact attached to its own session. The store is injected
 * (a pure decision rule); the real read is covered by the Sessions screen test.
 */

import { attachSessionRecords, type SessionListItem } from '@/components/session-list';
import type { PersonalRecordFact } from '@/src/progress-summary';

const item = (id: string, completedAt: string | null): SessionListItem => ({
  id,
  startedAt: '2026-10-01T08:00:00.000Z',
  status: completedAt ? 'completed' : 'active',
  completedAt,
  durationSec: 3_600,
  durationDisplay: '1h',
  gymName: null,
  exerciseCount: 1,
  setCount: 3,
  totalWeight: 0,
  deletedAt: null,
  records: [],
});

const fact = (sessionId: string, exerciseName: string): PersonalRecordFact => ({
  sessionId,
  achievedAt: new Date('2026-10-02T09:00:00.000Z'),
  kind: 'oneRepMax',
  exerciseName,
  value: 100,
  reps: null,
});

it('reads once from the oldest completion to just past the newest, and attaches each fact to its session', async () => {
  const loadRecordFacts = jest.fn(async () => [fact('newest', 'Bench Press'), fact('newest', 'Squat'), fact('oldest', 'Deadlift')]);
  const sessions = [
    item('newest', '2026-10-07T18:00:00.000Z'),
    item('middle', '2026-10-03T18:00:00.000Z'),
    item('oldest', '2026-09-01T18:00:00.000Z'),
  ];

  const withRecords = await attachSessionRecords(sessions, { loadRecordFacts });

  expect(loadRecordFacts).toHaveBeenCalledTimes(1);
  expect(loadRecordFacts).toHaveBeenCalledWith({
    start: new Date('2026-09-01T18:00:00.000Z'),
    end: new Date(Date.parse('2026-10-07T18:00:00.000Z') + 1),
  });
  expect(withRecords.map((session) => session.records.map((record) => record.exerciseName))).toEqual([
    ['Bench Press', 'Squat'],
    [],
    ['Deadlift'],
  ]);
  // The placement fields stay with the read.
  expect(withRecords[0].records[0]).toEqual({ kind: 'oneRepMax', exerciseName: 'Bench Press', value: 100, reps: null });
});

it('reads nothing when no listed session has completed', async () => {
  const loadRecordFacts = jest.fn(async () => []);
  const sessions = [item('active', null)];

  expect(await attachSessionRecords(sessions, { loadRecordFacts })).toBe(sessions);
  expect(loadRecordFacts).not.toHaveBeenCalled();
});
