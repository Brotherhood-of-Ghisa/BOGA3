/* eslint-disable import/first */
import { eq } from 'drizzle-orm';
// Real SQLite readers prove that the two calculation columns are independent,
// durable per account, and rebuild facts without changing recorded workouts.
jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native database boundary.
  require('./helpers/local-data').localDataBootstrapModule());

import { exerciseDefinitions, exerciseMuscleMappings, exerciseSets, muscleGroups, sessionExercises, sessions } from '@/src/data/schema';
import { loadExercisePerformanceHistory } from '@/src/data/exercise-history';
import { loadRecentExerciseBlocks } from '@/src/data/exercise-block-history';
import { computeSelectedExerciseDailyEffort } from '@/src/data/exercise-analytics';
import { computeSelectedMuscleDailyEffort, createDrizzleStatsStore, aggregateStats } from '@/src/data/stats';
import { loadExerciseCatalogStats } from '@/src/data/exercise-catalog-stats';
import { loadExerciseBests, loadExerciseSessionFacts } from '@/src/data/exercise-session-facts';
import { loadSessionSnapshotById } from '@/src/data/session-drafts';
import { loadCompletedSessionInsights } from '@/src/session-insights';
import { buildSessionViewModel } from '@/src/session-recorder/session-view-model';
import { buildCompletedSessionDetailModel } from '@/src/session-recorder/completed-session-detail-model';
import { createExercise, mapDraftSnapshotToSession } from '@/src/session-recorder/session-model';
import { workingSetsBySession } from '@/src/progress-summary';
import { isWorkingSet, isVolumeSet } from '@/src/exercise-calculations/set-semantics';
import { groupLoadContext, summarizeExerciseLoad } from '@/src/exercise-calculations/analytics';
import { DEFAULT_PERSONAL_EFFORT_POLICY, EFFORT_CHOICES, type EffortChoice } from '@/src/exercise-calculations/effort-policy';
import { ensureAccountLocalPreferencesLoaded, setAccountLocalPreferenceAccount, setAccountLocalPreferences, __resetAccountLocalPreferencesForTests } from '@/src/preferences/account-local';
import { closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';

const start = new Date('2026-09-20T00:00:00Z');
const end = new Date('2026-09-21T00:00:00Z');
const account = async (id = 'A') => {
  setAccountLocalPreferenceAccount(id, true);
  await ensureAccountLocalPreferencesLoaded();
};
const configure = (workingSetEfforts: EffortChoice[], volumeEfforts: EffortChoice[]) =>
  setAccountLocalPreferences({ workingSetEfforts, volumeEfforts });

beforeEach(async () => {
  resetLocalData();
  await account();
  const db = localDatabase();
  db.insert(exerciseDefinitions).values({ id: 'lift', name: 'Lift' }).run();
  db.insert(muscleGroups).values({ id: 'back', displayName: 'Back', familyName: 'Back' }).run();
  db.insert(exerciseMuscleMappings).values({ id: 'map', exerciseDefinitionId: 'lift', muscleGroupId: 'back', role: 'primary', weight: 1 }).run();
  db.insert(sessions).values({ id: 'session', status: 'completed', startedAt: start, completedAt: new Date('2026-09-20T12:00:00Z') }).run();
  db.insert(sessionExercises).values({ id: 'block', sessionId: 'session', exerciseDefinitionId: 'lift', name: 'Lift', orderIndex: 0 }).run();
  for (const [orderIndex, [setType, weightValue]] of [['warm_up', '80'], ['rir_2', '50'], ['cooldown', '20'], ['technique', '10']].entries()) {
    db.insert(exerciseSets).values({ id: `set-${orderIndex}`, sessionExerciseId: 'block', orderIndex,
      weightValue, repsValue: '5', setType, performanceStatus: null }).run();
  }
});
afterEach(() => closeLocalData());

const read = async () => {
  const [history, blocks, daily, muscle, catalog, facts, bests, graph, insights, input] = await Promise.all([
    loadExercisePerformanceHistory({ exerciseDefinitionId: 'lift', period: 'all' }),
    loadRecentExerciseBlocks({ exerciseDefinitionId: 'lift', now: end }),
    computeSelectedExerciseDailyEffort({ exerciseDefinitionId: 'lift', start, end, timeZone: 'UTC' }),
    computeSelectedMuscleDailyEffort({ muscleGroupIds: ['back'], start, end, timeZone: 'UTC' }),
    loadExerciseCatalogStats('all', end), loadExerciseSessionFacts('lift'), loadExerciseBests({ exerciseDefinitionId: 'lift' }),
    loadSessionSnapshotById('session'), loadCompletedSessionInsights('session'),
    createDrizzleStatsStore().loadAggregationInput({ start, end }),
  ]);
  if (!graph || !history || !insights) throw Error('Expected saved workout');
  const session = mapDraftSnapshotToSession(graph);
  return { history, blocks, daily, muscle, catalog: catalog.aggregatesById.get('lift'), facts, bests, insights,
    stats: aggregateStats(input), today: workingSetsBySession(input),
    view: buildSessionViewModel(session, new Map()), detail: buildCompletedSessionDetailModel(session.exercises, new Map()) };
};

it.each(EFFORT_CHOICES)('defaults $label personally and in the fixed group rule alike', ({ id }) => {
  const set = { weight: '40', reps: '5', setType: id === 'unspecified' ? null : id };
  const expected = DEFAULT_PERSONAL_EFFORT_POLICY.workingSetEfforts.includes(id);
  expect(isWorkingSet(set, DEFAULT_PERSONAL_EFFORT_POLICY)).toBe(expected);
  expect(isVolumeSet(set, DEFAULT_PERSONAL_EFFORT_POLICY)).toBe(expected);
  expect(isWorkingSet(set)).toBe(expected);
  expect(isVolumeSet(set)).toBe(expected);
  expect(isWorkingSet({ ...set, performanceStatus: 'planned' }, DEFAULT_PERSONAL_EFFORT_POLICY)).toBe(false);
});

it('agrees on defaults across saved personal stats, records, summaries and heatmaps', async () => {
  const result = await read();
  expect(result.history.sessions[0]).toMatchObject({ workingSetCount: 1, totalVolume: 250, topWeightSet: { weight: 50 } });
  expect(result.catalog).toMatchObject({ workingSetCount: 1, totalVolume: 250, sessionCount: 1 });
  expect(result.facts[0]).toMatchObject({ workingSets: 1, volumeSets: 1, volumeKg: 250, topWeightKg: 50 });
  expect(result.stats).toMatchObject({ workingSetCount: 1, sessionCount: 1 });
  expect(result.view).toMatchObject({ workingSetCount: 1, volume: '250' });
  expect(result.detail).toMatchObject({ workingSetCount: 1, volume: '250' });
  expect(result.insights.muscleVolumeComparisons[0]).toMatchObject({ workingSetCount: 1, currentVolume: 125 });
});

it('includes hidden effort in counts/strength and other efforts independently in volume', async () => {
  setAccountLocalPreferences({ displayEfforts: ['rir_0'] });
  configure(['technique'], ['warm_up', 'cooldown']);
  const result = await read();
  expect(result.history.sessions[0]).toMatchObject({ workingSetCount: 1, totalVolume: 500, topWeightSet: { weight: 10 } });
  expect(result.blocks.blocks[0]).toMatchObject({ workingSetCount: 1, totalVolume: 500 });
  expect(result.daily[0]).toMatchObject({ workingSetCount: 1, totalVolume: 500, highestWeight: 10 });
  expect(result.muscle[0]).toMatchObject({ setCount: 1, totalWeight: 250, sessionCount: 1 });
  expect(result.catalog).toMatchObject({ workingSetCount: 1, totalVolume: 500, sessionCount: 1 });
  expect(result.facts[0]).toMatchObject({ workingSets: 1, volumeSets: 2, volumeKg: 500, topWeightKg: 10 });
  expect(result.view).toMatchObject({ workingSetCount: 1, volume: '500' });
  expect(result.detail).toMatchObject({ workingSetCount: 1, volume: '500' });
  expect(result.insights.exerciseVolumeComparisons[0]).toMatchObject({ workingSetCount: 1, currentVolume: 500 });
  expect(result.insights.muscleVolumeComparisons[0]).toMatchObject({ workingSetCount: 1, currentVolume: 250 });
  expect(result.today[0].workingSets).toBe(1);
  expect(createExercise('other', 'Other').sets[0].setType).toBe('rir_0');
});

it('keeps volume-only sessions in volume projections and records with zero counted sessions or strength records', async () => {
  await read(); // Prime the persisted derived cache under the old configuration.
  const before = localDatabase().select().from(exerciseSets).all();
  configure([], ['warm_up']);
  const result = await read();
  expect(result.stats).toMatchObject({ workingSetCount: 0, sessionCount: 0 });
  expect(result.today).toEqual([]);
  expect(result.blocks.blocks).toEqual([]);
  expect(result.daily[0]).toMatchObject({ workingSetCount: 0, totalVolume: 400, highestWeight: null, estimatedRM1: null });
  expect(result.muscle[0]).toMatchObject({ setCount: 0, totalWeight: 200, sessionCount: 0 });
  expect(result.catalog).toMatchObject({ workingSetCount: 0, totalVolume: 400, sessionCount: 0, estimatedOneRepMax: null });
  expect(result.facts[0]).toMatchObject({ workingSets: 0, volumeSets: 1, volumeKg: 400, topWeightKg: null, bestE1rmKg: null });
  expect(result.bests).toMatchObject({ oneRepMax: null, topWeight: null, latest: null, volume: { value: 400, volumeSets: 1 } });
  expect(result.view).toMatchObject({ workingSetCount: 0, volume: '400' });
  expect(result.detail).toMatchObject({ workingSetCount: 0, volume: '400' });
  expect(localDatabase().select().from(exerciseSets).all()).toEqual(before);
});

it('keeps working-only sets in counts and strength records with zero volume', async () => {
  configure(['technique'], []);
  const result = await read();
  expect(result.facts[0]).toMatchObject({ workingSets: 1, volumeSets: 0, volumeKg: 0, topWeightKg: 10 });
  expect(result.bests.volume).toBeNull();
  expect(result.view).toMatchObject({ workingSetCount: 1, volume: '0' });
  expect(result.stats).toMatchObject({ workingSetCount: 1, sessionCount: 1 });
});

it('restores account choices after relaunch and recalculates the persisted cache when account scope changes', async () => {
  configure([], ['technique']);
  expect((await read()).facts[0].volumeKg).toBe(50);
  __resetAccountLocalPreferencesForTests();
  await account();
  expect((await read()).facts[0]).toMatchObject({ workingSets: 0, volumeKg: 50 });
  await account('B');
  expect((await read()).facts[0]).toMatchObject({ workingSets: 1, volumeKg: 250 });
  await account('A');
  expect((await read()).facts[0]).toMatchObject({ workingSets: 0, volumeKg: 50 });
});

it('isolates groups and assigns historical custom RIR to RIR-4 without rewriting its label', () => {
  configure([], []);
  const sets = localDatabase().select().from(exerciseSets).all();
  const group = summarizeExerciseLoad(sets.map(set => ({ ...set, performanceStatus: null })), groupLoadContext(false, { bodyweightContribution: 0, loadInputMode: 'total_load' }, null));
  // The fixed group rule, not the empty personal choices: the RIR set only.
  expect(group.volumeCoverage.totalVolumeKgReps).toBe(250);
  expect(group.topWeightSet?.weight).toBe(50);
  expect(isWorkingSet({ weight: '80', reps: '5', setType: 'rir_12' }, { workingSetEfforts: [], volumeEfforts: [] })).toBe(false);
  expect(isVolumeSet({ weight: '80', reps: '5', setType: 'rir_12' }, { workingSetEfforts: [], volumeEfforts: [] })).toBe(false);
  expect(isWorkingSet({ weight: '80', reps: '5', setType: 'rir_12' }, { workingSetEfforts: ['rir_4'], volumeEfforts: [] })).toBe(true);
  expect(isVolumeSet({ weight: '80', reps: '5', setType: 'unknown' }, { workingSetEfforts: [], volumeEfforts: ['unspecified'] })).toBe(true);
});

it('sets Volume records from volume-only sessions without creating strength PRs or a Last date', async () => {
  configure([], ['warm_up']);
  const db = localDatabase();
  db.insert(sessions).values({ id: 'later', status: 'completed', startedAt: end, completedAt: new Date('2026-09-21T12:00:00Z') }).run();
  db.insert(sessionExercises).values({ id: 'later-block', sessionId: 'later', exerciseDefinitionId: 'lift', name: 'Lift', orderIndex: 0 }).run();
  db.insert(exerciseSets).values({ id: 'later-set', sessionExerciseId: 'later-block', orderIndex: 0, weightValue: '100', repsValue: '5', setType: 'warm_up', performanceStatus: null }).run();
  const facts = await loadExerciseSessionFacts('lift');
  expect(facts[1]).toMatchObject({ workingSets: 0, volumeSets: 1, prVolume: true, prWeight: false, prE1rm: false });
  const bests = await loadExerciseBests({ exerciseDefinitionId: 'lift' });
  expect(bests).toMatchObject({ latest: null, topWeight: null, oneRepMax: null, volume: { value: 500, sessionId: 'later', volumeSets: 1 } });
});

it('retains valid zero volume as an included observation with zero working counts', async () => {
  configure([], ['technique']);
  localDatabase().update(exerciseSets).set({ weightValue: '0' }).where(eq(exerciseSets.id, 'set-3')).run();
  const result = await read();
  expect(result.catalog).toMatchObject({ workingSetCount: 0, totalVolume: 0, estimatedOneRepMax: null });
  expect(result.daily[0]).toMatchObject({ workingSetCount: 0, totalVolume: 0 });
  expect(result.facts[0]).toMatchObject({ workingSets: 0, volumeSets: 1, volumeKg: 0 });
  expect(result.bests.volume).toBeNull();
});
