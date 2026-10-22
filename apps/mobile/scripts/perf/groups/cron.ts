// How often a pg_cron job runs per hour, from its schedule. Supports the two
// forms pg_cron accepts: '<n> seconds' and a five-field cron expression.

const SECONDS = /^(\d+)\s+seconds?$/;

const fieldCount = (field: string, size: number, offset: number): number => {
  let count = 0;
  for (let value = offset; value < size + offset; value += 1) {
    if (matchesField(field, value)) count += 1;
  }
  return count;
};

const matchesPart = (part: string, value: number): boolean => {
  const [range, stepText] = part.split('/');
  const step = stepText === undefined ? 1 : Number(stepText);
  if (!Number.isInteger(step) || step < 1) throw new Error(`unsupported cron step: ${part}`);
  if (range === '*') return value % step === 0;
  const [startText, endText] = range.split('-');
  const start = Number(startText);
  const end = endText === undefined ? (stepText === undefined ? start : Number.MAX_SAFE_INTEGER) : Number(endText);
  if (!Number.isInteger(start) || Number.isNaN(end)) throw new Error(`unsupported cron field: ${part}`);
  return value >= start && value <= end && (value - start) % step === 0;
};

const matchesField = (field: string, value: number): boolean => field.split(',').some((part) => matchesPart(part, value));

/**
 * Average runs per hour. Day-of-month, month and day-of-week restrictions are
 * averaged over a week (a weekly job runs 1/168 per hour); a restricted
 * day-of-month or month is not modelled and throws.
 */
export const runsPerHour = (schedule: string): number => {
  const trimmed = schedule.trim();
  const seconds = SECONDS.exec(trimmed);
  if (seconds) return 3600 / Number(seconds[1]);
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) throw new Error(`unsupported cron schedule: ${schedule}`);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (dayOfMonth !== '*' || month !== '*') throw new Error(`unsupported cron schedule: ${schedule}`);
  const minutes = fieldCount(minute, 60, 0);
  const hours = fieldCount(hour, 24, 0);
  const days = dayOfWeek === '*' ? 7 : fieldCount(dayOfWeek.replace(/\b7\b/g, '0'), 7, 0);
  return (minutes * hours * days) / (24 * 7);
};

/** Minutes past the hour a schedule fires in: every minute for '<n> seconds', else the minute field's matches. */
export const cronMinutes = (schedule: string): number[] => {
  const trimmed = schedule.trim();
  const all = Array.from({ length: 60 }, (_, minute) => minute);
  if (SECONDS.test(trimmed)) return all;
  const [minute] = trimmed.split(/\s+/);
  return all.filter((value) => matchesField(minute, value));
};
