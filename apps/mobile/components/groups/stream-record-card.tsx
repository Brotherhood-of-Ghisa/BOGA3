import { Pressable, StyleSheet, View } from 'react-native';

import { UiButton, UiSurface, UiText, uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';
import type { RecordSetWriteNotice, StreamRecordCardViewModel } from '@/src/groups';

import { GroupWriteNotice } from './write-notice';

type GroupStreamRecordCardProps = {
  card: StreamRecordCardViewModel;
  /** In All, name the record's group. */
  showGroupName: boolean;
  /** Opens the row detail sheet (E2). */
  onPress: (card: StreamRecordCardViewModel) => void;
  /** What a press does, for screen readers. */
  pressHint?: string;
  /** Certify from the card (E3): the same write as the sheet's. Omitted for a read-only card (Today). */
  onCertify?: (card: StreamRecordCardViewModel) => void;
  certifying?: boolean;
  /** The last certification outcome for this card's set. */
  notice?: RecordSetWriteNotice | null;
};

/**
 * A record card (product E3, P14, P15; 08 pattern 6): who, the group exercise
 * and value, one badge per board it broke, and the certification status in
 * text. It sits below its session card. The summary is one press target that
 * opens the row detail; Certify sits beside it (not inside, so it stays its own
 * accessibility element) and certifies without opening it. A voided card stays,
 * on the muted surface, with its status first (D15).
 */
export function GroupStreamRecordCard({
  card,
  showGroupName,
  onPress,
  pressHint = 'Opens the set',
  onCertify,
  certifying = false,
  notice = null,
}: GroupStreamRecordCardProps) {
  const testID = `group-stream-record-card-${card.key}`;
  return (
    <UiSurface style={styles.card} testID={testID} variant={card.voided ? 'panelMuted' : 'card'}>
      <Pressable
        accessibilityHint={pressHint}
        accessibilityLabel={card.accessibilityLabel}
        accessibilityRole="button"
        onPress={() => onPress(card)}
        style={({ pressed }) => [styles.summary, pressed ? styles.pressed : null]}
        testID={`${testID}-open`}>
        {card.voided ? (
          <UiText testID={`${testID}-status`} variant="label">
            {card.statusLabel}
          </UiText>
        ) : null}
        <UiText numberOfLines={1} testID={`${testID}-title`} variant="title">
          {card.title}
        </UiText>
        <UiText testID={`${testID}-value`} variant="body">
          {`${card.exerciseLabel}  ${card.valueLabel}`}
        </UiText>
        <View style={styles.badges}>
          {card.badges.map((badge) => (
            <View key={badge} style={styles.badge}>
              <UiText variant="subtitle">{badge}</UiText>
            </View>
          ))}
        </View>
        {card.provisionalLabel ? (
          <UiText testID={`${testID}-provisional`} variant="bodyMuted">
            {card.provisionalLabel}
          </UiText>
        ) : null}
        {card.voided ? null : (
          <UiText testID={`${testID}-status`} variant="label">
            {card.statusLabel}
          </UiText>
        )}
        {showGroupName ? (
          <UiText numberOfLines={1} style={styles.group} testID={`${testID}-group`} variant="bodyMuted">
            {card.groupName}
          </UiText>
        ) : null}
      </Pressable>
      {card.canCertify && onCertify ? (
        <UiButton
          disabled={certifying}
          label="Certify"
          onPress={() => onCertify(card)}
          testID={`${testID}-certify`}
          variant="secondary"
        />
      ) : null}
      {notice ? <GroupWriteNotice message={notice.message} testID={`${testID}-notice`} tone={notice.tone} /> : null}
    </UiSurface>
  );
}

const styles = StyleSheet.create({
  card: {
    marginLeft: uiSpace.md,
    padding: uiSpace.md,
    gap: uiSpace.sm,
  },
  summary: {
    gap: uiSpace.xs,
  },
  pressed: {
    opacity: 0.92,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.xs,
  },
  badge: {
    borderRadius: uiRadius.full,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.xs,
  },
  group: {
    fontSize: uiTypography.size.sm,
  },
});
