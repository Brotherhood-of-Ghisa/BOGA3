import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ExerciseSetsCard } from '@/components/session-detail';
import { MainTabs } from '@/components/navigation/main-tabs';
import {
  Card,
  ChipGroup,
  Icon,
  ListRow,
  Notice,
  Screen,
  ScreenScroll,
  SegmentedControl,
  Stat,
  StatePanel,
  Tag,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
  type ChipOption,
} from '@/components/ui';
import {
  loadExercisePerformanceHistory,
  type ExerciseHistoryPeriod,
  type ExerciseHistorySessionEntry,
  type ExerciseHistorySummary,
  type ExerciseHistoryTagOption,
} from '@/src/data';
import { parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
import { mainTabHref, type MainTabKey } from '@/src/navigation/main-tabs';
import {
  EMPTY_FIGURE,
  formatOneRepMaxFigure,
  formatSetRow,
  formatVolumeFigure,
  formatWeightFigure,
} from '@/src/session-recorder/session-view-model';

const PERIOD_OPTIONS: { value: ExerciseHistoryPeriod; label: string; accessibilityLabel: string }[] = [
  { value: 7, label: 'Last 7 days', accessibilityLabel: 'Show history for Last 7 days' },
  { value: 30, label: 'Last 30 days', accessibilityLabel: 'Show history for Last 30 days' },
  { value: 'all', label: 'All time', accessibilityLabel: 'Show history for All time' },
];

// The tag filter's "no filter" chip. Tag ids are generated, never this.
const ALL_TAGS = 'all';

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

const formatSessionDate = (value: Date): string => {
  if (Number.isNaN(value.getTime())) return EMPTY_FIGURE;
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  const year = value.getFullYear();
  const hours = `${value.getHours()}`.padStart(2, '0');
  const minutes = `${value.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
};

// Figures read as they do on the session view (`design-language.md` §6).
const formatTopSet = (set: { weight: number; reps: number } | null) =>
  set ? `${formatWeightFigure(set.weight)} × ${set.reps}` : EMPTY_FIGURE;

const formatOneRepMax = (value: number | null) =>
  value === null ? EMPTY_FIGURE : formatOneRepMaxFigure(value);

const formatVolume = (value: number) => (value > 0 ? formatVolumeFigure(value) : EMPTY_FIGURE);

// `ux-rules` §10.2: a deleted tag still filters, and says so in words.
const formatTagName = (tag: ExerciseHistoryTagOption) =>
  tag.deletedAt ? `${tag.name} (deleted)` : tag.name;

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
  const tagOptions = useMemo(() => summary?.tagOptions ?? [], [summary]);
  const tagChips = useMemo<ChipOption<string>[]>(
    () => [
      { value: ALL_TAGS, label: 'All tags' },
      ...tagOptions.map((option) => ({
        value: option.tagDefinitionId,
        label: `${formatTagName(option)} · ${option.occurrenceCount}`,
        accessibilityLabel: `Filter by tag ${formatTagName(option)}, ${option.occurrenceCount} sessions`,
        faint: Boolean(option.deletedAt),
      })),
    ],
    [tagOptions]
  );

  return (
    <Screen testID="exercise-history-screen">
      <ScreenScroll testID="exercise-history-scroll">
        <SegmentedControl
          accessibilityLabel="Time range"
          onChange={onSelectPeriod}
          options={PERIOD_OPTIONS}
          testIDPrefix="exercise-history-period-chip"
          value={period}
        />

        {summary && tagOptions.length > 0 ? (
          <ScrollView
            contentContainerStyle={styles.tagRowContent}
            horizontal
            showsHorizontalScrollIndicator={false}
            testID="exercise-history-tag-row">
            <ChipGroup
              accessibilityLabel="Filter by tag"
              clearValue={ALL_TAGS}
              mode="single"
              onChange={(next) => onSelectTag(next === ALL_TAGS ? null : next)}
              options={tagChips}
              style={styles.tagChips}
              testIDPrefix="exercise-history-tag-chip"
              value={appliedTagDefinitionId ?? ALL_TAGS}
            />
          </ScrollView>
        ) : null}

        {errorMessage ? (
          <Card>
            <StatePanel
              body={errorMessage}
              fill={false}
              kind="error"
              testID="exercise-history-error-state"
              title="Could not load history"
            />
          </Card>
        ) : null}

        {!errorMessage && isLoading && !summary ? (
          <Card>
            <StatePanel
              body="Loading exercise history…"
              fill={false}
              kind="loading"
              testID="exercise-history-loading-state"
            />
          </Card>
        ) : null}

        {summary ? (
          <>
            {summary.exerciseDeletedAt ? (
              <Notice
                icon="warning"
                message="This exercise has been deleted. Historical data remains available."
                testID="exercise-history-deleted-banner"
              />
            ) : null}

            <BestCard best={summary.allTimeBest} onPressSession={onPressSession} />

            {summary.sessions.length === 0 ? (
              <Card>
                <StatePanel
                  body={
                    appliedTagDefinitionId
                      ? 'No sessions in this period have the selected tag. Pick another tag or widen the period.'
                      : 'No completed sessions for this exercise in this period.'
                  }
                  fill={false}
                  testID="exercise-history-empty-state"
                  title="No sessions in this view"
                />
              </Card>
            ) : (
              summary.sessions.map((entry) => (
                <SessionCard
                  entry={entry}
                  key={entry.sessionExerciseId}
                  onPress={() => onPressSession(entry.sessionId)}
                  tagOptions={tagOptions}
                />
              ))
            )}
          </>
        ) : null}
      </ScreenScroll>

      <MainTabs activeTab={activeMainTab} onSelect={onSelectMainTab} />
    </Screen>
  );
}

// The exercise's all-time bests: two rows that open the session holding each.
// The figures are in `record`, the one superlative (T10-D2).
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
    <Card testID="exercise-history-best-card">
      <Text allowFontScaling={false} style={styles.cardLabel}>All-time bests</Text>
      <BestRow
        date={oneRm ? formatSessionDate(oneRm.completedAt) : null}
        divider={false}
        label="1RM"
        onPress={oneRm ? () => onPressSession(oneRm.sessionId) : undefined}
        testID="exercise-history-best-est-1rm"
        value={formatOneRepMax(oneRm?.value ?? null)}
      />
      <BestRow
        date={topWeight ? formatSessionDate(topWeight.completedAt) : null}
        label="Top weight"
        onPress={topWeight ? () => onPressSession(topWeight.sessionId) : undefined}
        testID="exercise-history-best-top-weight"
        value={formatTopSet(topWeight)}
      />
    </Card>
  );
}

function BestRow({
  testID,
  label,
  value,
  date,
  divider = true,
  onPress,
}: {
  testID: string;
  label: string;
  value: string;
  date: string | null;
  divider?: boolean;
  onPress?: () => void;
}) {
  return (
    <ListRow
      accessibilityHint={onPress ? 'Opens the session' : undefined}
      accessibilityLabel={date ? `${label} ${value}, ${date}` : `${label} ${value}`}
      density="list"
      divider={divider}
      label={label}
      meta={
        <View style={styles.bestFigures}>
          <Text
            allowFontScaling={false}
            style={[styles.bestValue, date ? null : styles.bestValueEmpty]}
            testID={`${testID}-value`}>
            {value}
          </Text>
          {date ? <Text allowFontScaling={false} style={styles.bestDate}>{date}</Text> : null}
        </View>
      }
      onPress={onPress}
      testID={testID}
      trailing={onPress ? <Icon color={uiRoles.inkMuted} name="chevron-right" size="sm" /> : null}
    />
  );
}

// One session's sets of this exercise: View Session's card and rows (T10-D1),
// with the session's summary figures above the rows. The card opens View
// Session.
function SessionCard({
  entry,
  tagOptions,
  onPress,
}: {
  entry: ExerciseHistorySessionEntry;
  tagOptions: ExerciseHistoryTagOption[];
  onPress: () => void;
}) {
  const date = formatSessionDate(entry.completedAt);
  const tags = entry.tagIds
    .map((id) => tagOptions.find((tag) => tag.tagDefinitionId === id))
    .filter((tag): tag is ExerciseHistoryTagOption => tag !== undefined);
  // Warm-ups read like working sets: the type column names them.
  const rows = entry.sets.map((set) =>
    formatSetRow({
      id: set.setId,
      weight: parseSetWeight(set.weightValue),
      reps: parseSetReps(set.repsValue),
      setType: set.setType,
      done: true,
    })
  );

  return (
    <ExerciseSetsCard
      accessibilityLabel={`Open session from ${date}`}
      count={`${rows.length} ${rows.length === 1 ? 'set' : 'sets'}`}
      name={date}
      nameFace="figure"
      onPress={onPress}
      recordOneRepMax={null}
      rowTestID={(row) => `exercise-history-set-row-${row.id}`}
      rows={rows}
      summary={
        <View style={styles.sessionSummary}>
          <Text allowFontScaling={false} numberOfLines={1} style={styles.gym}>
            {entry.gymName?.trim() ? entry.gymName : 'No gym'}
          </Text>
          {tags.length > 0 ? (
            <View style={styles.tags}>
              {tags.map((tag) => (
                <Tag key={tag.tagDefinitionId} label={formatTagName(tag)} tone={tag.deletedAt ? 'faint' : 'neutral'} />
              ))}
            </View>
          ) : null}
          <View style={styles.stats}>
            <Stat label="1RM" rank="secondary" value={formatOneRepMax(entry.estimatedOneRepMax)} />
            <Stat label="Top set" rank="secondary" value={formatTopSet(entry.topWeightSet)} />
            <Stat label="Vol" rank="secondary" value={formatVolume(entry.totalVolume)} />
            <Stat label="W/sets" rank="secondary" value={String(entry.workingSetCount)} />
          </View>
        </View>
      }
      testID={`exercise-history-session-card-${entry.sessionExerciseId}`}
    />
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
  tagRowContent: {
    paddingRight: uiSpace.sm,
  },
  // One line that scrolls sideways, not the group's usual wrap.
  tagChips: {
    flexWrap: 'nowrap',
  },
  cardLabel: {
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.sm,
    paddingBottom: uiSpace.xs,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkFaint,
  },
  bestFigures: {
    alignItems: 'flex-end',
  },
  bestValue: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.record,
  },
  bestValueEmpty: {
    fontWeight: '500',
    color: uiRoles.inkFaint,
  },
  bestDate: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
  },
  sessionSummary: {
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingBottom: uiSpace.sm,
  },
  gym: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.xs,
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
});
