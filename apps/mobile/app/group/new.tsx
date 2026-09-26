import { useRouter } from 'expo-router';
import { useState } from 'react';

import {
  GroupDetailsForm,
  GroupLoadingState,
  GroupsSignInRequired,
  UsernameGate,
  useUsernameGate,
} from '@/components/groups';
import { ScreenScroll } from '@/components/ui';
import { useAuth } from '@/src/auth';
import { createGroup, describeGroupWriteError, useGroupAction, type GroupDetailsInput } from '@/src/groups';

/** Create a group (groups contract §6.3, card flow 1): the username gate, then the shared form. */
export default function NewGroupRoute() {
  const { isConfigured, user } = useAuth();
  if (!isConfigured || !user) {
    return <GroupsSignInRequired isConfigured={isConfigured} />;
  }
  return <NewGroupContent userId={user.id} />;
}

function NewGroupContent({ userId }: { userId: string }) {
  const router = useRouter();
  const gate = useUsernameGate(userId);
  const create = useGroupAction(createGroup);
  // Kept so the form comes back filled in after a server USERNAME_REQUIRED detour.
  const [draft, setDraft] = useState<GroupDetailsInput | null>(null);

  const onSubmit = async (details: GroupDetailsInput) => {
    setDraft(details);
    const result = await create.run(details);
    if (result.ok) {
      // Replace the form so Back from the new group returns to where Create started.
      router.replace(`/group/${result.value.group_id}`);
      return;
    }
    if (result.error.code === 'USERNAME_REQUIRED') {
      gate.require('Set a username before creating a group.');
    }
  };

  return (
    <ScreenScroll keyboardShouldPersistTaps="handled" testID="group-new-screen">
      {gate.status === 'checking' ? <GroupLoadingState testID="group-new-loading" /> : null}
      {gate.status === 'required' ? <UsernameGate notice={gate.notice} onSaved={gate.complete} userId={userId} /> : null}
      {gate.status === 'ready' ? (
        <GroupDetailsForm
          errorMessage={create.error && create.error.code !== 'USERNAME_REQUIRED' ? describeGroupWriteError(create.error) : null}
          initialDescription={draft?.description}
          initialName={draft?.name}
          onSubmit={(details) => void onSubmit(details)}
          pending={create.pending}
          pendingLabel="Creating…"
          submitLabel="Create group"
        />
      ) : null}
    </ScreenScroll>
  );
}
