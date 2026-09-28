import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { uiSpace } from '@/components/ui/tokens';

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

  // A back arrow at the top left: a way back, never the screen's primary.
  return (
    <View style={styles.button}>
      <IconButton
        accessibilityLabel="Back to More"
        name="chevron-left"
        onPress={() => (returnBy === 'dismiss' ? router.dismissTo('/more') : router.replace('/more'))}
        testID="back-to-more-button"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    marginLeft: -uiSpace.xs,
  },
});
