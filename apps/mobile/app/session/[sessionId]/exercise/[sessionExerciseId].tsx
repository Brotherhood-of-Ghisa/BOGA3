import { useLocalSearchParams } from 'expo-router';

import { ExercisePageScreen } from '@/components/exercise-page/exercise-page-screen';

const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';

/**
 * The exercise page. It is reached only from the session view, so it follows
 * no setting of its own: an active session reaches it while the new-screens
 * setting is On, a completed session being edited always does.
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
