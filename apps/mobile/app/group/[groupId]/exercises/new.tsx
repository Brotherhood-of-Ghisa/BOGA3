import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  GroupLostAccessState,
  GroupMissingDataState,
  GroupStateView,
  GroupsSignInRequired,
  PersonalExercisePicker,
  StandardExercisePicker,
  pickInlineError,
} from '@/components/groups';
import { ScreenScroll, SegmentedControl } from '@/components/ui';
import { useAuth } from '@/src/auth';
import { linkExercise } from '@/src/data/exercise-group-links';
import type { IndexedExerciseCatalogExercise } from '@/src/exercise-catalog/search';
import { GroupComparisonForm } from '@/components/groups/group-comparison-form';
import type { CompetitionRules as GroupExerciseRules } from '@/src/groups/competition-contract';
import { createCompetitionExercise } from '@/src/groups/api';
import {
  canManageGroup,
  describeGroupExerciseWriteError,
  getGroup,
  groupCacheKeys,
  useGroupAction,
  useGroupResource,
  useMountedRef,
  type GroupGetResult,
  type StandardExerciseOption,
} from '@/src/groups';

type ExerciseSource = 'mine' | 'catalogue' | 'custom';

const SOURCE_OPTIONS = [
  { value: 'mine', label: 'My exercises' },
  { value: 'catalogue', label: 'From catalogue' },
  { value: 'custom', label: 'Custom' },
] as const;

const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

const resolveSourceExerciseId = (
  source: ExerciseSource,
  picked: StandardExerciseOption | null,
  pickedPersonal: IndexedExerciseCatalogExercise | null,
): string | null => {
  if (source === 'catalogue') return picked?.sourceExerciseId ?? null;
  if (source === 'mine') return pickedPersonal?.id.startsWith('seed_') ? pickedPersonal.id : null;
  return null;
};

const describeLinkError = (err: unknown): string =>
  err instanceof Error
    ? `Group exercise was added, but failed to link your personal exercise: ${err.message}`
    : 'Group exercise was added, but failed to link your personal exercise.';

/**
 * Add a group exercise (owner, admin; contract): copy a standard exercise
 * (its seed id becomes `source_exercise_id`), copy a personal exercise and
 * link it, or create a custom one, through the shared `ExerciseCore` fields.
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
  const [source, setSource] = useState<ExerciseSource>('mine');
  const [picked, setPicked] = useState<StandardExerciseOption | null>(null);
  const [pickedPersonal, setPickedPersonal] = useState<IndexedExerciseCatalogExercise | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [createdGroupExerciseId, setCreatedGroupExerciseId] = useState<string | null>(null);

  const create = useGroupAction((input: GroupExerciseRules & { sourceExerciseId: string | null }) =>
    createCompetitionExercise({
      groupId,
      name: input.name,
      mode: input.loadInputMode,
      contribution: input.bodyweightContribution,
      metric: input.defaultMetric,
      sourceId: input.sourceExerciseId,
    }),
  );
  const mounted = useMountedRef();

  const resetSelection = () => {
    setCreatedGroupExerciseId(null);
    setLinkError(null);
    create.reset();
  };

  const onSubmit = async (core: GroupExerciseRules) => {
    if (submitting || create.pending) return;
    setSubmitting(true);
    setLinkError(null);
    try {
      let targetGroupExerciseId = createdGroupExerciseId;
      if (!targetGroupExerciseId) {
        const sourceExerciseId = resolveSourceExerciseId(source, picked, pickedPersonal);
        const result = await create.run({ ...core, sourceExerciseId });
        if (!result.ok) {
          if (result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND') {
            void group.refresh();
          }
          return;
        }
        targetGroupExerciseId = result.value.exercise.group_exercise_id;
      }

      if (source === 'mine' && pickedPersonal) {
        try {
          await linkExercise(pickedPersonal.id, groupId, targetGroupExerciseId);
        } catch (err) {
          if (mounted.current) {
            setCreatedGroupExerciseId(targetGroupExerciseId);
            setLinkError(describeLinkError(err));
          }
          return;
        }
      }

      // Back during a slow save already left this screen: going back again would pop the group screen.
      if (!mounted.current) return;
      // The group screen's Exercises segment refreshes on focus.
      router.back();
    } finally {
      if (mounted.current) {
        setSubmitting(false);
      }
    }
  };

  const errorMessage =
    linkError ?? (create.error ? describeGroupExerciseWriteError(create.error) : null);

  const isRetryingLink = createdGroupExerciseId !== null;
  const formProps = {
    bodyweightCalculationsEnabled: group.data?.group.bodyweight_calculations_enabled ?? false,
    errorMessage,
    onSubmit: (core: GroupExerciseRules) => void onSubmit(core),
    pending: submitting || create.pending,
    pendingLabel: isRetryingLink ? 'Linking…' : 'Adding…',
    submitLabel: isRetryingLink ? 'Retry link' : 'Add exercise',
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
            resetSelection();
          }}
          options={SOURCE_OPTIONS}
          testIDPrefix="group-exercise-source"
          value={source}
        />
        {source === 'custom' ? (
          <GroupComparisonForm key="custom" {...formProps} />
        ) : source === 'mine' ? (
          <>
            <PersonalExercisePicker
              groupId={groupId}
              groupName={group.data.group.name}
              onPick={(option) => {
                setPickedPersonal(option);
                resetSelection();
              }}
              selectedId={pickedPersonal?.id ?? null}
            />
            {pickedPersonal ? (
              <GroupComparisonForm
                initialRules={{
                  name: pickedPersonal.name,
                  loadInputMode: pickedPersonal.loadInputMode ?? 'total_load',
                  bodyweightCalculationsEnabled: group.data.group.bodyweight_calculations_enabled,
                  bodyweightContribution: pickedPersonal.bodyweightContribution ?? 0,
                  defaultMetric: 'e1rm',
                }}
                key={pickedPersonal.id}
                {...formProps}
              />
            ) : null}
          </>
        ) : (
          <>
            <StandardExercisePicker
              onPick={(option) => {
                setPicked(option);
                resetSelection();
              }}
              selectedId={picked?.sourceExerciseId ?? null}
            />
            {picked ? (
              <GroupComparisonForm
                initialRules={{
                  name: picked.name,
                  loadInputMode: picked.loadInputMode,
                  bodyweightCalculationsEnabled: group.data.group.bodyweight_calculations_enabled,
                  bodyweightContribution: 0,
                  defaultMetric: 'e1rm',
                }}
                key={picked.sourceExerciseId}
                {...formProps}
              />
            ) : null}
          </>
        )}
      </>
    );
  }

  return (
    <ScreenScroll
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      testID="group-exercise-new-screen">
      {body}
    </ScreenScroll>
  );
}
