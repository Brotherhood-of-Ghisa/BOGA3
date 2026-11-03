import type { ProgressExerciseComparison, ProgressMuscleComparison } from '@/src/data';
import { compareProgressVolume } from '@/src/data/progress-comparisons';

const comparison = (now: number, previous: number, wide = false) => {
  const period = (count: number) => ({ workingSetCount: count, totalVolume: count * (wide ? 123456 : 500), volumeSetCount: count });
  const current = period(now);
  const before = period(previous);
  return { current, previous: before, workingSetChange: now - previous, volumeChange: compareProgressVolume(current.totalVolume, before.totalVolume) };
};

/** Fixed read models for the production Muscle presenters. */
export function tableGalleryMuscles(long = false, state = 'ready'): ProgressMuscleComparison[] {
  const exercises: ProgressExerciseComparison[] = [
    { exerciseDefinitionId: 'pulldown', displayName: long ? 'Single arm kneeling cable lat pulldown with a long exercise name' : 'Lat Pulldown', role: 'primary', ...comparison(10, 6, long) },
    { exerciseDefinitionId: 'row', displayName: long ? 'Chest supported row with a deliberately long exercise name' : 'Chest supported row', role: 'secondary', ...comparison(6, 4, long) },
  ];
  const rows: ProgressMuscleComparison[] = [
    { muscleGroupId: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0, exercises: [], ...comparison(12, 10, long) },
    { muscleGroupId: 'back_lats', displayName: long ? 'Latissimus dorsi with a long muscle name' : 'Lats', familyName: 'Back', sortOrder: 1, exercises: state === 'contributors-empty' ? [] : exercises, ...comparison(16, 10, long) },
    { muscleGroupId: 'back_upper', displayName: 'Upper back', familyName: 'Back', sortOrder: 2, exercises: [], ...comparison(14, 10, long) },
    { muscleGroupId: 'quads', displayName: 'Quads', familyName: 'Legs', sortOrder: 3, exercises: [], ...comparison(10, 10, long) },
    { muscleGroupId: 'hamstrings', displayName: 'Hamstrings', familyName: 'Legs', sortOrder: 4, exercises: [], ...comparison(8, 10, long) },
  ];
  if (state === 'values') {
    rows[0].current.totalVolume = null;
    rows[1].previous.totalVolume = 0;
    for (const exercise of rows[1].exercises) {
      exercise.previous.totalVolume = 0;
      exercise.volumeChange = compareProgressVolume(exercise.current.totalVolume, exercise.previous.totalVolume);
    }
    rows[3].current.totalVolume = 0;
    rows[3].previous.totalVolume = 0;
    for (const row of rows) row.volumeChange = compareProgressVolume(row.current.totalVolume, row.previous.totalVolume);
  }
  return rows;
}
