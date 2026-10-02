/**
 * The exercise page repository's guards, which no screen path reaches: a
 * completed session is never written back as a draft, and a save never
 * recreates an exercise or a session that is gone. Everything the page itself
 * does over real data is asserted in `exercise-page-screen.test.tsx`.
 */
/* eslint-disable import/first */

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

let mockActiveDatabase: InMemoryTestDatabase | null = null;

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    if (!mockActiveDatabase) throw new Error('test database not initialised');
    return mockActiveDatabase;
  }),
}));

import { __resetClockForTests } from '@/src/data/clock';
import { exerciseDefinitions } from '@/src/data/schema';
import { completeSessionDraft } from '@/src/data/session-drafts';
import { EXERCISE_PAGE_FIXTURE, seedExercisePageFixture } from '@/src/maestro/exercise-page-fixture';
import {
  saveSessionExerciseDraft,
  SessionExerciseDraftError,
} from '@/src/session-recorder/session-exercise-draft';

const NOW = new Date('2026-09-23T10:00:00Z');
const { activeSessionId, benchSessionExerciseId, squatSessionExerciseId } = EXERCISE_PAGE_FIXTURE;
// The fixture's newer completed Bench Press session.
const HISTORY_SESSION_ID = 'maestro_exercise_page_history_2';
const HISTORY_BENCH_ID = `${HISTORY_SESSION_ID}_bench`;

describe('exercise page persistence', () => {
  let fixture: InMemoryDatabaseFixture;

  beforeEach(async () => {
    __resetClockForTests();
    fixture = createInMemoryDatabase();
    mockActiveDatabase = fixture.database;
    fixture.database
      .insert(exerciseDefinitions)
      .values([
        {
          id: EXERCISE_PAGE_FIXTURE.benchExerciseId,
          name: EXERCISE_PAGE_FIXTURE.benchExerciseName,
        },
        {
          id: EXERCISE_PAGE_FIXTURE.squatExerciseId,
          name: EXERCISE_PAGE_FIXTURE.squatExerciseName,
        },
      ])
      .run();
    await seedExercisePageFixture(NOW);
  });

  afterEach(() => {
    fixture.close();
    mockActiveDatabase = null;
  });

  it('refuses to write a completed session back as a draft', async () => {
    await expect(
      saveSessionExerciseDraft(HISTORY_SESSION_ID, {
        sessionExerciseId: HISTORY_BENCH_ID,
        exercise: null,
        sessionStatus: 'active',
      })
    ).rejects.toEqual(new SessionExerciseDraftError('not-editable'));
  });

  it('will not recreate an exercise or a session that is gone', async () => {
    await saveSessionExerciseDraft(activeSessionId, {
      sessionExerciseId: benchSessionExerciseId,
      exercise: null,
      sessionStatus: 'active',
    });
    await expect(
      saveSessionExerciseDraft(activeSessionId, {
        sessionExerciseId: benchSessionExerciseId,
        exercise: null,
        sessionStatus: 'active',
      })
    ).rejects.toEqual(new SessionExerciseDraftError('missing-exercise'));

    await completeSessionDraft(activeSessionId, { now: NOW });
    await expect(
      saveSessionExerciseDraft(activeSessionId, {
        sessionExerciseId: squatSessionExerciseId,
        exercise: null,
        sessionStatus: 'active',
      })
    ).rejects.toEqual(new SessionExerciseDraftError('not-editable'));
  });
});
