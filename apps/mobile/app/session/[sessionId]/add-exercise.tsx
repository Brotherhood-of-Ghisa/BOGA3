import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useRef, useState } from 'react';

import { ExercisePicker } from '@/components/session-recorder/exercise-picker';
import { addExerciseToSession, appendPlanToSession } from '@/src/session-recorder/session-lifecycle';

const EXERCISE_CATALOG_MANAGE_ROUTE = '/exercise-catalog?source=session&intent=manage' as Href;

const coerceParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

export type AddExerciseScreenProps = {
  sessionId: string | null;
};

/**
 * Add exercise: the session's exercise picker on its own route, presented as
 * an iOS page sheet (`presentation: 'modal'` in the root stack). Swiping down
 * or Close returns to the session with nothing added. A pick writes, then goes
 * back, and the session view reloads on focus; a failed write keeps the picker
 * open and says so. Manage pushes the catalogue, whose back returns here.
 */
export function AddExerciseScreen({ sessionId }: AddExerciseScreenProps) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const writingRef = useRef(false);

  // One write at a time: a second pick while the first saves is ignored.
  const runWrite = async (write: (id: string) => Promise<unknown>) => {
    if (!sessionId || writingRef.current) return;
    writingRef.current = true;
    setNotice(null);
    try {
      await write(sessionId);
      router.back();
    } catch {
      setNotice("Couldn't add that exercise. Try again.");
    } finally {
      writingRef.current = false;
    }
  };

  return (
    <ExercisePicker
      notice={notice}
      onAppendPlan={(exercise, suggestion) => {
        void runWrite((id) => appendPlanToSession(id, exercise, suggestion));
      }}
      onClose={() => router.back()}
      onOpenManage={() => router.push(EXERCISE_CATALOG_MANAGE_ROUTE)}
      onSelectExercise={(exerciseDefinitionId, exerciseName) => {
        void runWrite((id) => addExerciseToSession(id, { id: exerciseDefinitionId, name: exerciseName }));
      }}
    />
  );
}

export default function AddExerciseRoute() {
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  return <AddExerciseScreen sessionId={coerceParam(params.sessionId)} />;
}
