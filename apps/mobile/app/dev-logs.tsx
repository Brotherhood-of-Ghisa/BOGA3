import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import {
  SegmentedChips,
  type SegmentedChipOption,
  UiButton,
  UiSurface,
  UiText,
  uiBorder,
  uiColors,
  uiRadius,
  uiSpace,
} from '@/components/ui';
import {
  clearRecentLogs,
  getRecentLogs,
  subscribeToLogs,
  type LogLevel,
  type LogRecord,
} from '@/src/logging';
import { isDevMode } from '@/src/utils/isDevMode';

type LevelFilter = LogLevel | 'all';

const FILTER_OPTIONS: readonly SegmentedChipOption<LevelFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'error', label: 'Error' },
  { value: 'warn', label: 'Warn' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
];

const LEVEL_COLOR: Record<LogLevel, string> = {
  error: uiColors.actionDangerText,
  warn: uiColors.textWarning,
  info: uiColors.textSecondary,
  debug: uiColors.textMuted,
};

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
};

function LogRow({ record }: { record: LogRecord }) {
  const [expanded, setExpanded] = useState(false);
  const hasContext = record.context != null && Object.keys(record.context).length > 0;

  return (
    <Pressable
      disabled={!hasContext}
      onPress={() => setExpanded((value) => !value)}
      style={styles.row}
      testID={`dev-logs-row-${record.seq}`}>
      <View style={styles.rowHeader}>
        <UiText selectable={false} style={[styles.level, { color: LEVEL_COLOR[record.level] }]}>
          {record.level.toUpperCase()}
        </UiText>
        <UiText selectable={false} variant="bodyMuted" style={styles.time}>
          {formatTime(record.createdAt)}
        </UiText>
      </View>
      <UiText selectable variant="labelStrong">
        {record.source} · {record.event}
      </UiText>
      {record.message ? (
        <UiText selectable variant="bodyMuted">
          {record.message}
        </UiText>
      ) : null}
      {hasContext && expanded ? (
        <UiText selectable style={styles.context}>
          {JSON.stringify(record.context, null, 2)}
        </UiText>
      ) : null}
      {hasContext && !expanded ? (
        <UiText selectable={false} variant="bodyMuted" style={styles.contextHint}>
          Tap to show context
        </UiText>
      ) : null}
    </Pressable>
  );
}

export default function DevLogsScreen() {
  const [logs, setLogs] = useState<LogRecord[]>(() => getRecentLogs());
  const [filter, setFilter] = useState<LevelFilter>('all');

  useEffect(() => subscribeToLogs(() => setLogs(getRecentLogs())), []);

  // Newest-first; apply the level filter.
  const visible = useMemo(() => {
    const filtered = filter === 'all' ? logs : logs.filter((entry) => entry.level === filter);
    return filtered.slice().reverse();
  }, [logs, filter]);

  if (!isDevMode()) {
    return (
      <View style={styles.empty} testID="dev-logs-screen">
        <UiText variant="bodyMuted">Log viewer is available in developer builds only.</UiText>
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="dev-logs-screen">
      <View style={styles.toolbar}>
        <SegmentedChips
          accessibilityLabel="Filter logs by level"
          compact
          onChange={setFilter}
          options={FILTER_OPTIONS}
          testIDPrefix="dev-logs-filter"
          value={filter}
        />
        <UiButton
          accessibilityLabel="Clear the on-device log view"
          label="Clear"
          onPress={clearRecentLogs}
          testID="dev-logs-clear-button"
          variant="secondary"
        />
      </View>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={visible}
        keyExtractor={(entry) => String(entry.seq)}
        ListEmptyComponent={
          <UiText style={styles.emptyText} variant="bodyMuted">
            No log entries captured yet.
          </UiText>
        }
        renderItem={({ item }) => (
          <UiSurface style={styles.rowCard}>
            <LogRow record={item} />
          </UiSurface>
        )}
        testID="dev-logs-list"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiColors.surfacePage,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.md,
    padding: uiSpace.screen,
  },
  listContent: {
    paddingHorizontal: uiSpace.screen,
    paddingBottom: uiSpace.xxl,
    gap: uiSpace.md,
  },
  rowCard: {
    padding: uiSpace.lg,
  },
  row: {
    gap: uiSpace.sm,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  level: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  time: {
    fontSize: 12,
  },
  context: {
    fontFamily: 'Courier',
    fontSize: 12,
    color: uiColors.textSecondary,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiColors.borderMuted,
    paddingTop: uiSpace.sm,
    borderRadius: uiRadius.sm,
  },
  contextHint: {
    fontSize: 12,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: uiSpace.screen,
    backgroundColor: uiColors.surfacePage,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: uiSpace.xxl,
  },
});
