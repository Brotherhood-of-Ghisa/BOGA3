import { formatOneRepMax, formatVolume, formatWeight } from '@/src/exercise-calculations/format';
import { formatVolumeWithCoverage } from '@/src/exercise-calculations/analytics';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Icon } from '@/components/ui/icon';
import { Stat } from '@/components/ui/stat';
import { uiBorder, uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';
import { formatShortDate, type ExerciseDateFormat } from '@/src/exercise-catalog/list-model';
import {
  formatEffort,
} from '@/src/session-recorder/exercise-page-model';
import {
  formatDaysAgo,
  type ExerciseRecords,
  type LastSession,
  type RecordSet,
} from '@/src/session-recorder/exercise-records';
import type { ExerciseRecordsState } from '@/src/session-recorder/use-exercise-records';

import { pageText } from './text-styles';

export type RecordsView = 'records' | 'last';

const VIEW_OPTIONS = [
  { value: 'records', label: 'Records' },
  { value: 'last', label: 'Last' },
] as const;

type RecordsPanelProps = {
  state: ExerciseRecordsState;
  view: RecordsView;
  expanded: boolean;
  dateFormat: ExerciseDateFormat;
  isFilteredByGym?: boolean;
  onToggleExpanded: () => void;
  // Choosing a view leaves the panel expanded or collapsed as it was.
  onSelectView: (view: RecordsView) => void;
  onOpenHistory: () => void;
  now?: Date;
};

const DASH = '—';

// The collapsible records panel: the `Records` | `Last` selector and the
// `History` link are present in both states.
export function RecordsPanel({
  state,
  view,
  expanded,
  dateFormat,
  isFilteredByGym = false,
  onToggleExpanded,
  onSelectView,
  onOpenHistory,
  now,
}: RecordsPanelProps) {
  return (
    <Card testID="exercise-records-panel">
      <View style={[styles.header, expanded ? styles.headerExpanded : null]}>
        <Pressable
          accessibilityLabel={expanded ? 'Collapse records panel' : 'Expand records panel'}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={onToggleExpanded}
          style={styles.toggle}
          testID="exercise-records-toggle">
          <Icon color={uiRoles.ink} name={expanded ? 'chevron-down' : 'chevron-right'} size="sm" />
        </Pressable>
        <SegmentedControl
          hitSlop={uiSpace.sm}
          layout="inline"
          onChange={onSelectView}
          options={VIEW_OPTIONS}
          testIDPrefix="exercise-records-view"
          value={view}
        />
        <View style={styles.spacer} />
        <Pressable
          accessibilityLabel="Open exercise history"
          accessibilityRole="link"
          hitSlop={uiSpace.sm}
          onPress={onOpenHistory}
          style={styles.historyLink}
          testID="exercise-records-history">
          <Text allowFontScaling={false} style={[pageText.microLabel, styles.historyLabel]}>History</Text>
          <Icon color={uiRoles.accent} name="chevron-right" size="xs" />
        </Pressable>
      </View>
      <PanelBody isFilteredByGym={isFilteredByGym} dateFormat={dateFormat} expanded={expanded} now={now} state={state} view={view} />
    </Card>
  );
}

type CollapsedStatValues = { oneRepMax: string; maxWeight: string; volume: string; coverageNote?: string };

const NO_STATS: CollapsedStatValues = { oneRepMax: DASH, maxWeight: DASH, volume: DASH };

const orDash = <T,>(value: T | null | undefined, format: (value: T) => string): string =>
  value === null || value === undefined ? DASH : format(value);

/** "2026-09-12 · Iron Den · 130.0 × 3": the date, the gym when known, then the detail. */
const datedDetail = (completedAt: Date, gymName: string | null | undefined, detail: string, dateFormat: ExerciseDateFormat) =>
  [formatShortDate(completedAt, dateFormat), gymName, detail].filter(Boolean).join(' · ');

const collapsedRecordStats = ({ oneRepMax, maxWeight, volume }: ExerciseRecords): CollapsedStatValues => ({
  oneRepMax: orDash(oneRepMax?.value, formatOneRepMax),
  maxWeight: orDash(maxWeight?.weight, formatWeight),
  volume: orDash(volume?.value, formatVolume),
});

/** The previous session's best 1RM, heaviest set and volume, noting volume it could not total. */
const collapsedLastStats = (last: LastSession | null): CollapsedStatValues => {
  if (!last) return NO_STATS;
  return {
    oneRepMax: orDash(last.oneRepMax, formatOneRepMax),
    maxWeight: orDash(last.maxWeight, formatWeight),
    volume: orDash(last.volume, formatVolume),
    coverageNote: last.volume === null ? formatVolumeWithCoverage(last.volume, last.knownVolume) : undefined,
  };
};

type RecordLineContent = { label: string; value: string; detail: string; divider?: boolean; testID: string };

const recordDetail = <R extends { completedAt: Date; gymName?: string | null }>(
  record: R | null,
  dateFormat: ExerciseDateFormat,
  describe: (record: R) => string,
): string => (record ? datedDetail(record.completedAt, record.gymName, describe(record), dateFormat) : '');

const recordLines = ({ oneRepMax, maxWeight, volume }: ExerciseRecords, dateFormat: ExerciseDateFormat): RecordLineContent[] => [
  {
    label: '1RM',
    testID: 'exercise-record-1rm',
    value: orDash(oneRepMax?.value, formatOneRepMax),
    detail: recordDetail(oneRepMax, dateFormat, record => `${formatWeight(record.weight)} × ${record.reps}`),
  },
  {
    label: 'Max',
    testID: 'exercise-record-max',
    divider: true,
    value: orDash(maxWeight?.weight, formatWeight),
    detail: recordDetail(maxWeight, dateFormat, record => `${record.reps} reps`),
  },
  {
    label: 'Vol',
    testID: 'exercise-record-vol',
    divider: true,
    value: orDash(volume?.value, formatVolume),
    detail: recordDetail(volume, dateFormat, record => `${record.setCount} sets`),
  },
];

// Collapsed, the body sums up the selected view; expanded, it lists the
// all-time records or the previous session's sets.
function PanelBody({
  state,
  view,
  expanded,
  dateFormat,
  isFilteredByGym,
  now,
}: Pick<RecordsPanelProps, 'state' | 'view' | 'expanded' | 'dateFormat' | 'now' | 'isFilteredByGym'>) {
  if (state.status !== 'ready') {
    return <StatusMessage expanded={expanded} status={state.status} />;
  }

  const { records, last } = state.summary;
  if (!expanded) {
    return <CollapsedStats {...(view === 'last' ? collapsedLastStats(last) : collapsedRecordStats(records))} />;
  }
  if (view === 'records') {
    const hasRecords = Boolean(records.oneRepMax || records.maxWeight || records.volume);
    return hasRecords ? <RecordList lines={recordLines(records, dateFormat)} /> : <Empty isFilteredByGym={isFilteredByGym} />;
  }
  return last ? <LastSessionDetail dateFormat={dateFormat} last={last} now={now} /> : <Empty isFilteredByGym={isFilteredByGym} />;
}

function StatusMessage({ status, expanded }: { status: 'loading' | 'error'; expanded: boolean }) {
  if (!expanded && status === 'loading') {
    return <CollapsedStats {...NO_STATS} />;
  }
  return (
    <Text allowFontScaling={false} style={[pageText.body, styles.message]} testID="exercise-records-message">
      {status === 'loading' ? 'Loading records…' : 'Records unavailable.'}
    </Text>
  );
}

function RecordList({ lines }: { lines: RecordLineContent[] }) {
  return (
    <View testID="exercise-records-list">
      {lines.map(line => (
        <RecordLine key={line.testID} {...line} />
      ))}
    </View>
  );
}

function LastSessionDetail({ last, dateFormat, now }: { last: LastSession; dateFormat: ExerciseDateFormat; now?: Date }) {
  return (
    <View style={styles.last} testID="exercise-records-last">
      <View style={styles.lastSummary}>
        <Text allowFontScaling={false} style={pageText.detailFigure}>
          {datedDetail(last.completedAt, last.gymName, formatDaysAgo(last.completedAt, now), dateFormat)}
        </Text>
        <Text allowFontScaling={false} style={pageText.detailFigure}>
          {`1RM ${orDash(last.oneRepMax, formatOneRepMax)} · VOL ${formatVolumeWithCoverage(last.volume, last.knownVolume)}`}
        </Text>
      </View>
      {last.sets.map((set, index) => (
        <LastSetLine index={index} key={index} set={set} />
      ))}
    </View>
  );
}

function CollapsedStats({
  oneRepMax,
  maxWeight,
  volume,
  coverageNote,
}: {
  oneRepMax: string;
  maxWeight: string;
  volume: string;
  coverageNote?: string;
}) {
  return (
    <View>
    <View style={styles.collapsed} testID="exercise-records-collapsed">
      <View style={styles.collapsedCell}>
        <Stat label="1RM" testID="exercise-records-1rm" value={oneRepMax} />
      </View>
      <View style={styles.collapsedCell}>
        <Stat label="Max" testID="exercise-records-max" value={maxWeight} />
      </View>
      <View style={styles.collapsedCell}>
        <Stat label="Vol" testID="exercise-records-vol" value={volume} />
      </View>
    </View>
    {coverageNote ? <Text allowFontScaling={false} style={[pageText.body, styles.message]} testID="exercise-records-volume-coverage">{`Volume: ${coverageNote}`}</Text> : null}
    </View>
  );
}

function RecordLine({
  label,
  value,
  detail,
  divider = false,
  testID,
}: {
  label: string;
  value: string;
  detail: string;
  divider?: boolean;
  testID: string;
}) {
  return (
    <View
      accessibilityLabel={`${label} record ${value}${detail ? `, ${detail}` : ''}`}
      accessible
      style={[styles.recordLine, divider ? styles.recordDivider : null]}
      testID={testID}>
      <Text allowFontScaling={false} style={[pageText.microLabel, styles.recordLabel]}>{label}</Text>
      <Text allowFontScaling={false} numberOfLines={1} style={[pageText.headlineFigure, styles.recordValue]}>
        {value}
      </Text>
      <Text allowFontScaling={false} numberOfLines={1} style={[pageText.detailFigure, styles.recordDetail]}>
        {detail}
      </Text>
    </View>
  );
}

function LastSetLine({ set, index }: { set: RecordSet; index: number }) {
  return (
    <View style={styles.lastSet} testID={`exercise-records-last-set-${index}`}>
      <Text allowFontScaling={false} style={[pageText.microLabel, styles.typeLabel]}>{formatEffort(set.setType)}</Text>
      <Text allowFontScaling={false} numberOfLines={1} style={[pageText.runningFigure, styles.lastSetFigure]}>
        {`${formatWeight(set.weight)} × ${set.reps}`}
      </Text>
      <Stat
        label="1RM"
        layout="inline"
        value={set.oneRepMax !== null ? formatOneRepMax(set.oneRepMax) : DASH}
      />
      <Stat label="Vol" layout="inline" rank="secondary" value={set.volume === null ? DASH : formatVolume(set.volume)} />
    </View>
  );
}

function Empty({ isFilteredByGym }: { isFilteredByGym?: boolean }) {
  return (
    <Text allowFontScaling={false} style={[pageText.body, styles.message]} testID="exercise-records-empty">
      {isFilteredByGym
        ? 'No completed sessions for this gym yet.'
        : 'No completed sessions with this exercise yet.'}
    </Text>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: uiSpace.md,
  },
  headerExpanded: {
    borderBottomWidth: uiBorder.width,
    borderBottomColor: uiRoles.ruleSoft,
  },
  toggle: {
    width: uiGeometry.tapTarget,
    height: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: {
    flex: 1,
  },
  historyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  historyLabel: {
    color: uiRoles.accent,
  },
  collapsed: {
    flexDirection: 'row',
    paddingLeft: uiGeometry.tapTarget,
    paddingRight: uiSpace.md,
    paddingBottom: uiSpace.sm,
  },
  collapsedCell: {
    flex: 1,
  },
  recordLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  recordDivider: {
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  recordLabel: {
    width: uiGeometry.tapTarget,
  },
  recordValue: {
    width: uiGeometry.tapTarget + uiSpace.md,
  },
  recordDetail: {
    flex: 1,
  },
  last: {
    paddingBottom: uiSpace.sm,
  },
  lastSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.sm,
    paddingBottom: uiSpace.xs,
  },
  lastSet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.xs,
  },
  typeLabel: {
    width: uiGeometry.tapTarget,
    color: uiRoles.ink,
  },
  lastSetFigure: {
    flex: 1,
  },
  message: {
    paddingHorizontal: uiSpace.md,
    paddingBottom: uiSpace.md,
    paddingTop: uiSpace.xs,
  },
});
