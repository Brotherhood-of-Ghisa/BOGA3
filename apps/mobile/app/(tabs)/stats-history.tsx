import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { computeStatsSummary, reopenCompletedSessionDraft, type StatsPeriodDays, type StatsSummary } from '@/src/data';
import {
  ActiveSessionRow,
  DEFAULT_SESSION_LIST_DATA_CLIENT,
  DEFAULT_SESSION_LIST_ITEMS,
  HistoryList,
  useSessionListData,
  type SessionListDataClient,
  type SessionListItem,
} from '@/components/session-list';
import { SegmentedChips, uiColors } from '@/components/ui';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { filterIndexedExerciseCatalogExercises } from '@/src/exercise-catalog/search';

const PERIOD_OPTIONS = [
  { value: 7 as StatsPeriodDays, label: 'Last 7 days' },
  { value: 30 as StatsPeriodDays, label: 'Last 30 days' },
] as const;

export type StatsHistoryView = 'stats' | 'history';

const VIEW_OPTIONS: readonly { value: StatsHistoryView; label: string }[] = [
  { value: 'stats', label: 'Stats' },
  { value: 'history', label: 'History' },
];

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
  onPressExerciseHistoryPicker: () => void;
  isLoading: boolean;
  errorMessage: string | null;
};

export function StatsScreenShell({
  summary,
  periodDays,
  onSelectPeriod,
  onPressExerciseHistoryPicker,
  isLoading,
  errorMessage,
}: StatsScreenShellProps) {
  return (
    <View style={styles.screen}>
      <View style={styles.contentRegion}>
        <StatsSubView
          summary={summary}
          periodDays={periodDays}
          onSelectPeriod={onSelectPeriod}
          onPressExerciseHistoryPicker={onPressExerciseHistoryPicker}
          isLoading={isLoading}
          errorMessage={errorMessage}
        />
      </View>
    </View>
  );
}

type StatsSubViewProps = {
  summary: StatsSummary | null;
  periodDays: StatsPeriodDays;
  onSelectPeriod: (period: StatsPeriodDays) => void;
  onPressExerciseHistoryPicker: () => void;
  isLoading: boolean;
  errorMessage: string | null;
};

function StatsSubView({
  summary,
  periodDays,
  onSelectPeriod,
  onPressExerciseHistoryPicker,
  isLoading,
  errorMessage,
}: StatsSubViewProps) {
  const sessionDelta = summary
    ? formatDelta(summary.current.totals.sessionCount, summary.previous.totals.sessionCount)
    : null;
  const setsDelta = summary
    ? formatDelta(summary.current.totals.totalSets, summary.previous.totals.totalSets)
    : null;

  const previousByMuscleId = useMemo(() => {
    const map = new Map<string, number>();
    if (summary) {
      for (const entry of summary.previous.totals.setsByMuscleGroup) {
        map.set(entry.muscleGroupId, entry.score);
      }
    }
    return map;
  }, [summary]);

  return (
    <View style={styles.subViewRegion}>
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
              <SummaryCard
                testID="stats-card-sessions"
                label="Sessions"
                value={formatNumber(summary.current.totals.sessionCount)}
                delta={sessionDelta}
              />
              <SummaryCard
                testID="stats-card-sets"
                label="Working sets"
                value={formatNumber(summary.current.totals.totalSets)}
                delta={setsDelta}
              />
            </View>

            <View style={styles.exerciseHistorySection}>
              <Text style={styles.sectionTitle}>Per-exercise history</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Pick an exercise to view its history"
                onPress={onPressExerciseHistoryPicker}
                style={styles.exerciseHistoryRow}
                testID="stats-exercise-history-picker-button">
                <View style={styles.exerciseHistoryRowText}>
                  <Text style={styles.exerciseHistoryRowTitle}>Pick an exercise…</Text>
                  <Text style={styles.exerciseHistoryRowSubtitle}>
                    Progression, top sets, and per-tag drill-down for one exercise.
                  </Text>
                </View>
                <Text style={styles.exerciseHistoryRowChevron}>›</Text>
              </Pressable>
            </View>

            <View style={styles.muscleSection}>
              <View style={styles.muscleSectionHeader}>
                <Text style={styles.sectionTitle}>Sets per muscle group</Text>
                <Text style={styles.sectionHint}>primary = 1.0 · secondary = 0.5</Text>
              </View>

              {summary.current.totals.setsByMuscleGroup.length === 0 ? (
                <View style={styles.statePanel} testID="stats-muscle-empty">
                  <Text style={styles.stateBody}>
                    No muscle taxonomy loaded yet. Add some exercises to see this section.
                  </Text>
                </View>
              ) : (
                <View style={styles.muscleList}>
                  {summary.current.totals.setsByMuscleGroup.map((entry) => {
                    const previousScore = previousByMuscleId.get(entry.muscleGroupId) ?? 0;
                    const untrained = entry.score === 0;
                    const delta = formatDelta(entry.score, previousScore);
                    return (
                      <View
                        key={entry.muscleGroupId}
                        style={[styles.muscleRow, untrained && styles.muscleRowUntrained]}
                        testID={`stats-muscle-row-${entry.muscleGroupId}`}>
                        <View style={styles.muscleLabelColumn}>
                          <Text
                            style={[
                              styles.muscleName,
                              untrained && styles.muscleNameUntrained,
                            ]}>
                            {entry.displayName}
                          </Text>
                          <Text style={styles.muscleFamily}>{entry.familyName}</Text>
                        </View>
                        <View style={styles.muscleScoreColumn}>
                          <Text
                            style={[
                              styles.muscleScore,
                              untrained && styles.muscleScoreUntrained,
                            ]}>
                            {untrained ? 'Not trained' : formatNumber(entry.score)}
                          </Text>
                          {!untrained || previousScore > 0 ? (
                            <Text style={[styles.muscleDelta, deltaToneStyle(delta.tone)]}>
                              {delta.text}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function SummaryCard({
  testID,
  label,
  value,
  delta,
}: {
  testID: string;
  label: string;
  value: string;
  delta: DeltaDisplay | null;
}) {
  return (
    <View style={styles.summaryCard} testID={testID}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
      {delta ? (
        <Text style={[styles.summaryDelta, deltaToneStyle(delta.tone)]}>{delta.text}</Text>
      ) : null}
    </View>
  );
}

export type HistorySubViewProps = {
  dataClient?: SessionListDataClient;
  initialSessions?: SessionListItem[];
  reloadToken?: number;
};

export function HistorySubView({
  dataClient,
  initialSessions = DEFAULT_SESSION_LIST_ITEMS,
  reloadToken = 0,
}: HistorySubViewProps) {
  const router = useRouter();
  const [showDeletedSessions, setShowDeletedSessions] = useState(false);
  const [activeDurationNowMs, setActiveDurationNowMs] = useState(() => Date.now());

  const { sessions, setSessions, isLoadingSessions, loadErrorMessage, reloadSessions } =
    useSessionListData({
      dataClient,
      initialSessions,
      showDeletedSessions,
      reloadToken,
    });

  const activeSession = sessions.find(
    (session) => session.status === 'active' && session.deletedAt === null
  );
  const completedSessions = sessions
    .filter((session) => session.status === 'completed')
    .filter((session) => showDeletedSessions || session.deletedAt === null)
    .sort((left, right) => {
      const leftTime = left.completedAt ? new Date(left.completedAt).getTime() : 0;
      const rightTime = right.completedAt ? new Date(right.completedAt).getTime() : 0;
      return rightTime - leftTime;
    });

  const showGlobalEmptyState =
    !isLoadingSessions && !loadErrorMessage && !activeSession && completedSessions.length === 0;
  const reopenDisabled = Boolean(activeSession);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const intervalId = setInterval(() => {
      setActiveDurationNowMs(Date.now());
    }, 30_000);

    return () => {
      clearInterval(intervalId);
    };
  }, [activeSession]);

  const navigateToSessionRecorder = () => {
    router.push('/session-recorder');
  };

  const completeActiveSession = () => {
    if (dataClient && activeSession) {
      return (async () => {
        await dataClient.completeActiveSession(activeSession.id);
        await reloadSessions();
      })();
    }

    setSessions((currentSessions) =>
      currentSessions.map((session) => {
        if (session.status !== 'active' || session.deletedAt !== null) {
          return session;
        }

        return {
          ...session,
          status: 'completed',
          completedAt: '2026-02-20T18:15:00.000Z',
        };
      })
    );
  };

  const discardActiveSession = () => {
    if (dataClient && activeSession) {
      return (async () => {
        await dataClient.discardActiveSession(activeSession.id);
        await reloadSessions();
      })();
    }

    setSessions((currentSessions) =>
      currentSessions.filter((session) => session.status !== 'active')
    );
  };

  const setCompletedSessionDeleted = (sessionId: string, isDeleted: boolean) => {
    if (dataClient) {
      return (async () => {
        await dataClient.setCompletedSessionDeletedState(sessionId, isDeleted);
        await reloadSessions();
      })();
    }

    setSessions((currentSessions) =>
      currentSessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        return {
          ...session,
          deletedAt: isDeleted ? '2026-02-23T12:00:00.000Z' : null,
        };
      })
    );
  };

  const openCompletedSessionEdit = (sessionId: string) => {
    router.push(`/session-recorder?mode=completed-edit&sessionId=${sessionId}`);
  };

  const reopenCompletedSession = (sessionId: string) => {
    if (activeSession) {
      return;
    }
    if (dataClient) {
      return (async () => {
        await dataClient.reopenCompletedSession(sessionId);
        await reloadSessions();
      })();
    }
    return (async () => {
      await reopenCompletedSessionDraft(sessionId);
      await reloadSessions();
    })();
  };

  const navigateToCompletedSessionDetail = (sessionId: string) => {
    router.push(`/completed-session/${sessionId}`);
  };

  return (
    <View style={styles.subViewRegion} testID="stats-history-history-subview">
      <View style={styles.pinnedTopRegion}>
        {activeSession ? (
          <View style={styles.sectionBlock}>
            <Text selectable style={styles.historyActiveTitle}>
              Active
            </Text>
            <ActiveSessionRow
              session={activeSession}
              nowMs={activeDurationNowMs}
              onResume={navigateToSessionRecorder}
              onComplete={() => {
                void completeActiveSession();
              }}
              onDelete={() => {
                void discardActiveSession();
              }}
            />
          </View>
        ) : null}
      </View>

      <HistoryList
        sessions={completedSessions}
        isLoading={isLoadingSessions}
        loadErrorMessage={loadErrorMessage}
        showDeletedSessions={showDeletedSessions}
        onToggleShowDeletedSessions={() => setShowDeletedSessions((current) => !current)}
        showGlobalEmptyState={showGlobalEmptyState}
        onOpenCompletedSession={navigateToCompletedSessionDetail}
        onSetCompletedSessionDeleted={setCompletedSessionDeleted}
        onEditCompletedSession={openCompletedSessionEdit}
        onReopenCompletedSession={reopenCompletedSession}
        reopenDisabled={reopenDisabled}
      />
    </View>
  );
}

export type StatsHistoryScreenShellProps = {
  // Stats sub-view inputs
  summary: StatsSummary | null;
  periodDays: StatsPeriodDays;
  onSelectPeriod: (period: StatsPeriodDays) => void;
  onPressExerciseHistoryPicker: () => void;
  isLoading: boolean;
  errorMessage: string | null;
  // History sub-view dependencies (optional so tests can omit them)
  historyDataClient?: SessionListDataClient;
  historyInitialSessions?: SessionListItem[];
  historyReloadToken?: number;
  // Toggle wiring
  activeView: StatsHistoryView;
  onChangeView: (next: StatsHistoryView) => void;
};

export function StatsHistoryScreenShell({
  summary,
  periodDays,
  onSelectPeriod,
  onPressExerciseHistoryPicker,
  isLoading,
  errorMessage,
  historyDataClient,
  historyInitialSessions,
  historyReloadToken,
  activeView,
  onChangeView,
}: StatsHistoryScreenShellProps) {
  return (
    <View style={styles.screen} testID="stats-history-screen">
      <SegmentedChips
        accessibilityLabel="Switch between Stats and History"
        options={VIEW_OPTIONS}
        value={activeView}
        onChange={onChangeView}
        testIDPrefix="stats-history-view-chip"
      />

      <View style={styles.contentRegion}>
        <View
          style={[styles.subViewSlot, activeView === 'stats' ? null : styles.subViewHidden]}
          pointerEvents={activeView === 'stats' ? 'auto' : 'none'}
          testID="stats-history-stats-slot">
          <StatsSubView
            summary={summary}
            periodDays={periodDays}
            onSelectPeriod={onSelectPeriod}
            onPressExerciseHistoryPicker={onPressExerciseHistoryPicker}
            isLoading={isLoading}
            errorMessage={errorMessage}
          />
        </View>

        <View
          style={[styles.subViewSlot, activeView === 'history' ? null : styles.subViewHidden]}
          pointerEvents={activeView === 'history' ? 'auto' : 'none'}
          testID="stats-history-history-slot">
          <HistorySubView
            dataClient={historyDataClient}
            initialSessions={historyInitialSessions}
            reloadToken={historyReloadToken}
          />
        </View>
      </View>
    </View>
  );
}

export default function StatsRoute() {
  const router = useRouter();
  const [activeView, setActiveView] = useState<StatsHistoryView>('stats');
  const [periodDays, setPeriodDays] = useState<StatsPeriodDays>(7);
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isExercisePickerVisible, setIsExercisePickerVisible] = useState(false);
  const [exercisePickerQuery, setExercisePickerQuery] = useState('');
  const [historyReloadToken, setHistoryReloadToken] = useState(0);

  const loadSummary = useCallback(
    async (period: StatsPeriodDays) => {
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
    },
    []
  );

  useFocusEffect(
    useCallback(() => {
      void loadSummary(periodDays);
      // Bump the history reload token on every focus so the History sub-view
      // matches the standalone session-list screen's refresh-on-focus behavior.
      setHistoryReloadToken((current) => current + 1);
    }, [loadSummary, periodDays])
  );

  const handleSelectPeriod = useCallback(
    (next: StatsPeriodDays) => {
      setPeriodDays(next);
      void loadSummary(next);
    },
    [loadSummary]
  );

  const openExercisePicker = useCallback(() => {
    setExercisePickerQuery('');
    setIsExercisePickerVisible(true);
  }, []);

  const closeExercisePicker = useCallback(() => {
    setIsExercisePickerVisible(false);
  }, []);

  const handleSelectExerciseHistoryTarget = useCallback(
    (exerciseDefinitionId: string) => {
      setIsExercisePickerVisible(false);
      router.push(`/exercise-history?exerciseDefinitionId=${encodeURIComponent(exerciseDefinitionId)}`);
    },
    [router]
  );

  return (
    <>
      <StatsHistoryScreenShell
        summary={summary}
        periodDays={periodDays}
        onSelectPeriod={handleSelectPeriod}
        onPressExerciseHistoryPicker={openExercisePicker}
        isLoading={isLoading}
        errorMessage={errorMessage}
        historyDataClient={DEFAULT_SESSION_LIST_DATA_CLIENT}
        historyReloadToken={historyReloadToken}
        activeView={activeView}
        onChangeView={setActiveView}
      />
      <ExerciseHistoryPickerModal
        visible={isExercisePickerVisible}
        searchValue={exercisePickerQuery}
        onChangeSearch={setExercisePickerQuery}
        onRequestClose={closeExercisePicker}
        onSelectExercise={handleSelectExerciseHistoryTarget}
      />
    </>
  );
}

const PICKER_DEBOUNCE_MS = 150;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debouncedValue;
}

function ExerciseHistoryPickerModal({
  visible,
  searchValue,
  onChangeSearch,
  onRequestClose,
  onSelectExercise,
}: {
  visible: boolean;
  searchValue: string;
  onChangeSearch: (next: string) => void;
  onRequestClose: () => void;
  onSelectExercise: (exerciseDefinitionId: string) => void;
}) {
  const catalog = useExerciseCatalog();
  const debouncedQuery = useDebouncedValue(searchValue, PICKER_DEBOUNCE_MS);
  const activeExercises = useMemo(
    () => catalog.exercises.filter((exercise) => !exercise.deletedAt),
    [catalog.exercises]
  );
  const filteredExercises = useMemo(
    () => filterIndexedExerciseCatalogExercises(activeExercises, debouncedQuery),
    [activeExercises, debouncedQuery]
  );
  const isLoading = catalog.status === 'idle' || catalog.status === 'loading';
  const loadError = catalog.status === 'error' ? catalog.lastError ?? 'Unable to load exercise catalog.' : null;

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onRequestClose}>
      <View style={styles.pickerRoot}>
        <Pressable
          accessibilityLabel="Dismiss exercise picker"
          style={styles.pickerOverlay}
          onPress={onRequestClose}
        />
        <View style={styles.pickerCard} testID="stats-exercise-history-picker-modal">
          <Text style={styles.pickerTitle}>Pick an exercise</Text>
          <TextInput
            accessibilityLabel="Exercise picker filter input"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Filter by exercise or muscle group"
            value={searchValue}
            onChangeText={onChangeSearch}
            style={styles.pickerSearchInput}
          />
          <ScrollView style={styles.pickerScroll} contentContainerStyle={styles.pickerScrollContent}>
            {loadError ? (
              <Text style={styles.pickerErrorText}>{loadError}</Text>
            ) : isLoading && filteredExercises.length === 0 ? (
              <Text style={styles.pickerHelperText}>Loading exercise catalog…</Text>
            ) : filteredExercises.length === 0 ? (
              <Text style={styles.pickerHelperText}>
                {activeExercises.length === 0
                  ? 'No active exercises yet. Create one from the Exercises tab first.'
                  : 'No exercises match that filter.'}
              </Text>
            ) : (
              filteredExercises.map((exercise) => (
                <Pressable
                  key={exercise.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open history for ${exercise.name}`}
                  onPress={() => onSelectExercise(exercise.id)}
                  style={styles.pickerRow}
                  testID={`stats-exercise-history-picker-row-${exercise.id}`}>
                  <Text numberOfLines={1} style={styles.pickerRowText}>
                    {exercise.name}
                  </Text>
                </Pressable>
              ))
            )}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel exercise picker"
            onPress={onRequestClose}
            style={styles.pickerCancelButton}>
            <Text style={styles.pickerCancelButtonText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiColors.surfacePage,
    padding: 16,
    gap: 12,
  },
  contentRegion: {
    flex: 1,
    minHeight: 0,
  },
  subViewSlot: {
    ...StyleSheet.absoluteFillObject,
  },
  subViewHidden: {
    display: 'none',
  },
  subViewRegion: {
    flex: 1,
    minHeight: 0,
    gap: 12,
  },
  pinnedTopRegion: {
    gap: 8,
    flexShrink: 0,
  },
  sectionBlock: {
    gap: 8,
  },
  historyActiveTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: uiColors.textPrimary,
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
  muscleSection: {
    gap: 8,
  },
  muscleSectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  sectionHint: {
    fontSize: 11,
    color: uiColors.textSecondary,
  },
  muscleList: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    overflow: 'hidden',
  },
  muscleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: uiColors.borderMuted,
    gap: 12,
  },
  muscleRowUntrained: {
    backgroundColor: uiColors.surfaceWarning,
  },
  muscleLabelColumn: {
    flex: 1,
    minWidth: 0,
  },
  muscleName: {
    fontSize: 14,
    fontWeight: '600',
    color: uiColors.textPrimary,
  },
  muscleNameUntrained: {
    color: uiColors.textWarning,
  },
  muscleFamily: {
    fontSize: 11,
    color: uiColors.textSecondary,
    marginTop: 2,
  },
  muscleScoreColumn: {
    alignItems: 'flex-end',
    gap: 2,
  },
  muscleScore: {
    fontSize: 15,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  muscleScoreUntrained: {
    fontSize: 12,
    fontWeight: '600',
    color: uiColors.textWarning,
  },
  muscleDelta: {
    fontSize: 11,
    fontWeight: '600',
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
  exerciseHistorySection: {
    gap: 8,
  },
  exerciseHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  exerciseHistoryRowText: {
    flex: 1,
    gap: 2,
  },
  exerciseHistoryRowTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  exerciseHistoryRowSubtitle: {
    fontSize: 12,
    color: uiColors.textSecondary,
  },
  exerciseHistoryRowChevron: {
    fontSize: 22,
    fontWeight: '700',
    color: uiColors.textSecondary,
  },
  pickerRoot: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  pickerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrim,
  },
  pickerCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: 14,
    gap: 10,
    maxHeight: '85%',
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  pickerSearchInput: {
    borderWidth: 1,
    borderColor: uiColors.borderInputStrong,
    borderRadius: 8,
    backgroundColor: uiColors.surfaceDefault,
    color: uiColors.textPrimary,
    paddingHorizontal: 10,
    paddingVertical: 9,
    minHeight: 42,
  },
  pickerScroll: {
    maxHeight: 360,
  },
  pickerScrollContent: {
    gap: 6,
    paddingVertical: 4,
  },
  pickerRow: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfacePage,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pickerRowText: {
    fontSize: 14,
    fontWeight: '600',
    color: uiColors.textPrimary,
  },
  pickerHelperText: {
    fontSize: 13,
    color: uiColors.textSecondary,
  },
  pickerErrorText: {
    fontSize: 13,
    fontWeight: '600',
    color: uiColors.actionDangerText,
  },
  pickerCancelButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
  },
  pickerCancelButtonText: {
    color: uiColors.textPrimary,
    fontWeight: '700',
  },
});
