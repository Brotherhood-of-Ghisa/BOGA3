import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ExerciseEditorModal } from '@/components/exercise-catalog/exercise-editor-modal';
import {
  GroupLoadingState,
  GroupStateView,
  GroupsSignInRequired,
  groupScreenStyles,
} from '@/components/groups';
import {
  ActionButton,
  Card,
  Notice,
  ScreenScroll,
  Tag,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import { useAuth } from '@/src/auth';
import {
  saveExerciseCatalogExercise,
  type ExerciseCatalogExercise,
} from '@/src/data/exercise-catalog';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { LOAD_INPUT_MODE_LABELS } from '@/src/exercise-core';
import {
  buildSharePrefill,
  decodeExerciseSharePayload,
  type ExerciseSharePayload,
} from '@/src/exercise-share';
import {
  getGroup,
  groupCacheKeys,
  useGroupResource,
  type GroupGetResult,
} from '@/src/groups';

const firstParam = (value: string | string[] | undefined): string | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

export default function ExerciseShareRoute() {
  const { isConfigured, user } = useAuth();
  const params = useLocalSearchParams<{ groupId?: string | string[]; payload?: string | string[] }>();
  const groupId = firstParam(params.groupId);
  const rawPayload = firstParam(params.payload);

  if (!isConfigured || !user) {
    return <GroupsSignInRequired isConfigured={isConfigured} />;
  }

  if (!groupId || !rawPayload) {
    return (
      <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>
        <Stack.Screen options={{ title: 'Shared exercise' }} />
        <GroupStateView
          body="This link is missing required exercise details."
          testID="exercise-share-invalid"
          title="Invalid share link"
        />
      </View>
    );
  }

  return <ExerciseShareContent groupId={groupId} rawPayload={rawPayload} userId={user.id} />;
}

function ExerciseShareContent({
  groupId,
  rawPayload,
  userId,
}: {
  groupId: string;
  rawPayload: string;
  userId: string;
}) {
  const router = useRouter();
  const catalog = useExerciseCatalog();
  const payload = useMemo(() => decodeExerciseSharePayload(rawPayload), [rawPayload]);

  const fetcher = useCallback(() => getGroup(groupId), [groupId]);
  const group = useGroupResource<GroupGetResult>({
    userId,
    cacheKey: groupCacheKeys.group(groupId),
    fetcher,
    evictGroupIdOnNotFound: groupId,
  });

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedExercise, setSavedExercise] = useState<ExerciseCatalogExercise | null>(null);

  const groupName = group.data?.group.name ?? 'Group';
  const role = group.data?.group.my_role ?? null;
  const isMember = role !== null;

  const existingInCatalog = useMemo(() => {
    if (!payload) return null;
    return catalog.exercises.find(
      (exercise) => !exercise.deletedAt && exercise.name.toLowerCase() === payload.name.toLowerCase(),
    );
  }, [catalog.exercises, payload]);

  const muscleLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const mg of catalog.muscleGroups) {
      map.set(mg.id, mg.displayName);
    }
    return map;
  }, [catalog.muscleGroups]);

  const editorPrefill = useMemo(() => (payload ? buildSharePrefill(payload) : null), [payload]);

  if (!payload) {
    return (
      <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>
        <Stack.Screen options={{ title: 'Shared exercise' }} />
        <GroupStateView
          body="The shared exercise details could not be decoded."
          testID="exercise-share-corrupt"
          title="Invalid exercise data"
        />
      </View>
    );
  }

  if (group.lostAccess || group.error?.code === 'NOT_FOUND' || group.error?.code === 'FORBIDDEN' || (group.data && !isMember)) {
    return (
      <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>
        <Stack.Screen options={{ title: 'Shared exercise' }} />
        <GroupStateView
          body="This exercise was shared with members of a group you are not a member of."
          testID="exercise-share-not-member"
          title="Group membership required"
        />
      </View>
    );
  }

  if (!group.data) {
    return (
      <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>
        <Stack.Screen options={{ title: 'Shared exercise' }} />
        <GroupLoadingState testID="exercise-share-loading" />
      </View>
    );
  }

  const handleDirectSave = async () => {
    setSaveError(null);
    setSavePending(true);
    try {
      const saved = await saveExerciseCatalogExercise({
        name: payload.name,
        loadInputMode: payload.loadInputMode,
        bodyweightContribution: payload.bodyweightContribution,
        mappings: payload.mappings.map((m) => ({
          muscleGroupId: m.muscleGroupId,
          weight: m.weight,
          role: m.role ?? 'primary',
        })),
      });
      setSavedExercise(saved);
      setSaveFeedback(`"${payload.name}" was added to your exercises.`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save exercise.');
    } finally {
      setSavePending(false);
    }
  };

  const handleEditorSaved = (exercise: ExerciseCatalogExercise) => {
    setIsEditorOpen(false);
    setSavedExercise(exercise);
    setSaveFeedback(`"${exercise.name}" was added to your exercises.`);
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Shared exercise' }} />
      <ScreenScroll contentContainerStyle={styles.container}>
        <ExerciseShareCard groupName={groupName} muscleLookup={muscleLookup} payload={payload} />

        {existingInCatalog && !savedExercise ? (
          <Notice
            live
            message={`You already have an active exercise named "${payload.name}". Adding this will create another definition.`}
            testID="exercise-share-exists-notice"
            tone="neutral"
          />
        ) : null}

        {saveFeedback ? (
          <Notice icon="success" live message={saveFeedback} testID="exercise-share-feedback" />
        ) : null}
        {saveError ? (
          <Notice live message={saveError} testID="exercise-share-error" tone="danger" />
        ) : null}

        <View style={styles.actions}>
          {savedExercise ? (
            <ActionButton
              accessibilityLabel="View in catalog"
              label="View in catalog"
              onPress={() => router.replace('/(tabs)/exercise-catalog')}
              testID="exercise-share-view-catalog-btn"
              variant="primary"
            />
          ) : (
            <>
              <ActionButton
                accessibilityLabel="Add to my exercises"
                disabled={savePending}
                label={savePending ? 'Adding…' : 'Add to my exercises'}
                onPress={() => void handleDirectSave()}
                testID="exercise-share-save-btn"
                variant="primary"
              />
              <ActionButton
                accessibilityLabel="Customize and add"
                disabled={savePending}
                label="Customize and add…"
                onPress={() => setIsEditorOpen(true)}
                testID="exercise-share-customize-btn"
                variant="outline"
              />
            </>
          )}
        </View>
      </ScreenScroll>

      <ExerciseEditorModal
        editingExercise={null}
        onRequestClose={() => setIsEditorOpen(false)}
        onSaved={handleEditorSaved}
        prefill={editorPrefill}
        title="Customize shared exercise"
        visible={isEditorOpen}
      />
    </>
  );
}

function ExerciseShareCard({
  groupName,
  muscleLookup,
  payload,
}: {
  groupName: string;
  muscleLookup: Map<string, string>;
  payload: ExerciseSharePayload;
}) {
  const primaryMuscles = payload.mappings
    .filter((m) => m.role === 'primary' || !m.role)
    .map((m) => muscleLookup.get(m.muscleGroupId) ?? m.muscleGroupId);

  const secondaryMuscles = payload.mappings
    .filter((m) => m.role === 'secondary' || m.role === 'stabilizer')
    .map((m) => muscleLookup.get(m.muscleGroupId) ?? m.muscleGroupId);

  return (
    <Card style={styles.card} testID="exercise-share-card">
      <View style={styles.eyebrowRow}>
        <Text allowFontScaling={false} style={styles.eyebrow} testID="exercise-share-group-eyebrow">
          Shared via {groupName}
        </Text>
      </View>

      <Text allowFontScaling={false} style={styles.title} testID="exercise-share-title">
        {payload.name}
      </Text>

      <View style={styles.metaRow}>
        <Tag label={LOAD_INPUT_MODE_LABELS[payload.loadInputMode]} testID="exercise-share-load-mode" />
        {payload.bodyweightContribution > 0 ? (
          <Tag
            label={`${Math.round(payload.bodyweightContribution * 100)}% bodyweight`}
            testID="exercise-share-bw"
          />
        ) : null}
      </View>

      {primaryMuscles.length > 0 ? (
        <View style={styles.muscleSection}>
          <Text allowFontScaling={false} style={styles.sectionLabel}>
            Primary muscle{primaryMuscles.length > 1 ? 's' : ''}
          </Text>
          <Text allowFontScaling={false} style={styles.muscleList} testID="exercise-share-primary-muscles">
            {primaryMuscles.join(', ')}
          </Text>
        </View>
      ) : null}

      {secondaryMuscles.length > 0 ? (
        <View style={styles.muscleSection}>
          <Text allowFontScaling={false} style={styles.sectionLabel}>
            Secondary muscle{secondaryMuscles.length > 1 ? 's' : ''}
          </Text>
          <Text allowFontScaling={false} style={styles.muscleList} testID="exercise-share-secondary-muscles">
            {secondaryMuscles.join(', ')}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: uiSpace.md,
    gap: uiSpace.md,
  },
  card: {
    padding: uiSpace.md,
    gap: uiSpace.sm,
  },
  eyebrowRow: {
    flexDirection: 'row',
  },
  eyebrow: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkFaint,
  },
  title: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxl,
    lineHeight: uiTypography.lineHeight.xxl,
    color: uiRoles.ink,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.xs,
    marginTop: uiSpace.xs,
  },
  muscleSection: {
    marginTop: uiSpace.sm,
    gap: uiSpace.xs,
  },
  sectionLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    textTransform: 'uppercase',
    color: uiRoles.inkFaint,
  },
  muscleList: {
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.md,
    color: uiRoles.ink,
  },
  actions: {
    gap: uiSpace.sm,
    marginTop: uiSpace.sm,
  },
});
