import { eq } from 'drizzle-orm';

import type { LocalDatabase } from '@/src/data/bootstrap';
import { seedSystemExerciseCatalog } from '@/src/data/exercise-catalog-seeds';
import { saveExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { exerciseDefinitions } from '@/src/data/schema';
import { calculateAnalyticsSetMetrics, personalLoadContext } from '@/src/exercise-calculations/analytics';
import {
  BODYWEIGHT_SEED_CONTRIBUTIONS,
  validateBodyweightContribution,
} from '@/src/exercise-core/bodyweight-contribution';

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockFixture.database }));
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));
jest.mock('@/src/logging/logEvent', () => ({ logEvent: jest.fn() }));

beforeEach(() => { mockFixture = createInMemoryDatabase(); });
afterEach(() => mockFixture.close());

it('accepts only a finite bodyweight contribution from zero through one', () => {
  for (const contribution of [-1, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(validateBodyweightContribution(contribution).ok).toBe(false);
  }
  expect(validateBodyweightContribution(0)).toEqual({ ok: true, value: 0 });
  expect(validateBodyweightContribution(1)).toEqual({ ok: true, value: 1 });
  expect(Object.keys(BODYWEIGHT_SEED_CONTRIBUTIONS).sort())
    .toEqual(['seed_chin-ups', 'seed_parallel_bar_dips', 'seed_pull_up', 'seed_push_up']);
});

it('seeds only the four reviewed exercise identities with a contribution', () => {
  const db = mockFixture.database;
  seedSystemExerciseCatalog(db as unknown as LocalDatabase);
  const configured = db.select().from(exerciseDefinitions).all()
    .filter(row => row.bodyweightContribution > 0);
  expect(configured.map(row => row.id).sort()).toEqual(Object.keys(BODYWEIGHT_SEED_CONTRIBUTIONS).sort());
  for (const exercise of configured) {
    expect(exercise.bodyweightContribution).toBe(BODYWEIGHT_SEED_CONTRIBUTIONS[exercise.id]);
  }
});

it('preserves an existing contribution when an edit omits it and validates explicit changes', async () => {
  const db = mockFixture.database;
  seedSystemExerciseCatalog(db as unknown as LocalDatabase);
  const input = {
    id: 'seed_pull_up',
    name: 'Renamed pull-up',
    loadInputMode: 'total_load' as const,
    mappings: [{ muscleGroupId: 'back_lats', weight: 1, role: 'primary' as const }],
  };
  expect(await saveExerciseCatalogExercise(input)).toMatchObject({ bodyweightContribution: 1 });
  await expect(saveExerciseCatalogExercise({ ...input, bodyweightContribution: 1.1 })).rejects.toThrow('100%');
  expect(db.select().from(exerciseDefinitions).where(eq(exerciseDefinitions.id, input.id)).get())
    .toMatchObject({ bodyweightContribution: 1 });
  expect(await saveExerciseCatalogExercise({ ...input, bodyweightContribution: 0.9 }))
    .toMatchObject({ bodyweightContribution: 0.9 });
});

it('changes derived math without rewriting the raw Weight value', () => {
  const set = { weightValue: '20', repsValue: '8', setType: null, performanceStatus: null };
  const raw = { ...set };
  const result = calculateAnalyticsSetMetrics({
    ...set,
    ...personalLoadContext(true, { bodyweightContribution: 1, loadInputMode: 'total_load' },
      { bodyWeightKg: 80, bodyWeightSource: 'reading', bodyWeightMeasurementId: 'reading',
        bodyWeightMeasuredAt: new Date('2026-09-01T00:00:00Z') }),
  });
  expect(result.volumeKgReps).toBe(800);
  expect(result.estimatedOneRepMaxKg).toBeCloseTo(47.671419, 6);
  expect(set).toEqual(raw);
});
