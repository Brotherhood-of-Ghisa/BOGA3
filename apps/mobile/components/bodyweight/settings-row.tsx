import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { bodyweightStatus } from '@/components/settings/statuses';
import { ChoiceRow, FormError, SwitchRow, uiSpace } from '@/components/ui';
import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import { readCurrentBodyWeight } from '@/src/data/bodyweight';
import {
  setBodyweightCalculationsEnabled,
  useBodyweightCalculationPreferenceError,
  useBodyweightCalculationsEnabled,
} from '@/src/bodyweight/calculation-preference';
import { BODY_WEIGHT_ROUTE } from '@/src/navigation/routes';

// Settings' Bodyweight row: the calculation switch's state and the current
// reading. The sub page (`/body-weight`) holds the switch and the log.
export function BodyWeightSettingsRow({ divider = false }: { divider?: boolean }) {
  const router = useRouter();
  const enabled = useBodyweightCalculationsEnabled();
  const currentKg = useCurrentBodyWeightKg();
  const status = bodyweightStatus(enabled, currentKg);
  return (
    <ChoiceRow
      accessibilityLabel={`Bodyweight, ${status}`}
      divider={divider}
      icon="weight"
      label="Bodyweight"
      onPress={() => router.push(BODY_WEIGHT_ROUTE)}
      testID="settings-body-weight-row"
      value={status}
    />
  );
}

// The reading sessions would use now, re-read whenever Settings is in view.
function useCurrentBodyWeightKg(): number | null {
  const [currentKg, setCurrentKg] = useState<number | null>(null);
  const revision = useBodyWeightContextRevision();
  useFocusEffect(useCallback(() => {
    let live = true;
    readCurrentBodyWeight().then((current) => {
      if (live) setCurrentKg(current?.weightKg ?? null);
    }, () => {
      if (live) setCurrentKg(null);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- A committed timeline change must reload the reading.
  }, [revision]));
  return currentKg;
}

// The calculation switch, at the top of the body weight page: a form card's
// `SwitchRow`, its write error under it (`ux-rules.md` "Forms").
export function BodyweightCalculationsRow() {
  const enabled = useBodyweightCalculationsEnabled();
  const preferenceError = useBodyweightCalculationPreferenceError();
  return (
    <>
      <SwitchRow
        density="list"
        label="Bodyweight calculations"
        onValueChange={(next) => { void setBodyweightCalculationsEnabled(next); }}
        testID="settings-bodyweight-calculations-toggle"
        value={enabled}
      />
      {preferenceError ? (
        <View style={styles.preferenceError}>
          <FormError message={preferenceError} testID="settings-bodyweight-calculations-error" />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  preferenceError: {
    paddingBottom: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
  },
});
