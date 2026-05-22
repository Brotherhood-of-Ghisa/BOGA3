import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  computeStatsSummary,
  type StatsMuscleFamilyPerformance,
  type StatsMusclePerformance,
  type StatsPeriodDays,
  type StatsSummary,
} from '@/src/data';
import { SegmentedChips, uiColors } from '@/components/ui';

const PERIOD_OPTIONS = [
  { value: 7 as StatsPeriodDays, label: 'Last 7 days' },
  { value: 30 as StatsPeriodDays, label: 'Last 30 days' },
] as const;

type DeltaDisplay = {
  text: string;
  tone: 'positive' | 'negative' | 'neutral' | 'new';
};

export const formatDelta = (current: number, previous: number): DeltaDisplay => {
  if (current === 0 && previous === 0) {
    return { text: '—', tone: 'neutral' };
  }

  if (previous === 0) {
    return { text: `+${formatNumber(current)} (new)`, tone: 'new' };
  }

  const diff = current - previous;
  if (diff === 0) {
    return { text: '±0', tone: 'neutral' };
  }

  const pct = Math.round((diff / previous) * 100);
  const sign = diff > 0 ? '+' : '−';
  const magnitude = formatNumber(Math.abs(diff));
  return {
    text: `${sign}${magnitude} (${diff > 0 ? '+' : '−'}${Math.abs(pct)}%)`,
    tone: diff > 0 ? 'positive' : 'negative',
  };
};

const formatNumber = (value: number): string => {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(1).replace(/\.0$/, '');
};

const formatTotalWeight = (value: number): string => {
  if (value === 0) return '0';
  if (value >= 1000) {
    const inK = value / 1000;
    return `${inK.toFixed(inK >= 100 ? 0 : 1).replace(/\.0$/, '')}k`;
  }
  return formatNumber(Math.round(value));
};

const deltaToneStyle = (tone: DeltaDisplay['tone']) => {
  switch (tone) {
    case 'positive':
      return styles.deltaPositive;
    case 'negative':
      return styles.deltaNegative;
    case 'new':
      return styles.deltaNew;
    case 'neutral':
    default:
      return styles.deltaNeutral;
  }
};

export type StatsScreenShellProps = {
  summary: StatsSummary | null;
  periodDays: StatsPeriodDays;
  onSelectPeriod: (period: StatsPeriodDays) => void;
  onPressSessionsCard: () => void;
  isLoading: boolean;
  errorMessage: string | null;
};

export function StatsScreenShell({
  summary,
  periodDays,
  onSelectPeriod,
  onPressSessionsCard,
  isLoading,
  errorMessage,
}: StatsScreenShellProps) {
  const sessionDelta = summary
    ? formatDelta(summary.current.totals.sessionCount, summary.previous.totals.sessionCount)
    : null;
  const setsDelta = summary
    ? formatDelta(summary.current.totals.totalSets, summary.previous.totals.totalSets)
    : null;

  return (
    <View style={styles.screen} testID="stats-history-screen">
      <SegmentedChips
        accessibilityLabel="Select stats period"
        options={PERIOD_OPTIONS}
        value={periodDays}
        onChange={onSelectPeriod}
        testIDPrefix="stats-period-chip"
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        testID="stats-scroll">
        {errorMessage ? (
          <View style={styles.statePanel} testID="stats-error-state">
            <Text style={styles.stateTitle}>Could not load stats</Text>
            <Text style={styles.stateBody}>{errorMessage}</Text>
          </View>
        ) : null}

        {!errorMessage && isLoading && !summary ? (
          <View style={styles.statePanel} testID="stats-loading-state">
            <Text style={styles.stateBody}>Loading stats…</Text>
          </View>
        ) : null}

        {summary ? (
          <>
            <View style={styles.summaryGrid}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open sessions list"
                onPress={onPressSessionsCard}
                style={({ pressed }) => [styles.summaryCard, pressed && styles.summaryCardPressed]}
                testID="stats-card-sessions">
                <Text style={styles.summaryLabel}>Sessions</Text>
                <Text style={styles.summaryValue}>
                  {formatNumber(summary.current.totals.sessionCount)}
                </Text>
                {sessionDelta ? (
                  <Text style={[styles.summaryDelta, deltaToneStyle(sessionDelta.tone)]}>
                    {sessionDelta.text}
                  </Text>
                ) : null}
              </Pressable>

              <View style={styles.summaryCard} testID="stats-card-sets">
                <Text style={styles.summaryLabel}>Working sets</Text>
                <Text style={styles.summaryValue}>
                  {formatNumber(summary.current.totals.totalSets)}
                </Text>
                {setsDelta ? (
                  <Text style={[styles.summaryDelta, deltaToneStyle(setsDelta.tone)]}>
                    {setsDelta.text}
                  </Text>
                ) : null}
              </View>
            </View>

            <MuscleFamilyList
              families={summary.current.totals.muscleFamilies}
              previousFamilies={summary.previous.totals.muscleFamilies}
            />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function MuscleFamilyList({
  families,
  previousFamilies,
}: {
  families: StatsMuscleFamilyPerformance[];
  previousFamilies: StatsMuscleFamilyPerformance[];
}) {
  if (families.length === 0) {
    return (
      <View style={styles.statePanel} testID="stats-muscle-empty">
        <Text style={styles.stateBody}>
          No muscle taxonomy loaded yet. Add some exercises to see this section.
        </Text>
      </View>
    );
  }

  const previousByFamilyName = new Map(previousFamilies.map((family) => [family.familyName, family]));
  const previousMusclesById = new Map<string, StatsMusclePerformance>();
  for (const family of previousFamilies) {
    for (const muscle of family.muscles) {
      previousMusclesById.set(muscle.muscleGroupId, muscle);
    }
  }

  return (
    <View style={styles.familyList}>
      {families.map((family) => (
        <MuscleFamilyCard
          key={family.familyName}
          family={family}
          previousFamily={previousByFamilyName.get(family.familyName) ?? null}
          previousMusclesById={previousMusclesById}
        />
      ))}
    </View>
  );
}

function isFamilyCollapsible(family: StatsMuscleFamilyPerformance): boolean {
  if (family.muscles.length !== 1) return false;
  return family.muscles[0].displayName.trim().toLowerCase() === family.familyName.trim().toLowerCase();
}

function MuscleFamilyCard({
  family,
  previousFamily,
  previousMusclesById,
}: {
  family: StatsMuscleFamilyPerformance;
  previousFamily: StatsMuscleFamilyPerformance | null;
  previousMusclesById: Map<string, StatsMusclePerformance>;
}) {
  const familyUntrained = family.sessionCount === 0 && family.totalWeight === 0;
  const testIdSlug = family.familyName.toLowerCase().replace(/\s+/g, '-');
  const sessionsDelta = formatDelta(family.sessionCount, previousFamily?.sessionCount ?? 0);
  const weightDelta = formatDelta(family.totalWeight, previousFamily?.totalWeight ?? 0);
  const collapsed = isFamilyCollapsible(family);

  return (
    <View style={styles.familyCard} testID={`stats-family-card-${testIdSlug}`}>
      <View style={styles.familyHeader}>
        <Text
          style={[styles.familyName, familyUntrained && styles.muscleTextUntrained]}
          testID={`stats-family-name-${testIdSlug}`}>
          {family.familyName}
        </Text>
        <View style={styles.familyMetrics}>
          <Metric
            label="Sessions"
            value={formatNumber(family.sessionCount)}
            delta={sessionsDelta}
            testID={`stats-family-sessions-${testIdSlug}`}
            muted={familyUntrained}
          />
          <Metric
            label="Total weight"
            value={formatTotalWeight(family.totalWeight)}
            delta={weightDelta}
            testID={`stats-family-weight-${testIdSlug}`}
            muted={familyUntrained}
          />
        </View>
      </View>
      {collapsed ? null : (
        <View style={styles.muscleList}>
          {family.muscles.map((muscle) => {
            const muscleUntrained = muscle.sessionCount === 0 && muscle.totalWeight === 0;
            const previousMuscle = previousMusclesById.get(muscle.muscleGroupId) ?? null;
            const muscleSessionsDelta = formatDelta(
              muscle.sessionCount,
              previousMuscle?.sessionCount ?? 0
            );
            const muscleWeightDelta = formatDelta(
              muscle.totalWeight,
              previousMuscle?.totalWeight ?? 0
            );
            return (
              <View
                key={muscle.muscleGroupId}
                style={styles.muscleRow}
                testID={`stats-muscle-row-${muscle.muscleGroupId}`}>
                <Text
                  style={[styles.muscleName, muscleUntrained && styles.muscleTextUntrained]}
                  numberOfLines={1}>
                  {muscle.displayName}
                </Text>
                <View style={styles.muscleMetrics}>
                  <Metric
                    label="Sessions"
                    value={formatNumber(muscle.sessionCount)}
                    delta={muscleSessionsDelta}
                    testID={`stats-muscle-sessions-${muscle.muscleGroupId}`}
                    muted={muscleUntrained}
                    small
                  />
                  <Metric
                    label="Total weight"
                    value={formatTotalWeight(muscle.totalWeight)}
                    delta={muscleWeightDelta}
                    testID={`stats-muscle-weight-${muscle.muscleGroupId}`}
                    muted={muscleUntrained}
                    small
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function Metric({
  label,
  value,
  delta,
  testID,
  muted,
  small,
}: {
  label: string;
  value: string;
  delta?: DeltaDisplay;
  testID: string;
  muted: boolean;
  small?: boolean;
}) {
  return (
    <View style={styles.metric} testID={testID}>
      <Text style={[small ? styles.metricLabelSmall : styles.metricLabel, muted && styles.metricLabelMuted]}>
        {label}
      </Text>
      <Text style={[small ? styles.metricValueSmall : styles.metricValue, muted && styles.metricValueMuted]}>
        {value}
      </Text>
      {delta ? (
        <Text style={[small ? styles.metricDeltaSmall : styles.metricDelta, deltaToneStyle(delta.tone)]}>
          {delta.text}
        </Text>
      ) : null}
    </View>
  );
}

export default function StatsRoute() {
  const router = useRouter();
  const [periodDays, setPeriodDays] = useState<StatsPeriodDays>(7);
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadSummary = useCallback(async (period: StatsPeriodDays) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const next = await computeStatsSummary({ periodDays: period });
      setSummary(next);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadSummary(periodDays);
    }, [loadSummary, periodDays])
  );

  const handleSelectPeriod = useCallback(
    (next: StatsPeriodDays) => {
      setPeriodDays(next);
      void loadSummary(next);
    },
    [loadSummary]
  );

  const handlePressSessionsCard = useCallback(() => {
    router.push('/sessions');
  }, [router]);

  // useMemo prevents unnecessary re-renders of the shell when the route re-renders.
  const shellProps = useMemo<StatsScreenShellProps>(
    () => ({
      summary,
      periodDays,
      onSelectPeriod: handleSelectPeriod,
      onPressSessionsCard: handlePressSessionsCard,
      isLoading,
      errorMessage,
    }),
    [summary, periodDays, handleSelectPeriod, handlePressSessionsCard, isLoading, errorMessage]
  );

  return <StatsScreenShell {...shellProps} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiColors.surfacePage,
    padding: 16,
    gap: 12,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    gap: 16,
    paddingBottom: 16,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: 12,
    gap: 4,
  },
  summaryCardPressed: {
    opacity: 0.7,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: uiColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontSize: 26,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  summaryDelta: {
    fontSize: 12,
    fontWeight: '600',
  },
  familyList: {
    gap: 12,
  },
  familyCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    overflow: 'hidden',
  },
  familyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.borderMuted,
  },
  familyName: {
    fontSize: 16,
    fontWeight: '700',
    color: uiColors.textPrimary,
    flexShrink: 1,
  },
  familyMetrics: {
    flexDirection: 'row',
    gap: 16,
  },
  muscleList: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  muscleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    gap: 12,
  },
  muscleName: {
    fontSize: 14,
    fontWeight: '500',
    color: uiColors.textPrimary,
    flexShrink: 1,
  },
  muscleMetrics: {
    flexDirection: 'row',
    gap: 12,
  },
  muscleTextUntrained: {
    color: uiColors.textSecondary,
  },
  metric: {
    alignItems: 'flex-end',
    minWidth: 60,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: uiColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metricLabelSmall: {
    fontSize: 9,
    fontWeight: '600',
    color: uiColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metricLabelMuted: {
    color: uiColors.textSecondary,
  },
  metricValue: {
    fontSize: 15,
    fontWeight: '700',
    color: uiColors.textPrimary,
    marginTop: 2,
  },
  metricValueSmall: {
    fontSize: 13,
    fontWeight: '600',
    color: uiColors.textPrimary,
    marginTop: 2,
  },
  metricValueMuted: {
    color: uiColors.textSecondary,
  },
  metricDelta: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  metricDeltaSmall: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  statePanel: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: 16,
    gap: 6,
  },
  stateTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  stateBody: {
    fontSize: 13,
    color: uiColors.textSecondary,
  },
  deltaPositive: {
    color: uiColors.textSuccess,
  },
  deltaNegative: {
    color: uiColors.actionDangerText,
  },
  deltaNeutral: {
    color: uiColors.textSecondary,
  },
  deltaNew: {
    color: uiColors.actionPrimary,
  },
});
