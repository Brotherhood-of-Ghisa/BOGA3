import { ScrollView, StyleSheet, Text } from 'react-native';

import { ActionButton, ListRow, Sheet, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { PersonalExerciseLinkChoice } from '@/src/groups/exercise-view-model';

type Props = {
  visible: boolean;
  groupName: string;
  groupExerciseName: string;
  choices: PersonalExerciseLinkChoice[];
  onSelect: (choice: PersonalExerciseLinkChoice) => void;
  /** The backdrop, Android back or the VoiceOver escape: nothing chosen. */
  onClose: () => void;
  /** The sheet has gone (`Sheet.onDismissed`): the host confirms the choice now. */
  onDismissed: () => void;
};

/**
 * `Your linked exercises`: one row per personal exercise linked to this group
 * exercise, each with its own `Unlink`. The chooser only selects one stable
 * personal ID; its host confirms once the sheet has gone. No Cancel (G5).
 */
export function GroupExerciseUnlinkSheet({ visible, groupName, groupExerciseName, choices, onSelect, onClose, onDismissed }: Props) {
  return (
    <Sheet
      dismissLabel="Dismiss your linked exercises"
      onDismiss={onClose}
      onDismissed={onDismissed}
      testID="group-unlink-chooser"
      title="Your linked exercises"
      visible={visible}>
      <Text allowFontScaling={false} style={styles.context}>
        {groupExerciseName} · {groupName}
      </Text>
      <ScrollView style={styles.list}>
        {choices.map((choice, index) => (
          <ListRow
            divider={index > 0}
            key={choice.exerciseDefinitionId}
            meta={
              <ActionButton
                accessibilityLabel={`Unlink ${choice.label} from ${groupExerciseName} in ${groupName}`}
                label="Unlink"
                onPress={() => onSelect(choice)}
                testID={`group-unlink-choice-${choice.exerciseDefinitionId}`}
                tone="danger"
                variant="text"
              />
            }>
            <Text allowFontScaling={false} style={styles.name}>
              {choice.label}
            </Text>
          </ListRow>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  context: {
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.sm,
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  list: {
    flexShrink: 1,
  },
  // Long names wrap rather than truncate.
  name: {
    paddingVertical: uiSpace.sm,
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
});
