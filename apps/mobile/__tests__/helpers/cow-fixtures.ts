import type { CoWResultWire, CoWSummaryWire } from '@/src/groups/cow-wire';
import { competitionExercise } from './competition-fixtures';
import type { CoWStreamEvent, CoWStreamItemWire } from '@/src/groups/competition-wire';

export const cowResult = (): CoWResultWire => ({
  cow: { cow_id: 'cow1', group_id: 'g1', group_exercise_id: 'ge1', week_start: '2026-10-26', time_zone: 'Europe/London',
    starts_at_us: 1792972800000000, ends_at_us: 1793577600000000, metrics: ['e1rm', 'volume', 'improvement'], revision: 1, state: 'active' },
  exercise: competitionExercise, bodyweight_calculations_enabled: true, state: 'ready', normalized: true, publication_id: 'publication1',
  rankings: [
    { metric: 'e1rm', unit: 'percent_bw', entries: [{ rank: 1, member: { user_id: 'u1', username: 'Me' }, former: false, value: 150, state: 'ranked' }], entry_count: 1, next_cursor: null },
    { metric: 'volume', unit: 'percent_bw_reps', entries: [], entry_count: 1, next_cursor: null },
    { metric: 'improvement', unit: 'percent', entries: [], entry_count: 1, next_cursor: null },
  ],
});
export const cowSummary = (): CoWSummaryWire => ({ group_id: 'g1', week_start: '2026-10-26', calendar_revision: 1,
  observed_at_us: 1793404800000000, valid_until_us: 1793577600000000, selection: 'current', result: cowResult() });

export function cowStreamItem(event: CoWStreamEvent = 'scheduled'): CoWStreamItemWire {
  const result=cowResult();
  const { state: _state, ...cow }=result.cow;
  const definition={ ...cow,exercise_name: 'Bench press' };
  result.cow.state=event === 'unavailable' ? 'unavailable' : 'final';
  if (event === 'unavailable') { result.state='unavailable'; result.rankings.forEach(r => { r.entries=[]; }); }
  return { kind: 'cow',key: '00000000000000000001',sort_at_ms: cow.ends_at_us / 1000,event,definition,
    previous: event === 'updated' ? { ...definition,revision: 1,exercise_name: 'Squat',group_exercise_id: 'old' } : null,
    actor: { user_id: 'u1',username: 'Me' },result: event === 'results' || event === 'unavailable' ? result : null,
    ...(event === 'updated' ? { definition: { ...definition,revision: 2 } } : {}) };
}


/** Old group fixtures have no CoW and an explicit calendar; new feature tests override these reads. */
export const absentCoWSummary = (groupId: string): CoWSummaryWire => ({ group_id: groupId, week_start: null, calendar_revision: 1,
  observed_at_us: Math.max(1, Date.now() * 1000), valid_until_us: Math.max(1, Date.now() * 1000), selection: 'none', result: null });
export const coWReadMocks = () => ({
  getCoWSummary: jest.fn(async (groupId: string) => absentCoWSummary(groupId)),
  getPreviousCoWSummary: jest.fn(async (groupId: string) => absentCoWSummary(groupId)),
  getCoWCalendar: jest.fn(async () => ({ time_zone: 'UTC', revision: 1, next_week_start: '2026-11-02' })),
});

export const previousCowSummary = (): CoWSummaryWire => {
  const summary = cowSummary();
  const result = cowResult();
  result.cow = { ...result.cow, cow_id: 'previous-cow', week_start: '2026-10-19', state: 'final',
    starts_at_us: result.cow.starts_at_us - 7 * 86400000000, ends_at_us: result.cow.starts_at_us };
  return { ...summary, selection: 'previous', result };
};
