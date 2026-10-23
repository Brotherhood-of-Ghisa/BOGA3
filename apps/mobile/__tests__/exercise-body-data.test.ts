import { buildExerciseBodyMuscle, buildExerciseBodyMuscles, type ExerciseBodyItem } from '@/components/stats/exercise-body-data';
import type { ProgressMuscleComparison } from '@/src/data/progress-comparisons';
import type { ExerciseCatalogExercise } from '@/src/data/exercise-catalog';

const period = (sets = 0, volume: number | null = 0) => ({ workingSetCount: sets, totalVolume: volume, volumeSetCount: sets });
const muscle = (id: string): ProgressMuscleComparison => ({
  muscleGroupId: id, displayName: id, familyName: 'Arms', sortOrder: 0,
  current: period(), previous: period(), exercises: [], workingSetChange: 0, volumeChange: { kind: 'empty' },
});
const item = (id: string, volume: number | null = 100): ExerciseBodyItem => ({
  id, name: id, current: period(6, volume), previous: period(2, 50), lastCompletedAt: null,
});
const definition = (id: string, primary: string[], secondary: string[] = []): Pick<ExerciseCatalogExercise, 'id' | 'mappings'> => ({
  id, mappings: [...primary.map(muscleGroupId => ({ id: muscleGroupId, muscleGroupId, weight: 1, role: 'primary' as const })),
    ...secondary.map(muscleGroupId => ({ id: muscleGroupId, muscleGroupId, weight: .5, role: 'secondary' as const }))],
});

it('keeps primary precedence, half-weight secondary work and filtered exercise membership in 3D', () => {
  const input = { items: [item('curl'), item('press'), item('missing')],
    exercises: [definition('curl', ['biceps', 'biceps'], ['biceps']), definition('press', [], ['biceps'])],
    muscles: [muscle('biceps'), muscle('triceps')] };
  const shaded = buildExerciseBodyMuscles(input);
  expect(shaded[0].current).toEqual({ ...period(9, 150), volumeSetCount: 12 });
  expect(shaded[0].previous).toEqual({ ...period(3, 75), volumeSetCount: 4 });
  expect(shaded[1].current).toEqual(period());
  const selected = buildExerciseBodyMuscle({ ...input, muscleGroupId: 'biceps' })!;
  expect(selected.exercises.map(entry => entry.item.id)).toEqual(['curl']);
  expect(selected.secondary.map(entry => entry.item.id)).toEqual(['press']);
  expect(selected.secondary[0].item.current).toEqual({ ...period(3, 50), volumeSetCount: 6 });
  expect(buildExerciseBodyMuscles({ ...input, items: [item('curl')] })[0].current).toEqual(period(6, 100));
});

it.each([null, Number.MAX_VALUE])('keeps unavailable or overflowing Volume unavailable in the body and detail (%s)', volume => {
  const input = { items: [item('a', volume), item('b', volume)],
    exercises: [definition('a', [], ['biceps']), definition('b', [], ['biceps'])], muscles: [muscle('biceps')] };
  // Two secondary MAX_VALUE contributions are finite; four overflow their aggregate.
  const overflowing = { ...input, items: [...input.items, ...input.items] };
  expect(buildExerciseBodyMuscles(overflowing)[0].current.totalVolume).toBeNull();
  const detail = buildExerciseBodyMuscle({ ...overflowing, muscleGroupId: 'biceps' })!;
  expect(detail.secondary).toHaveLength(4);
  expect(detail.secondary[0].item.current.totalVolume).toBe(volume === null ? null : volume * .5);
});

it('keeps known zero Volume and empty muscles while rejecting an absent selection', () => {
  const input = { items: [item('curl', 0)], exercises: [definition('curl', ['biceps'])], muscles: [muscle('biceps'), muscle('triceps')] };
  expect(buildExerciseBodyMuscles(input)[0].current.totalVolume).toBe(0);
  expect(buildExerciseBodyMuscle({ ...input, muscleGroupId: 'biceps' })?.secondary).toEqual([]);
  expect(buildExerciseBodyMuscle({ ...input, muscleGroupId: 'triceps' })?.exercises).toEqual([]);
  expect(buildExerciseBodyMuscle({ ...input, muscleGroupId: null })).toBeNull();
  expect(buildExerciseBodyMuscle({ ...input, muscleGroupId: 'missing' })).toBeNull();
});

it('drops secondary work from the body and the selected muscle when secondary sets are hidden', () => {
  const input = { items: [item('curl'), item('press')], countSecondary: false,
    exercises: [definition('curl', ['biceps'], ['triceps']), definition('press', [], ['biceps'])],
    muscles: [muscle('biceps'), muscle('triceps')] };
  const [biceps, triceps] = buildExerciseBodyMuscles(input);
  expect(biceps.current).toEqual(period(6, 100));
  expect(triceps.current).toEqual(period());
  const selected = buildExerciseBodyMuscle({ ...input, muscleGroupId: 'biceps' })!;
  expect(selected.exercises.map(entry => entry.item.id)).toEqual(['curl']);
  expect(selected.secondary).toEqual([]);
  expect(buildExerciseBodyMuscle({ ...input, muscleGroupId: 'triceps' })).toMatchObject({ exercises: [], secondary: [] });
});
