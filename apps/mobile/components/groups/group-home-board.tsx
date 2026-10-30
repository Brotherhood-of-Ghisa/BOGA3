import { StyleSheet, Text, View } from 'react-native';

import { FigureText } from '@/components/ui/figure-text';
import { uiText, uiTextEmphasis, uiTextTone } from '@/components/ui/text-roles';
import { uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';
import {
  GROUP_HOME_METRIC_COLUMN,
  type GroupHomeBoard,
  type GroupHomeBoardRow,
} from '@/src/groups/home-view-model';
import type { GroupHomeMetric } from '@/src/groups/home-periods';

const VALUE_WIDTH = 40;

function BoardValue({ record, testID, value }: { record: boolean; testID: string; value: string }) {
  return (
    <View style={[styles.valueCell, { width: VALUE_WIDTH }]}>
      <Text allowFontScaling={false} style={[uiText.figureSmall, uiTextTone.ink, record ? uiTextTone.record : null, styles.value]} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

function BoardRow({ metric, row }: { metric: GroupHomeMetric; row: GroupHomeBoardRow }) {
  const testID = `group-home-board-row-${row.userId}`;
  return (
    <View style={[styles.row, row.isMe ? styles.rowMine : null]} testID={testID}>
      <Text allowFontScaling={false} style={[uiText.figureSmall, styles.rank]} testID={`${testID}-rank`}>
        {row.rank}
      </Text>
      <Text
        allowFontScaling={false}
        ellipsizeMode="tail"
        numberOfLines={1}
        style={[uiText.body, row.isMe ? uiTextEmphasis.strong : null, styles.name]}
        testID={`${testID}-name`}>
        {row.name}
      </Text>
      <View style={styles.track}>
        <View
          style={[styles.fill, { width: `${Math.round(row.fraction * 100)}%` }, row.leader ? styles.fillLeader : null]}
          testID={`${testID}-fill`}
        />
      </View>
      <BoardValue record={metric === 'prs' && row.value > 0} testID={`${testID}-value`} value={row.valueLabel} />
    </View>
  );
}

/**
 * The period's top five by the chosen metric, under `title` (`Top 5` when
 * none): rank, member, a bar against the
 * leader, the figure. My own line closes the board when I am outside the five.
 */
export function GroupHomeBoard({ board, metric, title }: { board: GroupHomeBoard; metric: GroupHomeMetric; title?: string }) {
  return (
    <View accessible accessibilityLabel={board.accessibilityLabel} style={styles.board} testID="group-home-board">
      <View style={styles.heading}>
        <Text allowFontScaling={false} style={[uiText.label, uiTextTone.ink, styles.headingTitle]}>
          {title ?? `Top ${board.rows.length}`}
        </Text>
        <Text
          allowFontScaling={false}
          style={[uiText.label, uiTextTone.faint, styles.headingValue, { width: VALUE_WIDTH }]}>
          {GROUP_HOME_METRIC_COLUMN[metric]}
        </Text>
      </View>
      {board.rows.map((row) => (
        <BoardRow key={row.userId} metric={metric} row={row} />
      ))}
      {board.me ? (
        <View style={styles.meLine} testID="group-home-board-me">
          <Text allowFontScaling={false} style={[uiText.body, styles.meText]} testID="group-home-board-me-label">
            <Text allowFontScaling={false} style={uiTextEmphasis.strong}>
              You
            </Text>
            <Text allowFontScaling={false} style={uiTextTone.muted}>
              {' · '}
              <FigureText>{board.me.rankLabel}</FigureText>
            </Text>
          </Text>
          <BoardValue record={false} testID="group-home-board-me-value" value={board.me.valueLabel} />
        </View>
      ) : null}
    </View>
  );
}

const BAR_HEIGHT = 12;
const RANK_WIDTH = 14;
const NAME_WIDTH = 76;

const styles = StyleSheet.create({
  board: {
    gap: uiSpace.xs,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: uiSpace.sm,
    paddingBottom: uiSpace.xs,
  },
  headingTitle: {
    flex: 1,
    minWidth: 0,
  },
  headingValue: {
    textAlign: 'right',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingVertical: uiSpace.xs + 2,
    // The `paper` band for my own row runs to the card's edges.
    marginHorizontal: -uiSpace.md,
    paddingHorizontal: uiSpace.md,
  },
  rowMine: {
    backgroundColor: uiRoles.paper,
  },
  rank: {
    width: RANK_WIDTH,
  },
  name: {
    width: NAME_WIDTH,
  },
  track: {
    flex: 1,
    height: BAR_HEIGHT,
    borderRadius: uiGeometry.radius.control,
    backgroundColor: uiRoles.viz0,
    overflow: 'hidden',
  },
  fill: {
    height: BAR_HEIGHT,
    borderRadius: uiGeometry.radius.control,
    backgroundColor: uiRoles.viz3,
  },
  fillLeader: {
    backgroundColor: uiRoles.viz4,
  },
  valueCell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  value: {
    textAlign: 'right',
  },
  meLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    marginTop: uiSpace.xs,
    paddingTop: uiSpace.sm,
    borderTopWidth: 1,
    borderTopColor: uiRoles.ruleSoft,
  },
  meText: {
    flex: 1,
    minWidth: 0,
  },
});
