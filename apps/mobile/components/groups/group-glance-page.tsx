import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { todayText } from '@/components/today/text-styles';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/page-header';
import { uiRoles, uiSpace } from '@/components/ui/tokens';
import type { GroupApiError } from '@/src/groups/api';
import {
  GROUP_RANK_PERIODS,
  groupHomeWindowFor,
  type GroupHomeMetric,
  type GroupHomePeriod,
  type GroupHomeWindow,
} from '@/src/groups/home-periods';
import { buildGroupHomeBoard, buildGroupRankSeries, GROUP_HOME_METRIC_LABELS } from '@/src/groups/home-view-model';

import { GroupHomeBoard } from './group-home-board';
import { groupHomeColumnLabel, groupHomePeriodLabel } from './group-home-labels';
import { GroupHomeStepper } from './group-home-stepper';
import { GroupRankChart } from './group-rank-chart';
import { GroupRankTable } from './group-rank-table';
import { GroupMissingDataState } from './group-state-view';

export type GroupGlancePageProps = {
  myUserId: string;
  now: Date;
  metric: GroupHomeMetric;
  period: GroupHomePeriod;
  /** 0 is the period in progress; the stepper only walks backwards from it. */
  offset: number;
  onOffsetChange: (next: number) => void;
  /** The period at `offset` and the five before it, oldest first; null until read. */
  series: GroupHomeWindow[] | null;
  error: GroupApiError | null;
  offline: boolean;
  onRetry: () => void;
};

const PERIOD_NOUN: Record<GroupHomePeriod, string> = { week: 'weeks', month: 'months' };

/**
 * At a glance: the period's top five by the chosen metric, with a stepper back
 * through earlier periods, then every member's place over the last six
 * periods. Selecting a column in the chart reads that period's full ranking
 * into the table under it. The figures are the screen's period-totals read.
 */
export function GroupGlancePage({ myUserId, now, metric, period, offset, onOffsetChange, series, error, offline, onRetry }: GroupGlancePageProps) {
  // The chart column is held by its period, so it survives a metric change and
  // follows the same calendar period while the stepper keeps it in range.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const label = groupHomePeriodLabel(period, groupHomeWindowFor(period, now, offset), offset);
  const stepper = (
    <GroupHomeStepper
      canGoLater={offset < 0}
      label={label}
      onEarlier={() => onOffsetChange(offset - 1)}
      onLater={() => onOffsetChange(Math.min(0, offset + 1))}
      period={period}
    />
  );

  if (!series) {
    return (
      <View style={styles.sections} testID="group-glance">
        <Card testID="group-home-board-card">
          <View style={styles.card}>{stepper}</View>
        </Card>
        <GroupMissingDataState error={error} offline={offline} onRetry={onRetry} testIDPrefix="group-glance" />
      </View>
    );
  }

  const read = series[series.length - 1];
  const board = buildGroupHomeBoard({ members: read?.members ?? [], metric, myUserId });
  const rankSeries = buildGroupRankSeries({ period, reads: series, metric, includesCurrent: offset === 0 });
  const found = rankSeries.periods.findIndex((entry) => entry.key === selectedKey);
  const selectedIndex = found >= 0 ? found : rankSeries.periods.length - 1;
  const selected = rankSeries.periods[selectedIndex];

  return (
    <View style={styles.sections} testID="group-glance">
      <Card testID="group-home-board-card">
        <View style={styles.card}>
          {stepper}
          <GroupHomeBoard board={board} metric={metric} />
        </View>
      </Card>

      <View style={styles.section}>
        <SectionHeader title="Position" />
        <Card testID="group-position-card">
          <View style={styles.card}>
            <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelStrong]}>
              {`Last ${GROUP_RANK_PERIODS} ${PERIOD_NOUN[period]} · ${GROUP_HOME_METRIC_LABELS[metric].toLowerCase()}`}
            </Text>
            <GroupRankChart
              accessibilityLabel={`Place over the last ${GROUP_RANK_PERIODS} ${PERIOD_NOUN[period]} by ${GROUP_HOME_METRIC_LABELS[metric].toLowerCase()}`}
              columnLabels={rankSeries.periods.map((entry) => groupHomeColumnLabel(period, entry.window))}
              onSelect={(index) => setSelectedKey(rankSeries.periods[index]?.key ?? null)}
              selectedIndex={selectedIndex}
              series={rankSeries}
            />
            {selected ? (
              <>
                <View style={styles.divider} />
                <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelStrong]} testID="group-position-selected">
                  {`${groupHomePeriodLabel(period, selected.window, 0).detail}${selected.current ? ' · so far' : ''}`}
                </Text>
                <GroupRankTable entries={selected.entries} />
              </>
            ) : null}
          </View>
        </Card>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sections: {
    gap: uiSpace.xl,
  },
  section: {
    gap: uiSpace.md,
  },
  card: {
    padding: uiSpace.md,
    gap: uiSpace.lg,
  },
  // A `rule-soft` hairline across the card, edge to edge.
  divider: {
    height: 1,
    marginHorizontal: -uiSpace.md,
    backgroundColor: uiRoles.ruleSoft,
  },
});
