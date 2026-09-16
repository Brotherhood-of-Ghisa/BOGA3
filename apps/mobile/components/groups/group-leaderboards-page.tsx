import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { UiSurface, UiText, uiColors, uiRadius, uiSpace } from '@/components/ui';
import {
  buildPodiumCards,
  groupBoardPath,
  type GroupApiError,
  type GroupBoardPodiumsResult,
  type GroupResourceState,
  type PodiumCardViewModel,
} from '@/src/groups';

import { GroupMissingDataState, GroupStateView } from './group-state-view';

type GroupLeaderboardsPageProps = {
  groupId: string;
  userId: string;
  /** `group_board_podiums` through `useGroupResource` (`boards:<groupId>`), owned by the group screen. */
  boards: GroupResourceState<GroupBoardPodiumsResult>;
  offline: boolean;
  error: GroupApiError | null;
  onRetry: () => void;
};

/**
 * The group page's Leaderboards segment (product E1.1, P8, D11): one podium
 * card per group exercise on Certified · e1RM, archived exercises last. A card
 * opens its full board.
 */
export function GroupLeaderboardsPage({ groupId, userId, boards, offline, error, onRetry }: GroupLeaderboardsPageProps) {
  const router = useRouter();
  const cards = useMemo(() => (boards.data ? buildPodiumCards(boards.data, userId) : null), [boards.data, userId]);

  if (!cards) {
    return <GroupMissingDataState error={error} offline={offline} onRetry={onRetry} testIDPrefix="group-leaderboards" />;
  }
  if (cards.length === 0) {
    return (
      <GroupStateView
        body="Owners and admins add them on the Exercises page."
        testID="group-leaderboards-empty"
        title="No group exercises yet"
      />
    );
  }
  return (
    <View style={styles.list} testID="group-leaderboards-page">
      {cards.map((card) => (
        <GroupPodiumCard
          card={card}
          key={card.exerciseId}
          onPress={() => router.push(groupBoardPath(groupId, card.exerciseId))}
        />
      ))}
    </View>
  );
}

/** A podium card (E1.1): the whole card is one press target (08 pattern 6). */
export function GroupPodiumCard({ card, onPress }: { card: PodiumCardViewModel; onPress: () => void }) {
  const testID = `group-podium-card-${card.exerciseId}`;
  return (
    <Pressable
      accessibilityHint="Opens the full leaderboard"
      accessibilityLabel={card.accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
      testID={testID}>
      <UiSurface style={styles.card}>
        <View style={styles.titleRow}>
          <UiText numberOfLines={1} style={styles.title} testID={`${testID}-name`} variant="title">
            {card.name}
          </UiText>
          <UiText testID={`${testID}-view`} variant="subtitle">
            {card.viewLabel}
          </UiText>
        </View>
        {card.archived ? (
          <View style={styles.archivedTag}>
            <UiText testID={`${testID}-archived`} variant="subtitle">
              Archived
            </UiText>
          </View>
        ) : null}
        {card.rows.map((row) => (
          <View key={row.key} style={styles.podiumRow} testID={`${testID}-row-${row.rank}`}>
            <UiText style={styles.rank} variant="label">
              {String(row.rank)}
            </UiText>
            <UiText numberOfLines={1} style={styles.member} variant={row.isMe ? 'label' : 'body'}>
              {row.memberLabel}
            </UiText>
            <UiText variant="body">{row.valueLabel}</UiText>
            <UiText style={styles.date} variant="subtitle">
              {row.dateLabel}
            </UiText>
          </View>
        ))}
        {card.emptyLabel ? (
          <UiText testID={`${testID}-empty`} variant="bodyMuted">
            {card.emptyLabel}
          </UiText>
        ) : null}
        {card.youLabel ? (
          <UiText style={styles.you} testID={`${testID}-you`} variant="label">
            {card.youLabel}
          </UiText>
        ) : null}
      </UiSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: uiSpace.md,
  },
  pressed: {
    opacity: 0.92,
  },
  card: {
    padding: uiSpace.lg,
    gap: uiSpace.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
  archivedTag: {
    alignSelf: 'flex-start',
    borderRadius: uiRadius.full,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.xxs,
  },
  podiumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  rank: {
    minWidth: 20,
  },
  member: {
    flex: 1,
    minWidth: 0,
  },
  date: {
    minWidth: 56,
    textAlign: 'right',
  },
  you: {
    alignSelf: 'flex-end',
  },
});
