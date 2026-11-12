/* eslint-disable import/first */

/**
 * Training notes over real data: the `/notes` route (all notes, under More's
 * tab bar) and `/notes?exerciseId=` (one exercise's, from the exercise page's
 * ⋮), with the production repository over the migrated in-memory SQLite
 * database (helpers/local-data.ts). Notes are seeded through the repository,
 * or as raw rows for what only sync delivers (an agent's note); every write is
 * read back from `training_notes`.
 *
 * Replaced: the native database open and the router. A pending and a failed
 * read are forced on the real module with `jest.spyOn` (states real data
 * cannot produce); `Alert.alert` is spied so a test presses its buttons.
 */

import * as mockReact from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, Platform, type AlertButton } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { eq } from 'drizzle-orm';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

let mockSearchParams: Record<string, string> = {};
const mockScreenOptions: { title?: string }[] = [];

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
  useLocalSearchParams: () => mockSearchParams,
  useNavigation: () => ({ setOptions: jest.fn() }),
  useRouter: () => ({ dismissTo: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  Stack: {
    Screen: ({ options }: { options: { title?: string } }) => {
      mockScreenOptions.push(options);
      return null;
    },
  },
}));

import NotesRoute from '../app/notes';
import * as trainingNotesData from '@/src/data/training-notes';
import { addTrainingNote, toLocalDateKey } from '@/src/data/training-notes';
import { exerciseDefinitions, trainingNotes } from '@/src/data/schema';
import { formatCompactDate, formatShortDate } from '@/src/utils/local-time';
import { bootLocalApp, closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';
import { renderWithTheme } from './helpers/theme';
import { waitForGone } from './helpers/wait-for-gone';

const today = () => toLocalDateKey(new Date());
const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};
const compact = (date: Date) => formatCompactDate(date, 'DD-MM-YYYY');

const noteRows = () => localDatabase().select().from(trainingNotes).all();
const noteRow = (id: string) => localDatabase().select().from(trainingNotes).where(eq(trainingNotes.id, id)).get();

// Inserted before the catalogue first loads, so every page names them.
const seedExercises = async () => {
  localDatabase().insert(exerciseDefinitions).values([
    { id: 'note-squat', name: 'Note Back Squat' },
    { id: 'note-bench', name: 'Note Bench Press' },
  ]).run();
  await bootLocalApp();
};

const seedNotes = async () => {
  await seedExercises();
  const general = await addTrainingNote({ body: 'Right shoulder: no pressing', notedOn: toLocalDateKey(daysAgo(3)) });
  const squat = await addTrainingNote({ body: 'From today I squat to a bench', notedOn: toLocalDateKey(daysAgo(1)), exerciseId: 'note-squat' });
  localDatabase().insert(trainingNotes).values({
    id: 'agent-note', body: 'Coach: keep bench light this week', notedOn: today(), source: 'agent',
    exerciseDefinitionId: 'note-bench',
  }).run();
  return { general, squat };
};

const renderNotes = async (params: Record<string, string> = {}) => {
  mockSearchParams = params;
  renderWithTheme(<NotesRoute />);
  await screen.findByTestId('notes-screen');
};

const alertButton = (text: string): AlertButton => {
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2] ?? [];
  const button = buttons.find((candidate) => candidate.text === text);
  if (!button) throw new Error(`No alert button ${text}`);
  return button;
};

const listedIds = () =>
  screen.getByTestId('notes-list')
    .findAll((node) => typeof node.props.testID === 'string' && /^note-row-/.test(node.props.testID), { deep: true })
    .map((node) => (node.props.testID as string).replace('note-row-', ''))
    .filter((id, index, ids) => ids.indexOf(id) === index);

const originalPlatform = Platform.OS;

beforeEach(() => {
  resetLocalData();
  mockSearchParams = {};
  mockScreenOptions.length = 0;
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  Platform.OS = originalPlatform;
  closeLocalData();
});

describe('All notes (More → Notes)', () => {
  it('shows loading until the read settles', async () => {
    await seedExercises();
    let settle: (notes: trainingNotesData.TrainingNoteView[]) => void = () => undefined;
    jest.spyOn(trainingNotesData, 'listTrainingNotes').mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    await renderNotes();

    expect(screen.getByTestId('notes-loading')).toBeTruthy();
    await act(async () => settle([]));
    expect(await screen.findByTestId('notes-empty')).toHaveTextContent('No notes yet');
  });

  it('says No notes yet with nothing saved', async () => {
    await seedExercises();
    await renderNotes();
    expect(await screen.findByText('No notes yet')).toBeTruthy();
    expect(screen.getByTestId('note-exercise-row')).toBeTruthy();
  });

  it('offers Retry after a failed read, and lists the notes once it succeeds', async () => {
    await seedNotes();
    jest.spyOn(trainingNotesData, 'listTrainingNotes').mockRejectedValueOnce(new Error('database is locked'));
    await renderNotes();

    const error = await screen.findByTestId('notes-error');
    expect(within(error).getByText('Couldn’t load notes.')).toBeTruthy();
    fireEvent.press(within(error).getByLabelText('Retry loading notes'));

    expect(await screen.findByTestId('notes-list')).toBeTruthy();
    expect(listedIds()).toHaveLength(3);
  });

  it('lists every note newest first with its date, text and exercise or General, marking the agent\'s', async () => {
    const { general, squat } = await seedNotes();
    await renderNotes();
    await screen.findByTestId('notes-list');

    expect(listedIds()).toEqual(['agent-note', squat.id, general.id]);
    expect(screen.getByTestId(`note-meta-${general.id}`)).toHaveTextContent(`${compact(daysAgo(3))} · General`);
    expect(screen.getByTestId(`note-meta-${squat.id}`)).toHaveTextContent(`${compact(daysAgo(1))} · Note Back Squat`);
    expect(screen.getByTestId('note-meta-agent-note')).toHaveTextContent(`${compact(new Date())} · Note Bench Press`);
    expect(screen.getByTestId(`note-body-${squat.id}`)).toHaveTextContent('From today I squat to a bench');

    expect(screen.getByTestId('note-agent-agent-note').props.accessibilityLabel).toBe('Added by your coach');
    expect(screen.queryByTestId(`note-agent-${general.id}`)).toBeNull();
    expect(screen.getByTestId(`note-remove-${general.id}`).props.accessibilityLabel)
      .toBe(`Remove note from ${formatShortDate(daysAgo(3), 'DD-MM-YYYY')}`);
  });

  it('adds a general note dated today and lists it', async () => {
    await seedExercises();
    await renderNotes();
    await screen.findByTestId('notes-empty');
    expect(screen.getByTestId('note-exercise-row')).toHaveTextContent(/General/);

    fireEvent.changeText(screen.getByTestId('note-form-body'), '  Deload week  ');
    fireEvent.press(screen.getByTestId('note-form-save'));

    expect(await screen.findByText('Deload week')).toBeTruthy();
    expect(noteRows()).toEqual([expect.objectContaining({
      body: 'Deload week', notedOn: today(), exerciseDefinitionId: null, source: 'app', deletedAt: null,
    })]);
    expect(screen.getByTestId('note-form-body').props.value).toBe('');
  });

  it('attaches the note to the exercise chosen in the picker, and can go back to General', async () => {
    await seedExercises();
    await renderNotes();
    await screen.findByTestId('notes-empty');

    fireEvent.press(screen.getByTestId('note-exercise-row'));
    const picker = await screen.findByTestId('note-exercise-sheet');
    fireEvent.press(within(picker).getByTestId('note-exercise-general'));
    expect(screen.getByTestId('note-exercise-row')).toHaveTextContent(/General/);

    fireEvent.press(screen.getByTestId('note-exercise-row'));
    const reopened = await screen.findByTestId('note-exercise-sheet');
    fireEvent.changeText(within(reopened).getByLabelText('Search exercises'), 'Note Back');
    fireEvent.press(await within(reopened).findByText('Note Back Squat'));
    expect(screen.getByTestId('note-exercise-row')).toHaveTextContent(/Note Back Squat/);

    fireEvent.changeText(screen.getByTestId('note-form-body'), 'Pause at the bottom');
    fireEvent.press(screen.getByTestId('note-form-save'));

    expect(await screen.findByText('Pause at the bottom')).toBeTruthy();
    expect(noteRows()[0]).toMatchObject({ exerciseDefinitionId: 'note-squat' });
    // The next note starts general again.
    expect(screen.getByTestId('note-exercise-row')).toHaveTextContent(/General/);
  });

  it('shows the repository\'s message for an empty note and saves nothing', async () => {
    await seedExercises();
    await renderNotes();
    await screen.findByTestId('notes-empty');

    fireEvent.changeText(screen.getByTestId('note-form-body'), '   ');
    fireEvent.press(screen.getByTestId('note-form-save'));

    expect(await screen.findByTestId('note-form-error')).toHaveTextContent('Write a note first.');
    expect(noteRows()).toEqual([]);
  });

  it('dates a note earlier from the iOS picker, which offers no later day than today', async () => {
    Platform.OS = 'ios';
    await seedExercises();
    await renderNotes();
    await screen.findByTestId('notes-empty');

    fireEvent.press(screen.getByTestId('note-date-row'));
    const picker = screen.getByTestId('note-date-picker');
    expect(toLocalDateKey(picker.props.maximumDate)).toBe(today());
    fireEvent(picker, 'onChange', { type: 'set' }, daysAgo(5));
    expect(screen.getByTestId('note-date-row')).toHaveTextContent(new RegExp(compact(daysAgo(5))));

    // A later day reported by the picker is held to today.
    fireEvent(picker, 'onChange', { type: 'set' }, new Date(Date.now() + 3 * 86_400_000));
    expect(screen.getByTestId('note-date-row')).toHaveTextContent(new RegExp(compact(new Date())));
    fireEvent(picker, 'onChange', { type: 'set' }, daysAgo(5));

    fireEvent.changeText(screen.getByTestId('note-form-body'), 'Started the new programme');
    fireEvent.press(screen.getByTestId('note-form-save'));
    await screen.findByText('Started the new programme');
    expect(noteRows()[0]).toMatchObject({ notedOn: toLocalDateKey(daysAgo(5)) });
    // Saving resets the next note to today, picker closed.
    expect(screen.getByTestId('note-date-row')).toHaveTextContent(new RegExp(compact(new Date())));
  });

  it('opens the system date dialog on Android, capped at today', async () => {
    Platform.OS = 'android';
    await seedExercises();
    await renderNotes();
    await screen.findByTestId('notes-empty');

    fireEvent.press(screen.getByTestId('note-date-row'));

    const options = jest.mocked(DateTimePickerAndroid.open).mock.calls.at(-1)?.[0];
    expect(options).toMatchObject({ mode: 'date' });
    expect(toLocalDateKey(options!.maximumDate as Date)).toBe(today());
    act(() => options!.onChange?.({ type: 'set', nativeEvent: { timestamp: 0, utcOffset: 0 } }, daysAgo(2)));
    expect(screen.getByTestId('note-date-row')).toHaveTextContent(new RegExp(compact(daysAgo(2))));
    expect(screen.queryByTestId('note-date-picker')).toBeNull();
  });

  it('removes a note after the confirmation, soft-deleting it', async () => {
    const { general } = await seedNotes();
    await renderNotes();
    await screen.findByTestId('notes-list');

    fireEvent.press(screen.getByTestId(`note-remove-${general.id}`));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Remove note?',
      `The note from ${formatShortDate(daysAgo(3), 'DD-MM-YYYY')} will be removed.`,
      expect.any(Array),
    );
    await act(async () => alertButton('Remove').onPress?.());

    await waitForGone(() => screen.queryByTestId(`note-row-${general.id}`));
    expect(noteRow(general.id)?.deletedAt).toBeInstanceOf(Date);
    expect(listedIds()).toHaveLength(2);
  });

  it('keeps the note when the confirmation is cancelled', async () => {
    const { general } = await seedNotes();
    await renderNotes();
    await screen.findByTestId('notes-list');

    fireEvent.press(screen.getByTestId(`note-remove-${general.id}`));
    expect(alertButton('Cancel').style).toBe('cancel');
    await act(async () => alertButton('Cancel').onPress?.());

    expect(screen.getByTestId(`note-row-${general.id}`)).toBeTruthy();
    expect(noteRow(general.id)?.deletedAt).toBeNull();
  });

  it('says so when a removal fails, and keeps the note listed', async () => {
    const { general } = await seedNotes();
    await renderNotes();
    await screen.findByTestId('notes-list');
    jest.spyOn(trainingNotesData, 'removeTrainingNote').mockRejectedValueOnce(new Error('disk full'));

    fireEvent.press(screen.getByTestId(`note-remove-${general.id}`));
    await act(async () => alertButton('Remove').onPress?.());

    expect(await screen.findByTestId('notes-remove-error')).toHaveTextContent('Couldn’t remove the note. Try again.');
    expect(screen.getByTestId(`note-row-${general.id}`)).toBeTruthy();
  });
});

describe('One exercise\'s notes (exercise page ⋮ → Notes)', () => {
  it('lists only that exercise\'s notes, titled by the exercise, with no exercise choice', async () => {
    const { squat } = await seedNotes();
    await renderNotes({ exerciseId: 'note-squat' });
    await screen.findByTestId('notes-list');

    expect(listedIds()).toEqual([squat.id]);
    // The page is the exercise's: rows do not repeat its name.
    expect(screen.getByTestId(`note-meta-${squat.id}`)).toHaveTextContent(compact(daysAgo(1)));
    expect(screen.queryByTestId('note-exercise-row')).toBeNull();
    await waitFor(() => {
      if (!mockScreenOptions.some((options) => options.title === 'Note Back Squat notes')) throw new Error('title not set');
    });
  });

  it('says No notes yet for an exercise without notes', async () => {
    await seedNotes();
    await renderNotes({ exerciseId: 'note-missing' });
    expect(await screen.findByTestId('notes-empty')).toHaveTextContent('No notes yet');
  });

  it('attaches a new note to the exercise', async () => {
    await seedNotes();
    await renderNotes({ exerciseId: 'note-bench' });
    await screen.findByTestId('notes-list');

    fireEvent.changeText(screen.getByTestId('note-form-body'), 'Elbows tucked');
    fireEvent.press(screen.getByTestId('note-form-save'));

    expect(await screen.findByText('Elbows tucked')).toBeTruthy();
    expect(listedIds()).toHaveLength(2);
    expect(noteRows().find((row) => row.body === 'Elbows tucked')).toMatchObject({ exerciseDefinitionId: 'note-bench' });
  });

  it('shows the repository\'s message when the exercise is gone', async () => {
    await seedNotes();
    await renderNotes({ exerciseId: 'note-missing' });
    await screen.findByTestId('notes-empty');

    fireEvent.changeText(screen.getByTestId('note-form-body'), 'Orphan');
    fireEvent.press(screen.getByTestId('note-form-save'));

    expect(await screen.findByTestId('note-form-error')).toHaveTextContent('This exercise is no longer available.');
  });
});
