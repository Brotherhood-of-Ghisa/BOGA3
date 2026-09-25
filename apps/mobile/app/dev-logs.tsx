import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  Card,
  ChipGroup,
  Icon,
  Screen,
  StatePanel,
  uiBorder,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
  type ChipOption,
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

const FILTER_OPTIONS: readonly ChipOption<LevelFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'error', label: 'Error' },
  { value: 'warn', label: 'Warn' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
];

// Only an error takes a hue; a warning is `ink` plus the warning glyph (G3).
const LEVEL_COLOR: Record<LogLevel, string> = {
  error: uiRoles.danger,
  warn: uiRoles.ink,
  info: uiRoles.inkMuted,
  debug: uiRoles.inkFaint,
};

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
};

function LogRow({ record, divider }: { record: LogRecord; divider: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasContext = record.context != null && Object.keys(record.context).length > 0;

  return (
    <Pressable
      disabled={!hasContext}
      onPress={() => setExpanded((value) => !value)}
      style={({ pressed }) => [styles.row, divider ? styles.rowDivider : null, pressed ? styles.rowPressed : null]}
      testID={`dev-logs-row-${record.seq}`}>
      <View style={styles.rowHeader}>
        <View style={styles.levelMark}>
          {record.level === 'warn' ? <Icon name="warning" size="xs" /> : null}
          <Text allowFontScaling={false} style={[styles.level, { color: LEVEL_COLOR[record.level] }]}>{record.level.toUpperCase()}</Text>
        </View>
        <Text allowFontScaling={false} style={styles.time}>{formatTime(record.createdAt)}</Text>
      </View>
      <Text allowFontScaling={false} selectable style={styles.event}>
        {record.source} · {record.event}
      </Text>
      {record.message ? (
        <Text allowFontScaling={false} selectable style={styles.message}>
          {record.message}
        </Text>
      ) : null}
      {hasContext && expanded ? (
        <Text allowFontScaling={false} selectable style={styles.context}>
          {JSON.stringify(record.context, null, 2)}
        </Text>
      ) : null}
      {hasContext && !expanded ? <Text allowFontScaling={false} style={styles.contextHint}>Tap to show context</Text> : null}
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
      <Screen testID="dev-logs-screen">
        <StatePanel body="Log viewer is available in developer builds only." />
      </Screen>
    );
  }

  return (
    <Screen testID="dev-logs-screen">
      <View style={styles.toolbar}>
        <ChipGroup
          accessibilityLabel="Filter logs by level"
          mode="single"
          onChange={setFilter}
          options={FILTER_OPTIONS}
          style={styles.filters}
          testIDPrefix="dev-logs-filter"
          value={filter}
        />
        <ActionButton
          accessibilityLabel="Clear the on-device log view"
          label="Clear"
          onPress={clearRecentLogs}
          testID="dev-logs-clear-button"
          variant="text"
        />
      </View>
      {/* The rows share one card, which scrolls inside the page gutter. */}
      <Card style={styles.listCard}>
        <FlatList
          data={visible}
          keyExtractor={(entry) => String(entry.seq)}
          ListEmptyComponent={<StatePanel body="No log entries captured yet." fill={false} />}
          renderItem={({ item, index }) => <LogRow divider={index > 0} record={item} />}
          testID="dev-logs-list"
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
    padding: uiSpace.lg,
  },
  filters: {
    flex: 1,
  },
  listCard: {
    flexShrink: 1,
    marginHorizontal: uiSpace.lg,
    marginBottom: uiSpace.lg,
  },
  row: {
    gap: uiSpace.xs,
    padding: uiSpace.md,
  },
  rowDivider: {
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  rowPressed: {
    backgroundColor: uiRoles.surfaceSubtle,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  levelMark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  level: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
  },
  time: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  event: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  message: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  context: {
    paddingTop: uiSpace.sm,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleFaint,
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  contextHint: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
});
