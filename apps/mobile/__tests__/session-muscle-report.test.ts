// The session views report the user's muscles ([[muscle.report-groups]]): the
// completed-session breakdown, the by-muscle volume comparison and live
// insights read one reading of the catalogue, so a session's figures agree
// everywhere. Under Broad a set counts once per muscle at its strongest role
// ([[muscle.set-count]]), and the comparison keeps a muscle that is primary for
// any of its entries ([[muscle.comparison-primary-only]]).
import { BROAD_MUSCLE_PRESET } from '@/src/data/muscle-report-presets';
import { buildMuscleSetup } from '@/src/exercise-catalog/muscle-setup';
import {
  buildSessionBreakdownMuscleRows,
  createCompletedSessionInsightsRepository,
  deriveSessionMuscleVolumeComparisons,
  sessionMuscleCatalogOfExercises,
  summarizeCurrentSessionMuscleLoad,
  type PersonalRecordSessionInput,
  type SessionInsightsStore,
} from '@/src/session-insights';

const ENTRIES = [
  { id: 'quads', displayName: 'Quads', familyName: 'Legs', sortOrder: 10 },
  { id: 'adductors', displayName: 'Adductors', familyName: 'Legs', sortOrder: 20 },
  { id: 'glutes_max', displayName: 'Glute Max', familyName: 'Legs', sortOrder: 30 },
  { id: 'hamstrings', displayName: 'Hamstrings', familyName: 'Legs', sortOrder: 40 },
  { id: 'chest', displayName: 'Pectoralis', familyName: 'Chest', sortOrder: 50 },
  { id: 'serratus_anterior', displayName: 'Serratus Anterior', familyName: 'Chest', sortOrder: 60 },
  { id: 'forearms_grip', displayName: 'Forearms', familyName: 'Arms', sortOrder: 70 },
];

/** The user's entry rows after choosing Broad: each member holds its muscle's key. */
const broadRows = ENTRIES.map((entry) => {
  const muscle = BROAD_MUSCLE_PRESET.muscles.find((candidate) => candidate.entries.includes(entry.id));
  return { ...entry, reportGroup: muscle?.key ?? null, tracked: 1 };
});
/** Broad, with the user's Track switch off for Forearms. */
const forearmsOffRows = broadRows.map((entry) => (entry.id === 'forearms_grip' ? { ...entry, tracked: 0 } : entry));
const detailedRows = ENTRIES.map((entry) => ({ ...entry, reportGroup: null, tracked: 1 }));

const exercise = (
  id: string,
  mappings: { muscleGroupId: string; role: 'primary' | 'secondary' | 'stabilizer' }[],
) => ({ id, bodyweightContribution: 0, loadInputMode: 'total_load' as const, mappings: mappings.map((m) => ({ ...m, weight: 1 })) });

const squat = exercise('squat', [
  { muscleGroupId: 'quads', role: 'primary' },
  { muscleGroupId: 'glutes_max', role: 'secondary' },
  { muscleGroupId: 'adductors', role: 'secondary' },
]);
const rdl = exercise('rdl', [
  { muscleGroupId: 'hamstrings', role: 'primary' },
  { muscleGroupId: 'glutes_max', role: 'primary' },
]);
const fly = exercise('fly', [
  { muscleGroupId: 'serratus_anterior', role: 'primary' },
  { muscleGroupId: 'forearms_grip', role: 'primary' },
]);
const press = exercise('press', [
  { muscleGroupId: 'chest', role: 'secondary' },
  { muscleGroupId: 'serratus_anterior', role: 'primary' },
]);
const bench = exercise('bench', [{ muscleGroupId: 'chest', role: 'secondary' }]);
const catalogExercises = [squat, rdl, fly, press, bench];

const sets = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => ({
  id: `${prefix}-${index}`, orderIndex: index, weightValue: '100', repsValue: '5', setType: 'rir_2', performanceStatus: null,
}));
const row = (exerciseDefinitionId: string, count: number, orderIndex: number) => ({
  id: `row-${exerciseDefinitionId}`, orderIndex, exerciseDefinitionId, exerciseName: exerciseDefinitionId, sets: sets(exerciseDefinitionId, count),
});
const DAY = new Date('2026-09-12T10:00:00.000Z');
const sessionOf = (sessionId: string, day: string, exercises: ReturnType<typeof row>[]): PersonalRecordSessionInput => ({
  sessionId, status: 'completed', completedAt: new Date(`2026-09-${day}T10:00:00.000Z`), exercises,
});

const catalogFor = (rows: typeof broadRows) =>
  sessionMuscleCatalogOfExercises(catalogExercises, ENTRIES, buildMuscleSetup(rows).assignment);

describe('completed-session muscle breakdown under Broad', () => {
  const summarize = (rows: typeof broadRows, exercises = [row('squat', 3, 0), row('rdl', 3, 1)]) =>
    summarizeCurrentSessionMuscleLoad({
      sessionId: 's', sessionAt: DAY, exercises, ...catalogFor(rows),
    });

  it('shows Quads and Glutes & Hams, counting the squat\'s secondary Glutes inside Glutes & Hams once', () => {
    const summary = summarize(broadRows);
    expect(summary.workingSetsByMuscle.map(({ id, displayName, primarySetCount, secondarySetCount, weightedSetCount }) =>
      ({ id, displayName, primarySetCount, secondarySetCount, weightedSetCount }))).toEqual([
      // RDL ×3 primary + squat ×3 secondary (Glute Max and Adductors collapse to one) = 3 + 1.5.
      { id: 'glutes_max', displayName: 'Glutes & Hams', primarySetCount: 3, secondarySetCount: 3, weightedSetCount: 4.5 },
      { id: 'quads', displayName: 'Quads', primarySetCount: 3, secondarySetCount: 0, weightedSetCount: 3 },
    ]);
    expect(summary.muscles.map((muscle) => muscle.displayName).sort()).toEqual(['Glutes & Hams', 'Quads']);
  });

  it('counts the squat alone as Quads 3 and Glutes & Hams 1.5', () => {
    const summary = summarize(broadRows, [row('squat', 3, 0)]);
    expect(summary.workingSetsByMuscle.map((muscle) => [muscle.displayName, muscle.weightedSetCount])).toEqual([
      ['Quads', 3], ['Glutes & Hams', 1.5],
    ]);
  });

  it('keeps every anatomy entry its own muscle under Detailed', () => {
    const summary = summarize(detailedRows);
    expect(summary.workingSetsByMuscle.map((muscle) => muscle.id).sort()).toEqual(
      ['adductors', 'glutes_max', 'hamstrings', 'quads'],
    );
  });

  it('drops untracked muscles from the breakdown while the sets stay counted as work', () => {
    const summary = summarize(forearmsOffRows, [row('fly', 2, 0)]);
    expect(summary.workingSetsByMuscle.map((muscle) => muscle.displayName)).toEqual(['Chest']);
    expect(summary.workingSetCount).toBe(2);
  });

  it('counts an exercise\'s record once on its muscle when two entries of it are primary', () => {
    const pushUp = exercise('push-up', [
      { muscleGroupId: 'chest', role: 'primary' },
      { muscleGroupId: 'serratus_anterior', role: 'primary' },
    ]);
    const catalog = sessionMuscleCatalogOfExercises([pushUp], ENTRIES, buildMuscleSetup(broadRows).assignment);
    const summary = summarizeCurrentSessionMuscleLoad({
      sessionId: 's', sessionAt: DAY, exercises: [row('push-up', 1, 0)], ...catalog,
    });
    const record = { exerciseDefinitionId: 'push-up', sets: [{ oneRepMax: true, topWeight: false }], volume: null };
    const rows = buildSessionBreakdownMuscleRows({
      muscleSummary: summary, personalRecords: [record as never], muscleMappings: catalog.muscleMappings,
    });
    expect(rows).toEqual([expect.objectContaining({ id: 'chest', displayName: 'Chest', recordCount: 1 })]);
  });
});

describe('by-muscle volume comparison under Broad', () => {
  const compare = (rows: typeof broadRows, targetRows: ReturnType<typeof row>[], history: PersonalRecordSessionInput[] = []) =>
    deriveSessionMuscleVolumeComparisons({
      targetSession: sessionOf('target', '12', targetRows), historicalSessions: history, ...catalogFor(rows),
    });

  it('includes a muscle when any entry is primary and excludes one trained only as secondary', () => {
    // Press maps Pectoralis secondary and Serratus primary: Chest is primary for one entry.
    expect(compare(broadRows, [row('press', 2, 0)]).map((comparison) => comparison.exerciseName)).toEqual(['Chest']);
    // Bench maps only Pectoralis secondary: no Chest comparison.
    expect(compare(broadRows, [row('bench', 2, 0)])).toEqual([]);
  });

  it('keeps entries apart under Detailed, so the secondary Pectoralis has no row of its own', () => {
    expect(compare(detailedRows, [row('press', 2, 0)]).map((comparison) => comparison.exerciseDefinitionId)).toEqual([
      'serratus_anterior',
    ]);
  });

  it('builds the baseline from earlier sessions under the same muscles', () => {
    const rows = compare(broadRows, [row('squat', 1, 0)], [
      sessionOf('earlier', '10', [row('squat', 2, 0)]),
    ]);
    expect(rows.find((comparison) => comparison.exerciseName === 'Quads')).toMatchObject({
      historicalSessionCount: 1, state: 'single-baseline', workingSetCount: 1,
    });
  });
});

describe('live insights and the completed session agree', () => {
  it('derive the same by-muscle comparison for the same sets under Broad', async () => {
    const target = sessionOf('target', '12', [row('squat', 3, 0), row('rdl', 3, 1)]);
    const earlier = sessionOf('earlier', '10', [row('squat', 2, 0), row('rdl', 2, 1)]);
    const live = deriveSessionMuscleVolumeComparisons({
      targetSession: target, historicalSessions: [earlier], ...catalogFor(broadRows),
    });

    const flat = (session: PersonalRecordSessionInput) => ({ sessionId: session.sessionId, status: session.status,
      completedAt: session.completedAt, bodyWeightKg: null, deletedAt: null });
    const store: SessionInsightsStore = {
      loadTargetSession: async () => flat(target),
      loadEarlierCompletedSessions: async () => [flat(earlier)],
      loadSessionExercises: async () => [target, earlier].flatMap((session) =>
        session.exercises.map((entry) => ({ ...entry, sessionId: session.sessionId }))),
      loadExerciseSets: async (ids) => [target, earlier].flatMap((session) => session.exercises)
        .filter((entry) => ids.includes(entry.id))
        .flatMap((entry) => entry.sets.map((set) => ({ ...set, sessionExerciseId: entry.id }))),
      loadEarlierRecordBaselines: async () => new Map(),
      loadMuscleCatalog: async () => ({
        definitions: catalogExercises.map((entry) => ({ id: entry.id, loadInputMode: entry.loadInputMode, bodyweightContribution: 0 })),
        mappings: catalogExercises.flatMap((entry) => entry.mappings.map((mapping) => ({ exerciseDefinitionId: entry.id, ...mapping }))),
        groups: broadRows,
      }),
    };
    // Ids repeat across the two sessions' rows, so give each its own.
    for (const session of [target, earlier]) {
      session.exercises = session.exercises.map((entry) => ({ ...entry, id: `${session.sessionId}-${entry.id}` }));
    }
    const completed = await createCompletedSessionInsightsRepository(store).loadInsights('target', 52);

    expect(completed?.muscleVolumeComparisons.map((comparison) => comparison.exerciseName).sort()).toEqual(['Glutes & Hams', 'Quads']);
    expect(completed?.muscleVolumeComparisons).toEqual(live);
  });

  it('reads a store that carries no muscle setup as Detailed', async () => {
    const target = sessionOf('target', '12', [{ ...row('squat', 1, 0), id: 'target-squat' }]);
    const store: SessionInsightsStore = {
      loadTargetSession: async () => ({ sessionId: 'target', status: 'completed', completedAt: target.completedAt, bodyWeightKg: null, deletedAt: null }),
      loadEarlierCompletedSessions: async () => [],
      loadSessionExercises: async () => target.exercises.map((entry) => ({ ...entry, sessionId: 'target' })),
      loadExerciseSets: async () => target.exercises.flatMap((entry) => entry.sets.map((set) => ({ ...set, sessionExerciseId: entry.id }))),
      loadEarlierRecordBaselines: async () => new Map(),
      loadMuscleCatalog: async () => ({
        definitions: [{ id: 'squat', loadInputMode: 'total_load', bodyweightContribution: 0 }],
        mappings: squat.mappings.map((mapping) => ({ exerciseDefinitionId: 'squat', ...mapping })),
        groups: ENTRIES,
      }),
    };
    const completed = await createCompletedSessionInsightsRepository(store).loadInsights('target', 52);
    expect(completed?.muscleVolumeComparisons.map((comparison) => comparison.exerciseDefinitionId)).toEqual(['quads']);
  });
});
