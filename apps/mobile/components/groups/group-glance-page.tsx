import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { todayText } from '@/components/today/text-styles';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/page-header';
import { uiRoles, uiSpace } from '@/components/ui/tokens';
import {
  readGroupHomeWindow,
  type GroupHomeMetric,
  type GroupHomePeriod,
} from '@/src/groups/home-mock';
import {
  buildGroupHomeBoard,
  buildGroupRankSeries,
  GROUP_HOME_METRIC_LABELS,
  GROUP_RANK_PERIODS,
} from '@/src/groups/home-view-model';

import { GroupHomeBoard } from './group-home-board';
import { groupHomeColumnLabel, groupHomePeriodLabel } from './group-home-labels';
import { GroupHomeStepper } from './group-home-stepper';
import { GroupRankChart } from './group-rank-chart';
import { GroupRankTable } from './group-rank-table';

export type GroupGlancePageProps = {
  myUserId: string;
  now: Date;
  metric: GroupHomeMetric;
  period: GroupHomePeriod;
};

const PERIOD_NOUN: Record<GroupHomePeriod, string> = { week: 'weeks', month: 'months' };

/**
 * At a glance: the period's top five by the chosen metric, with a stepper back
 * through earlier periods, then every member's place over the last six
 * periods. Selecting a column in the chart reads that period's full ranking
 * into the table under it.
 *
 * MOCK: every figure comes from `src/groups/home-mock`, so the section can be
 * reviewed before the server read exists. Nothing is written or cached.
 */
export function GroupGlancePage({ myUserId, now, metric, period }: GroupGlancePageProps) {
  // 0 is the period in progress; the stepper only walks backwards from it.
  const [offset, setOffset] = useState(0);
  // The chart column is held by its period, so it survives a metric change and
  // follows the same calendar period while the stepper keeps it in range.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const nowMs = now.getTime();

  const read = useMemo(() => readGroupHomeWindow({ period, offset, now: new Date(nowMs) }), [period, offset, nowMs]);
  const series = useMemo(
    () => buildGroupRankSeries({ period, offset, now: new Date(nowMs), metric }),
    [period, offset, nowMs, metric],
  );
  const board = buildGroupHomeBoard({ members: read.members, metric, myUserId });
  const label = groupHomePeriodLabel(period, read.window, offset);
  const found = series.periods.findIndex((entry) => entry.key === selectedKey);
  const selectedIndex = found >= 0 ? found : series.periods.length - 1;
  const selected = series.periods[selectedIndex];

  return (
    <View style={styles.sections} testID="group-glance">
      <Card testID="group-home-board-card">
        <View style={styles.card}>
          <GroupHomeStepper
            canGoLater={offset < 0}
            label={label}
            onEarlier={() => setOffset((current) => current - 1)}
            onLater={() => setOffset((current) => Math.min(0, current + 1))}
            period={period}
          />
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
              columnLabels={series.periods.map((entry) => groupHomeColumnLabel(period, entry.window))}
              onSelect={(index) => setSelectedKey(series.periods[index]?.key ?? null)}
              selectedIndex={selectedIndex}
              series={series}
            />
            {selected ? (
              <>
                <View style={styles.divider} />
                <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelStrong]} testID="group-position-selected">
                  {`${groupHomePeriodLabel(period, selected.window, 0).detail}${selected.current ? ' · so far' : ''}`}
                </Text>
                <GroupRankTable entries={selected.entries} metric={metric} />
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
