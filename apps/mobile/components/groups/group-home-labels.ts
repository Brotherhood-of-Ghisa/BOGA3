import { formatWeekRange, monthName, shortMonthName } from '@/components/today/progress-format';
import type { GroupHomePeriod } from '@/src/groups/home-periods';
import type { LocalWindow } from '@/src/utils/local-calendar';

/** The stepper's two lines: the period's name, then the dates it covers. */
export type GroupHomePeriodLabel = { title: string; detail: string };

const RELATIVE_WEEK = ['This week', 'Last week'] as const;
const RELATIVE_MONTH = ['This month', 'Last month'] as const;

const monthDetail = (window: LocalWindow): string => `${monthName(window.start)} ${window.start.getFullYear()}`;

/**
 * `This week` / `Last week` / the week's own dates, and underneath what the
 * title leaves unsaid: the dates for a named week, the month and year for a
 * week already titled by its dates. Months name themselves (`October 2026`).
 */
export const groupHomePeriodLabel = (period: GroupHomePeriod, window: LocalWindow, offset: number): GroupHomePeriodLabel => {
  const relative = period === 'week' ? RELATIVE_WEEK[-offset] : RELATIVE_MONTH[-offset];
  if (period === 'month') {
    return { title: relative ?? monthName(window.start), detail: monthDetail(window) };
  }
  return relative
    ? { title: relative, detail: formatWeekRange(window) }
    : { title: formatWeekRange(window), detail: monthDetail(window) };
};

/** A chart column: `5 Oct` for a week (its Monday), `Oct` for a month. */
export const groupHomeColumnLabel = (period: GroupHomePeriod, window: LocalWindow): string =>
  period === 'week'
    ? `${window.start.getDate()} ${shortMonthName(window.start)}`
    : shortMonthName(window.start);
