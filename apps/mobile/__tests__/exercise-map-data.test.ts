import { buildExerciseMapFamilies, exerciseMapLayout, exerciseMapTileRects, type ExerciseMapEntry, type ExerciseMapItem } from '@/components/stats/exercise-map-data';
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
  expect(families.find(family => family.name === 'Arms')!.exercises).toEqual([]);
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
