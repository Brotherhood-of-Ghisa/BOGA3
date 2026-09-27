import { ActionButton } from '@/components/ui/action-button';
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
  formatOneRepMax,
  formatVolume,
  formatWeight,
} from '@/src/session-recorder/exercise-page-model';
import { formatDaysAgo, type RecordSet } from '@/src/session-recorder/exercise-records';
import type { ExerciseRecordsState } from '@/src/session-recorder/use-exercise-records';

import { pageText } from './text-styles';

export type RecordsView = 'records' | 'last';

const VIEW_OPTIONS = [
  { value: 'records', label: 'Records' },
  { value: 'last', label: 'Last' },
] as const;

type RecordsPanelProps = {
  state: ExerciseRecordsState;
  bodyweight?: boolean;
  onEstimate?: () => void;
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
// `History` link are present in both states (`ux-rules` §14a.4).
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
  bodyweight = false,
  onEstimate,
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
      <PanelBody bodyweight={bodyweight} isFilteredByGym={isFilteredByGym} dateFormat={dateFormat} expanded={expanded} now={now} state={state} view={view} />
      {onEstimate ? <View style={styles.message}><ActionButton label="Loading estimate" variant="outline" onPress={onEstimate} testID="exercise-loading-estimate" /></View> : null}
    </Card>
  );
}

function PanelBody({
  state,
  view,
  expanded,
  dateFormat,
  isFilteredByGym = false,
  now,
  bodyweight = false,
}: Pick<RecordsPanelProps, 'state' | 'view' | 'expanded' | 'dateFormat' | 'now' | 'bodyweight' | 'isFilteredByGym'>) {
  if (state.status !== 'ready') {
    if (!expanded && state.status === 'loading') {
      return <CollapsedStats bodyweight={bodyweight} oneRepMax={DASH} maxWeight={DASH} volume={DASH} />;
    }
    return (
      <Text allowFontScaling={false} style={[pageText.body, styles.message]} testID="exercise-records-message">
        {state.status === 'loading' ? 'Loading records…' : 'Records unavailable.'}
      </Text>
    );
  }

  const { records, last } = state.summary;
  const date = (value: Date) => formatShortDate(value, dateFormat);

  // Collapsed, the row sums up the selected view: the all-time records, or the
  // previous session's best 1RM, heaviest weight and volume.
  if (!expanded) {
    if (view === 'last') {
      const added = last?.sets.map(set => set.addedWeightKg === undefined ? set.weight : set.addedWeightKg).filter((value): value is number => value !== null) ?? [];
      const heaviest = added.length ? Math.max(...added) : null;
      return (
        <CollapsedStats bodyweight={bodyweight}
          oneRepMax={last?.oneRepMax != null ? formatOneRepMax(last.oneRepMax) : DASH}
          maxWeight={heaviest !== null ? formatWeight(heaviest) : DASH}
          volume={last?.volume != null ? formatVolume(last.volume) : DASH}
          coverageNote={last?.volume === null ? formatVolumeWithCoverage(last.volume, last.knownVolume) : undefined}
        />
      );
    }
    return (
      <CollapsedStats bodyweight={bodyweight}
        oneRepMax={records.oneRepMax ? formatOneRepMax(records.oneRepMax.value) : DASH}
        maxWeight={records.maxWeight ? formatWeight(records.maxWeight.weight) : DASH}
        volume={records.volume ? formatVolume(records.volume.value) : DASH}
      />
    );
  }

  if (view === 'records') {
    if (!records.oneRepMax && !records.maxWeight && !records.volume) {
      return <Empty isFilteredByGym={isFilteredByGym} />;
    }
    return (
      <View testID="exercise-records-list">
        <RecordLine
          detail={
            records.oneRepMax
              ? `${date(records.oneRepMax.completedAt)}${records.oneRepMax.gymName ? ` · ${records.oneRepMax.gymName}` : ''} · ${records.oneRepMax.loadLabel ?? formatWeight(records.oneRepMax.weight)} × ${records.oneRepMax.reps}${bodyweight ? `\nSaved body weight ${records.oneRepMax.bodyWeightKg == null ? DASH : formatWeight(records.oneRepMax.bodyWeightKg)} kg · Effective load ${records.oneRepMax.effectiveResistanceKg == null ? DASH : formatWeight(records.oneRepMax.effectiveResistanceKg)} kg` : ''}`
              : ''
          }
          multiline={bodyweight}
          label={bodyweight ? "Added 1RM" : "1RM"}
          testID="exercise-record-1rm"
          value={records.oneRepMax ? formatOneRepMax(records.oneRepMax.value) : DASH}
        />
        <RecordLine
          detail={
            records.maxWeight
              ? `${date(records.maxWeight.completedAt)}${records.maxWeight.gymName ? ` · ${records.maxWeight.gymName}` : ''} · ${records.maxWeight.reps} reps`
              : ''
          }
          divider
          label={bodyweight ? "Added kg" : "Max"}
          testID="exercise-record-max"
          value={records.maxWeight ? formatWeight(records.maxWeight.weight) : DASH}
        />
        <RecordLine
          detail={
            records.volume
              ? `${date(records.volume.completedAt)}${records.volume.gymName ? ` · ${records.volume.gymName}` : ''} · ${records.volume.setCount} sets`
              : ''
          }
          divider
          label="Vol"
          testID="exercise-record-vol"
          value={records.volume ? formatVolume(records.volume.value) : DASH}
        />
      </View>
    );
  }

  if (!last) {
    return <Empty isFilteredByGym={isFilteredByGym} />;
  }

  return (
    <View style={styles.last} testID="exercise-records-last">
      <View style={styles.lastSummary}>
        <Text allowFontScaling={false} style={pageText.detailFigure}>
          {`${date(last.completedAt)}${last.gymName ? ` · ${last.gymName}` : ''} · ${formatDaysAgo(last.completedAt, now)}`}
        </Text>
        <Text allowFontScaling={false} style={pageText.detailFigure}>
          {`${bodyweight ? 'Added 1RM' : '1RM'} ${last.oneRepMax !== null ? formatOneRepMax(last.oneRepMax) : DASH} · VOL ${formatVolumeWithCoverage(last.volume, last.knownVolume)}`}
        </Text>
      </View>
      {last.sets.map((set, index) => (
        <LastSetLine bodyweight={bodyweight} index={index} key={index} set={set} />
      ))}
    </View>
  );
}

function CollapsedStats({
  bodyweight = false,
  oneRepMax,
  maxWeight,
  volume,
  coverageNote,
}: {
  bodyweight?: boolean;
  oneRepMax: string;
  maxWeight: string;
  volume: string;
  coverageNote?: string;
}) {
  return (
    <View>
    <View style={styles.collapsed} testID="exercise-records-collapsed">
      <View style={styles.collapsedCell}>
        <Stat label={bodyweight ? "Added 1RM" : "1RM"} testID="exercise-records-1rm" value={oneRepMax} />
      </View>
      <View style={styles.collapsedCell}>
        <Stat label={bodyweight ? "Added kg" : "Max"} testID="exercise-records-max" value={maxWeight} />
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
  multiline = false,
  label,
  value,
  detail,
  divider = false,
  testID,
}: {
  label: string;
  value: string;
  detail: string;
  multiline?: boolean;
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
      <Text allowFontScaling={false} numberOfLines={multiline ? undefined : 1} style={[pageText.detailFigure, styles.recordDetail]}>
        {detail}
      </Text>
    </View>
  );
}

function LastSetLine({ set, index, bodyweight }: { set: RecordSet; index: number; bodyweight: boolean }) {
  if (bodyweight) return <View style={styles.bodyweightLastSet} testID={`exercise-records-last-set-${index}`}>
    <View style={styles.bodyweightSetHeading}>
      <Text allowFontScaling={false} style={[pageText.microLabel, styles.typeLabel]}>{formatEffort(set.setType)}</Text>
      <Text allowFontScaling={false} style={[pageText.runningFigure, styles.lastSetFigure]}>{`${set.loadLabel ?? formatWeight(set.weight)} × ${set.reps}`}</Text>
    </View>
    <Text allowFontScaling={false} style={pageText.body}>{`Saved body weight ${set.bodyWeightKg == null ? DASH : formatWeight(set.bodyWeightKg)} kg · Effective load ${set.effectiveResistanceKg == null ? DASH : formatWeight(set.effectiveResistanceKg)} kg`}</Text>
    <View style={styles.bodyweightSetHeading}>
      <Stat label="Added 1RM" layout="inline" value={set.oneRepMax !== null ? formatOneRepMax(set.oneRepMax) : DASH} />
      <Stat label="Vol" layout="inline" rank="secondary" value={set.volume === null ? DASH : formatVolume(set.volume)} />
    </View>
  </View>;
  return (
    <View style={styles.lastSet} testID={`exercise-records-last-set-${index}`}>
      <Text allowFontScaling={false} style={[pageText.microLabel, styles.typeLabel]}>{formatEffort(set.setType)}</Text>
      <Text allowFontScaling={false} numberOfLines={1} style={[pageText.runningFigure, styles.lastSetFigure]}>
        {`${set.loadLabel ?? formatWeight(set.weight)} × ${set.reps}`}
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
    borderTopColor: uiRoles.ruleFaint,
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
  bodyweightLastSet: { paddingHorizontal: uiSpace.md, paddingVertical: uiSpace.sm, gap: uiSpace.xs },
  bodyweightSetHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: uiSpace.sm },
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
