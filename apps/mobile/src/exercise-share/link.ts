import { encodeExerciseSharePayload } from './serialization';
import type { ExerciseSharePayload } from './types';

export const EXERCISE_SHARE_ROUTE = '/exercise-share';

export const buildExerciseShareLink = (groupId: string, payload: ExerciseSharePayload): string => {
  const encodedPayload = encodeExerciseSharePayload(payload);
  return `boga3://exercise-share?groupId=${encodeURIComponent(groupId)}&payload=${encodeURIComponent(encodedPayload)}`;
};

export const buildExerciseShareMessage = (groupName: string, exerciseName: string, link: string): string =>
  `Check out the exercise "${exerciseName}" shared with "${groupName}" on BOGA.\n${link}`;
