import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { UiButton } from '@/components/ui';

const firstRouteParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** Explicit return affordance for tab-owned destinations launched from More. */
export function MoreHubBackButton() {
  const router = useRouter();
  const params = useLocalSearchParams<{ source?: string | string[] }>();

  if (firstRouteParam(params.source) !== 'more') {
    return null;
  }

  return (
    <UiButton
      accessibilityLabel="Back to More"
      label="Back to More"
      onPress={() => router.replace('/more')}
      style={styles.button}
      testID="back-to-more-button"
      variant="secondary"
    />
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
  },
});
