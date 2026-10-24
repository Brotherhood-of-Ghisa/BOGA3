import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { SettingsCard } from '@/components/settings/settings-card';
import { bodyweightStatus } from '@/components/settings/statuses';
import { ListRow, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import { isValidBodyWeightReading } from '@/src/bodyweight/weight-entry';
import { listBodyWeightReadings } from '@/src/data/bodyweight';
import {
  setBodyweightCalculationsEnabled,
  useBodyweightCalculationPreferenceError,
  useBodyweightCalculationsEnabled,
} from '@/src/bodyweight/calculation-preference';
import { BODY_WEIGHT_ROUTE } from '@/src/navigation/routes';

// Settings' Bodyweight card: the calculation switch's state and the current
// reading. The sub page (`/body-weight`) holds the switch and the log.
export function BodyWeightSettingsRow() {
  const router = useRouter();
  const enabled = useBodyweightCalculationsEnabled();
  const currentKg = useCurrentBodyWeightKg();
  return (
    <SettingsCard
      accessibilityHint="Opens bodyweight calculations and the body weight log"
      icon="weight"
      label="Bodyweight"
      onPress={() => router.push(BODY_WEIGHT_ROUTE)}
      status={bodyweightStatus(enabled, currentKg)}
      testID="settings-body-weight-row"
    />
  );
}

// The latest valid reading on or before now, re-read whenever Settings is in view.
function useCurrentBodyWeightKg(): number | null {
  const [currentKg, setCurrentKg] = useState<number | null>(null);
  const revision = useBodyWeightContextRevision();
  useFocusEffect(useCallback(() => {
    let live = true;
    listBodyWeightReadings().then((rows) => {
      const now = Date.now();
      const current = rows.find((row) => row.measuredAt.getTime() <= now);
      if (live) setCurrentKg(current && isValidBodyWeightReading(current) ? current.weightKg : null);
    }, () => {
      if (live) setCurrentKg(null);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- A committed timeline change must reload the reading.
  }, [revision]));
  return currentKg;
}

// The calculation switch, at the top of the body weight page.
export function BodyweightCalculationsRow() {
  const enabled = useBodyweightCalculationsEnabled();
  const preferenceError = useBodyweightCalculationPreferenceError();
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
            onPress={() => { void setBodyweightCalculationsEnabled(!enabled); }}
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
      {preferenceError ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          allowFontScaling={false}
          style={styles.preferenceError}
          testID="settings-bodyweight-calculations-error">
          {preferenceError}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  preferenceError: {
    color: uiRoles.danger,
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    paddingBottom: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
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
