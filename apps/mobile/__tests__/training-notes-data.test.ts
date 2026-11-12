import { eq } from 'drizzle-orm';

import { __resetClockForTests, type Transaction } from '@/src/data/clock';
import { exerciseDefinitions, trainingNotes } from '@/src/data/schema';
import {
  addTrainingNote,
  listTrainingNotes,
  parseLocalDateKey,
  removeTrainingNote,
  toLocalDateKey,
  TRAINING_NOTE_MAX_LENGTH,
} from '@/src/data/training-notes';
import { applyPullPage, entityToWire } from '@/src/sync/cycle';
import { notifyLocalWrite } from '@/src/sync/write-nudge';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockFixture.database }));
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));
jest.mock('@/src/logging/logEvent', () => ({ logEvent: jest.fn() }));

const NOW = new Date(2026, 10, 12, 18, 30);

beforeEach(() => {
  __resetClockForTests();
  jest.mocked(notifyLocalWrite).mockClear();
  mockFixture = createInMemoryDatabase({ foreignKeys: true });
  mockFixture.database.insert(exerciseDefinitions).values([
    { id: 'squat', name: 'Back Squat' },
    { id: 'bench', name: 'Bench Press' },
  ]).run();
});
afterEach(() => mockFixture.close());

const rawNote = (id: string) =>
  mockFixture.database.select().from(trainingNotes).where(eq(trainingNotes.id, id)).get();

describe('local date keys', () => {
  it('formats the local calendar date and rejects impossible dates', () => {
    expect(toLocalDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(parseLocalDateKey('2026-02-28')?.getDate()).toBe(28);
    expect(parseLocalDateKey('2026-02-30')).toBeNull();
    expect(parseLocalDateKey('2026-2-3')).toBeNull();
  });
});

describe('addTrainingNote', () => {
  it('stores a trimmed, dirty app note on an exercise and nudges sync', async () => {
    const note = await addTrainingNote({ body: '  From today I squat to a bench  ', notedOn: '2026-11-12', exerciseId: 'squat', now: NOW });
    expect(note).toMatchObject({
      body: 'From today I squat to a bench', notedOn: '2026-11-12', source: 'app',
      exerciseId: 'squat', exerciseName: 'Back Squat',
    });
    expect(rawNote(note.id)).toMatchObject({ localDirty: true, deletedAt: null, source: 'app' });
    expect(notifyLocalWrite).toHaveBeenCalledTimes(1);
  });

  it('stores a general note with no exercise', async () => {
    const note = await addTrainingNote({ body: 'Right shoulder: no pressing', notedOn: '2026-11-01', now: NOW });
    expect(note).toMatchObject({ exerciseId: null, exerciseName: null });
  });

  it.each([
    ['an empty body', { body: '   ', notedOn: '2026-11-12' }, 'Write a note first.'],
    ['an overlong body', { body: 'x'.repeat(TRAINING_NOTE_MAX_LENGTH + 1), notedOn: '2026-11-12' }, 'Keep the note to 1000 characters.'],
    ['an impossible date', { body: 'ok', notedOn: '2026-11-31' }, 'Choose a valid date.'],
    ['a future date', { body: 'ok', notedOn: '2026-11-13' }, 'The date cannot be in the future.'],
    ['an unknown exercise', { body: 'ok', notedOn: '2026-11-12', exerciseId: 'gone' }, 'This exercise is no longer available.'],
  ])('rejects %s without writing', async (_label, input, message) => {
    await expect(addTrainingNote({ ...input, now: NOW })).rejects.toThrow(message);
    expect(mockFixture.database.select().from(trainingNotes).all()).toHaveLength(0);
  });

  it('accepts exactly the longest body', async () => {
    await expect(addTrainingNote({ body: 'x'.repeat(TRAINING_NOTE_MAX_LENGTH), notedOn: '2026-11-12', now: NOW }))
      .resolves.toMatchObject({ notedOn: '2026-11-12' });
  });
});

describe('listTrainingNotes', () => {
  it('orders by applies-from date, newest first, then newest created; filters one exercise', async () => {
    const older = await addTrainingNote({ body: 'older date', notedOn: '2026-10-01', exerciseId: 'squat', now: NOW });
    const first = await addTrainingNote({ body: 'same day, first', notedOn: '2026-11-10', now: new Date(2026, 10, 12, 9) });
    const second = await addTrainingNote({ body: 'same day, second', notedOn: '2026-11-10', exerciseId: 'bench', now: NOW });
    expect((await listTrainingNotes()).map(note => note.id)).toEqual([second.id, first.id, older.id]);
    expect((await listTrainingNotes({ exerciseId: 'squat' })).map(note => note.id)).toEqual([older.id]);
  });

  it('keeps a deleted exercise’s notes, shown with its name', async () => {
    const note = await addTrainingNote({ body: 'bench touch', notedOn: '2026-11-12', exerciseId: 'squat', now: NOW });
    mockFixture.database.update(exerciseDefinitions).set({ deletedAt: NOW }).where(eq(exerciseDefinitions.id, 'squat')).run();
    expect(await listTrainingNotes()).toEqual([expect.objectContaining({ id: note.id, exerciseName: 'Back Squat' })]);
  });
});

describe('removeTrainingNote', () => {
  it('soft-deletes: the row stays, dirty, and leaves every list', async () => {
    const note = await addTrainingNote({ body: 'temporary', notedOn: '2026-11-12', exerciseId: 'squat', now: NOW });
    jest.mocked(notifyLocalWrite).mockClear();
    await removeTrainingNote(note.id, NOW);
    expect(rawNote(note.id)).toMatchObject({ body: 'temporary', localDirty: true, deletedAt: NOW });
    expect(await listTrainingNotes()).toEqual([]);
    expect(await listTrainingNotes({ exerciseId: 'squat' })).toEqual([]);
    expect(notifyLocalWrite).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for a removed or unknown note', async () => {
    const note = await addTrainingNote({ body: 'temporary', notedOn: '2026-11-12', now: NOW });
    await removeTrainingNote(note.id, NOW);
    const removed = rawNote(note.id);
    jest.mocked(notifyLocalWrite).mockClear();
    await removeTrainingNote(note.id, new Date(NOW.getTime() + 1000));
    await removeTrainingNote('missing', NOW);
    expect(rawNote(note.id)).toEqual(removed);
    expect(notifyLocalWrite).not.toHaveBeenCalled();
  });
});

describe('sync', () => {
  it('round-trips a note through the wire and shows a pulled agent note', async () => {
    const note = await addTrainingNote({ body: 'pushed', notedOn: '2026-11-12', exerciseId: 'bench', now: NOW });
    const wire = entityToWire(rawNote(note.id) as Record<string, unknown>, 'training_notes');
    expect(wire.fields).toEqual({
      exercise_definition_id: 'bench', body: 'pushed', noted_on: '2026-11-12', source: 'app',
      created_at: NOW.getTime(), updated_at: NOW.getTime(), deleted_at: null,
    });

    const agentNote = {
      type: 'training_notes', id: 'note_agent', client_updated_at_ms: NOW.getTime() + 5,
      fields: {
        exercise_definition_id: null, body: 'Deload this week', noted_on: '2026-11-11', source: 'agent',
        created_at: NOW.getTime(), updated_at: NOW.getTime(), deleted_at: null,
      },
    };
    const db = mockFixture.database;
    expect(db.transaction(tx => applyPullPage(tx as Transaction, [agentNote], 'training_notes'))).toBe(1);
    expect((await listTrainingNotes()).map(row => [row.id, row.source])).toEqual([[note.id, 'app'], ['note_agent', 'agent']]);
    expect(rawNote('note_agent')).toMatchObject({ localDirty: false });

    // A pulled tombstone removes it everywhere.
    const tombstone = { ...agentNote, client_updated_at_ms: NOW.getTime() + 10,
      fields: { ...agentNote.fields, deleted_at: NOW.getTime() + 10 } };
    db.transaction(tx => applyPullPage(tx as Transaction, [tombstone], 'training_notes'));
    expect((await listTrainingNotes()).map(row => row.id)).toEqual([note.id]);
  });
});
