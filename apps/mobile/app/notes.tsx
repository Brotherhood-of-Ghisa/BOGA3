import { Stack, useLocalSearchParams } from 'expo-router';

import { TabOwnedPage } from '@/components/navigation/tab-owned-page';
import { NotesScreen } from '@/components/notes/notes-screen';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';

const firstParam = (value: string | string[] | undefined): string | undefined => {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Training notes. Without `exerciseId`: every note, a More page that keeps the
 * tab bar. With it: that exercise's notes, from the exercise page's ⋮, titled
 * by the exercise once the catalogue names it (also a deleted one).
 */
export default function NotesRoute() {
  const exerciseId = firstParam(useLocalSearchParams<{ exerciseId?: string | string[] }>().exerciseId);
  if (exerciseId === undefined) {
    return (
      <TabOwnedPage>
        <NotesScreen />
      </TabOwnedPage>
    );
  }
  return <ExerciseNotesRoute exerciseId={exerciseId} />;
}

function ExerciseNotesRoute({ exerciseId }: { exerciseId: string }) {
  const catalog = useExerciseCatalog();
  const name = catalog.exercises.find((exercise) => exercise.id === exerciseId)?.name;
  return (
    <>
      {name ? <Stack.Screen options={{ title: `${name} notes` }} /> : null}
      <NotesScreen exerciseId={exerciseId} key={exerciseId} />
    </>
  );
}
