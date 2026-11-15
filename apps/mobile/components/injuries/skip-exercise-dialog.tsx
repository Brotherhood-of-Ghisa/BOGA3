import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { uiSpace } from '@/components/ui/tokens';

export type SkipReason = 'discomfort' | 'equipment' | 'fatigue' | 'other';

export type SkipExerciseDialogProps = {
  visible: boolean;
  exerciseName?: string;
  onDismiss: () => void;
  onConfirmSkip: (reason: SkipReason) => void;
  onReportDiscomfort?: () => void;
  testID?: string;
};

export function SkipExerciseDialog({
  visible,
  exerciseName: _exerciseName,
  onDismiss,
  onConfirmSkip,
  onReportDiscomfort,
  testID = 'skip-exercise-dialog',
}: SkipExerciseDialogProps) {
  const handleDiscomfort = () => {
    onDismiss();
    onConfirmSkip('discomfort');
    if (onReportDiscomfort) {
      onReportDiscomfort();
    }
  };

  const handleReason = (reason: SkipReason) => {
    onDismiss();
    onConfirmSkip(reason);
  };

  return (
    <Sheet
      dismissLabel="Cancel skip"
      onDismiss={onDismiss}
      testID={testID}
      title="Skip exercise"
      visible={visible}>
      <View style={styles.body}>
        <ListRow
          label="Discomfort / Injury flare-up"
          leading={<Icon colorRole="danger" name="warning" />}
          onPress={handleDiscomfort}
          testID="skip-reason-discomfort"
          tone="danger"
        />
        <ListRow
          label="Equipment unavailable"
          leading={<Icon colorRole="inkMuted" name="lock" />}
          onPress={() => handleReason('equipment')}
          testID="skip-reason-equipment"
        />
        <ListRow
          label="Fatigue / Out of time"
          leading={<Icon colorRole="inkMuted" name="timer" />}
          onPress={() => handleReason('fatigue')}
          testID="skip-reason-fatigue"
        />
        <ListRow
          label="Other reason"
          leading={<Icon colorRole="inkMuted" name="info" />}
          onPress={() => handleReason('other')}
          testID="skip-reason-other"
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingBottom: uiSpace.lg,
  },
});
