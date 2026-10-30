import { useDateFormat } from '@/src/preferences/hooks';
import { useEffect, useState, type ReactElement } from 'react';
import { ScrollView, StyleSheet, Text, View, type RefreshControlProps, type StyleProp, type ViewStyle } from 'react-native';

import { Card } from '@/components/ui/card';
import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiSpace } from '@/components/ui/tokens';
import type { GroupApiError } from '@/src/groups/api';
import {
  GROUP_RANK_PERIODS,
  groupHomeWindowFor,
  groupRankSeriesEnd,
  type GroupHomeMetric,
  type GroupHomePeriod,
  type GroupHomeWindow,
} from '@/src/groups/home-periods';
import type { GroupGlanceHeld } from '@/src/groups/use-group-glance';
import {
  buildGroupHomeBoard,
  buildGroupRankSeries,
  buildGroupWeekTotals,
  GROUP_HOME_METRIC_LABELS,
} from '@/src/groups/home-view-model';

import { GroupCycleButton } from './group-cycle-button';
import { GroupHomeBoard } from './group-home-board';
import { groupHomeColumnLabel, groupHomePeriodLabel } from './group-home-labels';
import { GroupHomeStepper } from './group-home-stepper';
import { GroupRankChart } from './group-rank-chart';
import { GroupMissingDataState } from './group-state-view';
import { GroupWeekTotalsFigures } from './group-week-totals';

export type GroupGlancePageProps = {
  myUserId: string;
  now: Date;
  metric: GroupHomeMetric;
  onMetricChange: (next: GroupHomeMetric) => void;
  period: GroupHomePeriod;
  /** The selected period: 0 is the one in progress, -1 the one before. Every card reads it. */
  offset: number;
  onOffsetChange: (next: number) => void;
  /**
   * The six periods the chart draws, oldest first, ending at
   * `groupRankSeriesEnd(offset)`; null until read.
   */
  series: GroupHomeWindow[] | null;
  /** Set when `series` is an earlier read, held while the one for `offset` loads: the period and the chart end it is for. */
  held?: GroupGlanceHeld | null;
  /** The page scrolls under the pinned controls, pulled to refresh. */
  refreshControl?: ReactElement<RefreshControlProps>;
  style?: StyleProp<ViewStyle>;
  error: GroupApiError | null;
  offline: boolean;
  onRetry: () => void;
};

const PERIOD_NOUN: Record<GroupHomePeriod, string> = { week: 'weeks' };

const METRIC_OPTIONS = [
  { value: 'sets' as const, label: GROUP_HOME_METRIC_LABELS.sets },
  { value: 'prs' as const, label: GROUP_HOME_METRIC_LABELS.prs },
];

/**
 * A held read fades only once it has been waiting this long, so a step to a
 * cached period swaps the figures in place with no dimming in between.
 */
export const GROUP_GLANCE_HOLD_FADE_DELAY_MS = 200;

function useHoldFade(holding: boolean): boolean {
  const [faded, setFaded] = useState(false);
  useEffect(() => {
    if (!holding) return undefined;
    const handle = setTimeout(() => setFaded(true), GROUP_GLANCE_HOLD_FADE_DELAY_MS);
    return () => {
      clearTimeout(handle);
      setFaded(false);
    };
  }, [holding]);
  return holding && faded;
}

/**
 * At a glance: the period stepper and the metric pinned in one row, since
 * they set everything under them; then three cards, each headed by a
 * micro-label: `Group stats`, the group's own total against the period
 * before; `Top brothers`, the period's top five by the chosen metric; and
 * `Rankings over time`, every member's place over six periods with the
 * selected one fourth where later periods allow. A column tap selects its
 * period, as the stepper does, and every card follows.
 */
export function GroupGlancePage({
  myUserId,
  now,
  metric,
  onMetricChange,
  period,
  offset,
  onOffsetChange,
  series,
  held = null,
  error,
  offline,
  onRetry,
  refreshControl,
  style,
}: GroupGlancePageProps) {
  const dateFormat = useDateFormat();
  const faded = useHoldFade(held !== null);
  const label = groupHomePeriodLabel(period, groupHomeWindowFor(period, now, offset), offset, dateFormat);
  const controls = (
    <View style={styles.controls} testID="group-glance-controls">
      <View style={styles.stepper}>
        <GroupHomeStepper
          canGoLater={offset < 0}
          label={label.title}
          onEarlier={() => onOffsetChange(offset - 1)}
          onLater={() => onOffsetChange(Math.min(0, offset + 1))}
          period={period}
        />
      </View>
      <GroupCycleButton
        accessibilityLabel="Metric"
        onChange={onMetricChange}
        options={METRIC_OPTIONS}
        style={styles.metric}
        testID="groups-filter-metric"
        value={metric}
      />
    </View>
  );

  return (
    <View style={[styles.page, style]} testID="group-glance">
      {controls}
      <ScrollView
        contentContainerStyle={styles.sections}
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={false}
        testID="groups-glance-scroll">
        {series ? (
          <GlanceCards
            dateFormat={dateFormat}
            faded={faded}
            held={held}
            metric={metric}
            myUserId={myUserId}
            offset={offset}
            onOffsetChange={onOffsetChange}
            period={period}
            series={series}
          />
        ) : (
          <GroupMissingDataState error={error} offline={offline} onRetry={onRetry} testIDPrefix="group-glance" />
        )}
      </ScrollView>
    </View>
  );
}

function GlanceCards({
  series,
  held,
  faded,
  offset,
  onOffsetChange,
  period,
  metric,
  myUserId,
  dateFormat,
}: {
  series: GroupHomeWindow[];
  held: GroupGlanceHeld | null;
  faded: boolean;
  offset: number;
  onOffsetChange: (next: number) => void;
  period: GroupHomePeriod;
  metric: GroupHomeMetric;
  myUserId: string;
  dateFormat: ReturnType<typeof useDateFormat>;
}) {
  // A held series is drawn as the periods it was read for, until its successor lands.
  const figures = held ?? { period, offset: groupRankSeriesEnd(offset) };
  const last = series.length - 1;
  // The selection's column; a held read may not reach it, and then shows its nearest.
  const selectedIndex = Math.min(last, Math.max(0, last - (figures.offset - offset)));
  const selected = series[selectedIndex];
  const board = buildGroupHomeBoard({ members: selected?.members ?? [], metric, myUserId });
  const totals = buildGroupWeekTotals(series.slice(0, selectedIndex + 1));
  const rankSeries = buildGroupRankSeries({ period: figures.period, reads: series, metric });

  return (
    <View
      accessibilityState={{ busy: held !== null }}
      style={[styles.sections, faded ? styles.held : null]}
      testID="group-glance-figures">
      <Card testID="group-week-totals-card">
        <View style={styles.card}>
          <CardTitle testID="group-week-totals-title" title="Group stats" />
          <GroupWeekTotalsFigures current={totals.current} offset={offset} previous={totals.previous} />
        </View>
      </Card>

      <Card testID="group-home-board-card">
        <View style={styles.card}>
          <GroupHomeBoard board={board} metric={metric} title="Top brothers" />
        </View>
      </Card>

      <Card testID="group-position-card">
        <View style={styles.card}>
          <CardTitle testID="group-position-title" title="Rankings over time" />
          <GroupRankChart
            accessibilityLabel={`Place over ${GROUP_RANK_PERIODS} ${PERIOD_NOUN[figures.period]} by ${GROUP_HOME_METRIC_LABELS[metric].toLowerCase()}`}
            columnLabels={rankSeries.periods.map((entry) => groupHomeColumnLabel(figures.period, entry.window, dateFormat))}
            onSelect={(index) => onOffsetChange(Math.min(0, figures.offset - (last - index)))}
            selectedIndex={selectedIndex}
            series={rankSeries}
          />
        </View>
      </Card>
    </View>
  );
}

/** A card's heading, inside it: a micro-label, as every card on the other pages. */
function CardTitle({ title, testID }: { title: string; testID: string }) {
  return (
    <Text accessibilityRole="header" allowFontScaling={false} numberOfLines={1} style={[uiText.label, uiTextTone.ink]} testID={testID}>
      {title}
    </Text>
  );
}

const styles = StyleSheet.create({
  page: {
    gap: uiSpace.md,
  },
  sections: {
    gap: uiSpace.md,
    paddingBottom: uiSpace.lg,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  stepper: {
    flex: 1,
    minWidth: 0,
  },
  metric: {
    flex: 0,
    minWidth: 72,
  },
  // A held read under a new period label: faded until the read in view lands.
  held: {
    opacity: 0.5,
  },
  card: {
    padding: uiSpace.md,
    gap: uiSpace.md,
  },
});
