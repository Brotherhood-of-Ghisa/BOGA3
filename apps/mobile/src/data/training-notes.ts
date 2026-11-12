import { and, desc, eq, isNull } from 'drizzle-orm';

import { bootstrapLocalDataLayer } from './bootstrap';
import { nowMonotonic, type Transaction } from './clock';
import { exerciseDefinitions, trainingNotes, type TrainingNote } from './schema';
import { notifyLocalWrite } from '@/src/sync/write-nudge';

/** The longest note body, in characters, after trimming. */
export const TRAINING_NOTE_MAX_LENGTH = 1000;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A note as the lists show it: removed notes never appear. */
export type TrainingNoteView = {
  id: string;
  body: string;
  notedOn: string;
  source: 'app' | 'agent';
  exerciseId: string | null;
  /** The exercise's name, also when that exercise was deleted or merged away; null for a general note. */
  exerciseName: string | null;
  createdAt: Date;
};

export type TrainingNoteInput = {
  body: string;
  /** Local calendar date (`YYYY-MM-DD`) the note applies from; today or earlier. */
  notedOn: string;
  exerciseId?: string | null;
  now?: Date;
};

/** A rejected note; the message is shown to the person. */
export class TrainingNoteInputError extends Error {}

const pad = (value: number): string => String(value).padStart(2, '0');

/** The local calendar date of `date` as `YYYY-MM-DD`. */
export const toLocalDateKey = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** The local-midnight date a `YYYY-MM-DD` key names, or null when it is not a real calendar date. */
export const parseLocalDateKey = (key: string): Date | null => {
  const match = DATE_KEY.exec(key);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
};

/** The trimmed body and checked date of a new note; throws `TrainingNoteInputError`. */
export const validateTrainingNoteInput = (input: TrainingNoteInput, now: Date): { body: string; notedOn: string } => {
  const body = input.body.trim();
  if (body.length === 0) throw new TrainingNoteInputError('Write a note first.');
  if (body.length > TRAINING_NOTE_MAX_LENGTH) {
    throw new TrainingNoteInputError(`Keep the note to ${TRAINING_NOTE_MAX_LENGTH} characters.`);
  }
  if (!parseLocalDateKey(input.notedOn)) throw new TrainingNoteInputError('Choose a valid date.');
  // Keys compare as dates because they are zero-padded.
  if (input.notedOn > toLocalDateKey(now)) throw new TrainingNoteInputError('The date cannot be in the future.');
  return { body, notedOn: input.notedOn };
};

const newNoteId = (now: Date): string =>
  `note-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

type ReadTx = Pick<Transaction, 'select'>;

/** Live notes, newest applies-from date first, then newest created. Optionally one exercise's only. */
export const readTrainingNotes = (database: ReadTx, exerciseId?: string): TrainingNoteView[] => {
  const live = isNull(trainingNotes.deletedAt);
  const rows = database
    .select({ note: trainingNotes, exerciseName: exerciseDefinitions.name })
    .from(trainingNotes)
    .leftJoin(exerciseDefinitions, eq(exerciseDefinitions.id, trainingNotes.exerciseDefinitionId))
    .where(exerciseId === undefined ? live : and(live, eq(trainingNotes.exerciseDefinitionId, exerciseId)))
    .orderBy(desc(trainingNotes.notedOn), desc(trainingNotes.createdAt), desc(trainingNotes.id))
    .all();
  return rows.map(({ note, exerciseName }) => toView(note, exerciseName));
};

const toView = (note: TrainingNote, exerciseName: string | null): TrainingNoteView => ({
  id: note.id,
  body: note.body,
  notedOn: note.notedOn,
  source: note.source === 'agent' ? 'agent' : 'app',
  exerciseId: note.exerciseDefinitionId ?? null,
  exerciseName: note.exerciseDefinitionId ? exerciseName : null,
  createdAt: note.createdAt,
});

export const listTrainingNotes = async (options: { exerciseId?: string } = {}): Promise<TrainingNoteView[]> => {
  const database = await bootstrapLocalDataLayer();
  return readTrainingNotes(database, options.exerciseId);
};

/** Saves a new app note; a named exercise must exist on this device. */
export const addTrainingNote = async (input: TrainingNoteInput): Promise<TrainingNoteView> => {
  const now = input.now ?? new Date();
  const value = validateTrainingNoteInput(input, now);
  const exerciseId = input.exerciseId ?? null;
  const database = await bootstrapLocalDataLayer();
  const saved = database.transaction((tx) => {
    let exerciseName: string | null = null;
    if (exerciseId) {
      const exercise = tx.select({ name: exerciseDefinitions.name }).from(exerciseDefinitions)
        .where(eq(exerciseDefinitions.id, exerciseId)).get();
      if (!exercise) throw new TrainingNoteInputError('This exercise is no longer available.');
      exerciseName = exercise.name;
    }
    const id = newNoteId(now);
    tx.insert(trainingNotes).values({
      id, exerciseDefinitionId: exerciseId, body: value.body, notedOn: value.notedOn, source: 'app',
      createdAt: now, updatedAt: now, localDirty: true, localUpdatedAtMs: nowMonotonic(tx as Transaction),
    }).run();
    const row = tx.select().from(trainingNotes).where(eq(trainingNotes.id, id)).get();
    if (!row) throw new Error('The note could not be saved. Try again.');
    return toView(row, exerciseName);
  });
  notifyLocalWrite();
  return saved;
};

/** Soft-deletes a note; the row stays so a later restore can bring it back. Removing a removed note is a no-op. */
export const removeTrainingNote = async (id: string, now = new Date()): Promise<void> => {
  const database = await bootstrapLocalDataLayer();
  const removed = database.transaction((tx) => {
    const existing = tx.select({ deletedAt: trainingNotes.deletedAt }).from(trainingNotes)
      .where(eq(trainingNotes.id, id)).get();
    if (!existing || existing.deletedAt) return false;
    tx.update(trainingNotes).set({
      deletedAt: now, updatedAt: now, localDirty: true, localUpdatedAtMs: nowMonotonic(tx as Transaction),
    }).where(eq(trainingNotes.id, id)).run();
    return true;
  });
  if (removed) notifyLocalWrite();
};
