import { useLocalSearchParams } from 'expo-router';

import { ExercisePageScreen } from '@/components/exercise-page/exercise-page-screen';

const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';

/**
 * The exercise page. It is reached only from the session view, for an active
 * session or a completed one being edited.
 */
export default function ExercisePageRoute() {
  const params = useLocalSearchParams<{
    sessionId?: string | string[];
    sessionExerciseId?: string | string[];
  }>();
  const sessionId = firstParam(params.sessionId);
  const sessionExerciseId = firstParam(params.sessionExerciseId);

  return (
    <ExercisePageScreen
      key={`${sessionId}:${sessionExerciseId}`}
      sessionExerciseId={sessionExerciseId}
      sessionId={sessionId}
    />
  );
}
