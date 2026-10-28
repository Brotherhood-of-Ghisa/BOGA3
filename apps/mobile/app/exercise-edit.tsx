import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { ExerciseEditorScreen } from '@/components/exercise-catalog/exercise-editor-screen';
import {
  readExerciseEditorRequest,
  releaseExerciseEditorRequest,
  type ExerciseEditorRequest,
} from '@/components/exercise-catalog/exercise-editor-request';

const firstParam = (value: string | string[] | undefined): string | null => {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
  return raw.length > 0 ? raw : null;
};

/**
 * The exercise editor page. `exerciseDefinitionId` edits one of my
 * exercises, else it creates one; `request` names the caller's prefill and
 * callbacks (`exercise-editor-request.ts`), released when the page leaves.
 */
export default function ExerciseEditRoute() {
  const params = useLocalSearchParams<{ exerciseDefinitionId?: string | string[]; request?: string | string[] }>();
  const token = firstParam(params.request);
  const exerciseDefinitionId = firstParam(params.exerciseDefinitionId);
  const [request] = useState<ExerciseEditorRequest>(() => {
    const registered = readExerciseEditorRequest(token);
    return { ...registered, exerciseDefinitionId, lost: token !== null && registered === null };
  });
  useEffect(() => () => releaseExerciseEditorRequest(token), [token]);
  return <ExerciseEditorScreen request={request} />;
}
