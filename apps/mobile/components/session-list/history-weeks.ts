// The completed history in calendar weeks (pure): [[session.history-weeks]],
// over [[comparison.window]]'s week, Monday 00:00 local.

import { formatWeekRange, weekDayLabel } from '@/components/today/progress-format';
import { localDateKey } from '@/src/utils/calendar-weeks';
import { localWeekWindow, type LocalWindow } from '@/src/utils/local-calendar';

import type { SessionListItem } from './types';

export type HistoryWeekSection = {
  /** The week's Monday, `YYYY-MM-DD`. */
  key: string;
  window: LocalWindow;
  /** Weeks back from this week: 0 is this week, 1 last week. */
  weeksAgo: number;
  /** Empty weeks between this week and the listed week above it (this week, for the first). */
  emptyWeeksBefore: number;
  /**
   * Sessions that count ([[set.eligibility]]: live, with a working set); a
   * deleted or warm-up-only row is listed, never counted.
   */
  sessionCount: number;
  data: SessionListItem[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Whole weeks between two Mondays; rounding absorbs a DST hour.
const weeksBetween = (later: Date, earlier: Date): number =>
  Math.round((later.getTime() - earlier.getTime()) / (7 * DAY_MS));

// A completed session sits in the week of its completion, as on Progress and
// Today; a row without one falls back to its start.
export const sessionInstant = (session: SessionListItem): Date =>
  new Date(session.completedAt ?? session.startedAt);

/**
 * Sessions (newest completion first) as one section per week that holds any,
 * newest first. Each section says how many empty weeks it follows.
 */
export const groupSessionsByWeek = (sessions: SessionListItem[], now: Date): HistoryWeekSection[] => {
  const thisWeek = localWeekWindow(now);
  const sections: HistoryWeekSection[] = [];
  for (const session of sessions) {
    const window = localWeekWindow(sessionInstant(session));
    const key = localDateKey(window.start);
    let section = sections.at(-1);
    if (section?.key !== key) {
      const weeksAgo = weeksBetween(thisWeek.start, window.start);
      const newerWeeksAgo = section ? section.weeksAgo : -1;
      section = {
        key,
        window,
        weeksAgo,
        emptyWeeksBefore: Math.max(0, weeksAgo - newerWeeksAgo - 1),
        sessionCount: 0,
        data: [],
      };
      sections.push(section);
    }
    section.data.push(session);
    if (session.deletedAt === null && session.setCount > 0) section.sessionCount += 1;
  }
  return sections;
};

/**
 * `Mon 15 – Sun 21 Sep`; a week across two months names both
 * (`Mon 29 Sep – Sun 5 Oct`). A week of another year adds it, to both ends
 * when the week spans two (`Mon 29 Dec 2025 – Sun 4 Jan 2026`).
 */
export const formatHistoryWeekRange = (window: LocalWindow, now: Date): string => {
  const sunday = new Date(window.end.getFullYear(), window.end.getMonth(), window.end.getDate() - 1);
  const startYear = window.start.getFullYear();
  const endYear = sunday.getFullYear();
  const acrossMonths = sunday.getMonth() !== window.start.getMonth();
  const start = weekDayLabel(window.start, acrossMonths);
  const end = weekDayLabel(sunday, true);
  if (startYear !== endYear) return `${start} ${startYear} – ${end} ${endYear}`;
  return endYear === now.getFullYear() ? `${start} – ${end}` : `${start} – ${end} ${endYear}`;
};

const formatSessionCount = (count: number): string => `${count} ${count === 1 ? 'session' : 'sessions'}`;

export type HistoryWeekHeading = { title: string; detail: string };

/**
 * `This week` / `Last week` with Today's range (`Mon 6 – Sun 12 · 2 sessions`);
 * an older week is its range, then its count (`1 session`).
 */
export const historyWeekHeading = (section: HistoryWeekSection, now: Date): HistoryWeekHeading => {
  const count = formatSessionCount(section.sessionCount);
  if (section.weeksAgo === 0 || section.weeksAgo === 1) {
    return {
      title: section.weeksAgo === 0 ? 'This week' : 'Last week',
      detail: `${formatWeekRange(section.window)} · ${count}`,
    };
  }
  return { title: formatHistoryWeekRange(section.window, now), detail: count };
};

/** `No sessions · 1 week`, `No sessions · 3 weeks`. */
export const formatEmptyWeeks = (weeks: number): string => `No sessions · ${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
