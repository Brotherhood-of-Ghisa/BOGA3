import { Alert, StyleSheet, Text, View } from 'react-native';

import { Card, FigureText, ListRow, uiSpace, uiText, uiTextTone } from '@/components/ui';
import { formatSessionSetType } from '@/src/data/set-types';
import type { PlanBlockView, PlanDetailView } from '@/src/session-planner';

export type PlanDetailBlocksProps = {
  detail: PlanDetailView;
  /** Adds the pending block to the active session (or starts one). */
  onAdd: (block: PlanBlockView) => void;
  /** Confirms the skip for a pending block. */
  onSkip: (block: PlanBlockView) => void;
  onOpenSession: (sessionId: string) => void;
};

const blockStateWord = (block: PlanBlockView): string => {
  if (block.status === 'completed') return 'Completed';
  if (block.status === 'skipped') return 'Skipped';
  if (block.status === 'attached') return 'In progress';
  return 'Ready';
};

const blockTargetsLine = (block: PlanBlockView): string => {
  const parts = block.targets.map((target) => {
    const weight = target.targetWeightValue !== null ? target.targetWeightValue : '—';
    const effort = formatSessionSetType(target.targetSetType);
    return `${weight} × ${target.targetReps}${effort ? ` (${effort})` : ''}`;
  });
  return parts.join(' · ');
};

/**
 * The plan detail's block cards: each block's state in words, its quiet
 * `Block N of M` position, its targets, and the row its state allows —
 * Add to session and Skip while pending; a link to its performed session
 * once consumed and claimed. Consumed blocks expose no edit or delete.
 */
export function PlanDetailBlocks({ detail, onAdd, onSkip, onOpenSession }: PlanDetailBlocksProps) {
  return (
    <>
      {detail.blocks.map((block, index) => (
        <Card key={block.id} testID={`plan-detail-block-${index + 1}`}>
          <View style={styles.blockHeader}>
            <Text allowFontScaling={false} accessibilityRole="header" style={uiText.title}>
              {block.name}
            </Text>
            <Text allowFontScaling={false} style={uiText.meta} testID={`plan-detail-block-${index + 1}-state`}>
              <FigureText>{`${blockStateWord(block)} · Block ${index + 1} of ${detail.blocks.length}`}</FigureText>
            </Text>
            <Text allowFontScaling={false} style={[uiText.meta, uiTextTone.ink]} testID={`plan-detail-block-${index + 1}-targets`}>
              <FigureText>{blockTargetsLine(block)}</FigureText>
            </Text>
          </View>
          {block.status === 'pending' ? (
            <>
              <ListRow
                accessibilityLabel={`Add ${block.name} to the active session`}
                density="list"
                divider={false}
                label="Add to session"
                onPress={() => onAdd(block)}
                testID={`plan-detail-block-${index + 1}-add`}
              />
              <ListRow
                accessibilityLabel={`Skip ${block.name} without doing it`}
                density="list"
                divider
                label="Skip without doing it"
                onPress={() => {
                  Alert.alert(`Skip ${block.name}?`, 'The block moves on without recording any work.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Skip', style: 'default', onPress: () => onSkip(block) },
                  ]);
                }}
                testID={`plan-detail-block-${index + 1}-skip`}
              />
            </>
          ) : block.attachedSessionId !== null ? (
            <ListRow
              accessibilityLabel="Open the session this block is part of"
              density="list"
              divider={false}
              label="Open session"
              onPress={() => onOpenSession(block.attachedSessionId as string)}
              testID={`plan-detail-block-${index + 1}-session`}
            />
          ) : null}
        </Card>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  blockHeader: {
    gap: uiSpace.xs,
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.md,
    paddingBottom: uiSpace.sm,
  },
});
