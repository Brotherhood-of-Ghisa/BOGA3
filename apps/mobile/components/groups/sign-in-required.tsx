import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';

import { Screen, StatePanel } from '@/components/ui';
import { SIGN_IN_ROUTE } from '@/src/navigation/routes';

import { groupScreenStyles } from './screen-styles';

/** Signed out or auth-unconfigured (C3.2.5): groups need an account. The panel centres on the page. */
export function GroupsSignInRequired({
  isConfigured,
  leading,
}: {
  isConfigured: boolean;
  leading?: ReactNode;
}) {
  const router = useRouter();
  return (
    <Screen style={groupScreenStyles.content}>
      {leading}
      <StatePanel
        action={
          isConfigured
            ? { label: 'Sign in', onPress: () => router.push(SIGN_IN_ROUTE), testID: 'groups-sign-in-button' }
            : undefined
        }
        body={
          isConfigured
            ? 'Groups are shared with other lifters, so they need an account.'
            : 'Groups need an account, and sign-in is not available in this build.'
        }
        testID="groups-signed-out-state"
        title="Sign in to use groups"
      />
    </Screen>
  );
}
