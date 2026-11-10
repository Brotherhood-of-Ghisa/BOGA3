import { ActivityIndicator, View } from 'react-native';

import { useUiRoles } from '@/components/ui';

// At the end of an Appearance page's header while a saved choice is still
// being drawn (`useAppearanceCommit`'s `applying`), so the page's own controls
// are known to be up to date once it goes. Nothing is drawn otherwise.
export function ApplyingIndicator({ applying, testID }: { applying: boolean; testID: string }) {
  const roles = useUiRoles();
  if (!applying) return null;
  return (
    <View accessibilityLabel="Applying the theme" accessibilityRole="progressbar" accessible testID={testID}>
      <ActivityIndicator color={roles.inkMuted} size="small" />
    </View>
  );
}
