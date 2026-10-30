import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Text } from 'react-native';

import { ActionRow, FormSection, Icon, ListRow, uiRoles, uiText, uiTextTone } from '@/components/ui';
import type { ExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { buildLinkScreenModel } from '@/src/groups';
import { useGroupExerciseLinking } from '@/src/groups/use-group-exercise-linking';
import { exerciseLinkHref } from '@/src/navigation/routes';

/**
 * The editor's Groups section: the group exercises this exercise counts
 * towards, then `Link to a group exercise`. Every row opens the Link page,
 * which owns linking and unlinking; the links re-read when this page regains
 * focus. Signed-in only, for a saved exercise.
 */
export function ExerciseLinksSection({ exercise, userId }: { exercise: ExerciseCatalogExercise; userId: string }) {
  const router = useRouter();
  const linking = useGroupExerciseLinking({ userId });
  const { muscleSetup } = useExerciseCatalog();
  const linked = useMemo(
    () => buildLinkScreenModel({
      exercise, catalogs: linking.catalogs, linkedCatalogs: linking.linkedCatalogs, links: linking.links, query: '', muscleSetup,
    }).linked,
    [exercise, linking.catalogs, linking.linkedCatalogs, linking.links, muscleSetup],
  );
  const openLink = () => router.push(exerciseLinkHref(exercise.id));

  return (
    <FormSection testID="exercise-editor-groups" title="Groups">
      {linking.linksReady ? linked.map((row, index) => (
        <ListRow
          accessibilityLabel={`Linked to ${row.groupExerciseName} in ${row.groupName}${row.statusLabel ? `, ${row.statusLabel}` : ''}`}
          density="list"
          divider={index > 0}
          key={row.key}
          label={row.groupExerciseName}
          leading={<Icon color={uiRoles.inkMuted} name="link" size="md" />}
          meta={
            <Text allowFontScaling={false} numberOfLines={1} style={[uiText.meta, uiTextTone.muted]}>
              {row.statusLabel ? `${row.groupName} · ${row.statusLabel}` : row.groupName}
            </Text>
          }
          onPress={openLink}
          testID={`exercise-editor-linked-${row.groupExerciseId}`}
          trailing={<Icon color={uiRoles.inkMuted} name="chevron-right" size="sm" />}
        />
      )) : null}
      <ActionRow
        divider={linking.linksReady && linked.length > 0}
        icon="link"
        label="Link to a group exercise"
        onPress={openLink}
        testID="exercise-editor-link"
      />
    </FormSection>
  );
}
