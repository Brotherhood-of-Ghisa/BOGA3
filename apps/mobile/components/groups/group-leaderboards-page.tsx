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

import { GroupCycleButton } from './group-cycle-button';
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

/** How the podium cards are ordered: by exercise name, or newest podium set first. */
export type PodiumOrder = 'name' | 'recent';

const ORDER_OPTIONS = [
  { value: 'name' as const, label: 'Name' },
  { value: 'recent' as const, label: 'Recent' },
];

/**
 * The Groups screen's Leaderboards page (product E1.1, P8, D11): one podium
 * card per group exercise on All · its default metric, under a search box
 * that narrows them by exercise name and a pill that orders them by name or
 * by most recent record. A card opens its full board.
 */
export function GroupLeaderboardsPage({ groupId, userId, boards, offline, error, onRetry }: GroupLeaderboardsPageProps) {
  const dateFormat = useDateFormat();
  const router = useRouter();
  const cards = useMemo(() => (boards.data ? buildGroupMetricPodiums(boards.data, userId, dateFormat) : null), [boards.data, userId, dateFormat]);
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<PodiumOrder>('name');

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
  const shown = sortPodiumCards(filterPodiumCards(cards, query), order);
  return (
    <View style={styles.list} testID="group-leaderboards-page">
      <View style={styles.controls}>
        <View style={styles.search}>
          <SearchField
            accessibilityLabel="Search leaderboards"
            onChangeText={setQuery}
            placeholder="Search exercises"
            testID="group-leaderboards-search"
            value={query}
          />
        </View>
        <GroupCycleButton
          accessibilityLabel="Order"
          onChange={setOrder}
          options={ORDER_OPTIONS}
          style={styles.order}
          testID="group-leaderboards-order"
          value={order}
        />
      </View>
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
 * The cards in `order`: by name, ignoring case; or the newest podium set first,
 * empty podiums last, ties by name.
 */
export function sortPodiumCards<T extends { name: string; latestRecordAtMs: number | null }>(cards: readonly T[], order: PodiumOrder): T[] {
  const byName = (left: T, right: T) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  if (order === 'name') return [...cards].sort(byName);
  return [...cards].sort((left, right) =>
    (right.latestRecordAtMs ?? -Infinity) - (left.latestRecordAtMs ?? -Infinity) || byName(left, right));
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
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  search: {
    flex: 1,
    minWidth: 0,
  },
  order: {
    flex: 0,
    minWidth: 88,
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
