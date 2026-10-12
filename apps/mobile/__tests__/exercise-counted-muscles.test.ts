import { exerciseCountedMuscles } from '@/src/exercise-catalog/exercise-muscles';

const mapping = (muscleGroupId: string, role: 'primary' | 'secondary' | 'stabilizer' | null) =>
  ({ id: `${muscleGroupId}-${role}`, muscleGroupId, weight: 1, role });

describe('exerciseCountedMuscles', () => {
  it('lists primaries before secondaries, each muscle once at its strongest role', () => {
    expect(exerciseCountedMuscles({
      mappings: [
        mapping('triceps', 'secondary'),
        mapping('chest', 'primary'),
        mapping('front_delts', 'secondary'),
        mapping('triceps', 'primary'),
      ],
    })).toEqual([
      { muscleGroupId: 'chest', role: 'primary' },
      { muscleGroupId: 'triceps', role: 'primary' },
      { muscleGroupId: 'front_delts', role: 'secondary' },
    ]);
  });

  it('leaves out stabilizer and unroled mappings, which count nothing', () => {
    expect(exerciseCountedMuscles({ mappings: [mapping('core', 'stabilizer'), mapping('lats', null)] })).toEqual([]);
  });
});
