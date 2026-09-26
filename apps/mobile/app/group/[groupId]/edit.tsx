import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import {
  GroupDetailsForm,
  GroupMissingDataState,
  GroupStateView,
  GroupsSignInRequired,
  pickInlineError,
} from '@/components/groups';
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
  type GroupGetResult,
} from '@/src/groups';

const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

/** Edit the group's name and description (groups contract §6.3, card flow 5): owner and admins. */
export default function EditGroupRoute() {
  const { isConfigured, user } = useAuth();
  const groupId = firstParam(useLocalSearchParams<{ groupId?: string | string[] }>().groupId);
  if (!isConfigured || !user) {
    return <GroupsSignInRequired isConfigured={isConfigured} />;
  }
  if (!groupId) {
    return null;
  }
  return <EditGroupContent groupId={groupId} userId={user.id} />;
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
  const update = useGroupAction((details: GroupDetailsInput) => updateGroup(groupId, details));

  const onSubmit = async (details: GroupDetailsInput) => {
    const result = await update.run(details);
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
      <GroupDetailsForm
        errorMessage={update.error ? describeGroupWriteError(update.error) : null}
        initialDescription={group.data.group.description}
        initialName={group.data.group.name}
        onSubmit={(details) => void onSubmit(details)}
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
