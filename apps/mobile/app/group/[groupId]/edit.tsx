import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import {
  GroupMissingDataState,
  GroupStateView,
  GroupsSignInRequired,
  pickInlineError,
} from '@/components/groups';
import { GroupDetailsFormFields,useGroupDetailsDraft } from '@/components/groups/group-details-form';
import { listCompetitionExercises } from '@/src/groups/api';
import type { CompetitionExerciseListWire } from '@/src/groups/competition-wire';
import { ScreenScroll } from '@/components/ui';
import { useAuth } from '@/src/auth';
import {
  canManageGroup,
  describeGroupWriteError,
  getGroup,
  groupCacheKeys,
  updateGroup,
  useGroupAction,
  useGroupResource,
  type GroupDetailsInput,
  type GroupUpdateInput,
  type GroupGetResult,
} from '@/src/groups';

const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

/** Edit group details and calculation policy: owner and admins. */
export default function EditGroupRoute() {
  const { isConfigured, user } = useAuth();
  const groupId = firstParam(useLocalSearchParams<{ groupId?: string | string[] }>().groupId);
  if (!isConfigured || !user) {
    return <GroupsSignInRequired isConfigured={isConfigured} />;
  }
  if (!groupId) {
    return null;
  }
  return <EditGroupContent key={`${user.id}:${groupId}`} groupId={groupId} userId={user.id} />;
}

function EditGroupContent({ userId, groupId }: { userId: string; groupId: string }) {
  const router = useRouter();
  const fetcher = useCallback(() => getGroup(groupId), [groupId]);
  const group = useGroupResource<GroupGetResult>({
    userId,
    cacheKey: groupCacheKeys.group(groupId),
    fetcher,
    evictGroupIdOnNotFound: groupId,
  });
  const exerciseFetcher = useCallback(() => listCompetitionExercises(groupId),[groupId]);
  const exercises = useGroupResource<CompetitionExerciseListWire>({ userId,
    cacheKey: groupCacheKeys.groupExercises(groupId),fetcher: exerciseFetcher,evictGroupIdOnNotFound: groupId });
  const draft=useGroupDetailsDraft(group.data?{ name: group.data.group.name,description: group.data.group.description ?? '',
    bodyweightCalculationsEnabled: group.data.group.bodyweight_calculations_enabled }:null);
  const update = useGroupAction((details: GroupUpdateInput) => updateGroup(groupId, details));

  const onSubmit = async (details: GroupDetailsInput & { bodyweightCalculationsEnabled?: boolean }) => {
    if (details.bodyweightCalculationsEnabled === undefined) {
      throw new Error('Group calculation preference is required when editing a group.');
    }
    const result = await update.run({ ...details,
      bodyweightCalculationsEnabled: details.bodyweightCalculationsEnabled });
    if (result.ok) {
      await group.refresh();
      router.back();
    }
  };

  let body;
  if (group.lostAccess) {
    body = <GroupStateView testID="group-edit-lost-access" title="You're no longer a member of this group" />;
  } else if (!group.data) {
    body = (
      <GroupMissingDataState
        error={pickInlineError(group.error)}
        offline={group.offline}
        onRetry={() => void group.refresh()}
        testIDPrefix="group-edit"
      />
    );
  } else if (!canManageGroup(group.data.group.my_role)) {
    body = (
      <GroupStateView
        body="Only the owner and admins can edit this group."
        testID="group-edit-forbidden"
        title="You can't edit this group"
      />
    );
  } else {
    body = (
      <GroupDetailsFormFields
        draft={draft}
        errorMessage={update.error ? describeGroupWriteError(update.error) : null}
        initialDescription={group.data.group.description}
        initialBodyweightCalculationsEnabled={group.data.group.bodyweight_calculations_enabled}
        initialName={group.data.group.name}
        onSubmit={(details) => void onSubmit(details)}
        positiveContributionCount={exercises.data ? exercises.data.exercises.filter(exercise =>
          exercise.archived_at_ms === null && exercise.rules.bodyweight_contribution > 0).length : null}
        pending={update.pending}
        pendingLabel="Saving…"
        submitLabel="Save changes"
      />
    );
  }

  return (
    <ScreenScroll keyboardShouldPersistTaps="handled" testID="group-edit-screen">
      {body}
    </ScreenScroll>
  );
}
