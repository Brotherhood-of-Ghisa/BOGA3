/**
 * Outcome: an exercise's own rest timer persists on its definition through the
 * catalog save, dirtying the row for sync. Null clears it back to the global
 * timer, an edit that omits it keeps the stored value, and a value outside
 * the rest timer range is refused before any write ([[timer.rest-default]]).
 */

import { eq } from 'drizzle-orm';

import type { LocalDatabase } from '@/src/data/bootstrap';
import { seedSystemExerciseCatalog } from '@/src/data/exercise-catalog-seeds';
import { saveExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { exerciseDefinitions } from '@/src/data/schema';

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockFixture.database }));
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));
jest.mock('@/src/logging/logEvent', () => ({ logEvent: jest.fn() }));

beforeEach(() => {
  mockFixture = createInMemoryDatabase();
  seedSystemExerciseCatalog(mockFixture.database as unknown as LocalDatabase);
});
afterEach(() => mockFixture.close());

const edit = {
  id: 'seed_pull_up',
  name: 'Pull-up',
  loadInputMode: 'total_load' as const,
  mappings: [{ muscleGroupId: 'back_lats', weight: 1, role: 'primary' as const }],
};
const stored = () =>
  mockFixture.database
    .select({ restTimerSec: exerciseDefinitions.restTimerSec, localDirty: exerciseDefinitions.localDirty })
    .from(exerciseDefinitions)
    .where(eq(exerciseDefinitions.id, edit.id))
    .get();

it('seeds every exercise on the global timer', () => {
  const rows = mockFixture.database.select({ restTimerSec: exerciseDefinitions.restTimerSec }).from(exerciseDefinitions).all();
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((row) => row.restTimerSec === null)).toBe(true);
});

it('saves, keeps on omission, and clears on null', async () => {
  expect(await saveExerciseCatalogExercise({ ...edit, restTimerSec: 150 })).toMatchObject({ restTimerSec: 150 });
  expect(stored()).toEqual({ restTimerSec: 150, localDirty: true });

  expect(await saveExerciseCatalogExercise({ ...edit, name: 'Renamed pull-up' })).toMatchObject({ restTimerSec: 150 });

  expect(await saveExerciseCatalogExercise({ ...edit, restTimerSec: null })).toMatchObject({ restTimerSec: null });
  expect(stored()?.restTimerSec).toBeNull();
});

it('creates a new exercise with its own timer', async () => {
  const created = await saveExerciseCatalogExercise({ ...edit, id: undefined, name: 'Cable row', restTimerSec: 75 });
  expect(created.restTimerSec).toBe(75);
});

it.each([14, 601, 90.5])('refuses %p without writing', async (restTimerSec) => {
  await saveExerciseCatalogExercise({ ...edit, restTimerSec: 120 });
  await expect(saveExerciseCatalogExercise({ ...edit, restTimerSec })).rejects.toThrow(
    'Rest timer must be a whole number of seconds from 15 to 600.',
  );
  expect(stored()?.restTimerSec).toBe(120);
});
