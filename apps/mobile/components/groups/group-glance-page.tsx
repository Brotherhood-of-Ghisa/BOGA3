import { useDateFormat } from '@/src/preferences/hooks';
import { useEffect, useState } from 'react';
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
import type { GroupGlanceHeld } from '@/src/groups/use-group-glance';
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
  /** Set when `series` is an earlier read, held while the one for `offset` loads: the period and offset it is for. */
  held?: GroupGlanceHeld | null;
  error: GroupApiError | null;
  offline: boolean;
  onRetry: () => void;
};

const PERIOD_NOUN: Record<GroupHomePeriod, string> = { week: 'weeks', month: 'months' };

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
 * At a glance: the period stepper on its own card, since it sets the period
 * for everything under it; then the period's top five by the chosen metric;
 * then every member's place over the six periods ending at it. Selecting a
 * column in the chart reads that period's full ranking into the table under
 * it. The figures are the screen's period-totals read.
 */
export function GroupGlancePage({
  myUserId,
  now,
  metric,
  period,
  offset,
  onOffsetChange,
  series,
  held = null,
  error,
  offline,
  onRetry,
}: GroupGlancePageProps) {
  const dateFormat = useDateFormat();
  // The chart column is held by its period, so it survives a metric change and
  // follows the same calendar period while the stepper keeps it in range.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const faded = useHoldFade(held !== null);
  const label = groupHomePeriodLabel(period, groupHomeWindowFor(period, now, offset), offset, dateFormat);
  const stepper = (
    <Card testID="group-glance-period-card">
      <View style={styles.card}>
        <GroupHomeStepper
          canGoLater={offset < 0}
          label={label}
          onEarlier={() => onOffsetChange(offset - 1)}
          onLater={() => onOffsetChange(Math.min(0, offset + 1))}
          period={period}
        />
      </View>
    </Card>
  );

  if (!series) {
    return (
      <View style={styles.sections} testID="group-glance">
        {stepper}
        <GroupMissingDataState error={error} offline={offline} onRetry={onRetry} testIDPrefix="group-glance" />
      </View>
    );
  }

  // A held series is drawn as the period it was read for, until its successor lands.
  const figures = held ?? { period, offset };
  const read = series[series.length - 1];
  const board = buildGroupHomeBoard({ members: read?.members ?? [], metric, myUserId });
  const rankSeries = buildGroupRankSeries({ period: figures.period, reads: series, metric, includesCurrent: figures.offset === 0 });
  const found = rankSeries.periods.findIndex((entry) => entry.key === selectedKey);
  const selectedIndex = found >= 0 ? found : rankSeries.periods.length - 1;
  const selected = rankSeries.periods[selectedIndex];

  return (
    <View style={styles.sections} testID="group-glance">
      {stepper}

      <View
        accessibilityState={{ busy: held !== null }}
        style={[styles.sections, faded ? styles.held : null]}
        testID="group-glance-figures">
        <Card testID="group-home-board-card">
          <View style={styles.card}>
            <GroupHomeBoard board={board} metric={metric} />
          </View>
        </Card>

        <View style={styles.section}>
          <SectionHeader title="Rankings" />
          <Card testID="group-position-card">
            <View style={styles.card}>
              <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelStrong]}>
                {`Last ${GROUP_RANK_PERIODS} ${PERIOD_NOUN[figures.period]} · ${GROUP_HOME_METRIC_LABELS[metric].toLowerCase()}`}
              </Text>
              <GroupRankChart
                accessibilityLabel={`Place over the last ${GROUP_RANK_PERIODS} ${PERIOD_NOUN[figures.period]} by ${GROUP_HOME_METRIC_LABELS[metric].toLowerCase()}`}
                columnLabels={rankSeries.periods.map((entry) => groupHomeColumnLabel(figures.period, entry.window, dateFormat))}
                onSelect={(index) => setSelectedKey(rankSeries.periods[index]?.key ?? null)}
                selectedIndex={selectedIndex}
                series={rankSeries}
              />
              {selected ? (
                <>
                  <View style={styles.divider} />
                  <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelStrong]} testID="group-position-selected">
                    {`${groupHomePeriodLabel(figures.period, selected.window, 0, dateFormat).detail}${selected.current ? ' · so far' : ''}`}
                  </Text>
                  <GroupRankTable entries={selected.entries} />
                </>
              ) : null}
            </View>
          </Card>
        </View>
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
  // A held read under a new period label: faded until the read in view lands.
  held: {
    opacity: 0.5,
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
