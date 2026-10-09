// Where a history grid's day or week leads, and where Sessions opens for
// `?week=` / `?day=`: the href builders and the jump into the listed weeks.

import {
  groupSessionsByWeek,
  historyJumpListIndex,
  historyJumpLocation,
  parseHistoryJump,
  type SessionListItem,
} from '@/components/session-list';
import { completedSessionHref, historyDayHref, sessionsDayHref, sessionsWeekHref } from '@/src/navigation/routes';

describe('history hrefs', () => {
  it('opens a day with one session on that session, several on Sessions at the day, and none nowhere', () => {
    expect(historyDayHref('2026-10-07', ['session-a'])).toBe('/completed-session/session-a');
    expect(historyDayHref('2026-10-07', ['session-a', 'session-b'])).toBe('/sessions?day=2026-10-07');
    expect(historyDayHref('2026-10-07', [])).toBeNull();
  });

  it('encodes what it carries', () => {
    expect(completedSessionHref('a/b c')).toBe('/completed-session/a%2Fb%20c');
    expect(sessionsWeekHref('2026-10-05')).toBe('/sessions?week=2026-10-05');
    expect(sessionsDayHref('2026-10-07')).toBe('/sessions?day=2026-10-07');
  });
});

describe('parseHistoryJump', () => {
  it('reads a week as the Monday of the local week holding the date', () => {
    expect(parseHistoryJump({ week: '2026-10-07' })).toEqual({ weekKey: '2026-10-05' });
    expect(parseHistoryJump({ week: '2026-10-05' })).toEqual({ weekKey: '2026-10-05' });
  });

  it('reads a day with its week', () => {
    expect(parseHistoryJump({ day: ['2026-10-11', 'ignored'] })).toEqual({ weekKey: '2026-10-05', dayKey: '2026-10-11' });
  });

  it.each([
    ['no param', {}],
    ['a date that does not exist', { day: '2026-02-30' }],
    ['a date that is not YYYY-MM-DD', { week: '7 Oct 2026' }],
    ['both params', { week: '2026-10-05', day: '2026-10-07' }],
  ])('opens at the top on %s', (_, params) => {
    expect(parseHistoryJump(params)).toBeNull();
  });
});

describe('historyJumpLocation', () => {
  const session = (id: string, completedAt: Date): SessionListItem => ({
    id, startedAt: completedAt.toISOString(), status: 'completed', completedAt: completedAt.toISOString(),
    durationSec: 3_600, durationDisplay: '1h', gymName: null, exerciseCount: 1, setCount: 3, totalWeight: 0,
    deletedAt: null, records: [],
  });
  // Newest first, as Sessions lists them; local wall-clock times.
  const sections = groupSessionsByWeek([
    session('mon-next', new Date(2026, 9, 12, 0, 0)),
    session('sun-late', new Date(2026, 9, 11, 23, 59)),
    session('wed-evening', new Date(2026, 9, 7, 19)),
    session('wed-morning', new Date(2026, 9, 7, 7)),
    session('mon-midnight', new Date(2026, 9, 5, 0, 0)),
    session('sep', new Date(2026, 8, 9, 12)),
  ], new Date(2026, 9, 14, 12));

  it('lands a week on its heading', () => {
    expect(historyJumpLocation(sections, { weekKey: '2026-10-05' })).toEqual({ sectionIndex: 1, itemIndex: 0 });
    expect(historyJumpLocation(sections, { weekKey: '2026-09-07' })).toEqual({ sectionIndex: 2, itemIndex: 0 });
  });

  it('lands a day on its newest row, by local completion day', () => {
    expect(historyJumpLocation(sections, { weekKey: '2026-10-05', dayKey: '2026-10-07' })).toEqual({ sectionIndex: 1, itemIndex: 2 });
    expect(historyJumpLocation(sections, { weekKey: '2026-10-05', dayKey: '2026-10-11' })).toEqual({ sectionIndex: 1, itemIndex: 1 });
    expect(historyJumpLocation(sections, { weekKey: '2026-10-05', dayKey: '2026-10-05' })).toEqual({ sectionIndex: 1, itemIndex: 4 });
  });

  it('lands a day without a listed row on its week heading, and a week without one nowhere', () => {
    expect(historyJumpLocation(sections, { weekKey: '2026-10-05', dayKey: '2026-10-06' })).toEqual({ sectionIndex: 1, itemIndex: 0 });
    expect(historyJumpLocation(sections, { weekKey: '2026-09-28' })).toBeNull();
  });

  it('counts each earlier week as its heading, its rows and a footer', () => {
    expect(historyJumpListIndex(sections, { sectionIndex: 0, itemIndex: 0 })).toBe(0);
    // Week 0 holds one row: heading, row, footer.
    expect(historyJumpListIndex(sections, { sectionIndex: 1, itemIndex: 2 })).toBe(5);
    // Week 1 holds four rows.
    expect(historyJumpListIndex(sections, { sectionIndex: 2, itemIndex: 0 })).toBe(9);
  });
});
