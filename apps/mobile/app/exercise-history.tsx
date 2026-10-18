import { formatOneRepMax, formatWeight } from '@/src/exercise-calculations/format';
import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import { canonicalizeWeightForReps } from '@/src/exercise-calculations/set-semantics';
import { formatVolumeFigure } from '@/src/exercise-calculations/analytics';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ExerciseSetsCard } from '@/components/session-detail';
import { MainTabBar } from '@/components/navigation/main-tab-bar';
import { useOpenMainTab } from '@/components/navigation/use-open-main-tab';
import {
  Card,
  ChipGroup,
  Icon,
  IconButton,
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
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import {
  ALL_GYMS_LABEL,
  decodeGymRouteParam,
  encodeGymRouteParam,
  gymScopeLabel,
  showsGymPicker,
} from '@/src/utils/gym-scope-route';
import { mainTabHref, type MainTabKey } from '@/src/navigation/main-tabs';
import {
  EMPTY_FIGURE,
  formatSetRow,
} from '@/src/session-recorder/session-view-model';

const PERIOD_OPTIONS: { value: ExerciseHistoryPeriod; label: string; accessibilityLabel: string }[] = [
  { value: 7, label: 'Last 7 days', accessibilityLabel: 'Show history for Last 7 days' },
  { value: 30, label: 'Last 30 days', accessibilityLabel: 'Show history for Last 30 days' },
  { value: 'all', label: 'All time', accessibilityLabel: 'Show history for All time' },
];

// The tag filter's "no filter" chip. Tag ids are generated, never this.
const ALL_TAGS = 'all';
// The gym filter's "every gym" chip. The other chips carry the route encoding
// (`encodeGymRouteParam`), so the no-gym chip is the reserved value.
const ALL_GYMS = 'all-gyms';

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
  set ? `${formatWeight(set.weight)} × ${set.reps}` : EMPTY_FIGURE;

const formatOptionalOneRepMax = (value: number | null) =>
  value === null ? EMPTY_FIGURE : formatOneRepMax(value);


// A deleted tag still filters, and says so in words.
const formatTagName = (tag: ExerciseHistoryTagOption) =>
  tag.deletedAt ? `${tag.name} (deleted)` : tag.name;

export type ExerciseHistoryScreenShellProps = {
  summary: ExerciseHistorySummary | null;
  period: ExerciseHistoryPeriod;
  appliedTagDefinitionId: string | null;
  /** Unset: every gym. `null`: the sessions with no gym. Otherwise that gym. */
  appliedGymId?: string | null;
  isLoading: boolean;
  errorMessage: string | null;
  onSelectPeriod: (period: ExerciseHistoryPeriod) => void;
  onSelectTag: (tagDefinitionId: string | null) => void;
  /** Three-state, as `appliedGymId`. */
  onSelectGym?: (gymId: string | null | undefined) => void;
  onPressSession: (sessionId: string) => void;
  activeMainTab?: MainTabKey;
  onSelectMainTab: (tab: MainTabKey) => void;
};

export function ExerciseHistoryScreenShell({
  summary,
  period,
  appliedTagDefinitionId,
  appliedGymId,
  isLoading,
  errorMessage,
  onSelectPeriod,
  onSelectTag,
  onSelectGym,
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
  const gymOptions = summary?.gymOptions ?? [];
  const gymLabel = appliedGymId === undefined ? null : gymScopeLabel(appliedGymId, gymOptions);

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

        {summary && onSelectGym ? (
          <GymChipRow appliedGymId={appliedGymId} onSelectGym={onSelectGym} options={gymOptions} />
        ) : null}

        {summary && tagOptions.length > 0 ? (
          <ScrollView
            contentContainerStyle={styles.tagRowContent}
            style={styles.chipScroll}
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

            <BestCard best={summary.allTimeBest} gymLabel={gymLabel} onPressSession={onPressSession} />

            {summary.sessions.length === 0 ? (
              <Card>
                <StatePanel
                  body={
                    appliedGymId === null
                      ? 'No completed sessions without a gym in this period.'
                      : appliedGymId !== undefined
                      ? 'No completed sessions for this gym in this period.'
                      : appliedTagDefinitionId
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

      <MainTabBar activeTab={activeMainTab} onSelect={onSelectMainTab} />
    </Screen>
  );
}

// The gym filter ([[gym.view-filter]]): single-choice chips like the tags',
// `All gyms` first; drawn as `showsGymPicker` says.
function GymChipRow({
  options,
  appliedGymId,
  onSelectGym,
}: {
  options: ExerciseHistorySummary['gymOptions'];
  appliedGymId: string | null | undefined;
  onSelectGym: (gymId: string | null | undefined) => void;
}) {
  if (!showsGymPicker(appliedGymId, options)) return null;
  const chips: ChipOption<string>[] = [
    { value: ALL_GYMS, label: ALL_GYMS_LABEL },
    ...options.map((option) => ({
      value: encodeGymRouteParam(option.gymId) as string,
      label: `${option.name} · ${option.occurrenceCount}`,
      accessibilityLabel: `Filter by gym ${option.name}, ${option.occurrenceCount} sessions`,
    })),
  ];
  return (
    <ScrollView
      contentContainerStyle={styles.tagRowContent}
      style={styles.chipScroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      testID="exercise-history-gym-row">
      <ChipGroup
        accessibilityLabel="Filter by gym"
        clearValue={ALL_GYMS}
        mode="single"
        onChange={(next) => onSelectGym(next === ALL_GYMS ? undefined : decodeGymRouteParam(next))}
        options={chips}
        style={styles.tagChips}
        testIDPrefix="exercise-history-gym-chip"
        value={encodeGymRouteParam(appliedGymId) ?? ALL_GYMS}
      />
    </ScrollView>
  );
}

// The exercise's all-time bests: two rows that open the session holding each.
// The figures are in `record`, the one superlative. With a gym chosen they are
// that gym's, and the label names it.
function BestCard({
  best,
  gymLabel,
  onPressSession,
}: {
  best: ExerciseHistorySummary['allTimeBest'];
  gymLabel: string | null;
  onPressSession: (sessionId: string) => void;
}) {
  const oneRm = best.estimatedOneRepMax;
  const topWeight = best.topWeight;
  return (
    <Card testID="exercise-history-best-card">
      <Text allowFontScaling={false} style={styles.cardLabel} testID="exercise-history-best-label">
        {gymLabel ? `All-time bests · ${gymLabel}` : 'All-time bests'}
      </Text>
      <BestRow
        date={oneRm ? formatSessionDate(oneRm.completedAt) : null}
        divider={false}
        label="1RM"
        onPress={oneRm ? () => onPressSession(oneRm.sessionId) : undefined}
        testID="exercise-history-best-est-1rm"
        value={formatOptionalOneRepMax(oneRm?.value ?? null)}
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

// One session's sets of this exercise: View Session's card and rows,
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
      weight: parseSetWeight(canonicalizeWeightForReps(set.weightValue, set.repsValue)),
      loadContext: entry.loadContext,
      reps: parseSetReps(set.repsValue),
      setType: set.setType,
      done: true,
    })
  );

  return (
    <ExerciseSetsCard
      accessibilityLabel={`Open session from ${date}`}
      count={`${entry.workingSetCount} ${entry.workingSetCount === 1 ? 'set' : 'sets'}`}
      name={date}
      nameFace="figure"
      onPress={onPress}
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
            <Stat label="1RM" rank="secondary" value={formatOptionalOneRepMax(entry.estimatedOneRepMax)} />
            <Stat label="Top set" rank="secondary" value={formatTopSet(entry.topWeightSet)} />
            <Stat label="Vol" rank="secondary" value={formatVolumeFigure(entry.totalVolume)} />
            <Stat label="Sets" rank="secondary" value={String(entry.workingSetCount)} />
          </View>
        </View>
      }
      testID={`exercise-history-session-card-${entry.sessionExerciseId}`}
    />
  );
}

export default function ExerciseHistoryRoute() {
  const router = useRouter();
  const openMainTab = useOpenMainTab(useCallback((href: Href) => router.push(href), [router]));
  const params = useLocalSearchParams<{
    exerciseDefinitionId?: string | string[];
    tagDefinitionId?: string | string[];
    period?: string | string[];
    gymId?: string | string[];
    currentGymId?: string | string[];
  }>();
  const [listPreferences] = useExerciseListPreferences();

  const exerciseDefinitionId = coerceRouteParam(params.exerciseDefinitionId);
  const initialTagDefinitionId = coerceRouteParam(params.tagDefinitionId);
  const initialPeriod = parsePeriodParam(coerceRouteParam(params.period));

  // One gym filter, three-state over the route boundary
  // (`src/utils/gym-scope-route.ts`): the chip's gym, else the gym the reader
  // came from under `Current gym only`, else every gym. A session with no gym
  // has no current gym to narrow to, so the filter stays off there.
  // A chip the reader picks here wins over all three.
  const routeGymId = decodeGymRouteParam(coerceRouteParam(params.gymId));
  const routeCurrentGymId = coerceRouteParam(params.currentGymId);
  const [chosenGym, setChosenGym] = useState<{ gymId: string | null | undefined } | null>(null);
  const appliedGymId: string | null | undefined =
    chosenGym !== null
      ? chosenGym.gymId
      : routeGymId !== undefined
        ? routeGymId
        : listPreferences.pastRecordsGymScope === 'current-gym' && routeCurrentGymId
          ? routeCurrentGymId
          : undefined;

  const [period, setPeriod] = useState<ExerciseHistoryPeriod>(initialPeriod);
  const [appliedTagDefinitionId, setAppliedTagDefinitionId] = useState<string | null>(
    initialTagDefinitionId
  );
  const [summary, setSummary] = useState<ExerciseHistorySummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const datedWeightRevision = useBodyWeightContextRevision();
  const loadSummary = useCallback(
    async (
      nextPeriod: ExerciseHistoryPeriod,
      nextTagDefinitionId: string | null,
      nextGymId: string | null | undefined
    ) => {
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
          ...(nextGymId === undefined ? {} : { gymId: nextGymId }),
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
      void loadSummary(period, appliedTagDefinitionId, appliedGymId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- A committed timeline change must reload the focused projection.
    }, [loadSummary, period, appliedTagDefinitionId, appliedGymId, datedWeightRevision])
  );

  const handleSelectPeriod = useCallback(
    (next: ExerciseHistoryPeriod) => {
      setPeriod(next);
      void loadSummary(next, appliedTagDefinitionId, appliedGymId);
    },
    [loadSummary, appliedTagDefinitionId, appliedGymId]
  );

  const handleSelectTag = useCallback(
    (next: string | null) => {
      setAppliedTagDefinitionId(next);
      void loadSummary(period, next, appliedGymId);
    },
    [loadSummary, period, appliedGymId]
  );

  const handleSelectGym = useCallback(
    (next: string | null | undefined) => {
      setChosenGym({ gymId: next });
      void loadSummary(period, appliedTagDefinitionId, next);
    },
    [loadSummary, period, appliedTagDefinitionId]
  );

  const title = summary?.exerciseName ?? 'Exercise History';

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerBackVisible: false,
          // The native back item can stop dispatching on iOS 26.4 after
          // reaching this screen from an active session (as on Body weight).
          // Draw the shared arrow and pop explicitly.
          headerLeft: () => (
            <IconButton
              name="chevron-left"
              accessibilityLabel="Back"
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace(mainTabHref('progress'))
              }
              testID="exercise-history-back"
            />
          ),
        }}
      />
      <ExerciseHistoryScreenShell
        summary={summary}
        period={period}
        appliedTagDefinitionId={appliedTagDefinitionId}
        appliedGymId={appliedGymId}
        isLoading={isLoading}
        errorMessage={errorMessage}
        onSelectPeriod={handleSelectPeriod}
        onSelectTag={handleSelectTag}
        onSelectGym={handleSelectGym}
        onPressSession={(sessionId) => router.push(`/completed-session/${sessionId}`)}
        onSelectMainTab={openMainTab}
      />
    </>
  );
}

const styles = StyleSheet.create({
  // A chip row is as tall as its chips: a ScrollView grows by default, and
  // inside the page's scroll that stretched the chips into circles.
  chipScroll: {
    flexGrow: 0,
  },
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
