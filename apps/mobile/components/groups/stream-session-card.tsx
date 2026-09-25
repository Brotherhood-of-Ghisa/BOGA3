import { StyleSheet, Text, View } from 'react-native';

import { Card, Icon, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { StreamSessionCardViewModel } from '@/src/groups';

type GroupStreamSessionCardProps = {
  card: StreamSessionCardViewModel;
  /** In All, name the groups holding the share. */
  showGroupNames: boolean;
  onPress: (card: StreamSessionCardViewModel) => void;
};

/**
 * Stream session card (08 UX pattern "Stream card"): a collapsed summary with
 * no expand; a tap opens the friend's session view. "Training now" is the
 * `set-current` ring and the words, never a colour (G3).
 */
export function GroupStreamSessionCard({ card, showGroupNames, onPress }: GroupStreamSessionCardProps) {
  const testID = `group-stream-session-card-${card.key}`;
  const context = [card.startedAtLabel, card.gymName?.trim() || null].filter(Boolean).join(' · ');

  return (
    <Card
      accessibilityLabel={[card.memberName, card.statusLabel, context, card.recordsLabel].filter(Boolean).join(', ')}
      onPress={() => onPress(card)}
      style={styles.card}
      testID={testID}>
      <View style={styles.headerRow}>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.member} testID={`${testID}-member`}>
          {card.memberName}
        </Text>
        <View style={styles.status}>
          {card.isTrainingNow ? <Icon name="set-current" size="xs" /> : null}
          <Text
            allowFontScaling={false}
            style={[styles.statusText, card.isTrainingNow ? styles.statusLive : null]}
            testID={`${testID}-status`}>
            {card.statusLabel}
          </Text>
        </View>
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={styles.muted} testID={`${testID}-context`}>
        {context}
      </Text>
      <Text allowFontScaling={false} style={styles.metrics} testID={`${testID}-metrics`}>
        {`${card.setsLabel} · ${card.volumeLabel} · ${card.exercisesLabel}`}
      </Text>
      {card.recordsLabel ? (
        <View style={styles.records}>
          <Icon color={uiRoles.record} name="arrow-up" size="xs" />
          <Text allowFontScaling={false} style={styles.recordsText} testID={`${testID}-records`}>
            {card.recordsLabel}
          </Text>
        </View>
      ) : null}
      {showGroupNames && card.groupNames.length > 0 ? (
        <Text allowFontScaling={false} numberOfLines={1} style={styles.muted} testID={`${testID}-groups`}>
          {card.groupNames.join(', ')}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.xs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  member: {
    flex: 1,
    minWidth: 0,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  statusText: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  statusLive: {
    fontWeight: '600',
    color: uiRoles.ink,
  },
  muted: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  metrics: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
  records: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  recordsText: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.record,
  },
});
