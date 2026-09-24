import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
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

type RecordsPanelProps = {
  state: ExerciseRecordsState;
  view: RecordsView;
  expanded: boolean;
  dateFormat: ExerciseDateFormat;
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
        <View accessibilityRole="tablist" style={styles.selector}>
          {(['records', 'last'] as const).map((option, index) => {
            const selected = option === view;
            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                hitSlop={uiSpace.sm}
                key={option}
                onPress={() => onSelectView(option)}
                style={[
                  styles.segment,
                  index > 0 ? styles.segmentDivider : null,
                  selected ? styles.segmentSelected : null,
                ]}
                testID={`exercise-records-view-${option}`}>
                <Text
                  style={[pageText.microLabel, selected ? styles.segmentLabelSelected : styles.segmentLabel]}>
                  {option === 'records' ? 'Records' : 'Last'}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.spacer} />
        <Pressable
          accessibilityLabel="Open exercise history"
          accessibilityRole="link"
          hitSlop={uiSpace.sm}
          onPress={onOpenHistory}
          style={styles.historyLink}
          testID="exercise-records-history">
          <Text style={[pageText.microLabel, styles.historyLabel]}>History</Text>
          <Icon color={uiRoles.accent} name="chevron-right" size="xs" />
        </Pressable>
      </View>
      <PanelBody dateFormat={dateFormat} expanded={expanded} now={now} state={state} view={view} />
    </Card>
  );
}

function PanelBody({
  state,
  view,
  expanded,
  dateFormat,
  now,
}: Pick<RecordsPanelProps, 'state' | 'view' | 'expanded' | 'dateFormat' | 'now'>) {
  if (state.status !== 'ready') {
    if (!expanded && state.status === 'loading') {
      return <CollapsedStats oneRepMax={DASH} maxWeight={DASH} volume={DASH} />;
    }
    return (
      <Text style={[pageText.body, styles.message]} testID="exercise-records-message">
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
      const heaviest = last && last.sets.length > 0 ? Math.max(...last.sets.map((set) => set.weight)) : null;
      return (
        <CollapsedStats
          oneRepMax={last?.oneRepMax != null ? formatOneRepMax(last.oneRepMax) : DASH}
          maxWeight={heaviest !== null ? formatWeight(heaviest) : DASH}
          volume={last ? formatVolume(last.volume) : DASH}
        />
      );
    }
    return (
      <CollapsedStats
        oneRepMax={records.oneRepMax ? formatOneRepMax(records.oneRepMax.value) : DASH}
        maxWeight={records.maxWeight ? formatWeight(records.maxWeight.weight) : DASH}
        volume={records.volume ? formatVolume(records.volume.value) : DASH}
      />
    );
  }

  if (view === 'records') {
    if (!records.oneRepMax && !records.maxWeight && !records.volume) {
      return <Empty />;
    }
    return (
      <View testID="exercise-records-list">
        <RecordLine
          detail={
            records.oneRepMax
              ? `${date(records.oneRepMax.completedAt)} · ${formatWeight(records.oneRepMax.weight)} × ${records.oneRepMax.reps}`
              : ''
          }
          label="1RM"
          testID="exercise-record-1rm"
          value={records.oneRepMax ? formatOneRepMax(records.oneRepMax.value) : DASH}
        />
        <RecordLine
          detail={
            records.maxWeight ? `${date(records.maxWeight.completedAt)} · ${records.maxWeight.reps} reps` : ''
          }
          divider
          label="Max"
          testID="exercise-record-max"
          value={records.maxWeight ? formatWeight(records.maxWeight.weight) : DASH}
        />
        <RecordLine
          detail={
            records.volume ? `${date(records.volume.completedAt)} · ${records.volume.setCount} sets` : ''
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
    return <Empty />;
  }

  return (
    <View style={styles.last} testID="exercise-records-last">
      <View style={styles.lastSummary}>
        <Text style={pageText.detailFigure}>
          {`${date(last.completedAt)} · ${formatDaysAgo(last.completedAt, now)}`}
        </Text>
        <Text style={pageText.detailFigure}>
          {`1RM ${last.oneRepMax !== null ? formatOneRepMax(last.oneRepMax) : DASH} · VOL ${formatVolume(last.volume)}`}
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
}: {
  oneRepMax: string;
  maxWeight: string;
  volume: string;
}) {
  return (
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
      <Text style={[pageText.microLabel, styles.recordLabel]}>{label}</Text>
      <Text numberOfLines={1} style={[pageText.headlineFigure, styles.recordValue]}>
        {value}
      </Text>
      <Text numberOfLines={1} style={[pageText.detailFigure, styles.recordDetail]}>
        {detail}
      </Text>
    </View>
  );
}

function LastSetLine({ set, index }: { set: RecordSet; index: number }) {
  return (
    <View style={styles.lastSet} testID={`exercise-records-last-set-${index}`}>
      <Text style={[pageText.microLabel, styles.typeLabel]}>{formatEffort(set.setType)}</Text>
      <Text numberOfLines={1} style={[pageText.runningFigure, styles.lastSetFigure]}>
        {`${formatWeight(set.weight)} × ${set.reps}`}
      </Text>
      <Stat
        label="1RM"
        layout="inline"
        value={set.oneRepMax !== null ? formatOneRepMax(set.oneRepMax) : DASH}
      />
      <Stat label="Vol" layout="inline" rank="secondary" value={formatVolume(set.volume)} />
    </View>
  );
}

function Empty() {
  return (
    <Text style={[pageText.body, styles.message]} testID="exercise-records-empty">
      No completed sessions with this exercise yet.
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
  selector: {
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: uiBorder.width,
    borderColor: uiRoles.ruleStrong,
    borderRadius: uiGeometry.radius.control,
  },
  segment: {
    justifyContent: 'center',
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.xs,
    backgroundColor: uiRoles.surface,
  },
  segmentDivider: {
    borderLeftWidth: uiBorder.width,
    borderLeftColor: uiRoles.ruleStrong,
  },
  segmentSelected: {
    backgroundColor: uiRoles.ink,
  },
  segmentLabel: {
    color: uiRoles.inkMuted,
  },
  segmentLabelSelected: {
    color: uiRoles.surface,
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
