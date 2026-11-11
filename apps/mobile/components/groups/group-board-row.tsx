import { Text, View } from 'react-native';

import { FigureText, ListRow, makeStyles, uiSpace, uiTextEmphasis, useUiText } from '@/components/ui';
import { UNCERTIFIED_MARK_LABEL, type BoardRowViewModel } from '@/src/groups';

import { GroupCertificationStatus } from './certification-status';
import { useScoreStyle } from './score-style';
import { useCardListItemStyles } from './screen-styles';

type GroupBoardRowProps = {
  row: BoardRowViewModel;
  /** Its place in the board's one card (the list draws the card across its cells). */
  index: number;
  count: number;
  onPress?: (row: BoardRowViewModel) => void;
};

/**
 * One full-board row (E1.2), a dense `ListRow` in the board's card: rank and
 * value in Plex Mono, the member ("You", "(former)") with the 1RM's set below
 * it, the date, and on All the certification mark (a check, or a ring and
 * "uncertified"). My row sits on `paper` and reads "You".
 * Percentage rows let date/certification wrap to keep the added-load set readable.
 * The whole row opens the row detail sheet (E2).
 */
export function GroupBoardRow({ row, index, count, onPress }: GroupBoardRowProps) {
  const styles = useStyles();
  const text = useUiText();
  const scoreStyle = useScoreStyle();
  const cardListItemStyles = useCardListItemStyles();
  const testID = `group-board-row-${row.rank}`;
  const percentageValue = row.valueLabel.includes('%BW') || row.detailLabel?.includes('%BW');
  return (
    <View style={[cardListItemStyles(index, count), row.isMe ? styles.mine : null]}>
      <ListRow
        accessibilityHint={onPress ? "Opens the set" : undefined}
        accessibilityLabel={row.accessibilityLabel}
        density="list"
        divider={index > 0}
        leading={
          <Text allowFontScaling={false} style={[text.figureLarge, styles.rank]}>
            {row.rankLabel}
          </Text>
        }
        meta={
          <View style={[styles.meta, percentageValue ? styles.percentageMeta : null]}>
            <Text allowFontScaling={false} style={scoreStyle(row.valueLabel, 'base')} testID={`${testID}-value`}>
              <FigureText figureStyle={scoreStyle(row.valueLabel, 'base')}>{row.valueLabel}</FigureText>
            </Text>
            <View style={[styles.dateLine, percentageValue ? styles.percentageDateLine : null]}>
              <Text allowFontScaling={false} style={text.figureSmall} testID={`${testID}-date`}>
                {row.dateLabel}
              </Text>
              {row.certification ? (
                <View testID={`${testID}-mark`}>
                  <GroupCertificationStatus
                    iconTestID={`${testID}-mark-${row.certification}`}
                    label={row.certification === 'uncertified' ? UNCERTIFIED_MARK_LABEL : null}
                    size="meta"
                    status={row.certification}
                  />
                </View>
              ) : null}
            </View>
          </View>
        }
        onPress={onPress ? () => onPress(row) : undefined}
        testID={testID}>
        <View style={styles.body}>
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            style={[text.body, row.isMe ? uiTextEmphasis.strong : null]}
            testID={`${testID}-member`}>
            {row.memberLabel}
          </Text>
          {row.detailLabel ? (
            <Text allowFontScaling={false} style={text.meta} testID={`${testID}-detail`}>
              <FigureText>{row.detailLabel}</FigureText>
            </Text>
          ) : null}
        </View>
      </ListRow>
    </View>
  );
}

const useStyles = makeStyles((roles) => ({
  mine: {
    backgroundColor: roles.paper,
  },
  rank: {
    minWidth: 24,
  },
  body: {
    paddingVertical: uiSpace.xs,
  },
  meta: {
    alignItems: 'flex-end',
    paddingVertical: uiSpace.xs,
  },
  dateLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  percentageMeta: { maxWidth: '50%' },
  percentageDateLine: { flexWrap: 'wrap', justifyContent: 'flex-end' },
}));
