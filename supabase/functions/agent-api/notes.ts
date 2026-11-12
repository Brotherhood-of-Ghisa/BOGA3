// Training notes for the coach: `GET/POST /v1/agent/notes`,
// `POST /v1/agent/notes/{id}/remove`, and the note slices of exercise context
// and training status. Pure: the routes read owner-filtered rows and these
// rules parse the caller's input and project the rows. The app's own rules
// (`apps/mobile/src/data/training-notes.ts`) match: a trimmed body of 1–1000
// characters, a real `YYYY-MM-DD` date that is not in the future.
//
// The SQL writers (`agent_add_note`, `agent_remove_note` in
// supabase/migrations/20261112180000_training_notes.sql) trust this shape and
// re-check only what needs the database: the exercise and the note.
import { localDateKey } from '../../../apps/mobile/src/utils/calendar-weeks.ts';
import { zonedWallClock, type TrainingStatusWindow } from './training-status.ts';

export const NOTE_MAX_LENGTH = 1000;
export const DEFAULT_NOTE_LIMIT = 20;
export const MAX_NOTE_LIMIT = 50;
/** Notes embedded in one exercise's context and in the training status. */
export const EMBEDDED_NOTE_LIMIT = 20;
const MAX_ID_LENGTH = 200;
const MIN_YEAR = 1900;

export const NOTE_COLUMNS = 'id,exercise_definition_id,body,noted_on,source,created_at';

/** `app_public.training_notes` as the routes read it: live rows only. */
export type NoteRow = {
  id: string;
  exercise_definition_id: string | null;
  body: string;
  noted_on: string;
  source: string | null;
  created_at: number;
};

/** A caller's bad note input, range or cursor; the route answers it as `400`. */
export class NoteInputError extends Error {}

type JsonObject = Record<string, unknown>;

const fail = (message: string): never => {
  throw new NoteInputError(message);
};

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written `YYYY-MM-DD` (no Feb 30), from 1900. */
export const isNoteDate = (raw: unknown): raw is string => {
  if (typeof raw !== 'string') return false;
  const match = DATE_KEY.exec(raw);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < MIN_YEAR || month < 1 || month > 12) return false;
  return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
};

/** Today's `YYYY-MM-DD` in the profile's zone. */
export const noteToday = (now: Date, timeZone: string): string => localDateKey(zonedWallClock(now, timeZone));

/** The first day of the training status's 56 days: its general notes start here. */
export const statusNotesFrom = (window: TrainingStatusWindow): string => localDateKey(window.readStart);

const readDateParam = (raw: string | null, label: string): string | null => {
  if (raw === null || raw === '') return null;
  return isNoteDate(raw) ? raw : fail(`${label} must be a date written YYYY-MM-DD.`);
};

/** The optional `[from, to]` range on `noted_on`, both days included. */
export const parseNoteRange = (fromRaw: string | null, toRaw: string | null) => {
  const from = readDateParam(fromRaw, 'from');
  const to = readDateParam(toRaw, 'to');
  if (from !== null && to !== null && from > to) fail('from must not be after to.');
  return { from, to };
};

export const parseNoteExerciseFilter = (raw: string | null): string | null => {
  if (raw === null) return null;
  return raw.length >= 1 && raw.length <= MAX_ID_LENGTH ? raw : fail('exercise_id is invalid.');
};

/** The keyset position after a note: newest date first, then newest created, then id. */
export type NoteCursor = { noted_on: string; created_at: number; id: string };

export const noteCursorFrom = (value: JsonObject): NoteCursor => {
  const { noted_on: notedOn, created_at: createdAt, id } = value;
  if (
    !isNoteDate(notedOn) || typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt)
    || typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH
  ) {
    return fail('Cursor is invalid.');
  }
  return { noted_on: notedOn, created_at: createdAt, id };
};

export const noteCursorOf = (row: NoteRow): JsonObject =>
  ({ kind: 'note', noted_on: row.noted_on, created_at: row.created_at, id: row.id });

const quote = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** The PostgREST `or` filter for the rows after `cursor` in the list order. */
export const noteKeysetFilter = (cursor: NoteCursor): string => {
  const on = quote(cursor.noted_on);
  const id = quote(cursor.id);
  return `noted_on.lt.${on},and(noted_on.eq.${on},or(created_at.lt.${cursor.created_at},`
    + `and(created_at.eq.${cursor.created_at},id.lt.${id})))`;
};

/** A note as the coach reads it; `exercise_name` also for a deleted exercise, null for a general note. */
export const projectNote = (row: NoteRow, exerciseNames: ReadonlyMap<string, string>): JsonObject => ({
  id: row.id,
  body: row.body,
  noted_on: row.noted_on,
  source: row.source === 'agent' ? 'agent' : 'app',
  exercise_id: row.exercise_definition_id,
  exercise_name: row.exercise_definition_id === null ? null : exerciseNames.get(row.exercise_definition_id) ?? null,
  created_at: new Date(row.created_at).toISOString(),
});

export const noteExerciseIds = (rows: readonly NoteRow[]): string[] =>
  [...new Set(rows.flatMap((row) => (row.exercise_definition_id === null ? [] : [row.exercise_definition_id])))];

const ADD_KEYS = new Set(['body', 'noted_on', 'exercise_id']);

export type NoteAdd = {
  /** What the RPC stores. */
  note: { body: string; noted_on: string; exercise_id: string | null };
  /**
   * What the idempotency hash covers: the caller's input, with an omitted date
   * as null, so a retry after midnight still replays the first result.
   */
  hashed: { body: string; noted_on: string | null; exercise_id: string | null };
};

const readBody = (value: unknown): string => {
  if (typeof value !== 'string') return fail('body must be the note text.');
  const body = value.trim();
  if (body.length === 0) fail('body must not be blank.');
  if (body.length > NOTE_MAX_LENGTH) fail(`body must be at most ${NOTE_MAX_LENGTH} characters.`);
  return body;
};

const readExerciseId = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) {
    return fail('exercise_id must be an exercise id from search_exercises, or null for a general note.');
  }
  return value;
};

const readNotedOn = (value: unknown, today: string): string | null => {
  if (value === undefined || value === null) return null;
  if (!isNoteDate(value)) return fail('noted_on must be a real date written YYYY-MM-DD.');
  if (value > today) fail(`noted_on must not be after today (${today}) in the person’s time zone.`);
  return value;
};

/** The coach's new note, strictly parsed; `today` is the profile zone's. */
export const normalizeNoteAdd = (input: JsonObject, today: string): NoteAdd => {
  for (const key of Object.keys(input)) {
    if (!ADD_KEYS.has(key)) fail(`Unsupported field: ${key}`);
  }
  const body = readBody(input.body);
  const notedOn = readNotedOn(input.noted_on, today);
  const exerciseId = readExerciseId(input.exercise_id);
  return {
    note: { body, noted_on: notedOn ?? today, exercise_id: exerciseId },
    hashed: { body, noted_on: notedOn, exercise_id: exerciseId },
  };
};

/** The removal body is empty: the note id is in the path. */
export const normalizeNoteRemove = (input: JsonObject, noteId: string): { note_id: string } => {
  for (const key of Object.keys(input)) fail(`Unsupported field: ${key}`);
  if (noteId.length === 0 || noteId.length > MAX_ID_LENGTH) fail('note_id is invalid.');
  return { note_id: noteId };
};
