import { useAccountLocalPreferenceState, useDateFormat } from '@/src/preferences/hooks';
import { formatLocalDateTime } from '@/src/utils/local-time';
import { formatOneRepMax, formatWeight } from '@/src/exercise-calculations/format';
import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import { canonicalizeWeightForReps } from '@/src/exercise-calculations/set-semantics';
import { formatVolumeFigure } from '@/src/exercise-calculations/analytics';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
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
  type ExerciseHistorySessionEntry,
  type ExerciseHistorySummary,
  type ExerciseHistoryTagOption,
} from '@/src/data';
import { parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { GymPickerButton, GymPickerSheet } from '@/components/gyms/gym-picker';
import { decodeGymRouteParam, gymScopeLabel } from '@/src/utils/gym-scope-route';
import { mainTabHref, type MainTabKey } from '@/src/navigation/main-tabs';
import { historyBlockRecord } from '@/src/session-recorder/exercise-history-view';
import {
  cardRecordBand,
  EMPTY_FIGURE,
  formatSetRow,
  recordFlagsFor,
} from '@/src/session-recorder/session-view-model';

type ExerciseHistoryPeriod = 'week' | 'progress' | 'history';

// The tag filter's "no filter" chip. Tag ids are generated, never this.
const ALL_TAGS = 'all';

const coerceRouteParam = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
};

const parsePeriodParam = (raw: string | null): ExerciseHistoryPeriod => {
  if (raw === '7' || raw === 'week') return 'week';
  return raw === 'progress' ? 'progress' : 'history';
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
  onPressSession,
  activeMainTab = 'progress',
  onSelectMainTab,
}: ExerciseHistoryScreenShellProps) {
  const { values } = useAccountLocalPreferenceState();
  const periodOptions = [
    { value: 'week' as const, label: 'This week' },
    { value: 'progress' as const, label: `Progress (${values.targetWindowWeeks}w)`, accessibilityLabel: `Progress period, ${values.targetWindowWeeks} weeks` },
    { value: 'history' as const, label: `History (${values.historyLookbackWeeks}w)`, accessibilityLabel: `History look-back, ${values.historyLookbackWeeks} weeks` },
  ];
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
          density="compact"
          layout="fit"
          onChange={onSelectPeriod}
          options={periodOptions}
          testIDPrefix="exercise-history-period-chip"
          value={period}
        />

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
  const dateFormat = useDateFormat();
  const oneRm = best.estimatedOneRepMax;
  const topWeight = best.topWeight;
  return (
    <Card testID="exercise-history-best-card">
      <Text allowFontScaling={false} style={styles.cardLabel} testID="exercise-history-best-label">
        {gymLabel ? `All-time bests · ${gymLabel}` : 'All-time bests'}
      </Text>
      <BestRow
        date={oneRm ? formatLocalDateTime(oneRm.completedAt.getTime(), dateFormat) : null}
        divider={false}
        label="1RM"
        onPress={oneRm ? () => onPressSession(oneRm.sessionId) : undefined}
        testID="exercise-history-best-est-1rm"
        value={formatOptionalOneRepMax(oneRm?.value ?? null)}
      />
      <BestRow
        date={topWeight ? formatLocalDateTime(topWeight.completedAt.getTime(), dateFormat) : null}
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
  const dateFormat = useDateFormat();
  const date = formatLocalDateTime(entry.completedAt.getTime(), dateFormat);
  const tags = entry.tagIds
    .map((id) => tagOptions.find((tag) => tag.tagDefinitionId === id))
    .filter((tag): tag is ExerciseHistoryTagOption => tag !== undefined);
  // The records the session took when it was completed, in the book the gym
  // filter names ([[gym.split]]), drawn as View Session draws
  // them ([[set.row-figures]]).
  const record = historyBlockRecord(entry);
  // Warm-ups read like working sets: the type column names them.
  const rows = entry.sets.map((set) =>
    formatSetRow({
      id: set.setId,
      weight: parseSetWeight(canonicalizeWeightForReps(set.weightValue, set.repsValue)),
      loadContext: entry.loadContext,
      reps: parseSetReps(set.repsValue),
      setType: set.setType,
      done: true,
      ...recordFlagsFor(record, set.setId),
    })
  );

  return (
    <ExerciseSetsCard
      accessibilityLabel={`Open session from ${date}`}
      count={`${entry.workingSetCount} ${entry.workingSetCount === 1 ? 'set' : 'sets'}`}
      name={date}
      nameFace="figure"
      onPress={onPress}
      record={cardRecordBand(record, entry.sessionExerciseId)}
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
  const { values: { targetWindowWeeks, historyLookbackWeeks }, accountRevision } = useAccountLocalPreferenceState();

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
  const readGeneration = useRef(0);

  const datedWeightRevision = useBodyWeightContextRevision();
  const loadSummary = useCallback(
    async (
      nextPeriod: ExerciseHistoryPeriod,
      nextTagDefinitionId: string | null,
      nextGymId: string | null | undefined
    ) => {
      const generation = ++readGeneration.current;
      if (!exerciseDefinitionId) {
        setSummary(null);
        setIsLoading(false);
        setErrorMessage('Missing exerciseDefinitionId in route');
        return;
      }
      setIsLoading(true);
      setSummary(null);
      setErrorMessage(null);
      try {
        const next = await loadExercisePerformanceHistory({
          exerciseDefinitionId,
          period: { weeks: nextPeriod === 'week' ? 1 : nextPeriod === 'progress' ? targetWindowWeeks : historyLookbackWeeks,
            kind: nextPeriod === 'history' ? 'history' : 'progress' },
          tagDefinitionId: nextTagDefinitionId,
          ...(nextGymId === undefined ? {} : { gymId: nextGymId }),
        });
        if (generation !== readGeneration.current) return;
        if (next === null) {
          setSummary(null);
          setErrorMessage('Exercise not found.');
        } else {
          setSummary(next);
        }
      } catch (error) {
        if (generation === readGeneration.current) setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
      } finally {
        if (generation === readGeneration.current) setIsLoading(false);
      }
    },
    [exerciseDefinitionId, targetWindowWeeks, historyLookbackWeeks]
  );

  useFocusEffect(
    useCallback(() => {
      void loadSummary(period, appliedTagDefinitionId, appliedGymId);
      return () => { readGeneration.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- A committed timeline change must reload the focused projection.
    }, [loadSummary, period, appliedTagDefinitionId, appliedGymId, datedWeightRevision, accountRevision])
  );

  const handleSelectGym = useCallback((gymId: string | null | undefined) => setChosenGym({ gymId }), []);

  const [gymSheetVisible, setGymSheetVisible] = useState(false);
  const gymOptions = useMemo(() => (summary?.gymOptions ?? []).map((option) => ({
    gymId: option.gymId,
    name: option.gymId === null ? null : option.name,
    sessionCount: option.occurrenceCount,
  })), [summary]);

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
          // The gym button ([[gym.view-filter]]) lives in the header, so the
          // page adds no row for it. Named either way: options merge across renders.
          headerRight: summary ? () => (
            <GymPickerButton onPress={() => setGymSheetVisible(true)} options={gymOptions} size="compact"
              testID="exercise-history-gym" value={appliedGymId} />
          ) : undefined,
        }}
      />
      <GymPickerSheet onChange={handleSelectGym} onClose={() => setGymSheetVisible(false)} options={gymOptions}
        testID="exercise-history-gym" value={appliedGymId} visible={gymSheetVisible} />
      <ExerciseHistoryScreenShell
        summary={summary}
        period={period}
        appliedTagDefinitionId={appliedTagDefinitionId}
        appliedGymId={appliedGymId}
        isLoading={isLoading}
        errorMessage={errorMessage}
        onSelectPeriod={setPeriod}
        onSelectTag={setAppliedTagDefinitionId}
        onPressSession={(sessionId) => router.push(`/completed-session/${sessionId}`)}
        onSelectMainTab={openMainTab}
      />
    </>
  );
}

const styles = StyleSheet.create({
  // A chip row is as tall as its chips: a ScrollView grows by default, and
  // inside the page's scroll that stretched them into circles.
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
