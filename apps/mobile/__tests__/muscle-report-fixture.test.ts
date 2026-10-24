/* eslint-disable import/first */
jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native database boundary.
  require('./helpers/local-data').localDataBootstrapModule());

/** The Maestro muscle-report fixture seeds one completed session, dated before `now`, on the real data layer. */
import { eq } from 'drizzle-orm';

import { exerciseSets, sessionExercises, sessions } from '@/src/data/schema';
import { MUSCLE_REPORT_FIXTURE, seedMuscleReportFixture } from '@/src/maestro/muscle-report-fixture';
import { closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';

beforeEach(() => resetLocalData());
afterEach(() => closeLocalData());

it('seeds one completed session of three exercises, three working sets each, completed before now', async () => {
  const now = new Date(2026, 9, 24, 10);
  await seedMuscleReportFixture({ now });

  const database = localDatabase();
  const [session] = database.select().from(sessions).where(eq(sessions.id, MUSCLE_REPORT_FIXTURE.sessionId)).all();
  expect(session).toMatchObject({ status: 'completed', gymId: MUSCLE_REPORT_FIXTURE.gymId });
  expect(session.completedAt!.getTime()).toBeLessThan(now.getTime());

  const blocks = database.select().from(sessionExercises).where(eq(sessionExercises.sessionId, session.id)).all();
  expect(blocks.map((block) => block.exerciseDefinitionId).sort()).toEqual([
    'seed_barbell_back_squat', 'seed_lat_pulldown', 'seed_standing_calf_raise',
  ]);
  for (const block of blocks) {
    const sets = database.select().from(exerciseSets).where(eq(exerciseSets.sessionExerciseId, block.id)).all();
    expect(sets).toHaveLength(3);
  }
});
