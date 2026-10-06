import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton, Icon, ListRow, Sheet, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';

export type PlanCardChoice = {
  /** The candidate card's `sessionExerciseId`. */
  id: string;
  exerciseName: string;
  setCount: number;
};

export type PlanCardChoiceSheetProps = {
  /** The block being added; `null` keeps the sheet closed. */
  blockName: string | null;
  candidates: PlanCardChoice[];
  /** The one write path: the host attaches the block to the chosen card. */
  onConfirm: (sessionExerciseId: string) => void;
  onDismiss: () => void;
};

/**
 * Which of several matching cards takes this planned block? Shown when
 * attaching a plan block finds two or more compatible unsourced cards of the
 * same exercise: the choice is explicit, and nothing is written until the
 * confirm. A `Sheet` with no Cancel — the backdrop dismisses it (G5) — radio
 * rows for the choice, and the confirm as the sheet's one `accent`.
 */
export function PlanCardChoiceSheet({ blockName, candidates, onConfirm, onDismiss }: PlanCardChoiceSheetProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // A new target resets the selection: keyed on the block and the exact
  // candidate set, so a re-render with the same choice never clears it.
  const targetKey =
    blockName === null ? null : `${blockName}:${candidates.map((candidate) => candidate.id).join(',')}`;
  const [shownKey, setShownKey] = useState<string | null>(null);
  if (shownKey !== targetKey) {
    setShownKey(targetKey);
    setSelectedId(null);
  }

  if (!blockName || candidates.length === 0) {
    return null;
  }

  const confirm = () => {
    if (selectedId === null || pending) {
      return;
    }
    setPending(true);
    onDismiss();
    onConfirm(selectedId);
  };

  return (
    <Sheet
      dismissLabel="Dismiss card choice"
      onDismiss={onDismiss}
      testID="plan-card-choice-sheet"
      title={blockName}
      visible>
      <Text allowFontScaling={false} style={styles.prompt}>
        Which {blockName} card?
      </Text>
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
        {candidates.map((candidate, index) => {
          const checked = selectedId === candidate.id;
          return (
            <ListRow
              accessibilityLabel={`${candidate.exerciseName} card, ${candidate.setCount} ${candidate.setCount === 1 ? 'set' : 'sets'}`}
              checked={checked}
              density="list"
              divider={index > 0}
              key={candidate.id}
              leading={<Icon color={uiRoles.ink} name={checked ? 'radio-on' : 'radio-off'} />}
              onPress={() => setSelectedId(candidate.id)}
              testID={`plan-card-choice-${candidate.id}`}>
              <View style={styles.choiceText}>
                <Text allowFontScaling={false} style={styles.optionLabel}>
                  {candidate.exerciseName}
                </Text>
                <Text allowFontScaling={false} style={styles.detail}>
                  {candidate.setCount} {candidate.setCount === 1 ? 'set' : 'sets'}
                </Text>
              </View>
            </ListRow>
          );
        })}
      </ScrollView>
      <View style={styles.footer}>
        {/* The sheet's one `accent`. */}
        <ActionButton
          disabled={pending || selectedId === null}
          label="Add block to card"
          onPress={() => void confirm()}
          testID="plan-card-choice-confirm"
          variant="primary"
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  prompt: {
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.sm,
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  list: {
    flexShrink: 1,
  },
  choiceText: {
    paddingVertical: uiSpace.sm,
  },
  optionLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  detail: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  footer: {
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.lg,
    paddingTop: uiSpace.sm,
    paddingBottom: uiSpace.lg,
  },
});
