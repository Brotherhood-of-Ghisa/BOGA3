import { Pressable, StyleSheet, View } from 'react-native';

import { UiSurface, UiText, uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';
import type { StreamSessionCardViewModel } from '@/src/groups';

type GroupStreamSessionCardProps = {
  card: StreamSessionCardViewModel;
  /** In All, name the groups holding the share. */
  showGroupNames: boolean;
  onPress: (card: StreamSessionCardViewModel) => void;
};

/**
 * Stream session card (08 UX pattern "Stream card"): a collapsed summary with
 * no expand; a tap opens the friend's session view.
 */
export function GroupStreamSessionCard({ card, showGroupNames, onPress }: GroupStreamSessionCardProps) {
  const testID = `group-stream-session-card-${card.key}`;
  const context = [card.startedAtLabel, card.gymName?.trim() || null].filter(Boolean).join(' · ');

  return (
    <Pressable
      accessibilityHint="Opens the session"
      accessibilityLabel={[card.memberName, card.statusLabel, context, card.recordsLabel].filter(Boolean).join(', ')}
      accessibilityRole="button"
      onPress={() => onPress(card)}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
      testID={testID}>
      <UiSurface style={styles.card}>
        <View style={styles.headerRow}>
          <UiText numberOfLines={1} style={styles.name} testID={`${testID}-member`} variant="title">
            {card.memberName}
          </UiText>
          <View style={[styles.statusPill, card.isTrainingNow ? styles.statusLive : styles.statusDone]}>
            <UiText
              style={card.isTrainingNow ? styles.statusLiveText : null}
              testID={`${testID}-status`}
              variant="subtitle">
              {card.statusLabel}
            </UiText>
          </View>
        </View>
        <UiText numberOfLines={1} testID={`${testID}-context`} variant="subtitle">
          {context}
        </UiText>
        <UiText testID={`${testID}-metrics`} variant="label">
          {`${card.setsLabel} · ${card.volumeLabel} · ${card.exercisesLabel}`}
        </UiText>
        {card.recordsLabel ? (
          <UiText testID={`${testID}-records`} variant="label">
            {card.recordsLabel}
          </UiText>
        ) : null}
        {showGroupNames && card.groupNames.length > 0 ? (
          <UiText numberOfLines={1} style={styles.groups} testID={`${testID}-groups`} variant="bodyMuted">
            {card.groupNames.join(', ')}
          </UiText>
        ) : null}
      </UiSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.92,
  },
  card: {
    padding: uiSpace.lg,
    gap: uiSpace.xs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  name: {
    flex: 1,
    minWidth: 0,
  },
  statusPill: {
    borderRadius: uiRadius.full,
    borderWidth: 1,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.xxs,
  },
  statusLive: {
    borderColor: uiColors.borderSuccess,
    backgroundColor: uiColors.surfaceSuccess,
  },
  statusDone: {
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfacePage,
  },
  statusLiveText: {
    color: uiColors.textSuccess,
  },
  groups: {
    fontSize: uiTypography.size.sm,
  },
});
