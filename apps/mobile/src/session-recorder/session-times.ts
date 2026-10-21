import type { ExerciseDateFormat } from '@/src/preferences/model';
import { formatLocalDateTime, parseSessionDateTime } from '@/src/utils/local-time';

/**
 * A completed session's editable Start and End, as the recorder's completed
 * edit validated them: local date/time text, End not before Start. Pure;
 * the session view's summary card edits them and its autosave writes them only
 * while they are valid.
 */

export type SessionTimes = { startedAt: Date; completedAt: Date };

export type SessionTimesText = { start: string; end: string };

export type SessionTimesValidation = { start: string | null; end: string | null };

export const START_TIME_FORMAT_MESSAGE = 'Enter a valid Start time.';
export const END_TIME_FORMAT_MESSAGE = 'Enter a valid End time.';
export const END_BEFORE_START_MESSAGE = 'End time must be later than or equal to Start time.';
export const TIMES_AUTOSAVE_PAUSED_NOTICE = 'Autosave paused until Start/End times are valid.';

export const formatSessionTimes = (times: SessionTimes, dateFormat: ExerciseDateFormat = 'YYYY-MM-DD'): SessionTimesText => ({
  start: formatLocalDateTime(times.startedAt.getTime(), dateFormat),
  end: formatLocalDateTime(times.completedAt.getTime(), dateFormat),
});

/** Each field's message, or `null` when it is valid. */
export const validateSessionTimes = (text: SessionTimesText, dateFormat: ExerciseDateFormat = 'YYYY-MM-DD'): SessionTimesValidation => {
  const start = parseSessionDateTime(text.start, dateFormat);
  const end = parseSessionDateTime(text.end, dateFormat);
  return {
    start: start ? null : START_TIME_FORMAT_MESSAGE,
    end: !end ? END_TIME_FORMAT_MESSAGE : start && end.getTime() < start.getTime() ? END_BEFORE_START_MESSAGE : null,
  };
};

/**
 * The times to write, or `null` while either is invalid. A field still showing
 * its persisted value keeps the persisted instant, so opening and leaving a
 * session does not round its times to the minute — unless mixing a persisted
 * instant with an edited minute would put End before Start.
 */
export const resolveSessionTimes = (text: SessionTimesText, persisted: SessionTimes, dateFormat: ExerciseDateFormat = 'YYYY-MM-DD'): SessionTimes | null => {
  const validation = validateSessionTimes(text, dateFormat);
  if (validation.start || validation.end) return null;
  const startedAt = parseSessionDateTime(text.start, dateFormat) as Date;
  const completedAt = parseSessionDateTime(text.end, dateFormat) as Date;
  const shown = formatSessionTimes(persisted, dateFormat);
  const kept = {
    startedAt: text.start === shown.start ? persisted.startedAt : startedAt,
    completedAt: text.end === shown.end ? persisted.completedAt : completedAt,
  };
  return kept.completedAt.getTime() >= kept.startedAt.getTime() ? kept : { startedAt, completedAt };
};
