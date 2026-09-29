import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Icon, ListRow, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import {
  setBodyweightCalculationsEnabled,
  useBodyweightCalculationsEnabled,
} from '@/src/bodyweight/calculation-preference';
import { BODY_WEIGHT_ROUTE } from '@/src/navigation/routes';

export function BodyWeightSettingsRow() {
  const router = useRouter();
  const enabled = useBodyweightCalculationsEnabled();
  return (
    <>
      <ListRow
        density="list"
        divider={false}
        label="Bodyweight calculations"
        testID="settings-bodyweight-calculations-row"
        trailing={
          <Pressable
            accessibilityLabel={`Bodyweight calculations ${enabled ? 'on' : 'off'}`}
            accessibilityRole="switch"
            accessibilityState={{ checked: enabled }}
            hitSlop={uiSpace.sm}
            onPress={() => setBodyweightCalculationsEnabled(!enabled)}
            style={({ pressed }) => [
              styles.stateButton,
              enabled ? styles.stateButtonOn : null,
              pressed ? styles.stateButtonPressed : null,
            ]}
            testID="settings-bodyweight-calculations-toggle">
            <Text allowFontScaling={false} style={[styles.stateLabel, enabled ? styles.stateLabelOn : null]}>
              {enabled ? 'On' : 'Off'}
            </Text>
          </Pressable>
        }
      />
      <ListRow
        accessibilityHint="Opens dated body weight readings"
        accessibilityLabel="Open body weight log"
        density="list"
        divider
        leading={<Icon name="user" size="md" color={uiRoles.inkMuted} />}
        onPress={() => router.push(BODY_WEIGHT_ROUTE)}
        testID="settings-body-weight-row"
        trailing={<Icon name="chevron-right" size="sm" color={uiRoles.inkFaint} />}>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.bodyWeightLogLabel}>
          Body weight log
        </Text>
      </ListRow>
    </>
  );
}

const styles = StyleSheet.create({
  bodyWeightLogLabel: {
    color: uiRoles.ink,
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.lg,
    fontWeight: '400',
    lineHeight: uiTypography.lineHeight.lg,
  },
  stateButton: {
    minWidth: uiGeometry.tapTarget + uiSpace.sm,
    minHeight: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: uiSpace.md,
    borderWidth: 1,
    borderColor: uiRoles.rule,
    borderRadius: uiGeometry.radius.control,
    backgroundColor: uiRoles.surface,
  },
  stateButtonOn: {
    borderColor: uiRoles.accent,
    backgroundColor: uiRoles.accent,
  },
  stateButtonPressed: {
    opacity: 0.72,
  },
  stateLabel: {
    color: uiRoles.ink,
    fontFamily: uiFonts.display.family,
    fontSize: uiTypography.size.sm,
    fontWeight: '700',
    lineHeight: uiTypography.lineHeight.sm,
  },
  stateLabelOn: {
    color: uiRoles.surface,
  },
});
