import { useRef, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';

import { ActionButton, FormField, uiSpace } from '@/components/ui';
import { planSetCountError } from '@/src/session-planner/plan-form-model';

/** Count-only body shared by the plan's sheet and the programme child editor. */
export function PlanSetAddForm({ setCount, onAddSets }: {
  setCount: number;
  onAddSets: (countText: string) => void;
}) {
  const [countText, setCountText] = useState('1');
  const submitted = useRef(false);
  const error = planSetCountError(setCount, countText);

  return (
    <View style={styles.body}>
      <FormField
        accessibilityLabel="Number of sets to add"
        error={error}
        keyboardType="number-pad"
        label="Sets"
        onChangeText={setCountText}
        selectTextOnFocus
        testID="plan-set-add-count"
        value={countText}
      />
      <ActionButton
        disabled={error !== null}
        label="Add"
        onPress={() => {
          if (error !== null || submitted.current) return;
          submitted.current = true;
          Keyboard.dismiss();
          onAddSets(countText);
        }}
        testID="plan-set-add-confirm"
        variant="primary"
      />
    </View>
  );
}

const styles = StyleSheet.create({ body: { gap: uiSpace.lg } });
