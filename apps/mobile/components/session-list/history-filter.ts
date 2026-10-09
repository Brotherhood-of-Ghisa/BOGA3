// Sessions opened on one week or one day of the completed history (pure): a
// history grid's week or day leads here. The window is local time, as
// [[session.history-weeks]] places each session.

import { weekDayLabel } from '@/components/today/progress-format';
import { isInWindow, localWeekWindow, startOfLocalDay, type LocalWindow } from '@/src/utils/local-calendar';

import { formatHistoryWeekRange, sessionInstant } from './history-weeks';
import type { SessionListItem } from './types';

export type HistoryFilter = {
  kind: 'week' | 'day';
  window: LocalWindow;
};

type RouteParam = string | string[] | undefined;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

const firstParam = (value: RouteParam): string | undefined => (Array.isArray(value) ? value[0] : value);

/** Local 00:00 of a real calendar date `YYYY-MM-DD`; anything else is null. */
const parseLocalDateKey = (value: string | undefined): Date | null => {
  const match = value ? DATE_KEY.exec(value) : null;
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
};

/**
 * The opening filter from `/sessions?week=` or `?day=`. The week is the one
 * holding the date. A malformed date, or both params at once, opens the whole
 * list rather than guessing.
 */
export const parseHistoryFilter = (params: { week?: RouteParam; day?: RouteParam }): HistoryFilter | null => {
  const week = firstParam(params.week);
  const day = firstParam(params.day);
  if (week !== undefined && day !== undefined) return null;
  const date = parseLocalDateKey(week ?? day);
  if (!date) return null;
  return week !== undefined
    ? { kind: 'week', window: localWeekWindow(date) }
    : { kind: 'day', window: { start: date, end: startOfLocalDay(date, 1) } };
};

/** The filtered page's title: the week's range, or the day (`Wed 7 Oct`), with the year when not this one. */
export const historyFilterTitle = (filter: HistoryFilter, now: Date): string => {
  if (filter.kind === 'week') return formatHistoryWeekRange(filter.window, now);
  const day = weekDayLabel(filter.window.start, true);
  return filter.window.start.getFullYear() === now.getFullYear() ? day : `${day} ${filter.window.start.getFullYear()}`;
};

/** The sessions inside the filter's window, placed as the week grouping places them. */
export const sessionsInHistoryFilter = (sessions: SessionListItem[], filter: HistoryFilter): SessionListItem[] =>
  sessions.filter((session) => isInWindow(sessionInstant(session), filter.window));
