import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import {
  GroupBoardRow,
  GroupInlineError,
  GroupLostAccessState,
  GroupMissingDataState,
  GroupOfflineBanner,
  GroupPagesFooter,
  GroupStateView,
  GroupsSignInRequired,
  RecordSetSheet,
  groupScreenStyles,
  pickInlineError,
  usePullToRefresh,
} from '@/components/groups';
import { ActionButton, SegmentedControl, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { useAuth } from '@/src/auth';
import {
  BOARD_METRIC_LABELS,
  BOARD_SCOPE_LABELS,
  NO_SETS_LABEL,
  buildBoardRow,
  getGroup,
  getGroupBoard,
  groupBoardHistoryPath,
  groupCacheKeys,
  parseBoardMetricParam,
  parseBoardScopeParam,
  recordSetFromBoardRow,
  recordSetKey,
  useGroupOnlinePages,
  useGroupResource,
  useRecordSetCertification,
  writtenCertificationSettled,
  type BoardRow,
  type GroupBoardCursor,
  type GroupBoardMetric,
  type GroupBoardResult,
  type GroupBoardScope,
  type GroupExercise,
  type GroupGetResult,
} from '@/src/groups';

const METRIC_OPTIONS = [
  { value: 'weight', label: BOARD_METRIC_LABELS.weight },
  { value: 'e1rm', label: BOARD_METRIC_LABELS.e1rm },
] as const;

const SCOPE_OPTIONS = [
  { value: 'certified', label: BOARD_SCOPE_LABELS.certified },
  { value: 'all', label: BOARD_SCOPE_LABELS.all },
] as const;

const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

type BoardParams = {
  groupId?: string | string[];
  exerciseId?: string | string[];
  metric?: string | string[];
  scope?: string | string[];
};

/**
 * A group exercise's full board (product E1.2, P6, P7; contract §4.5): the
 * Weight / 1RM × Certified / All toggles switch in place; rows are read online
 * and paged, never cached (M25 design §7), and drawn as one card. Opens on
 * `?metric=&scope=`, else 1RM · Certified. The exercise's name is the native
 * header title.
 */
export default function GroupBoardRoute() {
  const { isConfigured, user } = useAuth();
  const params = useLocalSearchParams<BoardParams>();
  const groupId = firstParam(params.groupId);
  const exerciseId = firstParam(params.exerciseId);
  if (!isConfigured || !user) {
    return <GroupsSignInRequired isConfigured={isConfigured} />;
  }
  if (!groupId || !exerciseId) {
    return (
      <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>
        <GroupLostAccessState testID="group-board-lost-access" />
      </View>
    );
  }
  return (
    <GroupBoardContent
      exerciseId={exerciseId}
      groupId={groupId}
      initialMetric={parseBoardMetricParam(params.metric)}
      initialScope={parseBoardScopeParam(params.scope)}
      userId={user.id}
    />
  );
}

type GroupBoardContentProps = {
  userId: string;
  groupId: string;
  exerciseId: string;
  initialMetric: GroupBoardMetric;
  initialScope: GroupBoardScope;
};

const selectRows = (page: GroupBoardResult) => page.rows;
const selectCursor = (page: GroupBoardResult) => page.next_cursor;
const selectHasMore = (page: GroupBoardResult) => page.has_more;
const rowKey = (row: BoardRow) => row.member.user_id;

function GroupBoardContent({ userId, groupId, exerciseId, initialMetric, initialScope }: GroupBoardContentProps) {
  const router = useRouter();
  const [metric, setMetric] = useState<GroupBoardMetric>(initialMetric);
  const [scope, setScope] = useState<GroupBoardScope>(initialScope);
  const [exercise, setExercise] = useState<GroupExercise | null>(null);

  const fetchPage = useCallback(
    (after: GroupBoardCursor | null) =>
      getGroupBoard({ groupId, groupExerciseId: exerciseId, metric, certified: scope === 'certified', after }),
    [groupId, exerciseId, metric, scope],
  );
  const board = useGroupOnlinePages<GroupBoardResult, BoardRow, GroupBoardCursor>({
    userId,
    groupId,
    viewKey: `${exerciseId}|${metric}|${scope}`,
    fetchPage,
    selectItems: selectRows,
    selectCursor,
    selectHasMore,
    itemKey: rowKey,
  });
  const { pulling, onRefresh } = usePullToRefresh(board.refresh);

  // My role, for Cancel certification in the row detail (cache-first, shared with the group screen).
  const groupFetcher = useCallback(() => getGroup(groupId), [groupId]);
  const group = useGroupResource<GroupGetResult>({
    userId,
    cacheKey: groupCacheKeys.group(groupId),
    fetcher: groupFetcher,
    evictGroupIdOnNotFound: groupId,
  });

  // The row detail sheet (E2, M25-T10). It follows its member's live row, so the
  // refresh after a write shows the server's state; the snapshot covers a row
  // that left the loaded pages.
  const refreshBoard = board.refresh;
  const certification = useRecordSetCertification({ myUserId: userId, onChanged: refreshBoard, onLostAccess: refreshBoard });
  const [sheetRow, setSheetRow] = useState<BoardRow | null>(null);
  const liveSheetRow = sheetRow ? (board.items.find((row) => row.member.user_id === sheetRow.member.user_id) ?? sheetRow) : null;
  const sheetDetail = useMemo(
    () => (liveSheetRow && exercise ? recordSetFromBoardRow(groupId, exercise, liveSheetRow) : null),
    [liveSheetRow, exercise, groupId],
  );
  const { reset: resetCertification, written, clearWritten } = certification;
  // Show the write's result until the board agrees with it (a read in flight at write time can land stale).
  useEffect(() => {
    if (!written) return;
    const live = board.items.find(
      (row) => recordSetKey({ groupExerciseId: exerciseId, member: row.member, setId: row.set_id }) === written.setKey,
    );
    if (writtenCertificationSettled(written, live ? (live.certified ? live.certification : null) : undefined)) {
      clearWritten();
    }
  }, [board.items, written, clearWritten, exerciseId]);
  const openRow = useCallback(
    (memberId: string) => {
      const row = board.items.find((item) => item.member.user_id === memberId);
      if (!row) return;
      resetCertification();
      setSheetRow(row);
    },
    [board.items, resetCertification],
  );

  // Keep the exercise's name in the header while a toggle reloads the rows.
  useEffect(() => {
    if (board.firstPage) {
      setExercise(board.firstPage.exercise);
    }
  }, [board.firstPage]);

  const rows = useMemo(
    () => board.items.map((row) => buildBoardRow(row, metric, scope, userId)),
    [board.items, metric, scope, userId],
  );

  if (board.lostAccess || group.lostAccess) {
    return (
      <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>
        <GroupLostAccessState testID="group-board-lost-access" />
      </View>
    );
  }
  if (board.exerciseMissing) {
    return (
      <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>
        <GroupStateView
          body="It may have been removed, or the link is wrong."
          testID="group-board-exercise-missing"
          title="This exercise isn't in this group"
        />
      </View>
    );
  }

  const inlineError = pickInlineError(board.error);
  const header = (
    <View style={groupScreenStyles.header} testID="group-board-header">
      {exercise ? <Stack.Screen options={{ title: exercise.name }} /> : null}
      <View style={styles.titleRow}>
        <View style={styles.titleText}>
          {exercise && exercise.archived_at_ms !== null ? (
            <Text allowFontScaling={false} style={styles.archived} testID="group-board-archived">
              Archived · read-only
            </Text>
          ) : null}
        </View>
        <ActionButton
          label="History"
          onPress={() => router.push(groupBoardHistoryPath(groupId, exerciseId, { metric, scope }))}
          testID="group-board-history-button"
          variant="text"
        />
      </View>
      <View style={styles.toggles}>
        <SegmentedControl
          accessibilityLabel="Metric"
          onChange={setMetric}
          options={METRIC_OPTIONS}
          style={styles.toggle}
          testIDPrefix="group-board-metric"
          value={metric}
        />
        <SegmentedControl
          accessibilityLabel="Sets"
          onChange={setScope}
          options={SCOPE_OPTIONS}
          style={styles.toggle}
          testIDPrefix="group-board-scope"
          value={scope}
        />
      </View>
      {board.offline ? <GroupOfflineBanner lastUpdatedAtMs={board.loadedAtMs} /> : null}
      {inlineError && board.firstPage ? (
        <GroupInlineError error={inlineError} onRetry={onRefresh} testID="group-board-inline-error" />
      ) : null}
    </View>
  );

  let emptyState: ReactElement;
  if (!board.firstPage) {
    emptyState = (
      <GroupMissingDataState error={inlineError} offline={board.offline} onRetry={onRefresh} testIDPrefix="group-board" />
    );
  } else if (scope === 'certified') {
    // `group_board` carries no uncertified count; the podium card does (card deviation 4).
    emptyState = (
      <GroupStateView
        actionLabel="See all sets"
        actionTestID="group-board-see-all-button"
        onAction={() => setScope('all')}
        testID="group-board-empty"
        title="No certified sets yet"
      />
    );
  } else {
    emptyState = <GroupStateView testID="group-board-empty" title={NO_SETS_LABEL} />;
  }

  return (
    <>
      <FlatList
        ListEmptyComponent={emptyState}
        ListFooterComponent={
          <GroupPagesFooter
            loadMoreError={board.loadMoreError}
            loadingMore={board.loadingMore}
            noun="rows"
            onRetry={() => void board.loadMore()}
            testIDPrefix="group-board"
          />
        }
        ListFooterComponentStyle={groupScreenStyles.cardListFooter}
        ListHeaderComponent={header}
        ListHeaderComponentStyle={groupScreenStyles.cardListHeader}
        contentContainerStyle={groupScreenStyles.cardListContent}
        data={rows}
        keyExtractor={(row) => row.key}
        onEndReached={() => void board.loadMore()}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={pulling} />}
        renderItem={({ item, index }) => (
          <GroupBoardRow count={rows.length} index={index} onPress={(row) => openRow(row.key)} row={item} />
        )}
        style={groupScreenStyles.screen}
        testID="group-board-list"
      />
      <RecordSetSheet
        certification={certification}
        detail={sheetDetail}
        myRole={group.data?.group.my_role ?? null}
        onClose={() => setSheetRow(null)}
        userId={userId}
      />
    </>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
  },
  titleText: {
    flex: 1,
    minWidth: 0,
  },
  archived: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  toggles: {
    flexDirection: 'row',
    gap: uiSpace.sm,
  },
  toggle: {
    flex: 1,
  },
});
