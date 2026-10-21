import type { LoadInputMode } from '@/src/exercise-core';

export type ExerciseShareMuscleMapping = {
  muscleGroupId: string;
  weight: number;
  role?: 'primary' | 'secondary' | 'stabilizer' | null;
};

export type ExerciseSharePayload = {
  v: 1;
  name: string;
  loadInputMode: LoadInputMode;
  bodyweightContribution: number;
  mappings: ExerciseShareMuscleMapping[];
};
