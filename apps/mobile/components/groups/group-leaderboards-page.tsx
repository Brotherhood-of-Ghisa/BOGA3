import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, Tag, uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
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
 * card per group exercise on Certified · 1RM, archived exercises last. A card
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

/**
 * A podium card (E1.1): one link `Card` (08 pattern 6). The name in Archivo,
 * the view as a micro-label, `Archived` as a `Tag`; rank, value and date in
 * Plex Mono, the member in Source Sans, and my row reads "You" in bold.
 */
export function GroupPodiumCard({ card, onPress }: { card: PodiumCardViewModel; onPress: () => void }) {
  const testID = `group-podium-card-${card.exerciseId}`;
  return (
    <Card accessibilityLabel={card.accessibilityLabel} onPress={onPress} style={styles.card} testID={testID}>
      <View style={styles.titleRow}>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.name} testID={`${testID}-name`}>
          {card.name}
        </Text>
        {card.archived ? <Tag label="Archived" testID={`${testID}-archived`} /> : null}
      </View>
      <Text allowFontScaling={false} style={styles.view} testID={`${testID}-view`}>
        {card.viewLabel}
      </Text>
      {card.rows.length > 0 ? (
        <View style={styles.rows}>
          {card.rows.map((row) => (
            <View key={row.key} style={styles.podiumRow} testID={`${testID}-row-${row.rank}`}>
              <Text allowFontScaling={false} style={styles.rank}>
                {String(row.rank)}
              </Text>
              <Text allowFontScaling={false} numberOfLines={1} style={[styles.member, row.isMe ? styles.memberMine : null]}>
                {row.memberLabel}
              </Text>
              <Text allowFontScaling={false} style={styles.value}>
                {row.valueLabel}
              </Text>
              <Text allowFontScaling={false} style={styles.date}>
                {row.dateLabel}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {card.emptyLabel ? (
        <Text allowFontScaling={false} style={styles.muted} testID={`${testID}-empty`}>
          {card.emptyLabel}
        </Text>
      ) : null}
      {card.youLabel ? (
        <Text allowFontScaling={false} style={styles.you} testID={`${testID}-you`}>
          {card.youLabel}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: uiSpace.md,
  },
  card: {
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  name: {
    flexShrink: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  view: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  rows: {
    marginTop: uiSpace.xs,
  },
  podiumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingVertical: uiSpace.xs,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  rank: {
    minWidth: 16,
    fontFamily: uiFonts.figure.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  member: {
    flex: 1,
    minWidth: 0,
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  memberMine: {
    fontWeight: '600',
  },
  value: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  date: {
    minWidth: 52,
    textAlign: 'right',
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  muted: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  you: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
});
