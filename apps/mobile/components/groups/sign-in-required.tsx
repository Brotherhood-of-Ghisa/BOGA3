import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { SIGN_IN_ROUTE } from '@/src/navigation/routes';

import { GroupStateView } from './group-state-view';
import { groupScreenStyles } from './screen-styles';

/** Signed out or auth-unconfigured (C3.2.5): groups need an account. */
export function GroupsSignInRequired({ isConfigured }: { isConfigured: boolean }) {
  const router = useRouter();
  return (
    <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>
      <GroupStateView
        actionLabel={isConfigured ? 'Sign in' : undefined}
        actionTestID="groups-sign-in-button"
        body={
          isConfigured
            ? 'Groups are shared with other lifters, so they need an account.'
            : 'Groups need an account, and sign-in is not available in this build.'
        }
        onAction={() => router.push(SIGN_IN_ROUTE)}
        testID="groups-signed-out-state"
        title="Sign in to use groups"
      />
    </View>
  );
}
