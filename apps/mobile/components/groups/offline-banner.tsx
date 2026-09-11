import { StyleSheet, View } from 'react-native';

import { UiText, uiColors, uiRadius, uiSpace } from '@/components/ui';
import { formatOfflineMarker } from '@/src/groups';

/** Contract §7 offline marker. Cached data stays visible below it. */
export function GroupOfflineBanner({ lastUpdatedAtMs }: { lastUpdatedAtMs: number | null }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.banner} testID="groups-offline-banner">
      <UiText style={styles.text} variant="label">
        {formatOfflineMarker(lastUpdatedAtMs)}
      </UiText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderWarning,
    backgroundColor: uiColors.surfaceWarning,
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.sm,
  },
  text: {
    color: uiColors.textWarning,
  },
});
