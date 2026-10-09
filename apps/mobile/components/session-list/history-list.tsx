import { useCallback, useEffect, useRef, type ReactElement, type RefObject } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';

import {
  formatSessionSummaryDuration,
  formatSessionSummaryFigures,
  sessionSummaryAccessibilityLabel,
  sessionSummaryRecordLine,
  type SessionSummaryFigures,
} from '@/components/today/progress-format';
import { SessionSummaryRow } from '@/components/today/session-summary-row';
import { todayText } from '@/components/today/text-styles';
import { Card, StatePanel, Tag, uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { logEvent } from '@/src/logging';
import { formatMonthDayTime } from '@/src/utils/local-time';

import { historyJumpListIndex, historyJumpLocation, type HistoryJump, type HistoryJumpLocation } from './history-jump';

import {
  formatEmptyWeeks,
  groupSessionsByWeek,
  historyWeekHeading,
  type HistoryWeekSection,
} from './history-weeks';
import type { SessionListItem } from './types';

export type HistoryListProps = {
  /** Completed sessions to render (already filtered by the deleted toggle), newest completion first. */
  sessions: SessionListItem[];
  isLoading: boolean;
  loadErrorMessage: string | null;
  /** Reloads the list after a load error (the same load as a focus refresh). */
  onRetryLoad: () => void;
  /** Whether the global empty-state panel should render (no active + no completed). */
  showGlobalEmptyState: boolean;
  onOpenCompletedSession: (sessionId: string) => void;
  /** What `This week` is measured from: when the sessions were read. */
  nowMs: number;
  /** The blocks above the history (active session, planning). */
  header: ReactElement;
  /**
   * A week or day to open at, once its rows first load: a history grid's
   * week or day leads here. The list stays whole.
   */
  jumpTo?: HistoryJump | null;
};

const toSummaryFigures = (session: SessionListItem): SessionSummaryFigures => ({
  startedAt: new Date(session.startedAt),
  durationSec: session.durationSec,
  gymName: session.gymName,
  workingSets: session.setCount,
  exerciseCount: session.exerciseCount,
  records: session.records,
});

/**
 * The page's one scroll: the host's `header`, then the completed history
 * ([[session.history-weeks]]) as one virtualized section per week, so a long
 * history renders only what is near the screen.
 */
export function HistoryList({
  sessions,
  isLoading,
  loadErrorMessage,
  onRetryLoad,
  showGlobalEmptyState,
  onOpenCompletedSession,
  nowMs,
  header,
  jumpTo = null,
}: HistoryListProps) {
  const now = new Date(nowMs);
  // A reload (focus, the deleted toggle) keeps the rows on screen, and with
  // them the scroll position, until the new read lands; loading shows only
  // before the first rows.
  const showRows = !loadErrorMessage && (!isLoading || sessions.length > 0);
  const sections = showRows ? groupSessionsByWeek(sessions, now) : [];
  const listRef = useRef<SectionList<SessionListItem, HistoryWeekSection>>(null);
  const jumpLocation = jumpTo ? historyJumpLocation(sections, jumpTo) : null;
  const onScrollToIndexFailed = useJumpOnce(listRef, jumpLocation);

  return (
    <SectionList
      onScrollToIndexFailed={onScrollToIndexFailed}
      ref={listRef}
      contentContainerStyle={styles.content}
      // A screenful of rows and week headings and more; the rest render as they
      // near the screen. A jump renders every row down to its target, so the
      // target's offset is measured rather than estimated (rows differ in height).
      initialNumToRender={24 + (jumpLocation ? historyJumpListIndex(sections, jumpLocation) : 0)}
      keyboardShouldPersistTaps="handled"
      keyExtractor={(session) => session.id}
      ListEmptyComponent={
        <HistoryState isLoading={isLoading} loadErrorMessage={loadErrorMessage} onRetryLoad={onRetryLoad} />
      }
      ListFooterComponent={showGlobalEmptyState ? <GlobalEmptyState /> : undefined}
      ListHeaderComponent={<View style={styles.header}>{header}</View>}
      renderItem={({ item, index, section }) => (
        <HistoryRow
          first={index === 0}
          last={index === section.data.length - 1}
          onOpen={onOpenCompletedSession}
          session={item}
        />
      )}
      renderSectionHeader={({ section }) => <WeekHeading now={now} section={section} />}
      sections={sections}
      stickySectionHeadersEnabled={false}
      style={styles.list}
      testID="completed-history-scroll"
    />
  );
}

// The jump's rows are rendered but may not be measured yet: aim again shortly,
// for up to two seconds.
const JUMP_RETRY_MS = 50;
const JUMP_ATTEMPTS = 40;

type ScrollToIndexFailure = { index: number };

/**
 * Scrolls once to `location` the first time it exists (the first load holding
 * the target), never again on a reload. Returns the list's
 * `onScrollToIndexFailed`.
 */
function useJumpOnce(
  listRef: RefObject<SectionList<SessionListItem, HistoryWeekSection> | null>,
  location: HistoryJumpLocation | null,
) {
  const jumpedRef = useRef(false);
  const attemptsRef = useRef(0);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionIndex = location?.sectionIndex;
  const itemIndex = location?.itemIndex;

  const scrollToTarget = useCallback(() => {
    if (sectionIndex === undefined || itemIndex === undefined) return;
    listRef.current?.scrollToLocation({ sectionIndex, itemIndex, viewPosition: 0, animated: false });
  }, [listRef, sectionIndex, itemIndex]);

  useEffect(() => {
    if (jumpedRef.current || sectionIndex === undefined) return;
    jumpedRef.current = true;
    scrollToTarget();
  }, [scrollToTarget, sectionIndex]);

  useEffect(() => () => {
    if (retryRef.current) clearTimeout(retryRef.current);
  }, []);

  return useCallback((failure: ScrollToIndexFailure) => {
    attemptsRef.current += 1;
    if (attemptsRef.current > JUMP_ATTEMPTS) {
      void logEvent({
        level: 'warn',
        source: 'app',
        event: 'sessions.history_jump_failed',
        message: `Could not reach list index ${failure.index} after ${JUMP_ATTEMPTS} attempts`,
      });
      return;
    }
    retryRef.current = setTimeout(scrollToTarget, JUMP_RETRY_MS);
  }, [scrollToTarget]);
}

function WeekHeading({ section, now }: { section: HistoryWeekSection; now: Date }) {
  const heading = historyWeekHeading(section, now);
  return (
    <View style={styles.weekHeading} testID={`completed-history-week-${section.key}`}>
      {section.emptyWeeksBefore > 0 ? (
        <View style={styles.gap} testID={`completed-history-gap-${section.key}`}>
          <View style={styles.gapRule} />
          <Text allowFontScaling={false} style={styles.gapLabel}>
            {formatEmptyWeeks(section.emptyWeeksBefore)}
          </Text>
          <View style={styles.gapRule} />
        </View>
      ) : null}
      <View accessibilityRole="header" accessible style={styles.weekTitleRow}>
        <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelStrong]}>
          {heading.title}
        </Text>
        <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelFaint]}>
          {heading.detail}
        </Text>
      </View>
    </View>
  );
}

function HistoryRow({
  session,
  first,
  last,
  onOpen,
}: {
  session: SessionListItem;
  first: boolean;
  last: boolean;
  onOpen: (sessionId: string) => void;
}) {
  const deleted = session.deletedAt !== null;
  const figures = toSummaryFigures(session);
  const label = sessionSummaryAccessibilityLabel(figures);
  return (
    <View
      style={[styles.cell, first ? styles.cellFirst : styles.cellDivider, last ? styles.cellLast : null]}
      testID={`completed-session-row-${session.id}`}>
      <SessionSummaryRow
        accessibilityHint="Opens the completed session"
        accessibilityLabel={deleted ? `Deleted. ${label}` : label}
        chevron={false}
        duration={formatSessionSummaryDuration(figures)}
        figures={formatSessionSummaryFigures(figures)}
        gym={session.gymName}
        onPress={() => onOpen(session.id)}
        record={sessionSummaryRecordLine(figures)}
        stamp={formatMonthDayTime(figures.startedAt.getTime())}
        style={[styles.row, deleted ? styles.deletedRow : null]}
        testID={`completed-session-open-button-${session.id}`}>
        {/* Deleted is said in words, not only by the fade (`08` baseline 5). */}
        {deleted ? <Tag label="Deleted" testID={`completed-session-deleted-tag-${session.id}`} tone="faint" /> : null}
      </SessionSummaryRow>
    </View>
  );
}

function HistoryState({
  isLoading,
  loadErrorMessage,
  onRetryLoad,
}: Pick<HistoryListProps, 'isLoading' | 'loadErrorMessage' | 'onRetryLoad'>) {
  if (isLoading) {
    return (
      <Card style={styles.state}>
        <StatePanel body="Loading sessions…" fill={false} kind="loading" testID="session-list-loading-state" />
      </Card>
    );
  }
  if (loadErrorMessage) {
    return (
      <Card style={styles.state}>
        <StatePanel
          action={{ label: 'Retry', onPress: onRetryLoad, testID: 'session-list-load-error-retry' }}
          body={loadErrorMessage}
          fill={false}
          kind="error"
          testID="session-list-load-error"
          title="Could not load sessions"
        />
      </Card>
    );
  }
  return (
    <Card style={styles.state}>
      <StatePanel body="No completed sessions" fill={false} />
    </Card>
  );
}

function GlobalEmptyState() {
  return (
    <Card style={styles.footer}>
      <StatePanel
        body="Start your first workout session to see it here."
        fill={false}
        testID="session-list-empty-state"
        title="No sessions yet"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: uiRoles.paper,
  },
  content: {
    padding: uiSpace.lg,
  },
  header: {
    gap: uiSpace.md,
  },
  // The states and the empty panel keep the header's rhythm.
  state: {
    marginTop: uiSpace.md,
  },
  footer: {
    marginTop: uiSpace.md,
  },
  weekHeading: {
    gap: uiSpace.md,
    paddingTop: uiSpace.lg,
    paddingBottom: uiSpace.sm,
  },
  weekTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: uiSpace.sm,
  },
  // Empty weeks between two listed ones: one quiet line, never a row.
  gap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  gapRule: {
    flex: 1,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.rule,
  },
  gapLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkFaint,
  },
  // A week's rows read as one `Card`: each cell draws its share of the
  // border, so the list can recycle rows one by one.
  cell: {
    overflow: 'hidden',
    backgroundColor: uiRoles.surface,
    borderColor: uiRoles.rule,
    borderLeftWidth: uiBorder.width,
    borderRightWidth: uiBorder.width,
  },
  cellFirst: {
    borderTopWidth: uiBorder.width,
    borderTopLeftRadius: uiGeometry.radius.card,
    borderTopRightRadius: uiGeometry.radius.card,
  },
  cellLast: {
    borderBottomWidth: uiBorder.width,
    borderBottomLeftRadius: uiGeometry.radius.card,
    borderBottomRightRadius: uiGeometry.radius.card,
  },
  cellDivider: {
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  row: {
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  // A deleted row has stepped back; the `Deleted` tag names it.
  deletedRow: {
    opacity: 0.6,
  },
});
