import { TodayWeekBoardCard } from './today-week-board';
import { TodayCoWSummaries } from './group-cow-summary';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { FigureText } from '@/components/ui/figure-text';
import { uiTextEmphasis, useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiSpace } from '@/components/ui/tokens';
import {
  GROUP_SESSIONS_SHOWN,
  buildGroupSessions,
  buildWeekBoard,
  type GroupSessionRowViewModel,
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

function SessionRow({ row, onPress }: { row: GroupSessionRowViewModel; onPress: () => void }) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
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
        <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={[text.bodyStrong, styles.who]} testID={`${testID}-member`}>
          {row.name}
        </Text>
        {row.live ? (
          <TrainingNowMark>
            <Text allowFontScaling={false} style={[text.meta, uiTextEmphasis.strong, tone.ink]} testID={`${testID}-when`}>
              <FigureText strong>{row.when}</FigureText>
            </Text>
          </TrainingNowMark>
        ) : (
          <Text allowFontScaling={false} style={text.meta} testID={`${testID}-when`}>
            <FigureText>{row.when}</FigureText>
          </Text>
        )}
      </View>
      {row.gym?.trim() ? (
        <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={text.meta}>
          {row.gym.trim()}
        </Text>
      ) : null}
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={[text.meta, tone.ink]} testID={`${testID}-figures`}>
        <FigureText>{row.figures}</FigureText>
        {record ? (
          <>
            <Text allowFontScaling={false} style={tone.faint}> · </Text>
            <Text allowFontScaling={false} style={tone.record} testID={`${testID}-record`}>
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
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  if (rows.length === 0) return null;
  return (
    <View testID={testID}>
      <Text allowFontScaling={false} style={[text.label, tone.ink, styles.sectionLabel]}>
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
  const styles = useStyles();
  const text = useUiText();
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
        <Text allowFontScaling={false} style={text.meta} testID="today-group-latest-empty">
          No sessions shared to this group yet.
        </Text>
      ) : null}
      {recent.failed ? (
        <Text allowFontScaling={false} style={text.meta} testID="today-group-recent-failed">
          {"Couldn't load earlier sessions."}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.stack, styles.fill]}>
      <TodayWeekBoardCard
        board={board}
        challenges={<TodayCoWSummaries key={`${myUserId}:${selectedGroupId}`} groupId={selectedGroupId} userId={myUserId} />}
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
  const styles = useStyles();
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

const useStyles = makeStyles((roles) => ({
  stack: {
    gap: uiSpace.sm,
  },
  fill: {
    flex: 1,
    minHeight: 0,
  },
  // A pressed row takes the `paper` ground, as `ListRow` does.
  pressed: {
    backgroundColor: roles.paper,
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
    borderTopColor: roles.ruleSoft,
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
}));
