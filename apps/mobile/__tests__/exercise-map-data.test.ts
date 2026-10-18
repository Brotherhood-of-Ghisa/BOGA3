import { buildExerciseMapFamilies, exerciseMapLayout, exerciseMapTileRects, exerciseMapValue, type ExerciseMapEntry, type ExerciseMapItem } from '@/components/stats/exercise-map-data';
import { MUSCLE_MAP_FAMILY_VOLUMES, MUSCLE_MAP_INSET, MUSCLE_MAP_HEADER } from '@/components/stats/muscle-map-layout';
import type { ProgressMuscleComparison } from '@/src/data/progress-comparisons';
import type { ExerciseCatalogExercise } from '@/src/data/exercise-catalog';

const period = (sets = 0, volume: number | null = 0) => ({ workingSetCount: sets, totalVolume: volume, volumeSetCount: sets });
const muscle = (id: string, family: string, sets: number): ProgressMuscleComparison => ({
  muscleGroupId: id, displayName: id, familyName: family, sortOrder: 0, current: period(sets), previous: period(),
  exercises: [], workingSetChange: sets, volumeChange: { kind: 'empty' },
});
const item = (id: string, sets = 6, volume: number | null = 100): ExerciseMapItem => ({
  id, name: id, current: period(sets, volume), previous: period(2, 50), lastCompletedAt: null,
});
const definition = (id: string, primary: string[], secondary: string[] = []): Pick<ExerciseCatalogExercise, 'id' | 'mappings'> => ({
  id, mappings: [...primary.map(muscleGroupId => ({ id: muscleGroupId, muscleGroupId, weight: 1, role: 'primary' as const })),
    ...secondary.map(muscleGroupId => ({ id: muscleGroupId, muscleGroupId, weight: .5, role: 'secondary' as const }))],
});

it('uses full exercise values once per primary family, and caps primary-muscle attainment before averaging', () => {
  const deadlift = item('deadlift');
  const families = buildExerciseMapFamilies({ items: [deadlift, item('squat'), item('extension'), item('unmapped')],
    exercises: [definition('deadlift', ['hams', 'glutes', 'hams', 'erectors'], ['hams', 'biceps']),
      definition('squat', ['quads']), definition('extension', ['quads']), definition('unmapped', [], ['biceps'])],
    muscles: [muscle('hams', 'Legs', 100), muscle('glutes', 'Legs', 0), muscle('quads', 'Legs', 6),
      muscle('erectors', 'Back', 4), muscle('biceps', 'Arms', 8)], workingSetTarget: 8 });
  const legs = families.find(family => family.name === 'Legs')!;
  const back = families.find(family => family.name === 'Back')!;
  expect(legs.exercises.map(entry => entry.item.id)).toEqual(['deadlift', 'squat', 'extension']);
  expect(legs.exercises[0]).toEqual({ item: deadlift, targetAttainment: .5 });
  expect(back.exercises).toEqual([{ item: deadlift, targetAttainment: .5 }]);
  expect(legs.exercises.slice(1).map(entry => entry.targetAttainment)).toEqual([.75, .75]);
  const arms = families.find(family => family.name === 'Arms')!;
  expect(arms.exercises).toEqual([]);
  expect(arms.secondary?.exercises.map(entry => entry.item.id)).toEqual(['deadlift', 'unmapped']);
  expect(arms.secondary?.current).toEqual({ ...period(6, 100), volumeSetCount: 12 });
  expect(legs.secondary).toBeNull();
  expect(families).toHaveLength(7);
});

it('keeps target colour independent of filtered exercise rows, and uses the full selected-period target', () => {
  const input = { items: [item('squat')], exercises: [definition('squat', ['quads'])],
    muscles: [muscle('quads', 'Legs', 8)], workingSetTarget: 32 };
  expect(buildExerciseMapFamilies(input).find(family => family.name === 'Legs')!.exercises[0].targetAttainment).toBe(.25);
  expect(buildExerciseMapFamilies({ ...input, muscles: [] }).every(family => family.exercises.length === 0)).toBe(true);
  expect(buildExerciseMapFamilies({ ...input, exercises: [] }).every(family => family.exercises.length === 0)).toBe(true);
});

it.each(['workingSetCount', 'totalVolume'] as const)('preserves exact %s areas without inflating tiny or zero tiles', metric => {
  const entries: ExerciseMapEntry[] = [item('large', 100, 100), item('medium', 30, 30), item('tiny', .0001, .0001),
    item('zero', 0, 0), item('unavailable', 0, null)].map(row => ({ item: row, targetAttainment: .5 }));
  for (const width of [288, 343, 398]) {
    const outer = exerciseMapLayout(width).families.Legs;
    const bounds = { x: MUSCLE_MAP_INSET, y: MUSCLE_MAP_HEADER, width: outer.width - MUSCLE_MAP_INSET * 2,
      height: outer.height - MUSCLE_MAP_HEADER - MUSCLE_MAP_INSET };
    const tiles = exerciseMapTileRects(entries, bounds, metric);
    const area = bounds.width * bounds.height;
    expect(tiles.map(tile => tile.entry.item.id)).toEqual(['large', 'medium', 'tiny']);
    expect(tiles.reduce((sum, tile) => sum + tile.bounds.width * tile.bounds.height, 0)).toBeCloseTo(area, 7);
    for (const tile of tiles) {
      const value = metric === 'workingSetCount' ? tile.entry.item.current.workingSetCount : tile.entry.item.current.totalVolume!;
      expect(tile.bounds.width * tile.bounds.height / area).toBeCloseTo(value / 130.0001, 12);
      expect(tile.bounds.x).toBeGreaterThanOrEqual(bounds.x);
      expect(tile.bounds.y).toBeGreaterThanOrEqual(bounds.y);
      expect(tile.bounds.x + tile.bounds.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-8);
      expect(tile.bounds.y + tile.bounds.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1e-8);
    }
    expect(Math.min(tiles[2].bounds.width, tiles[2].bounds.height)).toBeLessThan(1);
    expect(exerciseMapTileRects([], bounds, metric)).toEqual([]);
  }
});

it('normalizes large finite weights without overflowing a family sum', () => {
  const entries = [item('a', 1, Number.MAX_VALUE), item('b', 1, Number.MAX_VALUE), item('invalid', 1, Infinity)]
    .map(row => ({ item: row, targetAttainment: 0 }));
  const tiles = exerciseMapTileRects(entries, { x: 0, y: 0, width: 100, height: 100 }, 'totalVolume');
  expect(tiles).toHaveLength(2);
  expect(tiles.map(tile => tile.bounds.width * tile.bounds.height)).toEqual([5000, 5000]);
});


it.each([288, 343, 398])('keeps fixed family shares and readable family targets at width %i', width => {
  const layout = exerciseMapLayout(width);
  const total = Object.values(MUSCLE_MAP_FAMILY_VOLUMES).reduce((sum, value) => sum + value, 0);
  for (const [family, bounds] of Object.entries(layout.families)) {
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height - MUSCLE_MAP_HEADER - MUSCLE_MAP_INSET).toBeGreaterThanOrEqual(44 - 1e-8);
    expect(bounds.width * bounds.height / width / layout.height)
      .toBeCloseTo(MUSCLE_MAP_FAMILY_VOLUMES[family as keyof typeof MUSCLE_MAP_FAMILY_VOLUMES] / total, 12);
  }
});

const withContributor = (row: ProgressMuscleComparison, id: string, now = 1, previous = 0, volumeSets = now): ProgressMuscleComparison => ({
  ...row, exercises: [{ exerciseDefinitionId: id, displayName: id, role: 'secondary',
    current: { ...period(now), volumeSetCount: volumeSets }, previous: period(previous),
    workingSetChange: now - previous, volumeChange: { kind: 'empty' } }],
});

it('deduplicates secondary muscles within a family, keeps primary dominance and preserves cross-family roles', () => {
  const bench = item('bench', 4, 1600);
  const families = buildExerciseMapFamilies({ items: [bench, item('direct', 3, 600), item('mixed', 2, 100)],
    exercises: [definition('bench', ['chest'], ['triceps', 'biceps', 'triceps']), definition('direct', ['triceps']),
      definition('mixed', ['chest', 'triceps'], ['biceps'])],
    muscles: [muscle('chest', 'Chest', 6), muscle('triceps', 'Arms', 7), muscle('biceps', 'Arms', 2)], workingSetTarget: 8 });
  const arms = families.find(family => family.name === 'Arms')!;
  const chest = families.find(family => family.name === 'Chest')!;
  expect(arms.exercises.map(entry => entry.item.id)).toEqual(['direct', 'mixed']);
  expect(arms.secondary?.exercises.map(entry => entry.item.id)).toEqual(['bench']);
  expect(arms.secondary?.current).toEqual({ ...period(2, 800), volumeSetCount: 4 });
  expect(arms.secondary?.previous).toEqual({ ...period(1, 25), volumeSetCount: 2 });
  expect(chest.exercises.map(entry => entry.item.id)).toEqual(['bench', 'mixed']);
  expect(chest.secondary).toBeNull();
  expect(arms.secondary).not.toHaveProperty('id');
  const tiles = exerciseMapTileRects([...arms.exercises, arms.secondary!], { x: 0, y: 0, width: 100, height: 100 }, 'workingSetCount');
  expect(tiles.find(tile => tile.entry === arms.secondary)!.bounds.width * tiles.find(tile => tile.entry === arms.secondary)!.bounds.height).toBeCloseTo(10000 * 2 / 7);
});

it('uses unfiltered current/previous working contributors for the Secondary target, capped before averaging', () => {
  const muscles = [withContributor(muscle('triceps', 'Arms', 100), 'bench'),
    withContributor(muscle('biceps', 'Arms', 0), 'previous-only', 0, 2),
    withContributor(muscle('other', 'Arms', 8), 'volume-only', 0, 0, 1)];
  const all = { items: [item('bench'), { ...item('previous-only'), current: period() }],
    exercises: [definition('bench', [], ['triceps']), definition('previous-only', [], ['biceps']), definition('volume-only', [], ['other'])],
    muscles, workingSetTarget: 8 };
  const unfiltered = buildExerciseMapFamilies(all).find(family => family.name === 'Arms')!.secondary!;
  const filtered = buildExerciseMapFamilies({ ...all, items: [{ ...item('bench'), current: period(1, 10) }] }).find(family => family.name === 'Arms')!.secondary!;
  expect(unfiltered.targetAttainment).toBe(.5);
  expect(filtered.targetAttainment).toBe(.5);
  expect(filtered.current.workingSetCount).toBe(.5);
  expect(unfiltered.exercises.find(entry => entry.item.id === 'previous-only')!.item.previous.workingSetCount).toBe(1);
});

it('weights each full exercise Volume before summing, propagating unavailable values and genuine overflow', () => {
  const input = { exercises: ['a', 'b', 'c'].map(id => definition(id, [], ['triceps'])),
    muscles: [muscle('triceps', 'Arms', 0)], workingSetTarget: 8 };
  const secondary = (items: ExerciseMapItem[]) => buildExerciseMapFamilies({ ...input, items }).find(family => family.name === 'Arms')!.secondary!;
  expect(secondary([item('a', 1, Number.MAX_VALUE), item('b', 1, Number.MAX_VALUE)]).current.totalVolume).toBe(Number.MAX_VALUE);
  expect(secondary(['a', 'b', 'c'].map(id => item(id, 1, Number.MAX_VALUE))).current.totalVolume).toBeNull();
  for (const unavailable of [null, Infinity, NaN]) {
    const aggregate = secondary([item('a', 1, unavailable), item('b', 1, 40)]);
    expect(aggregate.current.totalVolume).toBeNull();
    expect(aggregate.exercises[0].item.current.totalVolume).toBeNull();
    expect(aggregate.previous.totalVolume).toBe(50);
    expect(exerciseMapValue(aggregate, 'totalVolume')).toBe(0);
  }
  const overflowingSets = secondary(['a', 'b', 'c'].map(id => item(id, Number.MAX_VALUE, 1)));
  expect(Number.isFinite(overflowingSets.current.workingSetCount)).toBe(false);
  expect(exerciseMapValue(overflowingSets, 'workingSetCount')).toBe(0);
  const zero = secondary([{ ...item('a'), current: period(0, 0) }]);
  expect(zero.current.totalVolume).toBe(0);
  expect(zero.previous.totalVolume).toBe(25);
  expect(zero.exercises).toHaveLength(1);
  expect(exerciseMapTileRects([zero], { x: 0, y: 0, width: 100, height: 100 }, 'totalVolume')).toEqual([]);
});
