import { StyleSheet, Text, View } from 'react-native';

import { ListRow, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { UNCERTIFIED_MARK_LABEL, type BoardRowViewModel } from '@/src/groups';

import { GroupCertificationStatus } from './certification-status';
import { cardListItemStyles } from './screen-styles';

type GroupBoardRowProps = {
  row: BoardRowViewModel;
  /** Its place in the board's one card (the list draws the card across its cells). */
  index: number;
  count: number;
  onPress: (row: BoardRowViewModel) => void;
};

/**
 * One full-board row (E1.2), a dense `ListRow` in the board's card: rank and
 * value in Plex Mono, the member ("You", "(former)") with the 1RM's set below
 * it, the date, and on All the certification mark (a check, or a ring and
 * "uncertified"). My row sits on `surface-subtle` and reads "You" (DLM-T12-D1).
 * The whole row opens the row detail sheet (E2, M25-T10).
 */
export function GroupBoardRow({ row, index, count, onPress }: GroupBoardRowProps) {
  const testID = `group-board-row-${row.rank}`;
  return (
    <View style={[cardListItemStyles(index, count), row.isMe ? styles.mine : null]}>
      <ListRow
        accessibilityHint="Opens the set"
        accessibilityLabel={row.accessibilityLabel}
        density="list"
        divider={index > 0}
        leading={
          <Text allowFontScaling={false} style={styles.rank}>
            {row.rankLabel}
          </Text>
        }
        meta={
          <View style={styles.meta}>
            <Text allowFontScaling={false} style={styles.value} testID={`${testID}-value`}>
              {row.valueLabel}
            </Text>
            <View style={styles.dateLine}>
              <Text allowFontScaling={false} style={styles.date} testID={`${testID}-date`}>
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
        onPress={() => onPress(row)}
        testID={testID}>
        <View style={styles.body}>
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            style={[styles.member, row.isMe ? styles.memberMine : null]}
            testID={`${testID}-member`}>
            {row.memberLabel}
          </Text>
          {row.detailLabel ? (
            <Text allowFontScaling={false} style={styles.detail} testID={`${testID}-detail`}>
              {row.detailLabel}
            </Text>
          ) : null}
        </View>
      </ListRow>
    </View>
  );
}

const styles = StyleSheet.create({
  mine: {
    backgroundColor: uiRoles.surfaceSubtle,
  },
  rank: {
    minWidth: 24,
    fontFamily: uiFonts.figure.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  body: {
    paddingVertical: uiSpace.xs,
  },
  member: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  memberMine: {
    fontWeight: '600',
  },
  detail: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  meta: {
    alignItems: 'flex-end',
    paddingVertical: uiSpace.xs,
  },
  value: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  dateLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  date: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
});
