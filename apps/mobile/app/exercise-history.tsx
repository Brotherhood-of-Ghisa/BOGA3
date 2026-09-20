import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MainTabs } from '@/components/navigation/main-tabs';
import { uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';
import {
  loadExercisePerformanceHistory,
  type ExerciseHistoryPeriod,
  type ExerciseHistorySessionEntry,
  type ExerciseHistorySummary,
  type ExerciseHistoryTagOption,
} from '@/src/data';
import { mainTabHref, type MainTabKey } from '@/src/navigation/main-tabs';

const PERIOD_OPTIONS: { value: ExerciseHistoryPeriod; label: string }[] = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 'all', label: 'All time' },
];

const coerceRouteParam = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
};

const parsePeriodParam = (raw: string | null): ExerciseHistoryPeriod => {
  if (raw === 'all') return 'all';
  if (raw === '7') return 7;
  if (raw === '30') return 30;
  return 30;
};

const formatPeriodChipLabel = (value: ExerciseHistoryPeriod, label: string) =>
  value === 'all' ? label : `Last ${label}`;

const formatSessionDate = (value: Date): string => {
  if (Number.isNaN(value.getTime())) return '—';
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  const year = value.getFullYear();
  const hours = `${value.getHours()}`.padStart(2, '0');
  const minutes = `${value.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
};

const formatNumeric = (value: number, fractionDigits = 0): string => {
  if (!Number.isFinite(value)) return '—';
  const fixed = value.toFixed(fractionDigits);
  return fractionDigits > 0 ? fixed.replace(/\.0+$/, '') : fixed;
};

const formatTopWeight = (set: { weight: number; reps: number } | null) =>
  set ? `${formatNumeric(set.weight, 1)} × ${set.reps}` : '—';

const formatVolume = (value: number) => (value > 0 ? formatNumeric(value, 1) : '—');

const formatEstOneRm = (value: number | null) =>
  value === null ? '—' : formatNumeric(value, 1);

const formatSetTypeBadge = (setType: ExerciseHistorySessionEntry['sets'][number]['setType']) => {
  switch (setType) {
    case 'warm_up':
      return 'W-Up';
    case 'rir_0':
      return 'R0';
    case 'rir_1':
      return 'R1';
    case 'rir_2':
      return 'R2';
    default:
      return '';
  }
};

export type ExerciseHistoryScreenShellProps = {
  summary: ExerciseHistorySummary | null;
  period: ExerciseHistoryPeriod;
  appliedTagDefinitionId: string | null;
  isLoading: boolean;
  errorMessage: string | null;
  onSelectPeriod: (period: ExerciseHistoryPeriod) => void;
  onSelectTag: (tagDefinitionId: string | null) => void;
  onPressSession: (sessionId: string) => void;
  activeMainTab?: MainTabKey;
  onSelectMainTab: (tab: MainTabKey) => void;
};

export function ExerciseHistoryScreenShell({
  summary,
  period,
  appliedTagDefinitionId,
  isLoading,
  errorMessage,
  onSelectPeriod,
  onSelectTag,
  onPressSession,
  activeMainTab = 'progress',
  onSelectMainTab,
}: ExerciseHistoryScreenShellProps) {
  const tagOptions = summary?.tagOptions ?? [];

  return (
    <View style={styles.screen}>
      <View style={styles.contentRegion}>
        <View style={styles.periodChipsRow} accessibilityRole="tablist">
          {PERIOD_OPTIONS.map((option) => {
            const selected = option.value === period;
            return (
              <Pressable
                key={String(option.value)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`Show history for ${formatPeriodChipLabel(option.value, option.label)}`}
                onPress={() => onSelectPeriod(option.value)}
                style={[styles.periodChip, selected && styles.periodChipSelected]}
                testID={`exercise-history-period-chip-${option.value}`}>
                <Text style={[styles.periodChipText, selected && styles.periodChipTextSelected]}>
                  {formatPeriodChipLabel(option.value, option.label)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {summary && tagOptions.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tagChipsRow}
            testID="exercise-history-tag-row">
            <TagChip
              testID="exercise-history-tag-chip-all"
              label="All tags"
              selected={appliedTagDefinitionId === null}
              onPress={() => onSelectTag(null)}
            />
            {tagOptions.map((option) => {
              const baseName = option.deletedAt ? `${option.name} (deleted)` : option.name;
              return (
                <TagChip
                  key={option.tagDefinitionId}
                  testID={`exercise-history-tag-chip-${option.tagDefinitionId}`}
                  label={`${baseName} · ${option.occurrenceCount}`}
                  accessibilityLabel={`Filter by tag ${baseName}, ${option.occurrenceCount} sessions`}
                  selected={appliedTagDefinitionId === option.tagDefinitionId}
                  onPress={() =>
                    onSelectTag(appliedTagDefinitionId === option.tagDefinitionId ? null : option.tagDefinitionId)
                  }
                  deleted={Boolean(option.deletedAt)}
                />
              );
            })}
          </ScrollView>
        ) : null}

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          testID="exercise-history-scroll">
          {errorMessage ? (
            <View style={styles.statePanel} testID="exercise-history-error-state">
              <Text style={styles.stateTitle}>Could not load history</Text>
              <Text style={styles.stateBody}>{errorMessage}</Text>
            </View>
          ) : null}

          {!errorMessage && isLoading && !summary ? (
            <View style={styles.statePanel} testID="exercise-history-loading-state">
              <Text style={styles.stateBody}>Loading exercise history…</Text>
            </View>
          ) : null}

          {summary ? (
            <>
              {summary.exerciseDeletedAt ? (
                <View style={styles.deletedExerciseBanner} testID="exercise-history-deleted-banner">
                  <Text style={styles.deletedExerciseBannerText}>
                    This exercise has been deleted. Historical data remains available.
                  </Text>
                </View>
              ) : null}

              <BestCard
                best={summary.allTimeBest}
                onPressSession={onPressSession}
              />

              {summary.sessions.length === 0 ? (
                <View style={styles.statePanel} testID="exercise-history-empty-state">
                  <Text style={styles.stateTitle}>No sessions in this view</Text>
                  <Text style={styles.stateBody}>
                    {appliedTagDefinitionId
                      ? 'No sessions in this period have the selected tag. Pick another tag or widen the period.'
                      : 'No completed sessions for this exercise in this period.'}
                  </Text>
                </View>
              ) : (
                summary.sessions.map((entry) => (
                  <SessionCard
                    key={entry.sessionExerciseId}
                    entry={entry}
                    tagLookup={tagOptions}
                    onPress={() => onPressSession(entry.sessionId)}
                  />
                ))
              )}
            </>
          ) : null}
        </ScrollView>
      </View>

      <MainTabs activeTab={activeMainTab} onSelect={onSelectMainTab} />
    </View>
  );
}

function BestCard({
  best,
  onPressSession,
}: {
  best: ExerciseHistorySummary['allTimeBest'];
  onPressSession: (sessionId: string) => void;
}) {
  const oneRm = best.estimatedOneRepMax;
  const topWeight = best.topWeight;
  return (
    <View style={styles.bestCard} testID="exercise-history-best-card">
      <Text style={styles.bestCardTitle}>All-time bests</Text>
      <BestRow
        testID="exercise-history-best-est-1rm"
        label="Est. 1RM"
        primary={formatEstOneRm(oneRm?.value ?? null)}
        secondary={oneRm ? formatSessionDate(oneRm.completedAt) : null}
        onPress={oneRm ? () => onPressSession(oneRm.sessionId) : undefined}
      />
      <BestRow
        testID="exercise-history-best-top-weight"
        label="Top weight"
        primary={formatTopWeight(topWeight)}
        secondary={topWeight ? formatSessionDate(topWeight.completedAt) : null}
        onPress={topWeight ? () => onPressSession(topWeight.sessionId) : undefined}
      />
    </View>
  );
}

function TagChip({
  testID,
  label,
  accessibilityLabel,
  selected,
  deleted = false,
  onPress,
}: {
  testID: string;
  label: string;
  accessibilityLabel?: string;
  selected: boolean;
  deleted?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.tagChip,
        selected && styles.tagChipSelected,
        deleted && !selected && styles.tagChipDeleted,
      ]}
      testID={testID}>
      <Text style={[styles.tagChipText, selected && styles.tagChipTextSelected]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function BestRow({
  testID,
  label,
  primary,
  secondary,
  onPress,
}: {
  testID: string;
  label: string;
  primary: string;
  secondary: string | null;
  onPress?: () => void;
}) {
  const inner = (
    <View style={styles.bestRowInner}>
      <Text style={styles.bestRowLabel}>{label}</Text>
      <Text style={styles.bestRowPrimary}>{primary}</Text>
      {secondary ? <Text style={styles.bestRowSecondary}>{secondary}</Text> : null}
    </View>
  );

  if (!onPress) {
    return (
      <View style={styles.bestRow} testID={testID}>
        {inner}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.bestRow}
      testID={testID}>
      {inner}
    </Pressable>
  );
}

function SessionCard({
  entry,
  tagLookup,
  onPress,
}: {
  entry: ExerciseHistorySessionEntry;
  tagLookup: ExerciseHistoryTagOption[];
  onPress: () => void;
}) {
  const tagById = useMemo(() => {
    const map = new Map<string, ExerciseHistoryTagOption>();
    for (const tag of tagLookup) map.set(tag.tagDefinitionId, tag);
    return map;
  }, [tagLookup]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open session from ${formatSessionDate(entry.completedAt)}`}
      onPress={onPress}
      style={styles.sessionCard}
      testID={`exercise-history-session-card-${entry.sessionExerciseId}`}>
      <View style={styles.sessionCardHeader}>
        <Text style={styles.sessionCardDate}>{formatSessionDate(entry.completedAt)}</Text>
        <Text style={styles.sessionCardGym} numberOfLines={1}>
          {entry.gymName?.trim() ? entry.gymName : 'No gym'}
        </Text>
      </View>

      {entry.tagIds.length > 0 ? (
        <View style={styles.sessionTagWrap}>
          {entry.tagIds.map((id) => {
            const tag = tagById.get(id);
            if (!tag) return null;
            return (
              <View
                key={id}
                style={[styles.sessionTagChip, tag.deletedAt ? styles.sessionTagChipDeleted : null]}>
                <Text numberOfLines={1} style={styles.sessionTagChipText}>
                  {tag.deletedAt ? `${tag.name} (deleted)` : tag.name}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={styles.sessionMetricsRow}>
        <SessionMetric label="Est 1RM" value={formatEstOneRm(entry.estimatedOneRepMax)} />
        <SessionMetric label="Top set" value={formatTopWeight(entry.topWeightSet)} />
        <SessionMetric label="Volume" value={formatVolume(entry.totalVolume)} />
        <SessionMetric label="W/sets" value={String(entry.workingSetCount)} />
      </View>

      <View style={styles.setTableHeaderRow}>
        <Text style={[styles.setTableHeaderCell, styles.setTableTypeCell]}>Type</Text>
        <Text style={[styles.setTableHeaderCell, styles.setTableIndexCell]}>Set</Text>
        <Text style={[styles.setTableHeaderCell, styles.setTableValueCell]}>Weight</Text>
        <Text style={[styles.setTableHeaderCell, styles.setTableValueCell]}>Reps</Text>
      </View>
      {entry.sets.map((set, index) => (
        <View
          key={set.setId}
          style={[styles.setTableRow, !set.isWorking && styles.setTableRowNonWorking]}
          testID={`exercise-history-set-row-${set.setId}`}>
          <View style={[styles.setTableTypeCell, styles.setTableTypeBadgeWrap]}>
            {formatSetTypeBadge(set.setType) ? (
              <Text
                style={[
                  styles.setTableTypeBadge,
                  !set.isWorking && styles.setTableTypeBadgeWarmUp,
                ]}>
                {formatSetTypeBadge(set.setType)}
              </Text>
            ) : (
              <Text style={styles.setTableTypeBadgeEmpty}>—</Text>
            )}
          </View>
          <Text style={[styles.setTableCell, styles.setTableIndexCell]}>{index + 1}</Text>
          <Text style={[styles.setTableCell, styles.setTableValueCell]}>{set.weightValue || '—'}</Text>
          <Text style={[styles.setTableCell, styles.setTableValueCell]}>{set.repsValue || '—'}</Text>
        </View>
      ))}
    </Pressable>
  );
}

function SessionMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.sessionMetric}>
      <Text style={styles.sessionMetricLabel}>{label}</Text>
      <Text style={styles.sessionMetricValue}>{value}</Text>
    </View>
  );
}

export default function ExerciseHistoryRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    exerciseDefinitionId?: string | string[];
    tagDefinitionId?: string | string[];
    period?: string | string[];
  }>();
  const exerciseDefinitionId = coerceRouteParam(params.exerciseDefinitionId);
  const initialTagDefinitionId = coerceRouteParam(params.tagDefinitionId);
  const initialPeriod = parsePeriodParam(coerceRouteParam(params.period));

  const [period, setPeriod] = useState<ExerciseHistoryPeriod>(initialPeriod);
  const [appliedTagDefinitionId, setAppliedTagDefinitionId] = useState<string | null>(
    initialTagDefinitionId
  );
  const [summary, setSummary] = useState<ExerciseHistorySummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadSummary = useCallback(
    async (nextPeriod: ExerciseHistoryPeriod, nextTagDefinitionId: string | null) => {
      if (!exerciseDefinitionId) {
        setSummary(null);
        setIsLoading(false);
        setErrorMessage('Missing exerciseDefinitionId in route');
        return;
      }
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const next = await loadExercisePerformanceHistory({
          exerciseDefinitionId,
          period: nextPeriod,
          tagDefinitionId: nextTagDefinitionId,
        });
        if (next === null) {
          setSummary(null);
          setErrorMessage('Exercise not found.');
        } else {
          setSummary(next);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    },
    [exerciseDefinitionId]
  );

  useFocusEffect(
    useCallback(() => {
      void loadSummary(period, appliedTagDefinitionId);
    }, [loadSummary, period, appliedTagDefinitionId])
  );

  const handleSelectPeriod = useCallback(
    (next: ExerciseHistoryPeriod) => {
      setPeriod(next);
      void loadSummary(next, appliedTagDefinitionId);
    },
    [loadSummary, appliedTagDefinitionId]
  );

  const handleSelectTag = useCallback(
    (next: string | null) => {
      setAppliedTagDefinitionId(next);
      void loadSummary(period, next);
    },
    [loadSummary, period]
  );

  const title = summary?.exerciseName ?? 'Exercise History';

  return (
    <>
      <Stack.Screen options={{ title }} />
      <ExerciseHistoryScreenShell
        summary={summary}
        period={period}
        appliedTagDefinitionId={appliedTagDefinitionId}
        isLoading={isLoading}
        errorMessage={errorMessage}
        onSelectPeriod={handleSelectPeriod}
        onSelectTag={handleSelectTag}
        onPressSession={(sessionId) => router.push(`/completed-session/${sessionId}`)}
        onSelectMainTab={(tab) => router.push(mainTabHref(tab))}
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiColors.surfacePage,
    padding: uiSpace.lg,
    gap: uiSpace.lg,
  },
  contentRegion: {
    flex: 1,
    minHeight: 0,
    gap: uiSpace.md,
  },
  periodChipsRow: {
    flexDirection: 'row',
    gap: uiSpace.sm,
    flexWrap: 'wrap',
  },
  periodChip: {
    borderRadius: uiRadius.full,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  periodChipSelected: {
    borderColor: uiColors.actionPrimary,
    backgroundColor: uiColors.actionPrimarySubtleBg,
  },
  periodChipText: {
    fontSize: uiTypography.size.md,
    fontWeight: '600',
    color: uiColors.textSecondary,
  },
  periodChipTextSelected: {
    color: uiColors.actionPrimary,
  },
  tagChipsRow: {
    gap: uiSpace.sm,
    paddingRight: uiSpace.sm,
  },
  tagChip: {
    borderRadius: uiRadius.full,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.xs,
    maxWidth: 220,
  },
  tagChipSelected: {
    borderColor: uiColors.actionPrimary,
    backgroundColor: uiColors.actionPrimarySubtleBg,
  },
  tagChipDeleted: {
    borderColor: uiColors.borderWarning,
    backgroundColor: uiColors.surfaceWarning,
  },
  tagChipText: {
    fontSize: uiTypography.size.sm,
    fontWeight: '600',
    color: uiColors.textSecondary,
  },
  tagChipTextSelected: {
    color: uiColors.actionPrimary,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    gap: uiSpace.md,
    paddingBottom: uiSpace.lg,
  },
  statePanel: {
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.lg,
    gap: uiSpace.sm,
  },
  stateTitle: {
    fontSize: uiTypography.size.base,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  stateBody: {
    fontSize: uiTypography.size.md,
    color: uiColors.textSecondary,
  },
  deletedExerciseBanner: {
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderWarning,
    backgroundColor: uiColors.surfaceWarning,
    padding: uiSpace.md,
  },
  deletedExerciseBannerText: {
    color: uiColors.textWarning,
    fontSize: uiTypography.size.sm,
    fontWeight: '600',
  },
  bestCard: {
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.md,
    gap: uiSpace.sm,
  },
  bestCardTitle: {
    fontSize: uiTypography.size.sm,
    fontWeight: '700',
    color: uiColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bestRow: {
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfacePage,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.md,
  },
  bestRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
  },
  bestRowLabel: {
    flex: 1,
    fontSize: uiTypography.size.md,
    fontWeight: '600',
    color: uiColors.textSecondary,
  },
  bestRowPrimary: {
    fontSize: uiTypography.size.base,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  bestRowSecondary: {
    fontSize: uiTypography.size.xs,
    fontWeight: '600',
    color: uiColors.textSecondary,
  },
  sessionCard: {
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.md,
    gap: uiSpace.md,
  },
  sessionCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  sessionCardDate: {
    fontSize: uiTypography.size.base,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  sessionCardGym: {
    fontSize: uiTypography.size.sm,
    fontWeight: '600',
    color: uiColors.textSecondary,
    flex: 1,
    textAlign: 'right',
  },
  sessionTagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.sm,
  },
  sessionTagChip: {
    borderWidth: 1,
    borderColor: uiColors.actionPrimarySubtleBorder,
    backgroundColor: uiColors.actionPrimarySubtleBg,
    borderRadius: uiRadius.full,
    paddingVertical: uiSpace.xs,
    paddingHorizontal: uiSpace.sm,
    maxWidth: '100%',
  },
  sessionTagChipDeleted: {
    borderColor: uiColors.borderWarning,
    backgroundColor: uiColors.surfaceWarning,
  },
  sessionTagChipText: {
    fontSize: uiTypography.size.xs,
    color: uiColors.textAccentStrong,
    fontWeight: '600',
    maxWidth: 180,
  },
  sessionMetricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.md,
  },
  sessionMetric: {
    minWidth: 90,
    gap: uiSpace.xs,
  },
  sessionMetricLabel: {
    fontSize: uiTypography.size.xs,
    color: uiColors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sessionMetricValue: {
    fontSize: uiTypography.size.base,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  setTableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopLeftRadius: uiRadius.sm,
    borderTopRightRadius: uiRadius.sm,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfacePage,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.sm,
  },
  setTableHeaderCell: {
    color: uiColors.textSecondary,
    fontSize: uiTypography.size.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  setTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    borderTopWidth: 0,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.sm,
    backgroundColor: uiColors.surfaceDefault,
  },
  setTableRowNonWorking: {
    backgroundColor: uiColors.surfaceMuted,
  },
  setTableCell: {
    color: uiColors.textPrimary,
    fontSize: uiTypography.size.sm,
    fontWeight: '600',
  },
  setTableTypeCell: {
    width: 38,
  },
  setTableIndexCell: {
    width: 36,
  },
  setTableValueCell: {
    flex: 1,
  },
  setTableTypeBadgeWrap: {
    alignItems: 'flex-start',
  },
  setTableTypeBadge: {
    fontSize: uiTypography.size.xs,
    fontWeight: '700',
    color: uiColors.actionPrimary,
    borderWidth: 1,
    borderColor: uiColors.actionPrimarySubtleBorder,
    backgroundColor: uiColors.actionPrimarySubtleBg,
    borderRadius: uiRadius.sm,
    paddingHorizontal: uiSpace.xs,
    paddingVertical: uiSpace.xs,
  },
  setTableTypeBadgeWarmUp: {
    color: uiColors.textWarning,
    backgroundColor: uiColors.surfaceWarning,
    borderColor: uiColors.borderWarning,
  },
  setTableTypeBadgeEmpty: {
    fontSize: uiTypography.size.xs,
    fontWeight: '600',
    color: uiColors.textSecondary,
  },
});
