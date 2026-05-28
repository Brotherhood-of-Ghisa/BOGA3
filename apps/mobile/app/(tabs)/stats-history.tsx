import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  CalendarHeatmap,
  getCalendarHeatmapBucket,
  type CalendarHeatmapCell,
} from '@/components/muscle-analytics';
import { SegmentedChips, uiColors } from '@/components/ui';
import {
  computeSelectedMuscleDailyEffort,
  computeStatsSummary,
  type SelectedMuscleDailyEffort,
  type StatsMuscleFamilyPerformance,
  type StatsMusclePerformance,
  type StatsPeriodDays,
  type StatsSummary,
} from '@/src/data';

const PERIOD_OPTIONS = [
  { value: 7 as StatsPeriodDays, label: 'Last 7 days' },
  { value: 30 as StatsPeriodDays, label: 'Last 30 days' },
] as const;

const MUSCLE_HISTORY_WINDOW_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type DeltaDisplay = {
  text: string;
  tone: 'positive' | 'negative' | 'neutral' | 'new';
};

export type MuscleHistoryTarget = Pick<
  StatsMusclePerformance,
  'muscleGroupId' | 'displayName' | 'familyName'
>;

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
  onPressMuscleHistory: (muscle: MuscleHistoryTarget) => void;
  onDismissMuscleHistory: () => void;
  onSelectMuscleHistoryDate: (cell: CalendarHeatmapCell) => void;
  isLoading: boolean;
  errorMessage: string | null;
  selectedMuscle: MuscleHistoryTarget | null;
  muscleHistoryEffort: SelectedMuscleDailyEffort[];
  isMuscleHistoryLoading: boolean;
  muscleHistoryErrorMessage: string | null;
  selectedMuscleHistoryDateKey: string | null;
};

export function StatsScreenShell({
  summary,
  periodDays,
  onSelectPeriod,
  onPressSessionsCard,
  onPressMuscleHistory,
  onDismissMuscleHistory,
  onSelectMuscleHistoryDate,
  isLoading,
  errorMessage,
  selectedMuscle,
  muscleHistoryEffort,
  isMuscleHistoryLoading,
  muscleHistoryErrorMessage,
  selectedMuscleHistoryDateKey,
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
              onPressMuscleHistory={onPressMuscleHistory}
            />
          </>
        ) : null}
      </ScrollView>
      {selectedMuscle ? (
        <MuscleHistoryOverlay
          muscle={selectedMuscle}
          dailyEffort={muscleHistoryEffort}
          isLoading={isMuscleHistoryLoading}
          errorMessage={muscleHistoryErrorMessage}
          selectedDateKey={selectedMuscleHistoryDateKey}
          onDismiss={onDismissMuscleHistory}
          onSelectDate={onSelectMuscleHistoryDate}
        />
      ) : null}
    </View>
  );
}

function MuscleFamilyList({
  families,
  previousFamilies,
  onPressMuscleHistory,
}: {
  families: StatsMuscleFamilyPerformance[];
  previousFamilies: StatsMuscleFamilyPerformance[];
  onPressMuscleHistory: (muscle: MuscleHistoryTarget) => void;
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
          onPressMuscleHistory={onPressMuscleHistory}
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
  onPressMuscleHistory,
}: {
  family: StatsMuscleFamilyPerformance;
  previousFamily: StatsMuscleFamilyPerformance | null;
  previousMusclesById: Map<string, StatsMusclePerformance>;
  onPressMuscleHistory: (muscle: MuscleHistoryTarget) => void;
}) {
  const familyUntrained = family.sessionCount === 0 && family.totalWeight === 0;
  const testIdSlug = family.familyName.toLowerCase().replace(/\s+/g, '-');
  const sessionsDelta = formatDelta(family.sessionCount, previousFamily?.sessionCount ?? 0);
  const weightDelta = formatDelta(family.totalWeight, previousFamily?.totalWeight ?? 0);
  const collapsed = isFamilyCollapsible(family);
  const collapsedMuscle = collapsed ? family.muscles[0] : null;
  const headerContent = (
    <>
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
    </>
  );

  return (
    <View style={styles.familyCard} testID={`stats-family-card-${testIdSlug}`}>
      {collapsedMuscle ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${collapsedMuscle.displayName} history`}
          onPress={() => onPressMuscleHistory(toMuscleHistoryTarget(collapsedMuscle))}
          style={({ pressed }) => [styles.familyHeader, pressed && styles.actionableRowPressed]}
          testID={`stats-family-header-button-${collapsedMuscle.muscleGroupId}`}>
          {headerContent}
        </Pressable>
      ) : (
        <View style={styles.familyHeader}>{headerContent}</View>
      )}
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${muscle.displayName} history`}
                key={muscle.muscleGroupId}
                onPress={() => onPressMuscleHistory(toMuscleHistoryTarget(muscle))}
                style={({ pressed }) => [styles.muscleRow, pressed && styles.actionableRowPressed]}
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
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const toMuscleHistoryTarget = (muscle: StatsMusclePerformance): MuscleHistoryTarget => ({
  muscleGroupId: muscle.muscleGroupId,
  displayName: muscle.displayName,
  familyName: muscle.familyName,
});

function MuscleHistoryOverlay({
  muscle,
  dailyEffort,
  isLoading,
  errorMessage,
  selectedDateKey,
  onDismiss,
  onSelectDate,
}: {
  muscle: MuscleHistoryTarget;
  dailyEffort: SelectedMuscleDailyEffort[];
  isLoading: boolean;
  errorMessage: string | null;
  selectedDateKey: string | null;
  onDismiss: () => void;
  onSelectDate: (cell: CalendarHeatmapCell) => void;
}) {
  const selectedEffort =
    selectedDateKey === null
      ? null
      : dailyEffort.find((entry) => entry.dateKey === selectedDateKey) ?? null;
  const maxPositiveEffort = dailyEffort.reduce(
    (max, entry) => Math.max(max, entry.totalWeight > 0 ? entry.totalWeight : 0),
    0
  );
  const selectedBucket = selectedEffort
    ? getCalendarHeatmapBucket(selectedEffort.totalWeight, maxPositiveEffort)
    : 0;

  return (
    <View style={styles.overlayRoot} testID="stats-muscle-history-overlay">
      <Pressable
        accessibilityLabel="Dismiss muscle history"
        accessibilityRole="button"
        onPress={onDismiss}
        style={styles.overlayBackdrop}
        testID="stats-muscle-history-backdrop"
      />
      <View style={styles.overlayCard}>
        <View style={styles.overlayHeader}>
          <View style={styles.overlayTitleGroup}>
            <Text style={styles.overlayEyebrow}>Muscle history</Text>
            <Text style={styles.overlayTitle} testID="stats-muscle-history-title">
              {muscle.displayName} history
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Close muscle history"
            accessibilityRole="button"
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.overlayCloseButton,
              pressed && styles.actionableRowPressed,
            ]}
            testID="stats-muscle-history-close">
            <Text style={styles.overlayCloseButtonText}>X</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.overlayContent}
          showsVerticalScrollIndicator={false}
          testID="stats-muscle-history-scroll">
          {isLoading ? (
            <View style={styles.overlayStatePanel} testID="stats-muscle-history-loading">
              <Text style={styles.stateBody}>Loading {muscle.displayName} history...</Text>
            </View>
          ) : null}

          {!isLoading && errorMessage ? (
            <View style={styles.overlayStatePanel} testID="stats-muscle-history-error">
              <Text style={styles.stateTitle}>Could not load muscle history</Text>
              <Text style={styles.stateBody}>{errorMessage}</Text>
            </View>
          ) : null}

          {!isLoading && !errorMessage ? (
            <>
              {dailyEffort.length === 0 ? (
                <View style={styles.overlayStatePanel} testID="stats-muscle-history-empty">
                  <Text style={styles.stateTitle}>No history yet</Text>
                  <Text style={styles.stateBody}>
                    No {muscle.displayName} training was found in the last{' '}
                    {MUSCLE_HISTORY_WINDOW_DAYS} days.
                  </Text>
                </View>
              ) : null}

              <CalendarHeatmap
                dailyEffort={dailyEffort}
                selectedDateKey={selectedDateKey}
                onSelectDate={onSelectDate}
                testID="stats-muscle-history-heatmap"
              />

              <SelectedDateSummary
                muscle={muscle}
                selectedDateKey={selectedDateKey}
                selectedEffort={selectedEffort}
                bucket={selectedBucket}
              />
            </>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

function SelectedDateSummary({
  muscle,
  selectedDateKey,
  selectedEffort,
  bucket,
}: {
  muscle: MuscleHistoryTarget;
  selectedDateKey: string | null;
  selectedEffort: SelectedMuscleDailyEffort | null;
  bucket: number;
}) {
  if (selectedDateKey === null) {
    return (
      <View style={styles.selectedDatePanel} testID="stats-muscle-history-selected-date">
        <Text style={styles.stateBody}>Select a date to inspect that day.</Text>
      </View>
    );
  }

  if (!selectedEffort || selectedEffort.totalWeight <= 0) {
    return (
      <View style={styles.selectedDatePanel} testID="stats-muscle-history-selected-date">
        <View style={styles.selectedDateHeader}>
          <Text style={styles.stateTitle}>{formatDateKey(selectedDateKey)}</Text>
          <Text style={styles.selectedDateMuscle}>{muscle.displayName}</Text>
        </View>
        <Text style={styles.selectedDateMeta}>Effort 0 - Bucket 0</Text>
        <Text style={styles.stateBody}>No {muscle.displayName} training on this date.</Text>
      </View>
    );
  }

  const contributionGroups = groupSelectedDateContributions(selectedEffort.contributions);

  return (
    <View style={styles.selectedDatePanel} testID="stats-muscle-history-selected-date">
      <View style={styles.selectedDateHeader}>
        <Text style={styles.stateTitle}>{formatDateKey(selectedDateKey)}</Text>
        <Text style={styles.selectedDateMuscle}>{muscle.displayName}</Text>
      </View>
      <Text style={styles.selectedDateMeta}>
        Effort {formatTotalWeight(selectedEffort.totalWeight)} - Bucket {bucket} of 4
      </Text>
      <Text style={styles.stateBody}>
        {formatNumber(selectedEffort.sessionCount)} session
        {selectedEffort.sessionCount === 1 ? '' : 's'} - {formatNumber(selectedEffort.setCount)}{' '}
        set{selectedEffort.setCount === 1 ? '' : 's'}
      </Text>

      {contributionGroups.length === 0 ? (
        <Text style={styles.stateBody}>No set-level details are available for this date.</Text>
      ) : (
        <View style={styles.contributionList}>
          <Text style={styles.contributionSectionTitle}>Contributing exercises</Text>
          {contributionGroups.map((group) => (
            <View
              key={group.sessionExerciseId}
              style={styles.contributionExercise}
              testID={`stats-muscle-history-exercise-${group.sessionExerciseId}`}>
              <View style={styles.contributionExerciseHeader}>
                <Text style={styles.contributionExerciseName} numberOfLines={1}>
                  {group.exerciseName}
                </Text>
                <Text style={styles.contributionExerciseMeta}>
                  {formatSessionTime(group.sessionCompletedAt)}
                </Text>
              </View>
              <Text style={styles.contributionExerciseMeta}>
                {formatContributionRole(group.role)} - {group.contributions.length} set
                {group.contributions.length === 1 ? '' : 's'}
              </Text>
              <View style={styles.contributionSetList}>
                {group.contributions.map((contribution, index) => (
                  <View
                    key={contribution.setId ?? `${group.sessionExerciseId}-${index}`}
                    style={styles.contributionSetRow}
                    testID={`stats-muscle-history-set-${
                      contribution.setId ?? `${group.sessionExerciseId}-${index}`
                    }`}>
                    <Text style={styles.contributionSetLabel}>
                      {formatContributionSetLabel(contribution, index)}
                    </Text>
                    <Text style={styles.contributionSetValue} numberOfLines={1}>
                      {formatContributionSetLoad(contribution)} - effort{' '}
                      {formatTotalWeight(contribution.weightedVolume)}
                    </Text>
                    {contribution.roleWeight === 1 ? null : (
                      <Text style={styles.contributionSetDetail} numberOfLines={1}>
                        base {formatTotalWeight(contribution.setVolume)} x{' '}
                        {formatRoleWeight(contribution.roleWeight)}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

type SelectedDateContribution =
  SelectedMuscleDailyEffort['contributions'][number];

type SelectedDateContributionGroup = {
  sessionExerciseId: string;
  exerciseName: string;
  sessionCompletedAt: Date;
  role: SelectedDateContribution['role'];
  contributions: SelectedDateContribution[];
};

const groupSelectedDateContributions = (
  contributions: SelectedDateContribution[]
): SelectedDateContributionGroup[] => {
  const groupsByExerciseId = new Map<string, SelectedDateContributionGroup>();

  for (const contribution of contributions) {
    const existing = groupsByExerciseId.get(contribution.sessionExerciseId);
    if (existing) {
      existing.contributions.push(contribution);
      continue;
    }

    groupsByExerciseId.set(contribution.sessionExerciseId, {
      sessionExerciseId: contribution.sessionExerciseId,
      exerciseName: contribution.exerciseName ?? 'Logged exercise',
      sessionCompletedAt: contribution.sessionCompletedAt,
      role: contribution.role,
      contributions: [contribution],
    });
  }

  return Array.from(groupsByExerciseId.values());
};

const formatDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

const formatSessionTime = (date: Date) =>
  new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);

const formatContributionRole = (role: SelectedDateContribution['role']) => {
  if (role === 'primary') return 'Primary';
  if (role === 'secondary') return 'Secondary';
  return 'Contribution';
};

const formatContributionSetLabel = (
  contribution: SelectedDateContribution,
  fallbackIndex: number
) => {
  if (contribution.setOrderIndex === null) return `Set ${fallbackIndex + 1}`;
  return `Set ${contribution.setOrderIndex + 1}`;
};

const formatContributionSetLoad = (contribution: SelectedDateContribution) => {
  const weight = contribution.weightValue.trim() || '-';
  const reps = contribution.repsValue.trim() || '-';
  return `${weight} x ${reps}`;
};

const formatRoleWeight = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');

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
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleHistoryTarget | null>(null);
  const [muscleHistoryEffort, setMuscleHistoryEffort] = useState<SelectedMuscleDailyEffort[]>(
    []
  );
  const [isMuscleHistoryLoading, setIsMuscleHistoryLoading] = useState(false);
  const [muscleHistoryErrorMessage, setMuscleHistoryErrorMessage] = useState<string | null>(null);
  const [selectedMuscleHistoryDateKey, setSelectedMuscleHistoryDateKey] = useState<string | null>(
    null
  );
  const muscleHistoryRequestIdRef = useRef(0);

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

  const handlePressMuscleHistory = useCallback(async (muscle: MuscleHistoryTarget) => {
    const requestId = muscleHistoryRequestIdRef.current + 1;
    muscleHistoryRequestIdRef.current = requestId;
    const end = new Date();
    const start = new Date(end.getTime() - MUSCLE_HISTORY_WINDOW_DAYS * MS_PER_DAY);

    setSelectedMuscle(muscle);
    setMuscleHistoryEffort([]);
    setSelectedMuscleHistoryDateKey(null);
    setMuscleHistoryErrorMessage(null);
    setIsMuscleHistoryLoading(true);

    try {
      const nextEffort = await computeSelectedMuscleDailyEffort({
        muscleGroupId: muscle.muscleGroupId,
        start,
        end,
      });
      if (muscleHistoryRequestIdRef.current !== requestId) return;
      setMuscleHistoryEffort(nextEffort);
    } catch (error) {
      if (muscleHistoryRequestIdRef.current !== requestId) return;
      setMuscleHistoryErrorMessage(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      if (muscleHistoryRequestIdRef.current !== requestId) return;
      setIsMuscleHistoryLoading(false);
    }
  }, []);

  const handleDismissMuscleHistory = useCallback(() => {
    muscleHistoryRequestIdRef.current += 1;
    setSelectedMuscle(null);
    setMuscleHistoryEffort([]);
    setSelectedMuscleHistoryDateKey(null);
    setMuscleHistoryErrorMessage(null);
    setIsMuscleHistoryLoading(false);
  }, []);

  const handleSelectMuscleHistoryDate = useCallback((cell: CalendarHeatmapCell) => {
    setSelectedMuscleHistoryDateKey(cell.dateKey);
  }, []);

  // useMemo prevents unnecessary re-renders of the shell when the route re-renders.
  const shellProps = useMemo<StatsScreenShellProps>(
    () => ({
      summary,
      periodDays,
      onSelectPeriod: handleSelectPeriod,
      onPressSessionsCard: handlePressSessionsCard,
      onPressMuscleHistory: handlePressMuscleHistory,
      onDismissMuscleHistory: handleDismissMuscleHistory,
      onSelectMuscleHistoryDate: handleSelectMuscleHistoryDate,
      isLoading,
      errorMessage,
      selectedMuscle,
      muscleHistoryEffort,
      isMuscleHistoryLoading,
      muscleHistoryErrorMessage,
      selectedMuscleHistoryDateKey,
    }),
    [
      summary,
      periodDays,
      handleSelectPeriod,
      handlePressSessionsCard,
      handlePressMuscleHistory,
      handleDismissMuscleHistory,
      handleSelectMuscleHistoryDate,
      isLoading,
      errorMessage,
      selectedMuscle,
      muscleHistoryEffort,
      isMuscleHistoryLoading,
      muscleHistoryErrorMessage,
      selectedMuscleHistoryDateKey,
    ]
  );

  return <StatsScreenShell {...shellProps} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiColors.surfacePage,
    padding: 16,
    gap: 12,
    position: 'relative',
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
    paddingHorizontal: 4,
    gap: 12,
  },
  actionableRowPressed: {
    opacity: 0.7,
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
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    padding: 16,
  },
  overlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrim,
  },
  overlayCard: {
    height: '75%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    overflow: 'hidden',
  },
  overlayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: uiColors.borderMuted,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  overlayTitleGroup: {
    flexShrink: 1,
    gap: 2,
  },
  overlayEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: uiColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  overlayTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  overlayCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: uiColors.actionNeutralSubtleBorder,
    backgroundColor: uiColors.actionNeutralSubtleBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayCloseButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: uiColors.actionNeutralSubtleText,
  },
  overlayContent: {
    padding: 16,
    gap: 16,
  },
  overlayStatePanel: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceInfo,
    padding: 12,
    gap: 6,
  },
  selectedDatePanel: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceMuted,
    padding: 12,
    gap: 6,
  },
  selectedDateHeader: {
    gap: 2,
  },
  selectedDateMuscle: {
    fontSize: 12,
    fontWeight: '700',
    color: uiColors.textSecondary,
  },
  selectedDateMeta: {
    fontSize: 13,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  contributionList: {
    marginTop: 4,
    gap: 8,
  },
  contributionSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: uiColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  contributionExercise: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: 10,
    gap: 4,
  },
  contributionExerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  contributionExerciseName: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  contributionExerciseMeta: {
    fontSize: 11,
    fontWeight: '600',
    color: uiColors.textSecondary,
  },
  contributionSetList: {
    gap: 4,
    marginTop: 2,
  },
  contributionSetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: uiColors.borderMuted,
    paddingTop: 4,
    gap: 8,
  },
  contributionSetLabel: {
    width: 42,
    fontSize: 11,
    fontWeight: '700',
    color: uiColors.textSecondary,
  },
  contributionSetValue: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: '600',
    color: uiColors.textPrimary,
  },
  contributionSetDetail: {
    maxWidth: 84,
    fontSize: 10,
    fontWeight: '600',
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
