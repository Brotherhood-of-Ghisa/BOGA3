import { ActivityIndicator, Text, View } from 'react-native';

import { makeStyles, useUiMode, useUiRoles } from '@/components/ui/theme-context';

// A component drawn the way a migrated screen is: a `makeStyles` sheet for its
// views, `useUiRoles()` for a colour prop, `useUiMode()` for a native surface.
// `ui-theme-context.test.tsx` loads it through the React Compiler.
const useStyles = makeStyles((roles) => ({
  card: { backgroundColor: roles.surface, borderColor: roles.rule },
  title: { color: roles.ink },
}));

export function ThemedCard({ title }: { title: string }) {
  const styles = useStyles();
  const roles = useUiRoles();
  const mode = useUiMode();
  return (
    <View style={styles.card} testID="themed-card">
      <Text style={styles.title} testID="themed-card-title">
        {title}
      </Text>
      <ActivityIndicator accessibilityHint={mode} color={roles.accent} testID="themed-card-spinner" />
    </View>
  );
}
