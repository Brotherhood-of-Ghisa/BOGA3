import { useEffect, useRef } from 'react';
import { Platform, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { UiButton, UiText, uiColors, uiRadius, uiSpace } from '@/components/ui';
import type { PersonalExerciseLinkChoice } from '@/src/groups/exercise-view-model';

type Props = {
  visible: boolean;
  groupName: string;
  groupExerciseName: string;
  choices: PersonalExerciseLinkChoice[];
  onSelect: (choice: PersonalExerciseLinkChoice) => void;
  onClose: () => void;
  onDismiss: () => void;
};

/** The chooser only selects one stable personal ID; its host confirms after native dismissal. */
export function GroupExerciseUnlinkSheet({ visible, groupName, groupExerciseName, choices, onSelect, onClose, onDismiss }: Props) {
  const wasVisible = useRef(false);
  useEffect(() => {
    // Android has no Modal.onDismiss. With no animation its native view has
    // been removed by this commit before the host presents the confirmation.
    if (Platform.OS !== 'ios' && wasVisible.current && !visible) onDismiss();
    wasVisible.current = visible;
  }, [visible, onDismiss]);
  return (
    <Modal animationType={Platform.OS === 'ios' ? 'fade' : 'none'} onDismiss={onDismiss} onRequestClose={onClose} testID="group-unlink-modal" transparent visible={visible}>
      <View style={styles.root}>
        <Pressable accessibilityLabel="Dismiss your linked exercises" onPress={onClose} style={styles.scrim} />
        <View accessibilityViewIsModal style={styles.panel} testID="group-unlink-chooser">
          <UiText accessibilityRole="header" variant="title">Your linked exercises</UiText>
          <UiText variant="bodyMuted">{groupExerciseName} · {groupName}</UiText>
          <ScrollView contentContainerStyle={styles.list}>
            {choices.map((choice) => (
              <View key={choice.exerciseDefinitionId} style={styles.choice}>
                <UiText style={styles.name}>{choice.label}</UiText>
                <UiButton
                  accessibilityLabel={`Unlink ${choice.label} from ${groupExerciseName} in ${groupName}`}
                  label="Unlink"
                  onPress={() => onSelect(choice)}
                  style={styles.button}
                  testID={`group-unlink-choice-${choice.exerciseDefinitionId}`}
                  variant="danger"
                />
              </View>
            ))}
          </ScrollView>
          <UiButton label="Cancel" onPress={onClose} style={styles.button} testID="group-unlink-cancel" variant="secondary" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: uiColors.overlayScrim },
  panel: {
    maxHeight: '85%', gap: uiSpace.md, padding: uiSpace.xl, paddingBottom: uiSpace.xl * 2,
    borderTopLeftRadius: uiRadius.md, borderTopRightRadius: uiRadius.md, backgroundColor: uiColors.surfaceDefault,
  },
  list: { gap: uiSpace.md },
  choice: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.md },
  name: { flex: 1, minWidth: 0 },
  button: { minHeight: 44 },
});
