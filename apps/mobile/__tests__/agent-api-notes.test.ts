/**
 * Outcome: a coach can only add a note the app itself could save — a trimmed
 * body of 1–1000 characters and a real date that is not after the person's
 * today — and reads notes in the app's order (newest date, then newest
 * created), paged by a cursor that resumes exactly after the last note.
 *
 * The Edge Function (`supabase/functions/agent-api`) applies these pure rules
 * before any database call; the backend `agent-api` lane proves the SQL
 * writers, replay, permission and ownership.
 */

import {
  isNoteDate,
  NOTE_MAX_LENGTH,
  NoteInputError,
  normalizeNoteAdd,
  normalizeNoteRemove,
  noteCursorFrom,
  noteCursorOf,
  noteExerciseIds,
  noteKeysetFilter,
  noteToday,
  parseNoteExerciseFilter,
  parseNoteRange,
  projectNote,
  statusNotesFrom,
  type NoteRow,
} from '../../../supabase/functions/agent-api/notes.ts';
import { trainingStatusWindow } from '../../../supabase/functions/agent-api/training-status.ts';
import { validateTrainingNoteInput } from '../src/data/training-notes';

const rejection = (read: () => unknown): string => {
  try {
    read();
  } catch (error) {
    if (error instanceof NoteInputError) return error.message;
    throw error;
  }
  throw new Error('expected a NoteInputError');
};

const TODAY = '2026-11-12';

const row = (overrides: Partial<NoteRow> = {}): NoteRow => ({
  id: 'note-1',
  exercise_definition_id: null,
  body: 'Squat to a bench from today',
  noted_on: '2026-11-10',
  source: 'app',
  created_at: Date.UTC(2026, 10, 10, 9, 30),
  ...overrides,
});

describe('isNoteDate', () => {
  it.each(['2026-11-12', '2024-02-29', '1900-01-01'])('accepts the real date %s', (date) => {
    expect(isNoteDate(date)).toBe(true);
  });

  it.each(['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-11-00', '2026-11-1', '1899-12-31',
    '2026-11-12T00:00:00Z', ' 2026-11-12', '', 20261112, null])('rejects %p', (date) => {
    expect(isNoteDate(date)).toBe(false);
  });
});

describe('noteToday and statusNotesFrom', () => {
  it('reads today in the profile zone, not the runtime’s', () => {
    const instant = new Date('2026-11-12T23:30:00Z');
    expect(noteToday(instant, 'UTC')).toBe('2026-11-12');
    expect(noteToday(instant, 'Pacific/Auckland')).toBe('2026-11-13');
    expect(noteToday(instant, 'America/Los_Angeles')).toBe('2026-11-12');
  });

  it('starts the status notes 55 days before today, so the window holds 56 days', () => {
    expect(statusNotesFrom(trainingStatusWindow(new Date('2026-11-12T12:00:00Z'), 'UTC'))).toBe('2026-09-18');
    expect(statusNotesFrom(trainingStatusWindow(new Date('2026-11-12T23:30:00Z'), 'Pacific/Auckland'))).toBe('2026-09-19');
  });
});

describe('normalizeNoteAdd', () => {
  it('trims the body, keeps inner line breaks and the exercise, and stores the given date', () => {
    expect(normalizeNoteAdd({ body: '  Bench touch\nfrom now  ', noted_on: '2026-11-01', exercise_id: 'squat' }, TODAY))
      .toEqual({
        note: { body: 'Bench touch\nfrom now', noted_on: '2026-11-01', exercise_id: 'squat' },
        hashed: { body: 'Bench touch\nfrom now', noted_on: '2026-11-01', exercise_id: 'squat' },
      });
  });

  it('defaults the date to today but hashes the omitted date as null, so a later retry still replays', () => {
    expect(normalizeNoteAdd({ body: 'Shoulder sore' }, TODAY)).toEqual({
      note: { body: 'Shoulder sore', noted_on: TODAY, exercise_id: null },
      hashed: { body: 'Shoulder sore', noted_on: null, exercise_id: null },
    });
    expect(normalizeNoteAdd({ body: 'Shoulder sore', noted_on: null, exercise_id: null }, '2026-11-13').hashed)
      .toEqual(normalizeNoteAdd({ body: 'Shoulder sore' }, TODAY).hashed);
  });

  it('accepts today and the full length, as the app does', () => {
    const body = 'x'.repeat(NOTE_MAX_LENGTH);
    expect(normalizeNoteAdd({ body, noted_on: TODAY }, TODAY).note.body).toHaveLength(NOTE_MAX_LENGTH);
    expect(() => validateTrainingNoteInput({ body, notedOn: TODAY }, new Date(2026, 10, 12, 12))).not.toThrow();
  });

  it.each([
    [{ body: '   ' }, /blank/],
    [{ body: 'x'.repeat(NOTE_MAX_LENGTH + 1) }, /at most 1000/],
    [{ body: 42 }, /note text/],
    [{}, /note text/],
    [{ body: 'ok', noted_on: '2026-11-13' }, /not be after today \(2026-11-12\)/],
    [{ body: 'ok', noted_on: '2026-02-30' }, /real date/],
    [{ body: 'ok', noted_on: '12/11/2026' }, /real date/],
    [{ body: 'ok', exercise_id: '' }, /exercise_id/],
    [{ body: 'ok', exercise_id: 7 }, /exercise_id/],
    [{ body: 'ok', exercise_id: 'x'.repeat(201) }, /exercise_id/],
    [{ body: 'ok', source: 'agent' }, /Unsupported field: source/],
    [{ body: 'ok', id: 'note-mine' }, /Unsupported field: id/],
  ])('rejects %j', (input, message) => {
    expect(rejection(() => normalizeNoteAdd(input as Record<string, unknown>, TODAY))).toMatch(message);
  });
});

describe('normalizeNoteRemove', () => {
  it('takes the id from the path and an empty body', () => {
    expect(normalizeNoteRemove({}, 'note-1')).toEqual({ note_id: 'note-1' });
  });

  it('rejects any body field and a blank or overlong id', () => {
    expect(rejection(() => normalizeNoteRemove({ note_id: 'other' }, 'note-1'))).toMatch(/Unsupported field: note_id/);
    expect(rejection(() => normalizeNoteRemove({}, ''))).toMatch(/note_id/);
    expect(rejection(() => normalizeNoteRemove({}, 'x'.repeat(201)))).toMatch(/note_id/);
  });
});

describe('list filters', () => {
  it('reads an inclusive date range and allows either end alone', () => {
    expect(parseNoteRange('2026-10-01', '2026-10-31')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(parseNoteRange('2026-10-01', '2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-10-01' });
    expect(parseNoteRange(null, '')).toEqual({ from: null, to: null });
  });

  it('rejects a reversed range and instants', () => {
    expect(rejection(() => parseNoteRange('2026-10-31', '2026-10-01'))).toMatch(/from must not be after to/);
    expect(rejection(() => parseNoteRange('2026-10-01T00:00:00Z', null))).toMatch(/from must be a date/);
    expect(rejection(() => parseNoteRange(null, '2026-02-30'))).toMatch(/to must be a date/);
  });

  it('bounds the exercise filter', () => {
    expect(parseNoteExerciseFilter(null)).toBeNull();
    expect(parseNoteExerciseFilter('squat')).toBe('squat');
    expect(rejection(() => parseNoteExerciseFilter(''))).toMatch(/exercise_id/);
  });
});

describe('note cursor', () => {
  it('round-trips the last note’s position', () => {
    const last = row({ id: 'note-9', noted_on: '2026-10-05', created_at: 1_760_000_000_000 });
    const { kind, ...position } = noteCursorOf(last);
    expect(kind).toBe('note');
    expect(noteCursorFrom(position)).toEqual({ noted_on: '2026-10-05', created_at: 1_760_000_000_000, id: 'note-9' });
  });

  it.each([
    [{ noted_on: '2026-02-30', created_at: 1, id: 'a' }],
    [{ noted_on: '2026-10-05', created_at: '1', id: 'a' }],
    [{ noted_on: '2026-10-05', created_at: 1.5, id: 'a' }],
    [{ noted_on: '2026-10-05', created_at: 1, id: '' }],
    [{ noted_on: '2026-10-05', created_at: 1 }],
  ])('rejects the tampered cursor %j', (value) => {
    expect(rejection(() => noteCursorFrom(value))).toBe('Cursor is invalid.');
  });

  it('continues after the cursor in date, creation, id order, quoting ids', () => {
    expect(noteKeysetFilter({ noted_on: '2026-10-05', created_at: 17, id: 'a"b' })).toBe(
      'noted_on.lt."2026-10-05",and(noted_on.eq."2026-10-05",or(created_at.lt.17,and(created_at.eq.17,id.lt."a\\"b")))',
    );
  });
});

describe('projectNote', () => {
  it('names the exercise from the lookup, including a deleted one, and dates creation in ISO', () => {
    const names = new Map([['squat', 'Back Squat (deleted)']]);
    expect(projectNote(row({ exercise_definition_id: 'squat', source: 'agent' }), names)).toEqual({
      id: 'note-1',
      body: 'Squat to a bench from today',
      noted_on: '2026-11-10',
      source: 'agent',
      exercise_id: 'squat',
      exercise_name: 'Back Squat (deleted)',
      created_at: '2026-11-10T09:30:00.000Z',
    });
  });

  it('gives a general note no exercise name and reads an unknown source as the app', () => {
    expect(projectNote(row({ source: null }), new Map())).toMatchObject({
      exercise_id: null, exercise_name: null, source: 'app',
    });
  });

  it('collects each referenced exercise once', () => {
    expect(noteExerciseIds([
      row({ exercise_definition_id: 'a' }), row({ exercise_definition_id: null }), row({ exercise_definition_id: 'a' }),
      row({ exercise_definition_id: 'b' }),
    ])).toEqual(['a', 'b']);
  });
});
