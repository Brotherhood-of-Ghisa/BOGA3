// Progress reads the user's muscles ([[muscle.report-groups]]): the data path, the
// 3D body, the exercise 3D shading and the helpers the screens share.
import { buildExerciseBodyMuscle, buildExerciseBodyMuscles, type ExerciseBodyItem } from '@/components/stats/exercise-body-data';
import {
  buildThemeShadePalette, hitTestProjectedMuscle, projectMuscleBody,
} from '@/components/stats/muscle-body-projection';
import { MUSCLE_BODY_MESH } from '@/components/stats/muscle-body-mesh';
import {
  compareFamilySections, countFamilyMuscles, familyHasHeader, sortProgressMuscles,
} from '@/components/stats/progress-tables';
import type { ExerciseCatalogExercise, ExerciseCatalogMuscleGroup } from '@/src/data/exercise-catalog';
import { SYSTEM_MUSCLE_GROUP_SEEDS } from '@/src/data/exercise-catalog-seeds';
import { buildMuscleReportAssignment } from '@/src/data/muscle-report-presets';
import type { ProgressMuscleComparison } from '@/src/data/progress-comparisons';
import { reportMuscleTrainingStarts } from '@/src/data/progress-muscle-tickers';
import { createStatsRepository, type StatsAggregationInput, type StatsStore } from '@/src/data/stats';
import {
  NO_MUSCLE_REPORT, muscleReportOfGroups, reportedExerciseMuscles, reportedExerciseSearchText,
  reportedMuscleName, reportedPrimaryFamilyName,
} from '@/src/exercise-catalog/reported-muscles';
import { broadMuscleReport, broadMuscleRows } from './helpers/broad-muscle-report';

const BROAD = broadMuscleReport(['calves']);
const MERGED_BACK = ['back_upper', 'traps_upper', 'traps_lower'];
// Broad leaves three untracked; this setup also switches Calves off.
const UNTRACKED = ['rotator_cuff', 'forearms_grip', 'spinal_erectors', 'calves'];

const catalogById = Object.fromEntries(SYSTEM_MUSCLE_GROUP_SEEDS.map(seed => [seed.id, seed])) as
  unknown as Record<string, ExerciseCatalogMuscleGroup>;
const exercise = (mappings: [string, 'primary' | 'secondary' | 'stabilizer'][]): ExerciseCatalogExercise => ({
  id: 'squat', name: 'Squat', bodyweightContribution: 0, splitByGym: false, deletedAt: null,
  mappings: mappings.map(([muscleGroupId, role]) => ({ id: `${muscleGroupId}-map`, muscleGroupId, weight: role === 'primary' ? 1 : .5, role })),
});

describe('3D body under the user’s muscles', () => {
  const buckets = new Map([['back_lats', 4 as const], ['chest', 2 as const]]);
  const project = (report?: typeof BROAD, angleDeg = 180) =>
    projectMuscleBody({ angleDeg, width: 300, height: 560, buckets, report });
  const palette = buildThemeShadePalette();

  it('gives every member mesh of a muscle its shade and the muscle’s id', () => {
    const detailed = project(undefined);
    const broad = project(BROAD);
    const memberTriangles = detailed.triangles.filter(tri => ['back_lats', ...MERGED_BACK].includes(tri.muscleGroupId));
    expect(MERGED_BACK.every(id => detailed.triangles.some(tri => tri.muscleGroupId === id))).toBe(true);
    const back = broad.triangles.filter(tri => tri.muscleGroupId === 'back_lats');
    expect(back).toHaveLength(memberTriangles.length);
    expect(new Set(back.map(tri => tri.fill)).size).toBeLessThanOrEqual(12);
    expect(back.every(tri => palette.buckets[4].includes(tri.fill))).toBe(true);
    expect(broad.triangles.some(tri => MERGED_BACK.includes(tri.muscleGroupId))).toBe(false);
  });

  it('leaves untracked meshes neutral and not tappable, and a tapped member selects its muscle', () => {
    const detailed = project(undefined);
    const broad = project(BROAD);
    expect(broad.triangles.some(tri => UNTRACKED.includes(tri.muscleGroupId))).toBe(false);
    const centreOf = (material: string, source: typeof detailed) => {
      for (const tri of [...source.triangles].reverse().filter(candidate => candidate.muscleGroupId === material)) {
        const x = (tri.x0 + tri.x1 + tri.x2) / 3;
        const y = (tri.y0 + tri.y1 + tri.y2) / 3;
        if (hitTestProjectedMuscle(source, x, y) === material) return { x, y };
      }
      throw new Error(`No ${material} facet is visible`);
    };
    for (const entry of MERGED_BACK) {
      const { x, y } = centreOf(entry, detailed);
      expect(hitTestProjectedMuscle(broad, x, y)).toBe('back_lats');
    }
    const erectors = centreOf('spinal_erectors', detailed);
    expect(hitTestProjectedMuscle(broad, erectors.x, erectors.y)).toBeNull();
    // The untracked facets did not vanish: they are drawn as neutral anatomy.
    const neutral = (body: typeof detailed) => body.triangles.filter(tri => tri.muscleGroupId === 'neutral').length;
    const untrackedFacets = detailed.triangles.filter(tri => UNTRACKED.includes(tri.muscleGroupId)).length;
    expect(untrackedFacets).toBeGreaterThan(0);
    expect(neutral(broad)).toBe(neutral(detailed) + untrackedFacets);
    expect(broad.triangles).toHaveLength(detailed.triangles.length);
  });

  it('marks a muscle selected across all its member meshes', () => {
    const selected = projectMuscleBody({ angleDeg: 180, width: 300, height: 560, buckets, report: BROAD, selectedId: 'back_lats' });
    const back = selected.triangles.filter(tri => tri.muscleGroupId === 'back_lats');
    expect(back.length).toBeGreaterThan(0);
    expect(back.every(tri => tri.selected)).toBe(true);
  });

  it('is unchanged under Detailed', () => {
    const detailedReport = buildMuscleReportAssignment(broadMuscleRows().map(row => ({ ...row, reportGroup: null, tracked: 1 })));
    expect(project(detailedReport)).toEqual(project(undefined));
    expect(MUSCLE_BODY_MESH.materials).toContain('serratus_anterior');
  });
});

describe('Exercise 3D shading under the user’s muscles', () => {
  const period = (sets = 0, volume: number | null = 0) => ({ workingSetCount: sets, totalVolume: volume, volumeSetCount: sets });
  const muscle = (id: string): ProgressMuscleComparison => ({
    muscleGroupId: id, displayName: id, familyName: 'Legs', sortOrder: 0,
    current: period(), previous: period(), exercises: [], workingSetChange: 0, volumeChange: { kind: 'empty' },
  });
  const item: ExerciseBodyItem = { id: 'squat', name: 'Squat', current: period(3, 300), previous: period(), lastCompletedAt: null };
  const squat = exercise([['quads', 'primary'], ['glutes_max', 'secondary'], ['hamstrings', 'secondary'],
    ['adductors', 'secondary'], ['forearms_grip', 'primary']]);
  const input = { items: [item], exercises: [squat], muscles: [muscle('quads'), muscle('glutes_max')], report: BROAD };

  it('counts a set once per muscle at its strongest entry, as Quads 3 and Glutes & Hams 1.5', () => {
    const [quads, glutes] = buildExerciseBodyMuscles(input);
    expect(quads.current.workingSetCount).toBe(3);
    expect(glutes.current.workingSetCount).toBe(1.5);
    expect(glutes.current.totalVolume).toBe(150);
  });

  it('lists an exercise under the muscle one of its entries maps and ignores untracked mappings', () => {
    const hamstringsOnly = exercise([['hamstrings', 'primary'], ['forearms_grip', 'secondary']]);
    const detail = buildExerciseBodyMuscle({ ...input, exercises: [hamstringsOnly], muscleGroupId: 'glutes_max' })!;
    expect(detail.exercises.map(entry => entry.item.id)).toEqual(['squat']);
    expect(buildExerciseBodyMuscle({ ...input, exercises: [hamstringsOnly], muscleGroupId: 'forearms_grip' })).toBeNull();
    expect(buildExerciseBodyMuscles({ ...input, exercises: [hamstringsOnly], countSecondary: false })[1].current.workingSetCount).toBe(3);
  });

  it('drops a muscle reached only as a secondary when secondary work is off', () => {
    const secondaryOnly = exercise([['adductors', 'secondary']]);
    const [quads] = buildExerciseBodyMuscles({ ...input, exercises: [secondaryOnly], countSecondary: false });
    expect(quads.current.workingSetCount).toBe(0);
  });
});

describe('the user’s muscles in catalogue helpers', () => {
  it('reads Detailed rows as every entry its own tracked muscle', () => {
    const detailed = muscleReportOfGroups(SYSTEM_MUSCLE_GROUP_SEEDS.map(seed => ({ ...seed })));
    expect(reportedExerciseMuscles(exercise([['quads', 'primary'], ['adductors', 'secondary']]), detailed)).toEqual([
      { muscleGroupId: 'quads', role: 'primary' }, { muscleGroupId: 'adductors', role: 'secondary' }]);
    expect(reportedMuscleName(NO_MUSCLE_REPORT, catalogById, 'adductors')).toBe(catalogById.adductors.displayName);
  });

  it('shows Quads once at the strongest role and hides untracked mappings', () => {
    const squat = exercise([['adductors', 'secondary'], ['quads', 'primary'], ['hip_flexors', 'secondary'], ['forearms_grip', 'secondary']]);
    expect(reportedExerciseMuscles(squat, BROAD)).toEqual([{ muscleGroupId: 'quads', role: 'primary' }]);
    const entryFirst = exercise([['hamstrings', 'primary'], ['glutes_max', 'secondary']]);
    expect(reportedExerciseMuscles(entryFirst, BROAD)).toEqual([{ muscleGroupId: 'glutes_max', role: 'primary' }]);
  });

  it('names only a muscle the user has', () => {
    expect(reportedMuscleName(BROAD, catalogById, 'back_lats')).toBe('Back');
    expect(reportedMuscleName(BROAD, catalogById, 'back_upper')).toBeNull();
    expect(reportedMuscleName(BROAD, catalogById, 'forearms_grip')).toBeNull();
    expect(reportedMuscleName(broadMuscleReport(['calves']), catalogById, 'calves')).toBeNull();
    expect(reportedMuscleName(BROAD, catalogById, 'glutes_max')).toBe('Glutes & Hams');
    expect(reportedMuscleName(BROAD, catalogById, 'unknown')).toBeNull();
  });

  it('places an exercise under its primary tracked muscle’s family, else Other', () => {
    const byId = new Map(Object.entries(catalogById));
    expect(reportedPrimaryFamilyName(exercise([['serratus_anterior', 'primary']]), BROAD, byId)).toBe('Chest');
    expect(reportedPrimaryFamilyName(exercise([['forearms_grip', 'primary'], ['biceps', 'secondary']]), BROAD, byId)).toBe('Arms');
    expect(reportedPrimaryFamilyName(exercise([['forearms_grip', 'primary']]), BROAD, byId)).toBe('Other');
    expect(reportedPrimaryFamilyName(exercise([['forearms_grip', 'primary']]), NO_MUSCLE_REPORT, byId)).toBe('Arms');
    expect(reportedPrimaryFamilyName(exercise([]), BROAD, byId)).toBe('Other');
  });

  it('searches an exercise by its muscles’ names, never a merged entry’s', () => {
    const row = exercise([['back_upper', 'primary'], ['spinal_erectors', 'primary']]);
    expect(reportedExerciseSearchText(row, BROAD, catalogById)).toBe('squat back back');
    expect(reportedExerciseSearchText(row, NO_MUSCLE_REPORT, catalogById)).toContain('upper back');
    expect(reportedExerciseSearchText(exercise([['quads', 'secondary']]), BROAD, catalogById)).toBe('squat');
  });
});

describe('family headers follow the user’s muscles', () => {
  const counts = countFamilyMuscles(['Shoulders', 'Shoulders', 'Shoulders', 'Chest']);

  it('shows a header only above two or more muscles, and always for Other', () => {
    expect(familyHasHeader('Shoulders', counts)).toBe(true);
    expect(familyHasHeader('Chest', counts)).toBe(false);
    expect(familyHasHeader('Other', counts)).toBe(true);
    expect(familyHasHeader('Chest')).toBe(true);
  });

  it('puts headerless families first so no muscle sits under another family’s header', () => {
    expect(['Shoulders', 'Other', 'Chest', 'Legs'].sort((left, right) => compareFamilySections(left, right, counts)))
      .toEqual(['Chest', 'Legs', 'Shoulders', 'Other']);
  });

  it('sorts a grouped muscle list with the same rule', () => {
    const row = (id: string, familyName: string) => ({ muscleGroupId: id, displayName: id, familyName } as ProgressMuscleComparison);
    const rows = [row('front', 'Shoulders'), row('chest', 'Chest'), row('rear', 'Shoulders')];
    expect(sortProgressMuscles(rows, 'name-asc', 'workingSetCount', true).map(entry => entry.muscleGroupId))
      .toEqual(['chest', 'front', 'rear']);
  });
});

describe('training starts under the user’s muscles', () => {
  const at = (day: number) => new Date(Date.UTC(2026, 0, day));

  it('starts a muscle when its earliest entry did and drops untracked entries', () => {
    const starts = {
      back_lats: { workingSetCount: at(9), totalVolume: undefined },
      back_upper: { workingSetCount: at(3), totalVolume: at(5) },
      traps_lower: { workingSetCount: at(20), totalVolume: at(2) },
      forearms_grip: { workingSetCount: at(1) },
      quads: { workingSetCount: at(7) },
    };
    expect(reportMuscleTrainingStarts(starts, BROAD)).toEqual({
      back_lats: { workingSetCount: at(3), totalVolume: at(2) },
      quads: { workingSetCount: at(7) },
    });
    expect(reportMuscleTrainingStarts(undefined, BROAD)).toBeUndefined();
    expect(reportMuscleTrainingStarts(starts, NO_MUSCLE_REPORT)).toEqual(starts);
  });
});

describe('Progress reads under the user’s muscles', () => {
  const NOW = new Date('2026-10-14T12:00:00Z');
  const baseInput = (): StatsAggregationInput => ({
    sessions: [{ id: 's1', completedAt: new Date('2026-10-13T10:00:00Z') }],
    exerciseDefinitions: [{ id: 'row', loadInputMode: 'total_load', bodyweightContribution: 0 }],
    sessionExercises: [{ id: 'b1', sessionId: 's1', exerciseDefinitionId: 'row', exerciseName: 'Row' }],
    exerciseSets: [{ id: 'set1', sessionExerciseId: 'b1', orderIndex: 0, setType: null, weightValue: '100', repsValue: '5', performanceStatus: null }],
    muscleMappings: [
      { exerciseDefinitionId: 'row', muscleGroupId: 'back_upper', role: 'primary' },
      { exerciseDefinitionId: 'row', muscleGroupId: 'back_lats', role: 'secondary' },
      { exerciseDefinitionId: 'row', muscleGroupId: 'forearms_grip', role: 'secondary' },
    ],
    muscleGroups: SYSTEM_MUSCLE_GROUP_SEEDS.map(({ id, displayName, familyName, sortOrder }) => ({ id, displayName, familyName, sortOrder })),
    muscleReport: BROAD,
    muscleTrainingStarts: {
      back_upper: { workingSetCount: new Date('2026-09-01T00:00:00Z') },
      back_lats: { workingSetCount: new Date('2026-08-01T00:00:00Z') },
      forearms_grip: { workingSetCount: new Date('2026-07-01T00:00:00Z') },
    },
  });
  const repository = (input = baseInput()) => {
    const store: StatsStore = { loadAggregationInput: jest.fn().mockResolvedValue(input), loadMuscleGroupTaxonomy: jest.fn() };
    return { repo: createStatsRepository(store), store };
  };

  it('lists the tracked muscles with merged entries counted together, once per set', async () => {
    const { repo } = repository();
    const { muscles } = await repo.computeProgressComparisons({ periodWeeks: 1, now: NOW });
    expect(muscles.map(row => row.muscleGroupId)).not.toContain('serratus_anterior');
    expect(muscles.map(row => row.muscleGroupId)).not.toContain('back_upper');
    expect(muscles.map(row => row.muscleGroupId)).not.toContain('forearms_grip');
    // Calves is switched off in this setup, so Broad's other ten remain.
    expect(muscles).toHaveLength(10);
    expect(muscles.map(row => row.muscleGroupId)).not.toContain('calves');
    const back = muscles.find(row => row.muscleGroupId === 'back_lats')!;
    expect(back.displayName).toBe('Back');
    expect(back.current.workingSetCount).toBe(1);
    expect(back.exercises.map(entry => [entry.exerciseDefinitionId, entry.role])).toEqual([['row', 'primary']]);
  });

  it('keeps entries as they are without a muscle setup', async () => {
    const input = baseInput();
    delete input.muscleReport;
    const { repo } = repository(input);
    const { muscles } = await repo.computeProgressComparisons({ periodWeeks: 1, now: NOW });
    expect(muscles).toHaveLength(SYSTEM_MUSCLE_GROUP_SEEDS.length);
    expect(muscles.find(row => row.muscleGroupId === 'back_upper')!.current.workingSetCount).toBe(1);
  });

  it('reads a muscle’s history across its entries and its ticker from the earliest entry start', async () => {
    const { repo } = repository();
    const daily = await repo.computeSelectedMuscleHistoryEffort({
      start: new Date('2026-10-01T00:00:00Z'), end: NOW, muscleGroupIds: ['back_lats'], timeZone: 'UTC',
    });
    expect(daily.daily.map(day => [day.dateKey, day.workingSetCount])).toEqual([['2026-10-13', 1]]);
    const noSecondary = await repo.computeSelectedMuscleHistoryEffort({
      start: new Date('2026-10-01T00:00:00Z'), end: NOW, muscleGroupIds: ['back_lats'], timeZone: 'UTC', countSecondary: false,
    });
    expect(noSecondary.daily.map(day => day.workingSetCount)).toEqual([1]);

    // Only the merged-away entry has a training start: the muscle still gets its ticker values.
    const merged = baseInput();
    delete merged.muscleTrainingStarts!.back_lats;
    const { repo: mergedRepo } = repository(merged);
    const tickers = await mergedRepo.computeMuscleTickers({ historyWeeks: 1, rollingWeeks: 1, weeklyTarget: 10, now: NOW });
    expect(Object.keys(tickers.muscles)).toEqual(['back_lats']);
    expect(tickers.muscles.back_lats.workingSetCount.observations.map(row => row.value)).toEqual([1]);
  });
});
