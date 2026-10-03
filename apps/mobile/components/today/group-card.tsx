import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GroupFilterChips } from '@/components/groups/group-filter-chips';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import {
  buildLatestActivity,
  buildWeekBoard,
  type GroupSummary,
  type GroupWeekSummaryResult,
  type LatestActivityViewModel,
  type WeekBoardRowViewModel,
  type WeekBoardViewModel,
} from '@/src/groups';

import { todayText } from './text-styles';

export type TodayGroupCardProps = {
  groups: GroupSummary[];
  selectedGroupId: string;
  onSelectGroup: (groupId: string) => void;
  summary: GroupWeekSummaryResult;
  myUserId: string;
  nowMs: number;
  /** The Groups screen on this group (the board, several training now). */
  onOpenGroup: (groupId: string) => void;
  onOpenSession: (memberUserId: string, sessionId: string) => void;
};

// A board figure: Plex Mono 500 at `sm`, right-aligned in its column.
function BoardFigure({ value, record = false, testID }: { value: number; record?: boolean; testID: string }) {
  const showRecord = record && value > 0;
  return (
    <View style={styles.figureCell}>
      {showRecord ? <Icon color={uiRoles.record} name="arrow-up" size="xs" /> : null}
      <Text allowFontScaling={false} style={[styles.boardFigure, showRecord ? todayText.record : null]} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

function BoardRow({ row }: { row: WeekBoardRowViewModel }) {
  const testID = `today-group-board-row-${row.userId}`;
  return (
    <View style={[styles.boardRow, row.isMe ? styles.boardRowMine : null]} testID={testID}>
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

const boardAccessibilityLabel = (title: string, board: WeekBoardViewModel): string =>
  [
    title,
    ...board.rows.map((row) => `${row.rank}, ${row.name}, ${row.workingSets} working sets, ${row.groupRecords} PRs`),
    board.me ? `You, ${board.me.rankLabel}, ${board.me.workingSets} working sets, ${board.me.groupRecords} PRs` : null,
  ]
    .filter(Boolean)
    .join('; ');

// This week's top three by working sets, `PRs` being group records; the
// caller's own line closes it when they are outside the three.
function WeekBoard({ board, title, onPress }: { board: WeekBoardViewModel; title: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityHint="Opens the group"
      accessibilityLabel={boardAccessibilityLabel(title, board)}
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
          W/S
        </Text>
        <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelFaint, styles.columnLabel]}>
          PRs
        </Text>
      </View>
      {board.rows.map((row) => (
        <BoardRow key={row.userId} row={row} />
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
    </Pressable>
  );
}

function TrainingNowMark({ children }: { children: ReactNode }) {
  return (
    <View style={styles.liveMark}>
      <Icon name="set-current" size="xs" />
      {children}
    </View>
  );
}

function LatestActivityContent({ activity }: { activity: LatestActivityViewModel }) {
  if (activity.kind === 'several') {
    return (
      <>
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
      </>
    );
  }

  const status =
    activity.kind === 'training' ? (
      <TrainingNowMark>
        <Text allowFontScaling={false} style={styles.liveText}>
          Training now
        </Text>
      </TrainingNowMark>
    ) : (
      <Text allowFontScaling={false} style={todayText.mutedLine}>
        {activity.status}
      </Text>
    );
  return (
    <>
      <View style={styles.latestHeader}>
        <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={[styles.member, styles.shrink]}>
          {activity.name}
        </Text>
        <View testID="today-group-latest-status">{status}</View>
      </View>
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={todayText.mutedLine}>
        {activity.context}
      </Text>
      <Text allowFontScaling={false} style={[todayText.detailFigure, styles.inkFigure]}>
        {activity.figures}
      </Text>
      {activity.kind === 'completed' && activity.record ? (
        <View style={styles.recordLine} testID="today-group-latest-record">
          <Icon color={uiRoles.record} name="arrow-up" size="xs" />
          <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.recordText}>
            <Text allowFontScaling={false} style={todayText.record}>
              {activity.record.lead}
            </Text>
            <Text allowFontScaling={false} style={styles.muted}>{` · ${activity.record.note}`}</Text>
          </Text>
        </View>
      ) : null}
    </>
  );
}

const ACTIVITY_HINTS: Record<LatestActivityViewModel['kind'], string> = {
  training: 'Opens their session',
  several: 'Opens the group',
  completed: 'Opens their session',
};

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
  const onPress =
    activity.kind === 'several' ? onOpenGroup : () => onOpenSession(activity.memberUserId, activity.sessionId);
  return (
    <Pressable
      accessibilityHint={ACTIVITY_HINTS[activity.kind]}
      accessibilityLabel={activity.accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.latestRow, pressed ? styles.pressed : null]}
      testID={`today-group-latest-${activity.kind}`}>
      <View style={styles.latestCopy}>
        <LatestActivityContent activity={activity} />
      </View>
      <Icon color={uiRoles.inkFaint} name="chevron-right" size="sm" />
    </Pressable>
  );
}

// Today's Group activity card (`design-targets/today-landing.md`): the group
// switcher (more than one group), this week's board, the latest activity.
export function TodayGroupCard({
  groups,
  selectedGroupId,
  onSelectGroup,
  summary,
  myUserId,
  nowMs,
  onOpenGroup,
  onOpenSession,
}: TodayGroupCardProps) {
  const board = buildWeekBoard(summary.members, myUserId);
  const activity = buildLatestActivity(summary, myUserId, nowMs);
  const groupName = groups.find((group) => group.group_id === selectedGroupId)?.name ?? '';
  const switcher = groups.length > 1;
  const openGroup = () => onOpenGroup(selectedGroupId);

  return (
    <Card testID="today-group-card">
      {switcher ? (
        <View style={styles.switcher} testID="today-group-switcher">
          <GroupFilterChips groups={groups} onChange={onSelectGroup} selectedGroupId={selectedGroupId} />
        </View>
      ) : null}
      <WeekBoard board={board} onPress={openGroup} title={switcher ? 'This week' : `${groupName} · this week`} />
      <View style={styles.latest}>
        <View style={styles.divider} />
        <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelStrong]}>
          Latest activity
        </Text>
        <LatestActivity activity={activity} onOpenGroup={openGroup} onOpenSession={onOpenSession} />
      </View>
    </Card>
  );
}

const BAR_HEIGHT = 12;
const RANK_WIDTH = 14;
const NAME_WIDTH = 72;
const FIGURE_WIDTH = 30;

const styles = StyleSheet.create({
  switcher: {
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.md,
  },
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
    gap: uiSpace.xs,
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
  latestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  shrink: {
    flexShrink: 1,
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
  liveMark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  liveText: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
  names: {
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  inkFigure: {
    color: uiRoles.ink,
  },
  recordLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  recordText: {
    flexShrink: 1,
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
  },
});
