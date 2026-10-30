import { CoWGroupPreview } from '@/components/groups/cow-group-preview';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { FigureText } from '@/components/ui/figure-text';
import { uiText, uiTextEmphasis, uiTextTone } from '@/components/ui/text-roles';
import { uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';
import {
  GROUP_SESSIONS_SHOWN,
  buildGroupSessions,
  buildWeekBoard,
  type GroupSessionRowViewModel,
  type WeekBoardRowViewModel,
  type WeekBoardViewModel,
} from '@/src/groups';
import type { CompetitionWeekSummaryWire as GroupWeekSummaryResult } from '@/src/groups/competition-wire';
import { localWeekWindow } from '@/src/utils/local-calendar';

import { TodayGroupHeader } from './group-header';
import { formatPeriodRange } from './progress-format';
import { TrainingNowMark } from './session-summary-row';
import { useGroupRecentSessions, type GroupStreamPageLoader } from './use-group-recent-sessions';

export type TodayGroupCardProps = {
  selectedGroupId: string;
  /** The shown group's name, heading the board card. */
  groupName: string;
  /** My groups, for the switch beside the name; one group hides it. */
  groups: { groupId: string; name: string }[];
  onSelectGroup: (groupId: string) => void;
  summary: GroupWeekSummaryResult;
  myUserId: string;
  nowMs: number;
  /** The group's home page. */
  onOpenGroup: (groupId: string) => void;
  onOpenSession: (memberUserId: string, sessionId: string, groupId: string) => void;
  /** Reads the group's stream for its recent sessions; online by default. */
  loadStreamPage?: GroupStreamPageLoader;
};

// A board figure: Plex Mono 500, right-aligned in its column.
function BoardFigure({ value, record = false, testID }: { value: number; record?: boolean; testID: string }) {
  const showRecord = record && value > 0;
  return (
    <View style={styles.figureCell}>
      <Text allowFontScaling={false} style={[uiText.figure, styles.boardFigure, showRecord ? uiTextTone.record : null]} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

function BoardRow({ row }: { row: WeekBoardRowViewModel }) {
  const testID = `today-group-board-row-${row.userId}`;
  return (
    <View style={[styles.boardRow, row.isMe ? styles.boardRowMine : null]} testID={testID}>
      <Text allowFontScaling={false} style={[uiText.figure, uiTextTone.muted, styles.rank]} testID={`${testID}-rank`}>
        {row.rank}
      </Text>
      <Text
        allowFontScaling={false}
        ellipsizeMode="tail"
        numberOfLines={1}
        style={[uiText.body, styles.memberName, row.isMe ? uiTextEmphasis.strong : null]}
        testID={`${testID}-name`}>
        {row.name}
      </Text>
      <View style={styles.track}>
        <View
          style={[styles.bar, { width: `${Math.round(row.fraction * 100)}%` }, row.leader ? styles.barLeader : null]}
          testID={`${testID}-fill`}
        />
      </View>
      <BoardFigure testID={`${testID}-working-sets`} value={row.workingSets} />
      <BoardFigure record testID={`${testID}-records`} value={row.groupRecords} />
    </View>
  );
}

const boardAccessibilityLabel = (range: string, board: WeekBoardViewModel): string =>
  [
    `This week, ${range}`,
    ...board.rows.map((row) => `${row.rank}, ${row.name}, ${row.workingSets} sets, ${row.groupRecords} PRs`),
    board.me ? `You, ${board.me.rankLabel}, ${board.me.workingSets} sets, ${board.me.groupRecords} PRs` : null,
  ]
    .filter(Boolean)
    .join('; ');

// The group's name and switch, then this week's leaders by working sets,
// `PRs` being group records: the top five, then the caller's own line when
// they are outside them.
function WeekBoardCard({ board, range, onOpenGroup, header }: {
  board: WeekBoardViewModel;
  range: string;
  onOpenGroup: () => void;
  header: ReactNode;
}) {
  return (
    <Card style={styles.boardCard} testID="today-group-card">
      {header}
      <View style={styles.boardHeading}>
        <Text allowFontScaling={false} numberOfLines={1} style={[uiText.label, uiTextTone.ink]}>
          This week
          <Text allowFontScaling={false} style={uiTextTone.faint} testID="today-group-board-range">{`  ${range}`}</Text>
        </Text>
      </View>
      <Pressable
        accessibilityHint="Opens the group"
        accessibilityLabel={boardAccessibilityLabel(range, board)}
        accessibilityRole="button"
        onPress={onOpenGroup}
        style={({ pressed }) => [styles.board, pressed ? styles.pressed : null]}
        testID="today-group-board">
        <View style={styles.columnLabels}>
          <Text allowFontScaling={false} style={[uiText.label, uiTextTone.faint, styles.columnLabel]}>
            Sets
          </Text>
          <Text allowFontScaling={false} style={[uiText.label, uiTextTone.faint, styles.columnLabel]}>
            PRs
          </Text>
        </View>
        {board.rows.map((row) => (
          <BoardRow key={row.userId} row={row} />
        ))}
        {board.me ? (
          <View style={[styles.boardRow, styles.meLine]} testID="today-group-board-me">
            <Text allowFontScaling={false} style={[uiText.figure, uiTextTone.muted, styles.rank]} testID="today-group-board-me-rank">
              {board.me.rankLabel}
            </Text>
            <Text allowFontScaling={false} style={[uiText.body, uiTextEmphasis.strong, styles.memberName, styles.meName]}>
              You
            </Text>
            <BoardFigure testID="today-group-board-me-working-sets" value={board.me.workingSets} />
            <BoardFigure record testID="today-group-board-me-records" value={board.me.groupRecords} />
          </View>
        ) : null}
      </Pressable>
    </Card>
  );
}

function SessionRow({ row, onPress }: { row: GroupSessionRowViewModel; onPress: () => void }) {
  const testID = `today-group-session-${row.sessionId}`;
  const { record } = row;
  return (
    <Pressable
      accessibilityHint="Opens their session"
      accessibilityLabel={row.accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.sessionRow, pressed ? styles.pressed : null]}
      testID={testID}>
      <View style={styles.sessionTop}>
        <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={[uiText.bodyStrong, styles.who]} testID={`${testID}-member`}>
          {row.name}
        </Text>
        {row.live ? (
          <TrainingNowMark>
            <Text allowFontScaling={false} style={[uiText.meta, uiTextEmphasis.strong, uiTextTone.ink]} testID={`${testID}-when`}>
              <FigureText strong>{row.when}</FigureText>
            </Text>
          </TrainingNowMark>
        ) : (
          <Text allowFontScaling={false} style={uiText.meta} testID={`${testID}-when`}>
            <FigureText>{row.when}</FigureText>
          </Text>
        )}
      </View>
      {row.gym?.trim() ? (
        <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={uiText.meta}>
          {row.gym.trim()}
        </Text>
      ) : null}
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={[uiText.meta, uiTextTone.ink]} testID={`${testID}-figures`}>
        <FigureText>{row.figures}</FigureText>
        {record ? (
          <>
            <Text allowFontScaling={false} style={uiTextTone.faint}> · </Text>
            <Text allowFontScaling={false} style={uiTextTone.record} testID={`${testID}-record`}>
              {record.kind === 'one' ? record.lead : record.count}
            </Text>
          </>
        ) : null}
      </Text>
    </Pressable>
  );
}

function SessionsSection({ title, rows, onOpenSession, testID }: {
  title: string;
  rows: GroupSessionRowViewModel[];
  onOpenSession: (row: GroupSessionRowViewModel) => void;
  testID: string;
}) {
  if (rows.length === 0) return null;
  return (
    <View testID={testID}>
      <Text allowFontScaling={false} style={[uiText.label, uiTextTone.ink, styles.sectionLabel]}>
        {title}
      </Text>
      {rows.map((row, index) => (
        <View key={row.sessionId} style={index > 0 ? styles.sessionDivider : null}>
          <SessionRow onPress={() => onOpenSession(row)} row={row} />
        </View>
      ))}
    </View>
  );
}

// Today's group page: the board card, headed by the group's name (the way to
// the group) and the switch between groups, then up to four sessions, the
// members training now first.
export function TodayGroupCard({
  selectedGroupId,
  groupName,
  groups,
  onSelectGroup,
  summary,
  myUserId,
  nowMs,
  onOpenGroup,
  onOpenSession,
  loadStreamPage,
}: TodayGroupCardProps) {
  const board = buildWeekBoard(summary.members, myUserId);
  const range = formatPeriodRange(localWeekWindow(new Date(nowMs)));
  // The week summary carries one completed session; the stream fills the rest.
  const wanted = GROUP_SESSIONS_SHOWN - summary.training_now.length - (summary.latest_completed ? 1 : 0);
  const recent = useGroupRecentSessions(selectedGroupId, summary.latest_completed?.session_id ?? null, wanted, loadStreamPage, summary);
  const sessions = buildGroupSessions(summary, recent.sessions, myUserId, nowMs);
  const openSession = (row: GroupSessionRowViewModel) => onOpenSession(row.memberUserId, row.sessionId, selectedGroupId);
  const empty = sessions.live.length === 0 && sessions.recent.length === 0;
  // The recent card shows unless the live card has everything to say.
  const showRecent = sessions.recent.length > 0 || recent.failed || sessions.live.length === 0;

  const recentBody = (
    <View style={styles.sessionsBody}>
      <SessionsSection onOpenSession={openSession} rows={sessions.recent} testID="today-group-recent" title="Recent" />
      {empty ? (
        <Text allowFontScaling={false} style={uiText.meta} testID="today-group-latest-empty">
          No sessions shared to this group yet.
        </Text>
      ) : null}
      {recent.failed ? (
        <Text allowFontScaling={false} style={uiText.meta} testID="today-group-recent-failed">
          {"Couldn't load earlier sessions."}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.stack, styles.fill]}>
      <WeekBoardCard
        board={board}
        header={
          <TodayGroupHeader
            groupName={groupName}
            groups={groups}
            onOpenHome={() => onOpenGroup(selectedGroupId)}
            onSelectGroup={onSelectGroup}
            selectedGroupId={selectedGroupId}
          />
        }
        onOpenGroup={() => onOpenGroup(selectedGroupId)}
        range={range}
      />
      <CoWGroupPreview key={`${myUserId}:${selectedGroupId}`} groupId={selectedGroupId} userId={myUserId} today />
      {/* Members training now, then the latest completed sessions: a card each. */}
      {sessions.live.length > 0 ? (
        <SessionsCard fill={!showRecent} testID="today-group-live">
          <View style={styles.sessionsBody}>
            <SessionsSection onOpenSession={openSession} rows={sessions.live} testID="today-group-training-now" title="Training now" />
          </View>
        </SessionsCard>
      ) : null}
      {showRecent ? (
        <SessionsCard fill testID="today-group-sessions">
          {recentBody}
        </SessionsCard>
      ) : null}
    </View>
  );
}

// A sessions card; the last one fills the page, taking the height the board leaves and scrolling its rows.
function SessionsCard({ fill, testID, children }: { fill: boolean; testID: string; children: ReactNode }) {
  return (
    <Card style={[styles.sessionsCard, fill ? styles.fill : null]} testID={testID}>
      {fill ? (
        <ScrollView alwaysBounceVertical={false} nestedScrollEnabled>
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </Card>
  );
}

const BAR_HEIGHT = 12;
const RANK_WIDTH = 22;
const NAME_WIDTH = 104;
// Fits the widest column label, `SETS`.
const FIGURE_WIDTH = 36;

const styles = StyleSheet.create({
  stack: {
    gap: uiSpace.sm,
  },
  fill: {
    flex: 1,
    minHeight: 0,
  },
  boardCard: {
    paddingBottom: uiSpace.sm,
  },
  // `This week` and its range, under the header row.
  boardHeading: {
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.sm,
    paddingBottom: uiSpace.xs,
  },
  board: {
    gap: 0,
  },
  columnLabels: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
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
  meLine: {
    marginTop: uiSpace.xs,
    borderTopWidth: 1,
    borderTopColor: uiRoles.ruleSoft,
  },
  meName: {
    flex: 1,
    width: undefined,
  },
  rank: {
    width: RANK_WIDTH,
  },
  memberName: {
    width: NAME_WIDTH,
  },
  track: {
    flex: 1,
    height: BAR_HEIGHT,
    borderRadius: uiGeometry.radius.control,
    backgroundColor: uiRoles.viz0,
    overflow: 'hidden',
  },
  bar: {
    height: BAR_HEIGHT,
    borderRadius: uiGeometry.radius.control,
    backgroundColor: uiRoles.viz3,
  },
  barLeader: {
    backgroundColor: uiRoles.viz4,
  },
  figureCell: {
    width: FIGURE_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  boardFigure: {
    textAlign: 'right',
  },
  // A pressed row takes the `paper` ground, as `ListRow` does.
  pressed: {
    backgroundColor: uiRoles.paper,
  },
  sessionsCard: {
    paddingHorizontal: uiSpace.md,
  },
  sessionsBody: {
    paddingVertical: uiSpace.md,
    gap: uiSpace.md,
  },
  sectionLabel: {
    paddingBottom: uiSpace.xs,
  },
  sessionDivider: {
    borderTopWidth: 1,
    borderTopColor: uiRoles.ruleSoft,
  },
  sessionRow: {
    paddingVertical: uiSpace.sm,
  },
  sessionTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  who: {
    flexShrink: 1,
  },
});
