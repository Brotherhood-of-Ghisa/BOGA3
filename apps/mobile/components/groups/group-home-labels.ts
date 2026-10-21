import { formatShortDate, formatMonthYear } from '@/src/utils/local-time';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import { formatWeekRange } from '@/components/today/progress-format';
import type { GroupHomePeriod } from '@/src/groups/home-periods';
import type { LocalWindow } from '@/src/utils/local-calendar';

/** The stepper's two lines: the period's name, then the dates it covers. */
export type GroupHomePeriodLabel = { title: string; detail: string };

const RELATIVE_WEEK = ['This week', 'Last week'] as const;

const monthDetail = (window: LocalWindow): string => formatMonthYear(window.start);

/**
 * `This week` / `Last week` / the week's own dates, and underneath what the
 * title leaves unsaid: the dates for a named week, the month and year for a
 * week already titled by its dates.
 */
export const groupHomePeriodLabel = (_period: GroupHomePeriod, window: LocalWindow, offset: number, dateFormat: ExerciseDateFormat): GroupHomePeriodLabel => {
  const relative = RELATIVE_WEEK[-offset];
  return relative
    ? { title: relative, detail: formatWeekRange(window, dateFormat) }
    : { title: formatWeekRange(window, dateFormat), detail: monthDetail(window) };
};

/** A chart column names its Monday. */
export const groupHomeColumnLabel = (_period: GroupHomePeriod, window: LocalWindow, dateFormat: ExerciseDateFormat): string =>
  formatShortDate(window.start, dateFormat);
