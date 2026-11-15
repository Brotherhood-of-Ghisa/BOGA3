import { ActivityIndicator, View } from 'react-native';

import { useUiRoles } from '@/components/ui';

// An Appearance page's header-right while a saved choice is still being
// drawn (`useAppearanceCommit`'s `applying`), so the page's own controls are
// known to be up to date once it goes. The page sets `headerRight` only then:
// on iOS 26 any `headerRight`, even one drawing nothing, gets a glass button.
export const applyingHeaderRight = (applying: boolean, testID: string) =>
  applying ? () => <ApplyingIndicator testID={testID} /> : undefined;

function ApplyingIndicator({ testID }: { testID: string }) {
  const roles = useUiRoles();
  return (
    <View accessibilityLabel="Applying the theme" accessibilityRole="progressbar" accessible testID={testID}>
      <ActivityIndicator color={roles.inkMuted} size="small" />
    </View>
  );
}
