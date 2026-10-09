// Where Sessions opens when a history grid's week or day leads here (pure):
// the whole list, positioned at that week's heading or that day's newest
// session. Weeks and days are local, as [[session.history-weeks]] places each
// session.

import { localDateKey } from '@/src/utils/calendar-weeks';
import { localWeekWindow } from '@/src/utils/local-calendar';

import { sessionInstant, type HistoryWeekSection } from './history-weeks';

/** A local week (its Monday), and a day in it for a day jump; `YYYY-MM-DD`. */
export type HistoryJump = { weekKey: string; dayKey?: string };

/** A `SectionList` location: item 0 is the section's heading, item n its nth row. */
export type HistoryJumpLocation = { sectionIndex: number; itemIndex: number };

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
 * The opening position from `/sessions?week=` or `?day=`; a week is the one
 * holding the date. A malformed date, or both params at once, opens the list
 * at its top rather than guessing.
 */
export const parseHistoryJump = (params: { week?: RouteParam; day?: RouteParam }): HistoryJump | null => {
  const week = firstParam(params.week);
  const day = firstParam(params.day);
  if (week !== undefined && day !== undefined) return null;
  const date = parseLocalDateKey(week ?? day);
  if (!date) return null;
  const weekKey = localDateKey(localWeekWindow(date).start);
  return week !== undefined ? { weekKey } : { weekKey, dayKey: localDateKey(date) };
};

/**
 * Where the jump lands in the listed weeks: a week's heading, or the day's
 * newest row (rows run newest first), else its week's heading. A week with no
 * listed session has no location.
 */
export const historyJumpLocation = (
  sections: readonly HistoryWeekSection[],
  jump: HistoryJump,
): HistoryJumpLocation | null => {
  const sectionIndex = sections.findIndex((section) => section.key === jump.weekKey);
  if (sectionIndex < 0) return null;
  // A missing day (-1) lands on the heading (0).
  const row = jump.dayKey === undefined
    ? -1
    : sections[sectionIndex].data.findIndex((session) => localDateKey(sessionInstant(session)) === jump.dayKey);
  return { sectionIndex, itemIndex: row + 1 };
};

/** The list's own index of a location: each section counts its heading, its rows and a footer. */
export const historyJumpListIndex = (
  sections: readonly HistoryWeekSection[],
  location: HistoryJumpLocation,
): number =>
  sections.slice(0, location.sectionIndex).reduce((index, section) => index + section.data.length + 2, location.itemIndex);
