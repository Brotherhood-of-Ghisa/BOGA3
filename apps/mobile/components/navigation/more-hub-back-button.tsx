import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { UiButton } from '@/components/ui';

const firstRouteParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

type MoreHubBackButtonProps = {
  // `replace` for a destination inside the tabs (Settings, the catalogue).
  // `dismiss` for one pushed over them on the root stack (Gyms): it pops back
  // to the tabs rather than stacking a second copy of them.
  returnBy?: 'replace' | 'dismiss';
};

/** Explicit return affordance for destinations launched from More. */
export function MoreHubBackButton({ returnBy = 'replace' }: MoreHubBackButtonProps = {}) {
  const router = useRouter();
  const params = useLocalSearchParams<{ source?: string | string[] }>();

  if (firstRouteParam(params.source) !== 'more') {
    return null;
  }

  return (
    <UiButton
      accessibilityLabel="Back to More"
      label="Back to More"
      onPress={() => (returnBy === 'dismiss' ? router.dismissTo('/more') : router.replace('/more'))}
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
