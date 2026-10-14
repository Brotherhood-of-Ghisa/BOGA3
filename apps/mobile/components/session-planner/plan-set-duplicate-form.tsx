import { useRef, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';

import { ActionButton, FormField, uiSpace } from '@/components/ui';
import { planSetDuplicationError } from '@/src/session-planner/plan-form-model';

/** Count-only body shared by the plan's sheet and the programme child editor. */
export function PlanSetDuplicateForm({ setCount, onDuplicate }: {
  setCount: number;
  onDuplicate: (countText: string) => void;
}) {
  const [countText, setCountText] = useState('1');
  const submitted = useRef(false);
  const error = planSetDuplicationError(setCount, countText);

  return (
    <View style={styles.body}>
      <FormField
        accessibilityLabel="Number of duplications"
        error={error}
        keyboardType="number-pad"
        label="Duplications"
        onChangeText={setCountText}
        selectTextOnFocus
        testID="plan-set-duplicate-count"
        value={countText}
      />
      <ActionButton
        disabled={error !== null}
        label="Duplicate"
        onPress={() => {
          if (error !== null || submitted.current) return;
          submitted.current = true;
          Keyboard.dismiss();
          onDuplicate(countText);
        }}
        testID="plan-set-duplicate-confirm"
        variant="primary"
      />
    </View>
  );
}

const styles = StyleSheet.create({ body: { gap: uiSpace.lg } });
