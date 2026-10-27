import { useDateFormat } from '@/src/preferences/hooks';
import { buildCompetitionPodiums as buildGroupMetricPodiums } from '@/src/groups/competition-view-model';
import type { CompetitionPodiumsWire as GroupMetricPodiumWire } from '@/src/groups/competition-wire';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, FigureText, SearchField, Tag, uiBorder, uiRoles, uiSpace, uiText, uiTextEmphasis, uiTextTone } from '@/components/ui';
import {
  groupBoardPath,
  type GroupApiError,
  type GroupResourceState,
  type PodiumCardViewModel,
} from '@/src/groups';

import { GroupMissingDataState, GroupStateView } from './group-state-view';
import { scoreStyle } from './score-style';

type GroupLeaderboardsPageProps = {
  groupId: string;
  userId: string;
  /** `group_competition_podiums` through `useGroupResource` (`boards:v5:<groupId>`), owned by the group screen. */
  boards: GroupResourceState<GroupMetricPodiumWire>;
  offline: boolean;
  error: GroupApiError | null;
  onRetry: () => void;
};

/**
 * The group page's Leaderboards segment (product E1.1, P8, D11): one podium
 * card per group exercise on Certified · 1RM, archived exercises last, under a
 * search box that narrows them by exercise name. A card opens its full board.
 */
export function GroupLeaderboardsPage({ groupId, userId, boards, offline, error, onRetry }: GroupLeaderboardsPageProps) {
  const dateFormat = useDateFormat();
  const router = useRouter();
  const cards = useMemo(() => (boards.data ? buildGroupMetricPodiums(boards.data, userId, dateFormat) : null), [boards.data, userId, dateFormat]);
  const [query, setQuery] = useState('');

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
  const shown = filterPodiumCards(cards, query);
  return (
    <View style={styles.list} testID="group-leaderboards-page">
      <SearchField
        accessibilityLabel="Search leaderboards"
        onChangeText={setQuery}
        placeholder="Search exercises"
        testID="group-leaderboards-search"
        value={query}
      />
      {shown.length === 0 ? (
        <GroupStateView testID="group-leaderboards-no-match" title="No exercises match" />
      ) : null}
      {shown.map((card) => (
        <GroupPodiumCard
          card={card}
          key={card.exerciseId}
          onPress={() => router.push(groupBoardPath(groupId, card.exerciseId))}
        />
      ))}
    </View>
  );
}

/** The cards whose exercise name contains the search text, ignoring case and outer spaces. */
export function filterPodiumCards<T extends { name: string }>(cards: readonly T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle ? cards.filter((card) => card.name.toLocaleLowerCase().includes(needle)) : [...cards];
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
        <Text allowFontScaling={false} numberOfLines={1} style={[uiText.title, styles.name]} testID={`${testID}-name`}>
          {card.name}
        </Text>
        {card.archived ? (
          // The Tag sets its own `alignSelf: flex-start`; the wrapper centres it on the name.
          <View>
            <Tag label="Archived" testID={`${testID}-archived`} />
          </View>
        ) : null}
      </View>
      <Text allowFontScaling={false} style={uiText.label} testID={`${testID}-view`}>
        {card.viewLabel}
      </Text>
      {card.rows.length > 0 ? (
        <View style={styles.rows}>
          {card.rows.map((row) => (
            <View key={row.key} style={styles.podiumRow} testID={`${testID}-row-${row.rank}`}>
              <Text allowFontScaling={false} style={[uiText.figure, styles.rank]}>
                {String(row.rank)}
              </Text>
              <Text allowFontScaling={false} numberOfLines={1} style={[uiText.body, row.isMe ? uiTextEmphasis.strong : null, styles.member]}>
                {row.memberLabel}
              </Text>
              <Text allowFontScaling={false} style={scoreStyle(row.valueLabel, 'base')}>
                {row.valueLabel}
              </Text>
              <Text allowFontScaling={false} style={[uiText.figureSmall, styles.date]}>
                {row.dateLabel}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {card.emptyLabel ? (
        <Text allowFontScaling={false} style={uiText.meta} testID={`${testID}-empty`}>
          {card.emptyLabel}
        </Text>
      ) : null}
      {card.youLabel ? (
        <Text allowFontScaling={false} style={[uiText.meta, uiTextTone.ink, uiTextEmphasis.strong]} testID={`${testID}-you`}>
          <FigureText strong>{card.youLabel}</FigureText>
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
  },
  member: {
    flex: 1,
    minWidth: 0,
  },
  date: {
    minWidth: 52,
    textAlign: 'right',
  },
});
