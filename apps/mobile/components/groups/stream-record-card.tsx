import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, Card, Icon, Tag, uiBorder, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { RecordSetWriteNotice, StreamRecordCardViewModel } from '@/src/groups';

import { GroupCertificationStatus } from './certification-status';
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
 * and value, one tag per board it broke, and the certification status in text.
 * It sits below its session card. A standing record carries the `record` band
 * with its title and its value in bold `record` (T11-D2), as the app's own
 * records do. The summary is one press target that opens the row detail;
 * Certify sits beside it (not inside, so it stays its own accessibility
 * element) and certifies without opening it. A voided card stays, without the
 * band and faded, with its status first (D15).
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
  const voided = card.voided;
  const status = <GroupCertificationStatus label={card.statusLabel} status={card.status} testID={`${testID}-status`} />;
  const title = (
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      style={voided ? [styles.voidedTitle, styles.faint] : styles.bandTitle}
      testID={`${testID}-title`}>
      {card.title}
    </Text>
  );

  return (
    <Card style={styles.card} testID={testID}>
      <Pressable
        accessibilityHint={pressHint}
        accessibilityLabel={card.accessibilityLabel}
        accessibilityRole="button"
        onPress={() => onPress(card)}
        style={({ pressed }) => (pressed ? styles.pressed : null)}
        testID={`${testID}-open`}>
        {voided ? null : (
          <View style={styles.band} testID={`${testID}-band`}>
            <Icon color={uiRoles.record} name="arrow-up" size="xs" />
            {title}
          </View>
        )}
        <View style={styles.body}>
          {voided ? status : null}
          {voided ? title : null}
          <Text allowFontScaling={false} style={[styles.exercise, voided ? styles.faint : null]} testID={`${testID}-value`}>
            {card.exerciseLabel}
            {'\n'}
            <Text allowFontScaling={false} style={[styles.value, voided ? styles.faint : null]}>
              {card.valueLabel}
            </Text>
          </Text>
          {card.badges.length > 0 ? (
            <View style={styles.tags}>
              {card.badges.map((badge) => (
                <Tag key={badge} label={badge} tone={voided ? 'faint' : 'neutral'} />
              ))}
            </View>
          ) : null}
          {card.provisionalLabel ? (
            <Text allowFontScaling={false} style={styles.muted} testID={`${testID}-provisional`}>
              {card.provisionalLabel}
            </Text>
          ) : null}
          {voided ? null : status}
          {showGroupName ? (
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              style={[styles.muted, voided ? styles.faint : null]}
              testID={`${testID}-group`}>
              {card.groupName}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {(card.canCertify && onCertify) || notice ? (
        <View style={styles.actions}>
          {card.canCertify && onCertify ? (
            <ActionButton
              disabled={certifying}
              label="Certify"
              onPress={() => onCertify(card)}
              testID={`${testID}-certify`}
              variant="outline"
            />
          ) : null}
          {notice ? <GroupWriteNotice message={notice.message} testID={`${testID}-notice`} tone={notice.tone} /> : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  // Indented under the session card it belongs to.
  card: {
    marginLeft: uiSpace.md,
  },
  pressed: {
    backgroundColor: uiRoles.surfaceSubtle,
  },
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.xs,
    backgroundColor: uiRoles.recordWash,
    borderBottomWidth: uiBorder.width,
    borderBottomColor: uiRoles.recordRule,
  },
  bandTitle: {
    flex: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.record,
  },
  voidedTitle: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
  },
  body: {
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.xs,
  },
  exercise: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  value: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    color: uiRoles.record,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.xs,
  },
  muted: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  // A voided record has stepped back: every line fades, the status stays readable.
  faint: {
    color: uiRoles.inkFaint,
  },
  actions: {
    paddingHorizontal: uiSpace.md,
    paddingBottom: uiSpace.md,
    gap: uiSpace.sm,
  },
});
