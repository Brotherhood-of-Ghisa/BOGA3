import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import {
  GroupExerciseForm,
  GroupLostAccessState,
  GroupMissingDataState,
  GroupStateView,
  GroupsSignInRequired,
  StandardExercisePicker,
  pickInlineError,
} from '@/components/groups';
import { ScreenScroll, SegmentedControl, uiFonts, uiRoles, uiTypography } from '@/components/ui';
import { useAuth } from '@/src/auth';
import type { ExerciseCore } from '@/src/exercise-core';
import {
  canManageGroup,
  createGroupExercise,
  describeGroupExerciseWriteError,
  getGroup,
  groupCacheKeys,
  useGroupAction,
  useGroupResource,
  useMountedRef,
  type CreateGroupExerciseInput,
  type GroupGetResult,
  type StandardExerciseOption,
} from '@/src/groups';

type ExerciseSource = 'catalogue' | 'custom';

const SOURCE_OPTIONS = [
  { value: 'catalogue', label: 'From catalogue' },
  { value: 'custom', label: 'Custom' },
] as const;

const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

/**
 * Add a group exercise (owner, admin; contract §4.4): copy a standard exercise
 * (its seed id becomes `source_exercise_id`) or create a custom one, through
 * the shared `ExerciseCore` fields.
 */
export default function NewGroupExerciseRoute() {
  const { isConfigured, user } = useAuth();
  const groupId = firstParam(useLocalSearchParams<{ groupId?: string | string[] }>().groupId);
  if (!isConfigured || !user) {
    return <GroupsSignInRequired isConfigured={isConfigured} />;
  }
  if (!groupId) {
    return null;
  }
  return <NewGroupExerciseContent groupId={groupId} userId={user.id} />;
}

function NewGroupExerciseContent({ userId, groupId }: { userId: string; groupId: string }) {
  const router = useRouter();
  const fetcher = useCallback(() => getGroup(groupId), [groupId]);
  const group = useGroupResource<GroupGetResult>({
    userId,
    cacheKey: groupCacheKeys.group(groupId),
    fetcher,
    evictGroupIdOnNotFound: groupId,
  });
  const [source, setSource] = useState<ExerciseSource>('catalogue');
  const [picked, setPicked] = useState<StandardExerciseOption | null>(null);
  const create = useGroupAction((input: CreateGroupExerciseInput) => createGroupExercise(groupId, input));
  const mounted = useMountedRef();

  const onSubmit = async (core: ExerciseCore) => {
    const sourceExerciseId = source === 'catalogue' ? (picked?.sourceExerciseId ?? null) : null;
    const result = await create.run({ ...core, sourceExerciseId });
    // Back during a slow save already left this screen: going back again would pop the group screen.
    if (!mounted.current) return;
    if (result.ok) {
      // The group screen's Exercises segment refreshes on focus.
      router.back();
      return;
    }
    if (result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND') {
      void group.refresh();
    }
  };

  const errorMessage = create.error ? describeGroupExerciseWriteError(create.error) : null;
  const formProps = {
    errorMessage,
    onSubmit: (core: ExerciseCore) => void onSubmit(core),
    pending: create.pending,
    pendingLabel: 'Adding…',
    submitLabel: 'Add exercise',
  };

  let body;
  if (group.lostAccess) {
    body = <GroupLostAccessState testID="group-exercise-new-lost-access" />;
  } else if (!group.data) {
    body = (
      <GroupMissingDataState
        error={pickInlineError(group.error)}
        offline={group.offline}
        onRetry={() => void group.refresh()}
        testIDPrefix="group-exercise-new"
      />
    );
  } else if (!canManageGroup(group.data.group.my_role)) {
    body = (
      <GroupStateView
        body="Only the owner and admins can add group exercises."
        testID="group-exercise-new-forbidden"
        title="You can't add exercises"
      />
    );
  } else {
    body = (
      <>
        <SegmentedControl
          accessibilityLabel="Exercise source"
          onChange={(next: ExerciseSource) => {
            setSource(next);
            create.reset();
          }}
          options={SOURCE_OPTIONS}
          testIDPrefix="group-exercise-source"
          value={source}
        />
        {source === 'custom' ? (
          <GroupExerciseForm key="custom" {...formProps} />
        ) : (
          <>
            <StandardExercisePicker
              onPick={(option) => {
                setPicked(option);
                create.reset();
              }}
              selectedId={picked?.sourceExerciseId ?? null}
            />
            {picked ? (
              <GroupExerciseForm
                initialCore={{ name: picked.name, loadInputMode: picked.loadInputMode }}
                key={picked.sourceExerciseId}
                note={`Copies the standard exercise "${picked.name}". You can change its name.`}
                {...formProps}
              />
            ) : (
              <Text allowFontScaling={false} style={styles.hint} testID="group-exercise-pick-hint">
                Pick a standard exercise to copy.
              </Text>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <ScreenScroll keyboardShouldPersistTaps="handled" testID="group-exercise-new-screen">
      {body}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
});
