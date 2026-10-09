// Where a history grid's day or week leads, and how Sessions reads that
// opening selection back: the href builders and the `?week=` / `?day=` filter.

import { historyFilterTitle, parseHistoryFilter } from '@/components/session-list';
import { completedSessionHref, historyDayHref, sessionsDayHref, sessionsWeekHref } from '@/src/navigation/routes';

describe('history hrefs', () => {
  it('opens a day with one session on that session, several on Sessions for the day, and none nowhere', () => {
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

describe('parseHistoryFilter', () => {
  it('reads a week as the local Monday-start week holding the date', () => {
    expect(parseHistoryFilter({ week: '2026-10-07' })).toEqual({
      kind: 'week',
      window: { start: new Date(2026, 9, 5), end: new Date(2026, 9, 12) },
    });
  });

  it('reads a day as its local midnight to the next', () => {
    expect(parseHistoryFilter({ day: ['2026-10-07', 'ignored'] })).toEqual({
      kind: 'day',
      window: { start: new Date(2026, 9, 7), end: new Date(2026, 9, 8) },
    });
  });

  it.each([
    ['no param', {}],
    ['a date that does not exist', { day: '2026-02-30' }],
    ['a date that is not YYYY-MM-DD', { week: '7 Oct 2026' }],
    ['both params', { week: '2026-10-05', day: '2026-10-07' }],
  ])('opens the whole list on %s', (_, params) => {
    expect(parseHistoryFilter(params)).toBeNull();
  });
});

describe('historyFilterTitle', () => {
  const now = new Date(2026, 9, 8, 12);

  it('names a week by its range, as a history week heading does', () => {
    expect(historyFilterTitle(parseHistoryFilter({ week: '2026-10-07' })!, now)).toBe('Mon 5 – Sun 11 Oct');
    expect(historyFilterTitle(parseHistoryFilter({ week: '2025-12-31' })!, now)).toBe('Mon 29 Dec 2025 – Sun 4 Jan 2026');
  });

  it('names a day, with its year when not this one', () => {
    expect(historyFilterTitle(parseHistoryFilter({ day: '2026-10-07' })!, now)).toBe('Wed 7 Oct');
    expect(historyFilterTitle(parseHistoryFilter({ day: '2025-10-15' })!, now)).toBe('Wed 15 Oct 2025');
  });
});
