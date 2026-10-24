import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import {
  WEEK_BOARD_SIZE,
  buildLatestActivity,
  buildWeekBoard,
  type LatestActivityViewModel,
  type WeekBoardRowViewModel,
  type WeekBoardViewModel,
} from '@/src/groups';

import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import type { CompetitionWeekSummaryWire as GroupWeekSummaryResult } from '@/src/groups/competition-wire';
import { SessionSummaryRow, TrainingNowMark } from './session-summary-row';
import { todayText } from './text-styles';

export type TodayGroupCardProps = {
  selectedGroupId: string;
  summary: GroupWeekSummaryResult;
  myUserId: string;
  nowMs: number;
  /** The Groups screen on this group (the board, several training now). */
  onOpenGroup: (groupId: string) => void;
  onOpenSession: (memberUserId: string, sessionId: string, groupId: string) => void;
  dateFormat?: ExerciseDateFormat;
  /** The cards layout: no card of its own, and the board shows as many rows as fit. */
  fill?: boolean;
};

// A board figure: Plex Mono 500 at `sm`, right-aligned in its column.
function BoardFigure({ value, record = false, testID }: { value: number; record?: boolean; testID: string }) {
  const showRecord = record && value > 0;
  return (
    <View style={styles.figureCell}>
      <Text allowFontScaling={false} style={[styles.boardFigure, showRecord ? todayText.record : null]} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

function BoardRow({ row, fill }: { row: WeekBoardRowViewModel; fill: boolean }) {
  const testID = `today-group-board-row-${row.userId}`;
  return (
    <View style={[styles.boardRow, fill ? styles.boardRowFill : null, row.isMe ? styles.boardRowMine : null]} testID={testID}>
      <Text allowFontScaling={false} style={styles.rank} testID={`${testID}-rank`}>
        {row.rank}
      </Text>
      <Text
        allowFontScaling={false}
        ellipsizeMode="tail"
        numberOfLines={1}
        style={[styles.memberName, row.isMe ? styles.memberNameMine : null]}
        testID={`${testID}-name`}>
        {row.name}
      </Text>
      <View style={styles.track}>
        <View
          style={[styles.fill, { width: `${Math.round(row.fraction * 100)}%` }, row.leader ? styles.fillLeader : null]}
          testID={`${testID}-fill`}
        />
      </View>
      <BoardFigure testID={`${testID}-working-sets`} value={row.workingSets} />
      <BoardFigure record testID={`${testID}-records`} value={row.groupRecords} />
    </View>
  );
}

const boardAccessibilityLabel = (title: string, board: WeekBoardViewModel, fill: boolean): string =>
  [
    title,
    ...board.rows.map((row) => `${row.rank}, ${row.name}, ${row.workingSets} sets, ${row.groupRecords} PRs`),
    board.me ? `You, ${board.me.rankLabel}, ${board.me.workingSets} sets, ${board.me.groupRecords} PRs` : null,
    fill && board.hiddenCount > 0 ? `${board.hiddenCount} more` : null,
  ]
    .filter(Boolean)
    .join('; ');

// This week's leaders by working sets, `PRs` being group records: the top
// three, or in the cards layout as many as fit and `+N more`. The caller's own
// line closes it when they are outside the rows shown.
function WeekBoard({ board, title, onPress, fill }: { board: WeekBoardViewModel; title: string; onPress: () => void; fill: boolean }) {
  return (
    <Pressable
      accessibilityHint="Opens the group"
      accessibilityLabel={boardAccessibilityLabel(title, board, fill)}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.board, pressed ? styles.pressed : null]}
      testID="today-group-board">
      <View style={styles.boardHeading}>
        <Text
          allowFontScaling={false}
          ellipsizeMode="tail"
          numberOfLines={1}
          style={[todayText.microLabel, todayText.microLabelStrong, styles.boardTitle]}
          testID="today-group-board-title">
          {title}
        </Text>
        <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelFaint, styles.columnLabel]}>
          Sets
        </Text>
        <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelFaint, styles.columnLabel]}>
          PRs
        </Text>
      </View>
      {board.rows.map((row) => (
        <BoardRow fill={fill} key={row.userId} row={row} />
      ))}
      {board.me ? (
        <View style={styles.meLine} testID="today-group-board-me">
          <Text allowFontScaling={false} style={styles.meText} testID="today-group-board-me-rank">
            <Text allowFontScaling={false} style={styles.memberNameMine}>You</Text>
            <Text allowFontScaling={false} style={styles.muted}>{` · ${board.me.rankLabel}`}</Text>
          </Text>
          <BoardFigure testID="today-group-board-me-working-sets" value={board.me.workingSets} />
          <BoardFigure record testID="today-group-board-me-records" value={board.me.groupRecords} />
        </View>
      ) : null}
      {fill && board.hiddenCount > 0 ? (
        <Text allowFontScaling={false} style={[todayText.microLabel, styles.more]} testID="today-group-board-more">
          {`+${board.hiddenCount} more`}
        </Text>
      ) : null}
    </Pressable>
  );
}

const ACTIVITY_HINTS: Record<LatestActivityViewModel['kind'], string> = {
  training: 'Opens their session',
  several: 'Opens the group',
  completed: 'Opens their session',
};

// Several members training now: one row naming them, which opens the group.
function SeveralTrainingRow({
  activity,
  onPress,
}: {
  activity: Extract<LatestActivityViewModel, { kind: 'several' }>;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint={ACTIVITY_HINTS.several}
      accessibilityLabel={activity.accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.latestRow, pressed ? styles.pressed : null]}
      testID="today-group-latest-several">
      <View style={styles.latestCopy}>
        <TrainingNowMark>
          <Text allowFontScaling={false} style={styles.member} testID="today-group-latest-title">
            <Text allowFontScaling={false} style={styles.memberFigure}>{activity.count}</Text> training now
          </Text>
        </TrainingNowMark>
        <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.names}>
          {activity.names}
        </Text>
        {activity.gyms ? (
          <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={todayText.mutedLine}>
            {activity.gyms}
          </Text>
        ) : null}
      </View>
      <Icon color={uiRoles.inkFaint} name="chevron-right" size="sm" />
    </Pressable>
  );
}

function LatestActivity({
  activity,
  onOpenGroup,
  onOpenSession,
}: {
  activity: LatestActivityViewModel | null;
  onOpenGroup: () => void;
  onOpenSession: (memberUserId: string, sessionId: string) => void;
}) {
  if (!activity) {
    return (
      <Text allowFontScaling={false} style={todayText.mutedLine} testID="today-group-latest-empty">
        No sessions shared to this group yet.
      </Text>
    );
  }
  if (activity.kind === 'several') return <SeveralTrainingRow activity={activity} onPress={onOpenGroup} />;
  // One member's session: the Progress card's row, under the member's name.
  return (
    <SessionSummaryRow
      accessibilityHint={ACTIVITY_HINTS[activity.kind]}
      accessibilityLabel={activity.accessibilityLabel}
      duration={activity.duration}
      figures={activity.figures}
      gym={activity.gym}
      member={{ name: activity.name, trainingNow: activity.kind === 'training' }}
      onPress={() => onOpenSession(activity.memberUserId, activity.sessionId)}
      record={activity.record}
      stamp={activity.stamp}
      testID={`today-group-latest-${activity.kind}`}
    />
  );
}

// Today's group card: this week's board, then the latest activity. The
// section's heading names the group and owns the switch between groups.
export function TodayGroupCard({
  selectedGroupId,
  summary,
  myUserId,
  nowMs,
  onOpenGroup,
  onOpenSession,
  dateFormat,
  fill = false,
}: TodayGroupCardProps) {
  const [listPreferences] = useExerciseListPreferences();
  const [boardHeight, setBoardHeight] = useState<number | null>(null);
  const resolvedDateFormat = dateFormat ?? listPreferences.dateFormat;
  const size = fill && boardHeight !== null ? boardRowsThatFit(boardHeight) : WEEK_BOARD_SIZE;
  const board = buildWeekBoard(summary.members, myUserId, size);
  const activity = buildLatestActivity(summary, myUserId, nowMs, resolvedDateFormat);
  const openGroup = () => onOpenGroup(selectedGroupId);

  const onBoardLayout = (event: LayoutChangeEvent) => {
    const measured = Math.round(event.nativeEvent.layout.height);
    if (measured > 0 && measured !== boardHeight) setBoardHeight(measured);
  };
  const weekBoard = <WeekBoard board={board} fill={fill} onPress={openGroup} title="This week" />;
  const latest = (
    <View style={styles.latest}>
      <View style={styles.divider} />
      <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelStrong]}>
        Latest activity
      </Text>
      <LatestActivity
        activity={activity}
        onOpenGroup={openGroup}
        onOpenSession={(memberId, sessionId) => onOpenSession(memberId, sessionId, selectedGroupId)}
      />
    </View>
  );
  if (fill) {
    // The board's box takes the height the latest activity leaves, whatever
    // its rows; the rows that fit it are chosen from that height.
    return (
      <View style={styles.fillCard} testID="today-group-card">
        <View onLayout={onBoardLayout} style={styles.fillBoard} testID="today-group-board-box">
          {weekBoard}
        </View>
        {latest}
      </View>
    );
  }
  return (
    <Card testID="today-group-card">
      {weekBoard}
      {latest}
    </Card>
  );
}

// The cards layout's board: its rows are a fixed height, so the rows that fit
// follow from the box's height, after its heading, the caller's own line and
// the `+N more` line. Never fewer than the list layout's three.
const FILL_ROW_HEIGHT = 36;
const FILL_ROW_PITCH = FILL_ROW_HEIGHT + uiSpace.xs;
const FILL_BOARD_CHROME = uiSpace.md + 14 + uiSpace.sm;
const FILL_ME_LINE = 36;
const FILL_MORE_LINE = 22;

export const boardRowsThatFit = (height: number): number =>
  Math.max(WEEK_BOARD_SIZE, Math.floor((height - FILL_BOARD_CHROME - FILL_ME_LINE - FILL_MORE_LINE) / FILL_ROW_PITCH));

const BAR_HEIGHT = 12;
const RANK_WIDTH = 14;
const NAME_WIDTH = 72;
// Fits the widest column label, `SETS`.
const FIGURE_WIDTH = 36;

const styles = StyleSheet.create({
  board: {
    paddingTop: uiSpace.md,
    paddingBottom: uiSpace.sm,
    gap: uiSpace.xs,
  },
  boardHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
  },
  boardTitle: {
    flex: 1,
    minWidth: 0,
  },
  columnLabel: {
    width: FIGURE_WIDTH,
    textAlign: 'right',
  },
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.xs + 2,
  },
  boardRowFill: {
    height: FILL_ROW_HEIGHT,
  },
  more: {
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.xs,
  },
  fillCard: {
    flex: 1,
  },
  // Its basis is 0 and its floor fixed, so the rows inside never size it.
  fillBoard: {
    flexGrow: 1,
    flexBasis: 0,
    minHeight: FILL_BOARD_CHROME + FILL_ME_LINE + FILL_MORE_LINE + WEEK_BOARD_SIZE * FILL_ROW_PITCH,
    overflow: 'hidden',
  },
  // `You` sits on `paper`, as the canvas draws it.
  boardRowMine: {
    backgroundColor: uiRoles.paper,
  },
  rank: {
    width: RANK_WIDTH,
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  memberName: {
    width: NAME_WIDTH,
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  memberNameMine: {
    fontWeight: '600',
    color: uiRoles.ink,
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
  figureCell: {
    width: FIGURE_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  boardFigure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
    textAlign: 'right',
  },
  meLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    marginTop: uiSpace.xs,
    paddingTop: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    borderTopWidth: 1,
    borderTopColor: uiRoles.ruleSoft,
  },
  meText: {
    flex: 1,
    minWidth: 0,
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  muted: {
    color: uiRoles.inkMuted,
  },
  latest: {
    paddingHorizontal: uiSpace.md,
    paddingBottom: uiSpace.md,
    gap: uiSpace.md,
  },
  // A `rule-soft` hairline across the card, edge to edge.
  divider: {
    height: 1,
    marginHorizontal: -uiSpace.md,
    backgroundColor: uiRoles.ruleSoft,
  },
  latestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
    minHeight: uiGeometry.tapTarget,
  },
  // A pressed row takes the `paper` ground, as `ListRow` does.
  pressed: {
    backgroundColor: uiRoles.paper,
  },
  latestCopy: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xs,
  },
  member: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  memberFigure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
  },
  names: {
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
});
