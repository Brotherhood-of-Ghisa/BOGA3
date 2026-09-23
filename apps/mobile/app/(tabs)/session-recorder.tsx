import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import {
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useGroupLinkingUserId } from '@/src/groups/use-group-exercise-linking';
import { exerciseLinkHref } from '@/src/navigation/routes';
import {
  ExerciseCardCollapsedSummary,
  SessionContentLayout,
} from '@/components/session-recorder/session-content-layout';
import { ExercisePicker } from '@/components/session-recorder/exercise-picker';
import { ExercisePersonalRecordCelebration } from '@/components/session-recorder/exercise-personal-record-celebration';
import { SessionMuscleLoad } from '@/components/session-recorder/session-muscle-load';
import { uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';
import { getAuthSnapshot } from '@/src/auth';
import {
  SEEDED_LOCATIONS,
  Session,
  SessionExercise,
  SessionExerciseTag,
  SessionLocation,
  SessionRecorderState,
  SessionSet,
} from '@/components/session-recorder/types';
import {
  attachExerciseTagToSessionExercise,
  createExerciseTagDefinition,
  deleteExerciseTagDefinition,
  completeSessionDraft,
  ExerciseTagDomainError,
  listExerciseTagDefinitions,
  listSessionExerciseAssignedTags,
  listLocalGyms,
  loadRecentExerciseBlocks,
  loadLocalGymById,
  loadLatestSessionDraftSnapshot,
  loadSessionSnapshotById,
  persistCompletedSessionSnapshot,
  persistSessionDraftSnapshot,
  removeExerciseTagFromSessionExercise,
  renameExerciseTagDefinition,
  undeleteExerciseTagDefinition,
  upsertLocalGym,
  type ExerciseTagDefinitionRecord,
  type ExerciseBlockHistoryBlock,
  type ExerciseBlockHistorySuggestedPlan,
  type LocalGymLookupRecord,
  type SessionExerciseAssignedTag,
} from '@/src/data';
import {
  SESSION_SET_TYPES,
  isWorkingSessionSetType,
  normalizeSessionSetType,
  type SessionSetType,
  type SessionSetTypeValue,
} from '@/src/data/set-types';
import {
  computeExerciseVolume,
  computeMaxRepsByWeight,
  estimateExerciseOneRepMax,
  parseCalculationSet,
} from '@/src/exercise-calculations';
import { ensureExerciseCatalogLoaded, useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { useExerciseCatalogStats } from '@/src/exercise-catalog/stats-cache';
import { getCurrentForegroundPositionLazy } from '@/src/location/foreground-location-lazy';
import {
  DEFAULT_MAX_POSITION_ACCURACY_M,
  matchNearestGymForPosition,
} from '@/src/location/gym-location-matcher';
import { logEvent } from '@/src/logging';
import { createDraftAutosaveController, type DraftAutosaveController } from '@/src/session-recorder/draft-autosave';
import { createSessionRecorderLifecycleHelpers } from '@/src/session-recorder/lifecycle-helpers';
import {
  appendSuggestedPlan,
  canonicalizeSessionSetWeights,
  createExercise,
  createExerciseId,
  createSetFromPrevious,
  formatCurrentDateTime,
  formatSetRepsLabel,
  formatSetWeightLabel,
  getSetQualityDisplayLabel,
  getSetRowState,
  hasPerformedActual,
  hasPlannedTarget,
  hasSetFieldValidationError,
  mapDraftSnapshotToSession,
  mapSessionGraphSnapshotToSession,
  parseSessionDateTime,
  removeExercisesWithNoSets,
  removeIncompleteSets,
  removeUnconfirmedSets,
  REPS_INPUT_PATTERN,
  SET_TYPE_MENU_LABELS,
  sessionHasInvalidSetValues,
  toCompletedHistorySession,
  toPersistCompletedExercises,
  toPersistDraftExercises,
  WEIGHT_INPUT_PATTERN,
  type PlannedSetRowState,
  type SetFieldName,
} from '@/src/session-recorder/session-model';
import {
  canonicalizeWeightForReps,
  hasValidActualValues,
} from '@/src/session-recorder/set-semantics';
import {
  deriveExercisePersonalRecord,
  summarizeCurrentSessionMuscleLoad,
  type ExercisePersonalRecord,
  type SessionInsightExerciseInput,
} from '@/src/session-insights';
import { isDevMode } from '@/src/utils/isDevMode';

const START_SESSION_GYM_DETECTION_TIMEOUT_MS = 1500;


const coerceRouteParam = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
};

const getDateTimeValidationMessage = (
  startedAtText: string,
  completedAtText: string | null
): string | null => {
  const parsedStart = parseSessionDateTime(startedAtText);
  if (!parsedStart) {
    return 'Enter a valid Start time in YYYY-MM-DD HH:mm format.';
  }

  if (completedAtText === null) {
    return null;
  }

  const parsedEnd = parseSessionDateTime(completedAtText);
  if (!parsedEnd) {
    return 'Enter a valid End time in YYYY-MM-DD HH:mm format.';
  }

  if (parsedEnd.getTime() < parsedStart.getTime()) {
    return 'End time must be later than or equal to Start time.';
  }

  return null;
};

const getCompletedEditStartTimeValidationMessage = (startedAtText: string): string | null => {
  const parsedStart = parseSessionDateTime(startedAtText);
  if (!parsedStart) {
    return 'Enter a valid Start time in YYYY-MM-DD HH:mm format.';
  }

  return null;
};

const getCompletedEditEndTimeValidationMessage = (
  startedAtText: string,
  completedAtText: string | null
): string | null => {
  if (completedAtText === null) {
    return 'Enter a valid End time in YYYY-MM-DD HH:mm format.';
  }

  const parsedEnd = parseSessionDateTime(completedAtText);
  if (!parsedEnd) {
    return 'Enter a valid End time in YYYY-MM-DD HH:mm format.';
  }

  const parsedStart = parseSessionDateTime(startedAtText);
  if (!parsedStart) {
    return null;
  }

  if (parsedEnd.getTime() < parsedStart.getTime()) {
    return 'End time must be later than or equal to Start time.';
  }

  return null;
};

function hasPersistableSessionContent(session: Session): boolean {
  return session.locationId !== null || session.exercises.length > 0;
}


function createInitialState(): SessionRecorderState {
  return {
    session: {
      dateTime: formatCurrentDateTime(new Date()),
      locationId: null,
      exercises: [],
    },
    locations: SEEDED_LOCATIONS,
    pendingLocationName: '',
    gymPickerVisible: false,
    gymModalMode: 'picker',
    editorReturnMode: 'picker',
    showArchivedInManager: false,
    editingLocationId: null,
    editingLocationName: '',
    exercisePickerVisible: false,
    exerciseSelectionTargetId: null,
    exerciseActionMenuVisible: false,
    activeExerciseActionId: null,
  };
}

const SEEDED_LOCATION_NAME_BY_ID = new Map(SEEDED_LOCATIONS.map((location) => [location.id, location.name]));

function mapLocalGymToSessionLocation(gym: LocalGymLookupRecord): SessionLocation {
  return {
    id: gym.id,
    name: gym.name,
    archived: false,
    latitude: gym.latitude,
    longitude: gym.longitude,
    coordinateAccuracyM: gym.coordinateAccuracyM,
    coordinatesUpdatedAt: gym.coordinatesUpdatedAt,
  };
}

function mergeLocalGymsIntoLocations(
  currentLocations: SessionLocation[],
  localGyms: LocalGymLookupRecord[]
): SessionLocation[] {
  let didChange = false;
  const nextLocations = [...currentLocations];

  for (const localGym of localGyms) {
    const existingIndex = nextLocations.findIndex((location) => location.id === localGym.id);

    if (existingIndex === -1) {
      nextLocations.push(mapLocalGymToSessionLocation(localGym));
      didChange = true;
      continue;
    }

    const existing = nextLocations[existingIndex];
    const seededName = SEEDED_LOCATION_NAME_BY_ID.get(existing.id);
    const mergedLocation: SessionLocation = {
      ...existing,
      name: seededName && existing.name === seededName ? localGym.name : existing.name,
      latitude: localGym.latitude,
      longitude: localGym.longitude,
      coordinateAccuracyM: localGym.coordinateAccuracyM,
      coordinatesUpdatedAt: localGym.coordinatesUpdatedAt,
    };

    if (
      mergedLocation.name !== existing.name ||
      mergedLocation.latitude !== existing.latitude ||
      mergedLocation.longitude !== existing.longitude ||
      mergedLocation.coordinateAccuracyM !== existing.coordinateAccuracyM ||
      mergedLocation.coordinatesUpdatedAt !== existing.coordinatesUpdatedAt
    ) {
      nextLocations[existingIndex] = mergedLocation;
      didChange = true;
    }
  }

  return didChange ? nextLocations : currentLocations;
}

function createLocationId(locationName: string): string {
  return `custom-${locationName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
}


const SET_TYPE_CYCLE_ORDER: SessionSetTypeValue[] = [null, ...SESSION_SET_TYPES];
const SET_TYPE_SHORT_LABELS: Record<SessionSetType, string> = {
  warm_up: 'W-Up',
  rir_0: 'R0',
  rir_1: 'R1',
  rir_2: 'R2',
};

const getSetTypeButtonLabel = (setType: SessionSetTypeValue): string =>
  setType === null ? '•' : SET_TYPE_SHORT_LABELS[setType];

const getSetTypeMenuLabel = (setType: SessionSetTypeValue): string =>
  setType === null ? 'None' : SET_TYPE_MENU_LABELS[setType];

const getSetTypeAccessibilityLabel = (setType: SessionSetTypeValue): string =>
  setType === null ? 'none' : SET_TYPE_MENU_LABELS[setType];

const getNextSetType = (setType: SessionSetTypeValue): SessionSetTypeValue => {
  const currentType = normalizeSessionSetType(setType);
  const currentIndex = SET_TYPE_CYCLE_ORDER.findIndex((value) => value === currentType);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % SET_TYPE_CYCLE_ORDER.length;
  return SET_TYPE_CYCLE_ORDER[nextIndex] ?? null;
};

const constrainSetFieldInput = (field: SetFieldName, value: string): string | null => {
  if (field === 'weight') {
    return WEIGHT_INPUT_PATTERN.test(value) ? value : null;
  }

  return REPS_INPUT_PATTERN.test(value) ? value : null;
};


const hydratePlannedSetForEditing = (set: SessionSet): SessionSet => {
  const isUntouchedPlan =
    set.performanceStatus === 'planned' || set.performanceStatus === 'skipped';

  return {
    ...set,
    reps:
      isUntouchedPlan || set.reps.trim().length === 0
        ? set.plannedReps ?? set.reps
        : set.reps,
    weight:
      isUntouchedPlan || set.weight.trim().length === 0
        ? set.plannedWeight ?? set.weight
        : set.weight,
    setType:
      !isUntouchedPlan && set.setType !== null
        ? set.setType
        : normalizeSessionSetType(set.plannedSetType),
    performanceStatus: 'unperformed',
  };
};

const getPerformedExerciseSets = (sets: SessionSet[]): SessionSet[] =>
  sets.filter(hasPerformedActual);

const getPlannedSetLabel = (set: SessionSet): string =>
  `${formatSetWeightLabel(set.plannedWeight)} · ${formatSetRepsLabel(set.plannedReps)}`;

const getActualSetLabel = (set: SessionSet): string =>
  `${formatSetWeightLabel(set.weight)} · ${formatSetRepsLabel(set.reps)}`;

const getSetQualityForRow = (set: SessionSet, rowState: PlannedSetRowState): SessionSetTypeValue =>
  rowState === 'planned'
    ? normalizeSessionSetType(set.plannedSetType)
    : normalizeSessionSetType(set.setType);

const resolveWithTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise.catch(() => fallback),
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const getExerciseSetSummary = (sets: SessionSet[]): string => {
  const planned = sets.filter(hasPlannedTarget).length;
  const performed = sets.filter(hasPerformedActual).length;

  if (planned > 0) {
    return `${planned} planned · ${performed} performed`;
  }

  return `${performed} performed`;
};


type SubmitCleanupPrompt = {
  step: 'incomplete-sets' | 'unconfirmed-sets' | 'empty-exercises';
  affectedCount: number;
  nextSession: Session;
};

type TagModalMode = 'picker' | 'manage';
type SetTypePickerState = {
  exerciseId: string;
  setId: string;
  exerciseIndex: number;
  setIndex: number;
};

type GymCoordinateAction = 'replace' | 'clear';
type GymCoordinateFeedbackTone = 'success' | 'error';
type GymCoordinateFeedback = {
  gymId: string;
  tone: GymCoordinateFeedbackTone;
  message: string;
};
type GymCoordinateDraft = {
  latitude: number;
  longitude: number;
  accuracyM: number;
  updatedAt: Date;
};
type CurrentCoordinateReadResult =
  | { status: 'success'; coordinates: GymCoordinateDraft }
  | { status: 'error'; message: string };
type ExerciseBlockHistoryPanelState = {
  exerciseDefinitionId: string;
  status: 'loading' | 'success' | 'error';
  blocks: ExerciseBlockHistoryBlock[];
  activeIndex: number;
  isCollapsed: boolean;
};
type ExerciseBlockComparisonMetrics = {
  estimatedOneRepMax: number | null;
  totalVolume: number;
  highestWeight: number | null;
  workingSetCount: number;
};
type ExerciseBlockMaxMetrics = {
  estimatedOneRepMax: number | null;
  totalVolume: number | null;
  highestWeight: number | null;
  workingSetCount: number;
};
type HorizontalSwipeDirection = 'left' | 'right';
type SwipeableSetRowProps = {
  children: ReactNode;
  testID: string;
  onInteract: () => void;
  onSwipeAction: () => void;
  onTouchSwipeStart: (event: GestureResponderEvent) => void;
  onTouchSwipeEnd: (event: GestureResponderEvent) => void;
};

const NEW_GYM_COORDINATE_FEEDBACK_ID = '__new_gym__';
const PAST_RECORDS_LABEL = 'Past Records';
const SWIPE_ACTION_THRESHOLD_X = 48;
const SWIPE_ACTION_REVEAL_X = 78;
const SWIPE_ACTION_MAX_DRAG_X = 108;

const formatExerciseBlockNumeric = (value: number, fractionDigits = 0): string => {
  if (!Number.isFinite(value)) return '-';
  const fixed = value.toFixed(fractionDigits);
  return fractionDigits > 0 ? fixed.replace(/\.0+$/, '') : fixed;
};

const formatExerciseBlockStat = (value: number | null, fractionDigits = 0): string =>
  value === null ? '-' : formatExerciseBlockNumeric(value, fractionDigits);

const formatExerciseBlockVolume = (value: number): string =>
  value > 0 ? formatExerciseBlockNumeric(value, 1) : '-';

const formatExerciseBlockAge = (daysAgo: number): string =>
  `${Math.max(0, daysAgo)}d ago`;

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getFiniteMetricMax = (values: number[]): number | null => {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  return finiteValues.length > 0 ? Math.max(...finiteValues) : null;
};

const getNullableMetricMax = (values: (number | null)[]): number | null =>
  getFiniteMetricMax(values.filter((value): value is number => value !== null));

const getExerciseBlockMaxMetrics = (
  blocks: ExerciseBlockHistoryBlock[],
  currentMetrics?: ExerciseBlockComparisonMetrics
): ExerciseBlockMaxMetrics => ({
  estimatedOneRepMax: getNullableMetricMax([
    ...blocks.map((block) => block.estimatedOneRepMax),
    currentMetrics?.estimatedOneRepMax ?? null,
  ]),
  totalVolume: getFiniteMetricMax([
    ...blocks.map((block) => block.totalVolume).filter((value) => value > 0),
    currentMetrics && currentMetrics.totalVolume > 0 ? currentMetrics.totalVolume : Number.NaN,
  ]),
  highestWeight: getNullableMetricMax([
    ...blocks.map((block) => block.highestWeight),
    currentMetrics?.highestWeight ?? null,
  ]),
  workingSetCount:
    getFiniteMetricMax([
      ...blocks.map((block) => block.workingSetCount),
      currentMetrics?.workingSetCount ?? Number.NaN,
    ]) ?? 0,
});

const isHistoricalPrMetric = (value: number | null, maxValue: number | null): boolean =>
  value !== null && maxValue !== null && value === maxValue;

const isCurrentPrMetric = (value: number | null, maxValue: number | null): boolean =>
  value !== null && maxValue !== null && value >= maxValue;

const getGesturePageX = (event: GestureResponderEvent): number | null => {
  const pageX = event.nativeEvent.pageX;
  return typeof pageX === 'number' && Number.isFinite(pageX) ? pageX : null;
};

function SwipeableSetRow({
  children,
  testID,
  onInteract,
  onSwipeAction,
  onTouchSwipeStart,
  onTouchSwipeEnd,
}: SwipeableSetRowProps) {
  const translateX = useSharedValue(0);

  const closeRow = useCallback(() => {
    translateX.value = withTiming(0, { duration: 180 });
  }, [translateX]);

  const triggerAction = useCallback(() => {
    translateX.value = withTiming(-SWIPE_ACTION_REVEAL_X, { duration: 150 }, () => {
      runOnJS(onSwipeAction)();
      translateX.value = 0;
    });
  }, [onSwipeAction, translateX]);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-14, 14])
    .onBegin(() => {
      runOnJS(onInteract)();
    })
    .onUpdate((event) => {
      translateX.value = Math.max(-SWIPE_ACTION_MAX_DRAG_X, Math.min(0, event.translationX));
    })
    .onEnd(() => {
      if (Math.abs(translateX.value) >= SWIPE_ACTION_THRESHOLD_X) {
        runOnJS(triggerAction)();
        return;
      }
      runOnJS(closeRow)();
    })
    .onFinalize(() => {
      if (Math.abs(translateX.value) < SWIPE_ACTION_THRESHOLD_X) {
        translateX.value = withTiming(0, { duration: 180 });
      }
    });

  const foregroundStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const backgroundStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      Math.abs(translateX.value),
      [0, SWIPE_ACTION_THRESHOLD_X],
      [0, 1],
      Extrapolation.CLAMP
    );

    return {
      opacity: interpolate(progress, [0, 1], [0, 1], Extrapolation.CLAMP),
    };
  });

  const cueStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      Math.abs(translateX.value),
      [0, SWIPE_ACTION_THRESHOLD_X],
      [0, 1],
      Extrapolation.CLAMP
    );

    return {
      opacity: interpolate(progress, [0, 1], [0.34, 1], Extrapolation.CLAMP),
    };
  });

  return (
    <GestureDetector gesture={panGesture}>
      <View
        style={styles.swipeableSetRow}
        testID={testID}
        onTouchStart={(event) => {
          onInteract();
          onTouchSwipeStart(event);
        }}
        onTouchEnd={onTouchSwipeEnd}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.swipeActionBackground,
            styles.swipeDeleteBackground,
            backgroundStyle,
          ]}
          testID={`${testID}-delete-action-background`}>
          <Animated.View style={[styles.swipeActionCue, cueStyle]}>
            <Text style={styles.swipeActionIcon}>×</Text>
            <Text style={styles.swipeActionText}>Delete</Text>
          </Animated.View>
        </Animated.View>
        <Animated.View style={foregroundStyle}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}

function ProtectedPlannedSetRow({
  children,
  testID,
}: Pick<SwipeableSetRowProps, 'children' | 'testID'>) {
  return (
    <View style={styles.swipeableSetRow} testID={testID}>
      {children}
    </View>
  );
}

function SetRowContainer({
  isPlanned,
  ...props
}: SwipeableSetRowProps & { isPlanned: boolean }) {
  if (isPlanned) {
    return (
      <ProtectedPlannedSetRow testID={props.testID}>
        {props.children}
      </ProtectedPlannedSetRow>
    );
  }

  return <SwipeableSetRow {...props} />;
}

const getCurrentExerciseBlockMetrics = (
  sets: SessionSet[]
): ExerciseBlockComparisonMetrics => {
  const calculationSets = getPerformedExerciseSets(sets).map((set) => ({
    weightValue: set.weight,
    repsValue: set.reps,
    setType: normalizeSessionSetType(set.setType),
  }));
  const maxRepsByWeight = computeMaxRepsByWeight(calculationSets);
  let workingSetCount = 0;

  for (const set of calculationSets) {
    const setType = normalizeSessionSetType(set.setType);
    if (!isWorkingSessionSetType(setType)) continue;
    if (parseCalculationSet(set) === null) continue;
    workingSetCount += 1;
  }

  return {
    estimatedOneRepMax: estimateExerciseOneRepMax(calculationSets),
    totalVolume: computeExerciseVolume(calculationSets),
    highestWeight: maxRepsByWeight[0]?.weight ?? null,
    workingSetCount,
  };
};

const toSessionInsightExercises = (
  session: Session,
  currentExerciseNameByDefinitionId: ReadonlyMap<string, string>
): SessionInsightExerciseInput[] =>
  session.exercises.map((exercise, exerciseIndex) => ({
    id: exercise.id,
    orderIndex: exerciseIndex,
    exerciseDefinitionId: exercise.exerciseDefinitionId,
    exerciseName:
      currentExerciseNameByDefinitionId.get(exercise.exerciseDefinitionId) ?? exercise.name,
    sets: exercise.sets.map((set, setIndex) => ({
      id: set.id,
      orderIndex: setIndex,
      weightValue: set.weight,
      repsValue: set.reps,
      setType: set.setType,
      performanceStatus: set.performanceStatus,
    })),
  }));

const hasSavedGymCoordinates = (location: SessionLocation) =>
  typeof location.latitude === 'number' &&
  Number.isFinite(location.latitude) &&
  typeof location.longitude === 'number' &&
  Number.isFinite(location.longitude);

const getCoordinateLocationFailureMessage = (status: string) => {
  if (status === 'permission_denied') {
    return 'Location permission was denied. Coordinates were not changed.';
  }

  if (status === 'unavailable') {
    return 'Location services are unavailable. Coordinates were not changed.';
  }

  return 'Unable to read current location. Coordinates were not changed.';
};

const coordinateDraftToLocationState = (coordinates: GymCoordinateDraft) => ({
  latitude: coordinates.latitude,
  longitude: coordinates.longitude,
  coordinateAccuracyM: coordinates.accuracyM,
  coordinatesUpdatedAt: coordinates.updatedAt,
});

const coordinateDraftToUpsertInput = (coordinates: GymCoordinateDraft) => ({
  latitude: coordinates.latitude,
  longitude: coordinates.longitude,
  accuracyM: coordinates.accuracyM,
  updatedAt: coordinates.updatedAt,
});

async function readCurrentCoordinatesForGym(): Promise<CurrentCoordinateReadResult> {
  const currentPositionResult = await getCurrentForegroundPositionLazy();

  if (currentPositionResult.status !== 'success') {
    return {
      status: 'error',
      message: getCoordinateLocationFailureMessage(currentPositionResult.status),
    };
  }

  const { position } = currentPositionResult;
  if (
    position.accuracyM === null ||
    !Number.isFinite(position.accuracyM) ||
    position.accuracyM < 0 ||
    position.accuracyM > DEFAULT_MAX_POSITION_ACCURACY_M
  ) {
    return {
      status: 'error',
      message: 'Location accuracy is too low right now. Coordinates were not changed.',
    };
  }

  return {
    status: 'success',
    coordinates: {
      latitude: position.latitude,
      longitude: position.longitude,
      accuracyM: position.accuracyM,
      updatedAt: position.capturedAt,
    },
  };
}

const normalizeTagName = (value: string) => value.trim().toLowerCase();

const mapAssignedTagsToExerciseTags = (assignedTags: SessionExerciseAssignedTag[]): SessionExerciseTag[] =>
  assignedTags.map((tag) => ({
    assignmentId: tag.assignmentId,
    tagDefinitionId: tag.tagDefinitionId,
    name: tag.name,
    deletedAt: tag.deletedAt,
    assignedAt: tag.assignedAt,
  }));

const getTagErrorMessage = (error: unknown): string => {
  if (error instanceof ExerciseTagDomainError) {
    switch (error.code) {
      case 'tag_name_required':
        return 'Tag name is required.';
      case 'tag_name_duplicate':
        return 'Tag name already exists for this exercise.';
      case 'tag_definition_not_found':
        return 'Tag no longer exists. Reload and try again.';
      case 'session_exercise_not_found':
        return 'Save exercise changes first, then try adding a tag again.';
      case 'invalid_cross_definition_assignment':
        return 'Tag does not belong to this exercise.';
      case 'duplicate_session_exercise_assignment':
        return 'Tag is already assigned to this exercise.';
      default:
        return 'Unable to update tags right now.';
    }
  }

  return error instanceof Error && error.message ? error.message : 'Unable to update tags right now.';
};


type SessionRecorderScreenProps = {
  requestWeightInputFocus?: (input: TextInput | null) => void;
  requestWeightInputSelectAll?: (input: TextInput | null, valueLength: number) => void;
};

const focusWeightTextInput = (input: TextInput | null) => {
  input?.focus();
};

const selectAllWeightTextInput = (input: TextInput | null, valueLength: number) => {
  if (!input || valueLength === 0) {
    return;
  }

  requestAnimationFrame(() => {
    input.setNativeProps({ selection: { start: 0, end: valueLength } });
  });
};

export default function SessionRecorderScreen({
  requestWeightInputFocus = focusWeightTextInput,
  requestWeightInputSelectAll = selectAllWeightTextInput,
}: SessionRecorderScreenProps = {}) {
  const router = useRouter();
  // M25-T07 linking: signed in only. Links are local synced rows; group
  // exercise names come from `group_cache` (design §7).
  const groupLinkingUserId = useGroupLinkingUserId();
  const navigation = useNavigation<any>();
  const params = useLocalSearchParams<{
    mode?: string | string[];
    sessionId?: string | string[];
    maestroShare?: string | string[];
  }>();
  const routeMode = coerceRouteParam(params.mode) === 'completed-edit' ? 'completed-edit' : 'active';
  const routeSessionId = coerceRouteParam(params.sessionId);
  const shouldFailNextMaestroShare =
    isDevMode() && coerceRouteParam(params.maestroShare) === 'fail-once';

  const [state, setState] = useState<SessionRecorderState>(createInitialState);
  const [submitCleanupPrompt, setSubmitCleanupPrompt] = useState<SubmitCleanupPrompt | null>(null);
  const [hasActiveSession, setHasActiveSession] = useState<boolean>(false);
  const [isPersistenceHydrated, setIsPersistenceHydrated] = useState<boolean>(false);
  const [isStartingSession, setIsStartingSession] = useState<boolean>(false);
  const [completedEditEndDateTime, setCompletedEditEndDateTime] = useState<string | null>(null);
  const [completedEditLoadError, setCompletedEditLoadError] = useState<string | null>(null);
  const [isCompletedEditLoading, setIsCompletedEditLoading] = useState(false);
  const [completedEditAutosaveNotice, setCompletedEditAutosaveNotice] = useState<string | null>(null);
  const [completedEditStartTouched, setCompletedEditStartTouched] = useState(false);
  const [completedEditEndTouched, setCompletedEditEndTouched] = useState(false);
  const [completedEditSubmitAttempted, setCompletedEditSubmitAttempted] = useState(false);
  const [isOpeningCompletedSummary, setIsOpeningCompletedSummary] = useState(false);
  const [exercisePickerOpenRequestId, setExercisePickerOpenRequestId] = useState(0);
  const [listPreferences] = useExerciseListPreferences();
  const exerciseCatalog = useExerciseCatalog();
  const loadInputModeByExerciseDefinitionId = useMemo(
    () =>
      new Map(
        exerciseCatalog.exercises.map((exercise) => [
          exercise.id,
          exercise.loadInputMode ?? 'total_load',
        ])
      ),
    [exerciseCatalog.exercises]
  );
  const exerciseCatalogStatsResult = useExerciseCatalogStats(listPreferences.dateRange);
  const { reload: reloadExerciseCatalogStats } = exerciseCatalogStatsResult;
  const [isTagModalVisible, setIsTagModalVisible] = useState(false);
  const [tagModalMode, setTagModalMode] = useState<TagModalMode>('picker');
  const [activeTagExerciseId, setActiveTagExerciseId] = useState<string | null>(null);
  const [tagSearchValue, setTagSearchValue] = useState('');
  const [tagDefinitions, setTagDefinitions] = useState<ExerciseTagDefinitionRecord[]>([]);
  const [isTagDefinitionsLoading, setIsTagDefinitionsLoading] = useState(false);
  const [tagModalError, setTagModalError] = useState<string | null>(null);
  const [showDeletedTagsInManager, setShowDeletedTagsInManager] = useState(false);
  const [editingTagDefinitionId, setEditingTagDefinitionId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState('');
  const [isTagMutationInFlight, setIsTagMutationInFlight] = useState(false);
  const [activeSetTypePicker, setActiveSetTypePicker] = useState<SetTypePickerState | null>(null);
  const [expandedSetIds, setExpandedSetIds] = useState<Set<string>>(() => new Set());
  const [collapsedExerciseIds, setCollapsedExerciseIds] = useState<Set<string>>(() => new Set());
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [pendingFocusedWeightSetId, setPendingFocusedWeightSetId] = useState<string | null>(null);
  const [isGpsDetectionInFlight, setIsGpsDetectionInFlight] = useState(false);
  const [pendingGymCoordinateAction, setPendingGymCoordinateAction] = useState<{
    gymId: string;
    action: GymCoordinateAction;
  } | null>(null);
  const [gymCoordinateFeedback, setGymCoordinateFeedback] = useState<GymCoordinateFeedback | null>(null);
  const [gymCoordinateLoadingId, setGymCoordinateLoadingId] = useState<string | null>(null);
  const [pendingNewGymCoordinates, setPendingNewGymCoordinates] = useState<GymCoordinateDraft | null>(null);
  const [exerciseBlockHistoryByExerciseId, setExerciseBlockHistoryByExerciseId] = useState<
    Record<string, ExerciseBlockHistoryPanelState>
  >({});
  const stateRef = useRef(state);
  const completedEditEndDateTimeRef = useRef<string | null>(completedEditEndDateTime);
  const persistedSessionIdRef = useRef<string | null>(null);
  const persistenceHydratedRef = useRef(false);
  const autosaveRef = useRef<DraftAutosaveController | null>(null);
  const hasSessionMutationRef = useRef(false);
  const sessionMutationVersionRef = useRef(0);
  const replayingBeforeRemoveActionRef = useRef(false);
  const pendingExercisePickerRestoreTargetRef = useRef<string | null | undefined>(undefined);
  const suppressSetTypeCyclePressRef = useRef(false);
  const exerciseBlockHistoryRequestKeyRef = useRef<Record<string, string>>({});
  const focusedSetInputIdRef = useRef<string | null>(null);
  const weightInputBySetIdRef = useRef<Record<string, TextInput | null>>({});
  const recorderScrollViewRef = useRef<ScrollView | null>(null);
  const exerciseCardYByExerciseIdRef = useRef<Record<string, number>>({});
  const pendingExerciseCardScrollIdRef = useRef<string | null>(null);
  const horizontalSwipeStartXByKeyRef = useRef<Record<string, number>>({});
  const isMountedRef = useRef(true);

  stateRef.current = state;
  completedEditEndDateTimeRef.current = completedEditEndDateTime;

  if (!autosaveRef.current) {
    autosaveRef.current = createDraftAutosaveController({
      persistDraft: async () => {
        const currentState = stateRef.current;
        const parsedStartedAt = parseSessionDateTime(currentState.session.dateTime);
        const selectedGym =
          currentState.session.locationId === null
            ? null
            : currentState.locations.find((location) => location.id === currentState.session.locationId) ?? null;
        const canCreateNewRecord =
          persistedSessionIdRef.current !== null || hasPersistableSessionContent(currentState.session);
        if (!canCreateNewRecord) {
          return;
        }

        if (!parsedStartedAt) {
          return;
        }

        if (selectedGym) {
          await upsertLocalGym({
            id: selectedGym.id,
            name: selectedGym.name,
          });
        }

        if (routeMode === 'completed-edit') {
          const currentEndText = completedEditEndDateTimeRef.current;
          const timingValidationMessage = getDateTimeValidationMessage(
            currentState.session.dateTime,
            currentEndText
          );

          if (timingValidationMessage || !currentEndText || !persistedSessionIdRef.current) {
            setCompletedEditAutosaveNotice(
              timingValidationMessage
                ? 'Autosave paused until Start/End times are valid.'
                : 'Autosave waiting for completed-session timestamps.'
            );
            return;
          }

          const parsedCompletedAt = parseSessionDateTime(currentEndText);
          if (!parsedCompletedAt) {
            setCompletedEditAutosaveNotice('Autosave paused until Start/End times are valid.');
            return;
          }

          await persistCompletedSessionSnapshot({
            sessionId: persistedSessionIdRef.current,
            gymId: selectedGym?.id ?? null,
            startedAt: parsedStartedAt,
            completedAt: parsedCompletedAt,
            exercises: toPersistDraftExercises(currentState.session),
          });
          setCompletedEditAutosaveNotice(null);
          return;
        }

        const persisted = await persistSessionDraftSnapshot({
          sessionId: persistedSessionIdRef.current ?? undefined,
          gymId: selectedGym?.id ?? null,
          startedAt: parsedStartedAt,
          status: 'active',
          exercises: toPersistDraftExercises(currentState.session),
        });

        persistedSessionIdRef.current = persisted.sessionId;
      },
    });
  }

  const autosaveController = autosaveRef.current;
  const lifecycleHelpers = useMemo(() => createSessionRecorderLifecycleHelpers(autosaveController), [autosaveController]);

  useEffect(() => {
    if (routeMode !== 'completed-edit') {
      return;
    }

    if (!navigation || typeof navigation.addListener !== 'function') {
      return;
    }

    const unsubscribe = navigation.addListener('beforeRemove', (event: any) => {
      if (replayingBeforeRemoveActionRef.current) {
        replayingBeforeRemoveActionRef.current = false;
        return;
      }

      if (!hasSessionMutationRef.current) {
        return;
      }

      event.preventDefault();

      void autosaveController
        .dispose({ flushDirty: true })
        .catch(() => {
          // Best-effort save on navigation out; allow navigation even if persistence fails.
        })
        .finally(() => {
          replayingBeforeRemoveActionRef.current = true;
          navigation.dispatch?.(event.data.action);
        });
    });

    return unsubscribe;
  }, [autosaveController, navigation, routeMode]);

  useEffect(() => {
    let cancelled = false;

    void listLocalGyms()
      .then((localGyms) => {
        if (cancelled) {
          return;
        }

        setState((current) => ({
          ...current,
          locations: mergeLocalGymsIntoLocations(current.locations, localGyms),
        }));
      })
      .catch(() => {
        // Keep seeded gyms available if local SQLite hydration fails.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (routeMode === 'completed-edit') {
      if (!routeSessionId) {
        setCompletedEditLoadError('Missing completed session id');
        persistenceHydratedRef.current = true;
        setIsPersistenceHydrated(true);
        return () => {
          cancelled = true;
        };
      }

      setIsCompletedEditLoading(true);
      setCompletedEditLoadError(null);
      setCompletedEditStartTouched(false);
      setCompletedEditEndTouched(false);
      setCompletedEditSubmitAttempted(false);

      void loadSessionSnapshotById(routeSessionId)
        .then(async (snapshot) => {
          if (cancelled || !snapshot || hasSessionMutationRef.current) {
            if (!snapshot && !cancelled) {
              setCompletedEditLoadError('Completed session not found');
            }
            return;
          }

          if (snapshot.status !== 'completed') {
            setCompletedEditLoadError('Session is not completed');
            return;
          }

          persistedSessionIdRef.current = snapshot.sessionId;
          const loadedGym = snapshot.gymId ? await loadLocalGymById(snapshot.gymId) : null;

          if (cancelled) {
            return;
          }

          setState((current) => ({
            ...current,
            locations:
              loadedGym && !current.locations.some((location) => location.id === loadedGym.id)
                ? [
                    ...current.locations,
                    {
                      id: loadedGym.id,
                      name: loadedGym.name,
                      archived: false,
                      latitude: loadedGym.latitude,
                      longitude: loadedGym.longitude,
                      coordinateAccuracyM: loadedGym.coordinateAccuracyM,
                      coordinatesUpdatedAt: loadedGym.coordinatesUpdatedAt,
                    },
                  ]
                : current.locations,
            session: mapSessionGraphSnapshotToSession(snapshot),
          }));
          setCompletedEditEndDateTime(
            formatCurrentDateTime(snapshot.completedAt ?? snapshot.startedAt)
          );
        })
        .catch(() => {
          if (!cancelled) {
            setCompletedEditLoadError('Unable to load completed session');
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsCompletedEditLoading(false);
            persistenceHydratedRef.current = true;
            setIsPersistenceHydrated(true);
          }
        });

      return () => {
        cancelled = true;
      };
    }

    return () => {
      cancelled = true;
    };
  }, [routeMode, routeSessionId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      void lifecycleHelpers.onAppStateChange(nextState);
    });

    return () => {
      subscription.remove();
    };
  }, [lifecycleHelpers]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      void lifecycleHelpers.onScreenBlur();
      void lifecycleHelpers.onRouteChange();
      void autosaveController.dispose({ flushDirty: true });
    };
  }, [autosaveController, lifecycleHelpers]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      reloadExerciseCatalogStats();

      if (routeMode === 'active') {
        const mutationVersionAtFocus = sessionMutationVersionRef.current;
        void (async () => {
          try {
            // A fast tab round-trip can refocus before the blur flush finishes.
            // Drain that queue before reading so the snapshot is never older than
            // the recorder state that just lost focus.
            await autosaveController.flushNow();
            const snapshot = await loadLatestSessionDraftSnapshot();
            if (
              cancelled ||
              sessionMutationVersionRef.current !== mutationVersionAtFocus
            ) {
              return;
            }

            hasSessionMutationRef.current = false;
            if (!snapshot) {
              persistedSessionIdRef.current = null;
              setHasActiveSession(false);
              return;
            }

            persistedSessionIdRef.current = snapshot.sessionId;
            setState((current) => ({
              ...current,
              session: mapDraftSnapshotToSession(snapshot),
            }));
            setHasActiveSession(true);
          } catch {
            // Keep the recorder usable if restore fails; a later focus retries the read.
          } finally {
            if (!cancelled) {
              persistenceHydratedRef.current = true;
              setIsPersistenceHydrated(true);
            }
          }
        })();
      }

      if (pendingExercisePickerRestoreTargetRef.current !== undefined) {
        const selectionTargetId = pendingExercisePickerRestoreTargetRef.current;
        pendingExercisePickerRestoreTargetRef.current = undefined;
        setState((current) => ({
          ...current,
          exercisePickerVisible: true,
          exerciseSelectionTargetId: selectionTargetId ?? null,
          exerciseActionMenuVisible: false,
          activeExerciseActionId: null,
        }));
      }

      return () => {
        cancelled = true;
        void lifecycleHelpers.onScreenBlur();
      };
    }, [autosaveController, lifecycleHelpers, reloadExerciseCatalogStats, routeMode])
  );

  const markSessionStructuralMutation = useCallback(() => {
    hasSessionMutationRef.current = true;
    sessionMutationVersionRef.current += 1;
    if (!persistenceHydratedRef.current) {
      return;
    }

    void autosaveController.markStructuralMutation();
  }, [autosaveController]);

  const markSessionTextMutation = useCallback(() => {
    hasSessionMutationRef.current = true;
    sessionMutationVersionRef.current += 1;
    if (!persistenceHydratedRef.current) {
      return;
    }

    autosaveController.markTextMutation();
  }, [autosaveController]);

  const selectedGym = useMemo<SessionLocation | undefined>(
    () => state.locations.find((location) => location.id === state.session.locationId),
    [state.locations, state.session.locationId]
  );

  const activeGyms = useMemo(
    () => state.locations.filter((location) => !location.archived),
    [state.locations]
  );

  const managedGyms = useMemo(
    () =>
      state.showArchivedInManager
        ? state.locations
        : state.locations.filter((location) => !location.archived),
    [state.locations, state.showArchivedInManager]
  );
  const exerciseIdsKey = useMemo(
    () => state.session.exercises.map((exercise) => exercise.id).join('|'),
    [state.session.exercises]
  );
  const exerciseBlockHistoryLoadKey = useMemo(
    () =>
      state.session.exercises
        .map((exercise) => `${exercise.id}:${exercise.exerciseDefinitionId}`)
        .join('|'),
    [state.session.exercises]
  );

  useEffect(() => {
    const activeExerciseIds = new Set(stateRef.current.session.exercises.map((exercise) => exercise.id));
    for (const exerciseId of Object.keys(exerciseCardYByExerciseIdRef.current)) {
      if (!activeExerciseIds.has(exerciseId)) {
        delete exerciseCardYByExerciseIdRef.current[exerciseId];
      }
    }

    if (
      pendingExerciseCardScrollIdRef.current &&
      !activeExerciseIds.has(pendingExerciseCardScrollIdRef.current)
    ) {
      pendingExerciseCardScrollIdRef.current = null;
    }

    setCollapsedExerciseIds((current) => {
      const next = new Set(
        [...current].filter((exerciseId) => activeExerciseIds.has(exerciseId))
      );
      return next.size === current.size ? current : next;
    });
  }, [exerciseIdsKey]);

  const refreshAssignedTagsForExercise = useCallback(async (sessionExerciseId: string) => {
    try {
      const assignedTags = await listSessionExerciseAssignedTags(sessionExerciseId);
      const mappedTags = mapAssignedTagsToExerciseTags(assignedTags);
      setState((current) => ({
        ...current,
        session: {
          ...current.session,
          exercises: current.session.exercises.map((exercise) =>
            exercise.id === sessionExerciseId ? { ...exercise, tags: mappedTags } : exercise
          ),
        },
      }));
    } catch {
      // Keep recorder usable even if tag refresh fails.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const sessionExerciseIds = stateRef.current.session.exercises.map((exercise) => exercise.id);
    if (sessionExerciseIds.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    void Promise.all(
      sessionExerciseIds.map(async (sessionExerciseId) => {
        try {
          const assignedTags = await listSessionExerciseAssignedTags(sessionExerciseId);
          return [sessionExerciseId, mapAssignedTagsToExerciseTags(assignedTags)] as const;
        } catch {
          return [sessionExerciseId, [] as SessionExerciseTag[]] as const;
        }
      })
    ).then((results) => {
      if (cancelled) {
        return;
      }

      const tagsByExerciseId = new Map<string, SessionExerciseTag[]>(results);
      setState((current) => ({
        ...current,
        session: {
          ...current.session,
          exercises: current.session.exercises.map((exercise) => ({
            ...exercise,
            tags: tagsByExerciseId.get(exercise.id) ?? [],
          })),
        },
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [exerciseIdsKey]);

  useEffect(() => {
    const exercises = stateRef.current.session.exercises.map((exercise) => ({
      id: exercise.id,
      exerciseDefinitionId: exercise.exerciseDefinitionId,
    }));
    const activeExerciseIds = new Set(exercises.map((exercise) => exercise.id));

    for (const exerciseId of Object.keys(exerciseBlockHistoryRequestKeyRef.current)) {
      if (!activeExerciseIds.has(exerciseId)) {
        delete exerciseBlockHistoryRequestKeyRef.current[exerciseId];
      }
    }

    setExerciseBlockHistoryByExerciseId((current) => {
      const next: Record<string, ExerciseBlockHistoryPanelState> = {};
      for (const exercise of exercises) {
        const existing = current[exercise.id];
        next[exercise.id] =
          existing?.exerciseDefinitionId === exercise.exerciseDefinitionId
            ? existing
            : {
                exerciseDefinitionId: exercise.exerciseDefinitionId,
                status: 'loading',
                blocks: [],
                activeIndex: 0,
                isCollapsed: true,
              };
      }
      return next;
    });

    for (const exercise of exercises) {
      const requestKey = `${exercise.id}:${exercise.exerciseDefinitionId}`;
      if (exerciseBlockHistoryRequestKeyRef.current[exercise.id] === requestKey) {
        continue;
      }

      exerciseBlockHistoryRequestKeyRef.current[exercise.id] = requestKey;
      void loadRecentExerciseBlocks({ exerciseDefinitionId: exercise.exerciseDefinitionId })
        .then((summary) => {
          if (
            !isMountedRef.current ||
            exerciseBlockHistoryRequestKeyRef.current[exercise.id] !== requestKey
          ) {
            return;
          }

          setExerciseBlockHistoryByExerciseId((current) => ({
            ...current,
            [exercise.id]: {
              exerciseDefinitionId: exercise.exerciseDefinitionId,
              status: 'success',
              blocks: summary.blocks,
              activeIndex: 0,
              isCollapsed:
                current[exercise.id]?.exerciseDefinitionId === exercise.exerciseDefinitionId
                  ? current[exercise.id].isCollapsed
                  : true,
            },
          }));
        })
        .catch(() => {
          if (
            !isMountedRef.current ||
            exerciseBlockHistoryRequestKeyRef.current[exercise.id] !== requestKey
          ) {
            return;
          }

          setExerciseBlockHistoryByExerciseId((current) => ({
            ...current,
            [exercise.id]: {
              exerciseDefinitionId: exercise.exerciseDefinitionId,
              status: 'error',
              blocks: [],
              activeIndex: 0,
              isCollapsed:
                current[exercise.id]?.exerciseDefinitionId === exercise.exerciseDefinitionId
                  ? current[exercise.id].isCollapsed
                  : true,
            },
          }));
        });
    }
  }, [exerciseBlockHistoryLoadKey]);


  const persistSessionGraphForTagOps = useCallback(async (): Promise<boolean> => {
    const currentState = stateRef.current;
    const parsedStartedAt = parseSessionDateTime(currentState.session.dateTime);
    if (!parsedStartedAt) {
      return false;
    }

    const selectedGymForPersist =
      currentState.session.locationId === null
        ? null
        : currentState.locations.find((location) => location.id === currentState.session.locationId) ?? null;

    if (routeMode === 'completed-edit') {
      if (!persistedSessionIdRef.current) {
        return false;
      }

      const currentEndText = completedEditEndDateTimeRef.current;
      if (!currentEndText) {
        return false;
      }

      const parsedCompletedAt = parseSessionDateTime(currentEndText);
      if (!parsedCompletedAt) {
        return false;
      }

      await persistCompletedSessionSnapshot({
        sessionId: persistedSessionIdRef.current,
        gymId: selectedGymForPersist?.id ?? null,
        startedAt: parsedStartedAt,
        completedAt: parsedCompletedAt,
        exercises: toPersistDraftExercises(currentState.session),
      });
      return true;
    }

    const persisted = await persistSessionDraftSnapshot({
      sessionId: persistedSessionIdRef.current ?? undefined,
      gymId: selectedGymForPersist?.id ?? null,
      startedAt: parsedStartedAt,
      status: 'active',
      exercises: toPersistDraftExercises(currentState.session),
    });
    persistedSessionIdRef.current = persisted.sessionId;
    return true;
  }, [routeMode]);

  const reloadTagDefinitions = useCallback(
    async (exerciseDefinitionId: string) => {
      setIsTagDefinitionsLoading(true);
      setTagModalError(null);

      try {
        const loadedDefinitions = await listExerciseTagDefinitions(exerciseDefinitionId, {
          includeDeleted: true,
        });
        setTagDefinitions(loadedDefinitions);
      } catch {
        setTagModalError('Unable to load tags right now.');
      } finally {
        setIsTagDefinitionsLoading(false);
      }
    },
    []
  );

  const clearSubmitFeedback = () => {
    setSubmitCleanupPrompt(null);
  };

  const findMatchedGymFromCurrentLocation = useCallback(async (): Promise<SessionLocation | null> => {
    const currentPositionResult = await getCurrentForegroundPositionLazy();

    if (currentPositionResult.status !== 'success') {
      return null;
    }

    const matchResult = matchNearestGymForPosition(
      {
        latitude: currentPositionResult.position.latitude,
        longitude: currentPositionResult.position.longitude,
        accuracyM: currentPositionResult.position.accuracyM,
      },
      stateRef.current.locations.map((location) => ({
        id: location.id,
        name: location.name,
        archived: location.archived,
        latitude: location.latitude ?? null,
        longitude: location.longitude ?? null,
      }))
    );

    if (matchResult.status === 'matched') {
      const currentGym = stateRef.current.locations.find((location) => location.id === matchResult.match.gym.id);
      if (!currentGym || currentGym.archived) {
        return null;
      }

      return currentGym;
    }

    return null;
  }, []);

  const startSessionFromEmptyState = useCallback(async () => {
    if (isStartingSession) {
      return;
    }

    setIsStartingSession(true);
    try {
      const startedAt = new Date();
      let detectedGym = await resolveWithTimeout(
        findMatchedGymFromCurrentLocation(),
        START_SESSION_GYM_DETECTION_TIMEOUT_MS,
        null
      );
      if (detectedGym) {
        try {
          await upsertLocalGym({
            id: detectedGym.id,
            name: detectedGym.name,
          });
        } catch {
          detectedGym = null;
        }
      }
      const persisted = await persistSessionDraftSnapshot({
        gymId: detectedGym?.id ?? null,
        startedAt,
        status: 'active',
        exercises: [],
      });
      persistedSessionIdRef.current = persisted.sessionId;
      hasSessionMutationRef.current = false;
      setState((current) => ({
        ...current,
        session: {
          ...current.session,
          dateTime: formatCurrentDateTime(startedAt),
          locationId: detectedGym?.id ?? null,
          exercises: [],
        },
      }));
      setHasActiveSession(true);
    } catch (error) {
      void logEvent({
        level: 'warn',
        source: 'app',
        event: 'session_recorder.start_session_failed',
        message: 'Failed to start an empty workout session.',
        context: {
          error_message: error instanceof Error ? error.message : String(error),
        },
      }).catch(() => undefined);
      // Keep the empty state visible if the persistence call fails — user can retry.
    } finally {
      setIsStartingSession(false);
    }
  }, [findMatchedGymFromCurrentLocation, isStartingSession]);

  const retryGpsGymSelection = useCallback(async () => {
    if (isGpsDetectionInFlight) {
      return;
    }

    setIsGpsDetectionInFlight(true);
    try {
      const matchedGym = await findMatchedGymFromCurrentLocation();
      if (!matchedGym) {
        return;
      }

      try {
        await upsertLocalGym({
          id: matchedGym.id,
          name: matchedGym.name,
        });
      } catch {
        return;
      }

      setState((current) => ({
        ...current,
        session: { ...current.session, locationId: matchedGym.id },
      }));
      clearSubmitFeedback();
      markSessionStructuralMutation();
    } finally {
      setIsGpsDetectionInFlight(false);
    }
  }, [findMatchedGymFromCurrentLocation, isGpsDetectionInFlight, markSessionStructuralMutation]);

  const openGymModal = () => {
    setPendingGymCoordinateAction(null);
    setGymCoordinateFeedback(null);
    setPendingNewGymCoordinates(null);
    setState((current) => ({
      ...current,
      gymPickerVisible: true,
      gymModalMode: 'picker',
      editorReturnMode: 'picker',
      pendingLocationName: '',
      editingLocationId: null,
      editingLocationName: '',
      showArchivedInManager: false,
    }));
  };

  const dismissGymModal = () => {
    setPendingGymCoordinateAction(null);
    setGymCoordinateFeedback(null);
    setPendingNewGymCoordinates(null);
    setState((current) => ({
      ...current,
      gymPickerVisible: false,
      gymModalMode: 'picker',
      editorReturnMode: 'picker',
      pendingLocationName: '',
      editingLocationId: null,
      editingLocationName: '',
      showArchivedInManager: false,
    }));
  };

  const selectGym = (locationId: string | null) => {
    setState((current) => ({
      ...current,
      session: { ...current.session, locationId },
      gymPickerVisible: false,
      gymModalMode: 'picker',
      editorReturnMode: 'picker',
      pendingLocationName: '',
      editingLocationId: null,
      editingLocationName: '',
    }));
    clearSubmitFeedback();
    markSessionStructuralMutation();
  };

  const openManageGyms = () => {
    setPendingGymCoordinateAction(null);
    setState((current) => ({
      ...current,
      gymModalMode: 'manage',
      pendingLocationName: '',
      editingLocationId: null,
      editingLocationName: '',
    }));
  };

  const openAddGymEditor = () => {
    setPendingNewGymCoordinates(null);
    setGymCoordinateFeedback(null);
    setPendingGymCoordinateAction(null);
    setState((current) => ({
      ...current,
      gymModalMode: 'editor',
      editorReturnMode: 'picker',
      pendingLocationName: '',
      editingLocationId: null,
      editingLocationName: '',
    }));
  };

  const openEditGymEditor = (location: SessionLocation) => {
    setPendingNewGymCoordinates(null);
    setGymCoordinateFeedback(null);
    setPendingGymCoordinateAction(null);
    setState((current) => ({
      ...current,
      gymModalMode: 'editor',
      editorReturnMode: 'manage',
      editingLocationId: location.id,
      editingLocationName: location.name,
      pendingLocationName: '',
    }));
    markSessionStructuralMutation();
  };

  const returnFromEditor = () => {
    setPendingNewGymCoordinates(null);
    setGymCoordinateFeedback(null);
    setPendingGymCoordinateAction(null);
    setState((current) => ({
      ...current,
      gymModalMode: current.editorReturnMode,
      pendingLocationName: '',
      editingLocationId: null,
      editingLocationName: '',
    }));
  };

  const handlePendingLocationNameChange = (pendingLocationName: string) => {
    setState((current) => ({
      ...current,
      pendingLocationName,
    }));
  };

  const handleEditingLocationNameChange = (editingLocationName: string) => {
    setState((current) => ({
      ...current,
      editingLocationName,
    }));
  };

  const saveGymFromEditor = () => {
    const draftName = (state.editingLocationId ? state.editingLocationName : state.pendingLocationName).trim();
    if (!draftName) {
      return;
    }

    if (state.editingLocationId) {
      setState((current) => ({
        ...current,
        locations: current.locations.map((location) =>
          location.id === current.editingLocationId ? { ...location, name: draftName } : location
        ),
        gymModalMode: 'manage',
        editingLocationId: null,
        editingLocationName: '',
      }));
      markSessionStructuralMutation();
      return;
    }

    const stagedCoordinates = pendingNewGymCoordinates;
    const newLocation: SessionLocation = {
      id: createLocationId(draftName),
      name: draftName,
      archived: false,
      ...(stagedCoordinates ? coordinateDraftToLocationState(stagedCoordinates) : {}),
    };

    setState((current) => ({
      ...current,
      locations: [...current.locations, newLocation],
      session: { ...current.session, locationId: newLocation.id },
      gymPickerVisible: false,
      gymModalMode: 'picker',
      editorReturnMode: 'picker',
      pendingLocationName: '',
    }));
    setPendingNewGymCoordinates(null);
    setGymCoordinateFeedback(null);
    markSessionStructuralMutation();

    void (async () => {
      let coordinates = stagedCoordinates;
      if (!coordinates) {
        const coordinateRead = await readCurrentCoordinatesForGym();
        coordinates = coordinateRead.status === 'success' ? coordinateRead.coordinates : null;
      }

      if (!coordinates) {
        return;
      }

      try {
        await upsertLocalGym({
          id: newLocation.id,
          name: newLocation.name,
          coordinates: coordinateDraftToUpsertInput(coordinates),
        });
        updateGymCoordinateState(newLocation.id, coordinateDraftToLocationState(coordinates));
      } catch {
        // Coordinate capture is opportunistic during gym creation; the selected gym remains usable.
      }
    })();
  };

  const returnToPickerFromManage = () => {
    setPendingGymCoordinateAction(null);
    setState((current) => ({
      ...current,
      gymModalMode: 'picker',
      showArchivedInManager: false,
      editingLocationId: null,
      editingLocationName: '',
    }));
  };

  const toggleArchivedVisibility = () => {
    setPendingGymCoordinateAction(null);
    setState((current) => ({
      ...current,
      showArchivedInManager: !current.showArchivedInManager,
    }));
  };

  const toggleGymArchive = (locationId: string, archived: boolean) => {
    setPendingGymCoordinateAction(null);
    setState((current) => ({
      ...current,
      locations: current.locations.map((location) =>
        location.id === locationId ? { ...location, archived: !archived } : location
      ),
      session:
        current.session.locationId === locationId && !archived
          ? { ...current.session, locationId: null }
          : current.session,
    }));
    markSessionStructuralMutation();
  };

  const showGymCoordinateFeedback = (feedback: GymCoordinateFeedback) => {
    setGymCoordinateFeedback(feedback);
  };

  const updateGymCoordinateState = (
    gymId: string,
    coordinates: {
      latitude: number | null;
      longitude: number | null;
      coordinateAccuracyM: number | null;
      coordinatesUpdatedAt: Date | null;
    }
  ) => {
    setState((current) => ({
      ...current,
      locations: current.locations.map((location) =>
        location.id === gymId
          ? {
              ...location,
              ...coordinates,
            }
          : location
      ),
    }));
  };

  const saveGymCoordinatesFromCurrentLocation = async (
    location: SessionLocation,
    successMessage = 'Coordinates saved from current location.'
  ) => {
    setPendingGymCoordinateAction(null);
    setGymCoordinateLoadingId(location.id);
    setGymCoordinateFeedback(null);

    try {
      const coordinateRead = await readCurrentCoordinatesForGym();

      if (coordinateRead.status === 'error') {
        showGymCoordinateFeedback({
          gymId: location.id,
          tone: 'error',
          message: coordinateRead.message,
        });
        return;
      }

      const { coordinates } = coordinateRead;
      await upsertLocalGym({
        id: location.id,
        name: location.name,
        coordinates: coordinateDraftToUpsertInput(coordinates),
      });

      updateGymCoordinateState(location.id, coordinateDraftToLocationState(coordinates));
      showGymCoordinateFeedback({
        gymId: location.id,
        tone: 'success',
        message: successMessage,
      });
    } catch {
      showGymCoordinateFeedback({
        gymId: location.id,
        tone: 'error',
        message: 'Unable to update gym coordinates right now.',
      });
    } finally {
      setGymCoordinateLoadingId(null);
    }
  };

  const savePendingNewGymCoordinatesFromCurrentLocation = async () => {
    setPendingGymCoordinateAction(null);
    setGymCoordinateLoadingId(NEW_GYM_COORDINATE_FEEDBACK_ID);
    setGymCoordinateFeedback(null);

    try {
      const coordinateRead = await readCurrentCoordinatesForGym();
      if (coordinateRead.status === 'error') {
        showGymCoordinateFeedback({
          gymId: NEW_GYM_COORDINATE_FEEDBACK_ID,
          tone: 'error',
          message: coordinateRead.message,
        });
        return;
      }

      setPendingNewGymCoordinates(coordinateRead.coordinates);
      showGymCoordinateFeedback({
        gymId: NEW_GYM_COORDINATE_FEEDBACK_ID,
        tone: 'success',
        message: 'Current location ready. Add the gym to save it.',
      });
    } finally {
      setGymCoordinateLoadingId(null);
    }
  };

  const requestReplaceGymCoordinates = (gymId: string) => {
    setGymCoordinateFeedback(null);
    setPendingGymCoordinateAction({ gymId, action: 'replace' });
  };

  const requestClearGymCoordinates = (gymId: string) => {
    setGymCoordinateFeedback(null);
    setPendingGymCoordinateAction({ gymId, action: 'clear' });
  };

  const cancelGymCoordinateAction = (gymId: string) => {
    setPendingGymCoordinateAction((current) => (current?.gymId === gymId ? null : current));
  };

  const confirmReplaceGymCoordinates = async (location: SessionLocation) => {
    await saveGymCoordinatesFromCurrentLocation(location, 'Coordinates replaced from current location.');
  };

  const confirmClearGymCoordinates = async (location: SessionLocation) => {
    setPendingGymCoordinateAction(null);
    setGymCoordinateLoadingId(location.id);
    setGymCoordinateFeedback(null);

    try {
      await upsertLocalGym({
        id: location.id,
        name: location.name,
        coordinates: null,
      });
      updateGymCoordinateState(location.id, {
        latitude: null,
        longitude: null,
        coordinateAccuracyM: null,
        coordinatesUpdatedAt: null,
      });
      showGymCoordinateFeedback({
        gymId: location.id,
        tone: 'success',
        message: 'Coordinates cleared. This gym will not be used for GPS matching.',
      });
    } catch {
      showGymCoordinateFeedback({
        gymId: location.id,
        tone: 'error',
        message: 'Unable to update gym coordinates right now.',
      });
    } finally {
      setGymCoordinateLoadingId(null);
    }
  };

  const rememberHorizontalSwipeStart = useCallback((key: string, event: GestureResponderEvent) => {
    const pageX = getGesturePageX(event);
    if (pageX === null) {
      delete horizontalSwipeStartXByKeyRef.current[key];
      return;
    }
    horizontalSwipeStartXByKeyRef.current[key] = pageX;
  }, []);

  const consumeHorizontalSwipeEnd = useCallback(
    (
      key: string,
      event: GestureResponderEvent,
      onSwipe: (direction: HorizontalSwipeDirection) => void
    ) => {
      const startX = horizontalSwipeStartXByKeyRef.current[key];
      delete horizontalSwipeStartXByKeyRef.current[key];
      const endX = getGesturePageX(event);
      if (typeof startX !== 'number' || endX === null) {
        return;
      }

      const deltaX = endX - startX;
      if (Math.abs(deltaX) < SWIPE_ACTION_THRESHOLD_X) {
        return;
      }
      onSwipe(deltaX < 0 ? 'left' : 'right');
    },
    []
  );

  const activateSetRow = useCallback((setId: string) => {
    setActiveRowId(setId);
  }, []);

  const clearSetRowMemory = useCallback((setId: string) => {
    setActiveRowId((current) => (current === setId ? null : current));
  }, []);

  const moveExerciseBlockHistory = useCallback((exerciseId: string, direction: 'older' | 'newer') => {
    setExerciseBlockHistoryByExerciseId((current) => {
      const panel = current[exerciseId];
      if (!panel || panel.status !== 'success' || panel.blocks.length === 0) {
        return current;
      }

      const nextIndex =
        direction === 'older'
          ? Math.min(panel.activeIndex + 1, panel.blocks.length - 1)
          : Math.max(panel.activeIndex - 1, 0);
      if (nextIndex === panel.activeIndex) {
        return current;
      }

      return {
        ...current,
        [exerciseId]: {
          ...panel,
          activeIndex: nextIndex,
        },
      };
    });
  }, []);

  const toggleExerciseBlockHistoryCollapsed = useCallback((exerciseId: string) => {
    const collapsibleExpandedSetIds = new Set(
      stateRef.current.session.exercises.flatMap((exercise) =>
        exercise.sets
          .filter((set) => {
            if (!expandedSetIds.has(set.id)) {
              return false;
            }
            const rowState = getSetRowState(set);
            return hasValidActualValues(set) || rowState === 'planned';
          })
          .map((set) => set.id)
      )
    );

    if (collapsibleExpandedSetIds.size > 0) {
      setExpandedSetIds((current) => {
        const next = new Set(current);
        collapsibleExpandedSetIds.forEach((setId) => {
          next.delete(setId);
        });
        return next;
      });
      return;
    }

    setExerciseBlockHistoryByExerciseId((current) => {
      const panel = current[exerciseId];
      if (!panel) {
        return current;
      }

      return {
        ...current,
        [exerciseId]: {
          ...panel,
          isCollapsed: !panel.isCollapsed,
        },
      };
    });
  }, [expandedSetIds]);

  const renderExerciseBlockHistoryPanel = useCallback(
    (exercise: SessionExercise, exerciseIndex: number) => {
      const panel = exerciseBlockHistoryByExerciseId[exercise.id];
      const panelTestId = `exercise-block-history-panel-${exerciseIndex + 1}`;
      const isCollapsed = panel?.isCollapsed ?? true;

      const renderCollapsedPanel = (testID = `${panelTestId}-collapsed`) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Show ${PAST_RECORDS_LABEL} for exercise ${exerciseIndex + 1}`}
          accessibilityState={{ expanded: false }}
          style={[styles.exerciseBlockHistoryPanel, styles.exerciseBlockHistoryPanelCollapsed]}
          testID={testID}
          onPress={() => toggleExerciseBlockHistoryCollapsed(exercise.id)}>
          <Text style={styles.exerciseBlockHistoryTitle}>{PAST_RECORDS_LABEL}</Text>
        </Pressable>
      );

      const renderHeader = (metaText: string) => (
        <View style={styles.exerciseBlockHistoryHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Hide ${PAST_RECORDS_LABEL} for exercise ${exerciseIndex + 1}`}
            accessibilityState={{ expanded: true }}
            style={styles.exerciseBlockHistoryHeaderRow}
            testID={`${panelTestId}-toggle`}
            onPress={() => toggleExerciseBlockHistoryCollapsed(exercise.id)}>
            <View style={styles.exerciseBlockHistoryHeadingText}>
              <Text style={styles.exerciseBlockHistoryTitle}>{PAST_RECORDS_LABEL}</Text>
              <Text style={styles.exerciseBlockHistoryAge}>{metaText}</Text>
            </View>
          </Pressable>
        </View>
      );

      if (!panel || panel.status === 'loading') {
        if (isCollapsed) {
          return renderCollapsedPanel(`${panelTestId}-loading-collapsed`);
        }

        return (
          <View
            style={styles.exerciseBlockHistoryPanel}
            testID={`${panelTestId}-loading`}>
            {renderHeader('Loading past records...')}
          </View>
        );
      }

      if (panel.status === 'error') {
        if (isCollapsed) {
          return renderCollapsedPanel(`${panelTestId}-error-collapsed`);
        }

        return (
          <View
            style={styles.exerciseBlockHistoryPanel}
            testID={`${panelTestId}-error`}>
            {renderHeader('Past records unavailable')}
          </View>
        );
      }

      if (panel.blocks.length === 0) {
        if (isCollapsed) {
          return renderCollapsedPanel(`${panelTestId}-empty-collapsed`);
        }

        return (
          <View
            style={styles.exerciseBlockHistoryPanel}
            testID={`${panelTestId}-empty`}>
            {renderHeader('No past records')}
          </View>
        );
      }

      const activeIndex = Math.min(panel.activeIndex, panel.blocks.length - 1);
      const activeBlock = panel.blocks[activeIndex];
      if (!activeBlock) {
        return null;
      }
      const currentMetrics = getCurrentExerciseBlockMetrics(exercise.sets);
      const maxMetrics = getExerciseBlockMaxMetrics(panel.blocks, currentMetrics);
      const historySwipeKey = `${panelTestId}:history`;
      const selectedRecordDate = formatLocalDate(activeBlock.completedAt);
      const recordPosition = `${activeIndex + 1}/${panel.blocks.length}`;

      if (isCollapsed) {
        return renderCollapsedPanel();
      }

      return (
        <View
          style={styles.exerciseBlockHistoryPanel}
          testID={panelTestId}
          onTouchStart={(event) => rememberHorizontalSwipeStart(historySwipeKey, event)}
          onTouchEnd={(event) =>
            consumeHorizontalSwipeEnd(historySwipeKey, event, (direction) => {
              moveExerciseBlockHistory(exercise.id, direction === 'right' ? 'older' : 'newer');
            })
          }>
          {renderHeader(`${formatExerciseBlockAge(activeBlock.daysAgo)} · ${recordPosition} · swipe for records`)}

          <View style={styles.exerciseBlockHistoryComparisonTable}>
              <View style={styles.exerciseBlockHistoryComparisonRow}>
                <Text style={styles.exerciseBlockHistoryMetricLabel} />
                <Text
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                  numberOfLines={1}
                  style={styles.exerciseBlockHistoryColumnHeader}>
                  {selectedRecordDate}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.exerciseBlockHistoryColumnHeader,
                    styles.exerciseBlockHistoryCurrentHeader,
                  ]}>
                  Current
                </Text>
                <Text numberOfLines={1} style={styles.exerciseBlockHistoryColumnHeader}>Max</Text>
              </View>
              <View style={styles.exerciseBlockHistoryComparisonRow}>
                <Text style={styles.exerciseBlockHistoryMetricLabel}>Est. 1RM</Text>
                <Text
                  style={[
                    styles.exerciseBlockHistoryMetricValue,
                    isHistoricalPrMetric(activeBlock.estimatedOneRepMax, maxMetrics.estimatedOneRepMax)
                      ? styles.exerciseBlockHistoryPrValue
                      : null,
                  ]}
                  testID={`${panelTestId}-est-1rm-date`}>
                  {formatExerciseBlockStat(activeBlock.estimatedOneRepMax, 1)}
                </Text>
                <Text
                  style={[
                    styles.exerciseBlockHistoryMetricValue,
                    styles.exerciseBlockHistoryCurrentValue,
                    isCurrentPrMetric(currentMetrics.estimatedOneRepMax, maxMetrics.estimatedOneRepMax)
                      ? styles.exerciseBlockHistoryPrValue
                      : null,
                  ]}
                  testID={`${panelTestId}-est-1rm-current`}>
                  {formatExerciseBlockStat(currentMetrics.estimatedOneRepMax, 1)}
                </Text>
                <Text
                  style={[
                    styles.exerciseBlockHistoryMetricValue,
                    maxMetrics.estimatedOneRepMax !== null ? styles.exerciseBlockHistoryPrValue : null,
                  ]}
                  testID={`${panelTestId}-est-1rm-max`}>
                  {formatExerciseBlockStat(maxMetrics.estimatedOneRepMax, 1)}
                </Text>
              </View>
              <View style={styles.exerciseBlockHistoryComparisonRow}>
                <Text style={styles.exerciseBlockHistoryMetricLabel}>Volume</Text>
                <Text
                  style={[
                    styles.exerciseBlockHistoryMetricValue,
                    isHistoricalPrMetric(activeBlock.totalVolume > 0 ? activeBlock.totalVolume : null, maxMetrics.totalVolume)
                      ? styles.exerciseBlockHistoryPrValue
                      : null,
                  ]}
                  testID={`${panelTestId}-volume-date`}>
                  {formatExerciseBlockVolume(activeBlock.totalVolume)}
                </Text>
                <Text
                  style={[
                    styles.exerciseBlockHistoryMetricValue,
                    styles.exerciseBlockHistoryCurrentValue,
                    isCurrentPrMetric(currentMetrics.totalVolume > 0 ? currentMetrics.totalVolume : null, maxMetrics.totalVolume)
                      ? styles.exerciseBlockHistoryPrValue
                      : null,
                  ]}
                  testID={`${panelTestId}-volume-current`}>
                  {formatExerciseBlockVolume(currentMetrics.totalVolume)}
                </Text>
                <Text
                  style={[
                    styles.exerciseBlockHistoryMetricValue,
                    maxMetrics.totalVolume !== null ? styles.exerciseBlockHistoryPrValue : null,
                  ]}
                  testID={`${panelTestId}-volume-max`}>
                  {maxMetrics.totalVolume === null ? '-' : formatExerciseBlockVolume(maxMetrics.totalVolume)}
                </Text>
              </View>
              <View style={styles.exerciseBlockHistoryComparisonRow}>
                <Text style={styles.exerciseBlockHistoryMetricLabel}>Highest</Text>
                <Text
                  style={[
                    styles.exerciseBlockHistoryMetricValue,
                    isHistoricalPrMetric(activeBlock.highestWeight, maxMetrics.highestWeight)
                      ? styles.exerciseBlockHistoryPrValue
                      : null,
                  ]}
                  testID={`${panelTestId}-highest-date`}>
                  {formatExerciseBlockStat(activeBlock.highestWeight, 1)}
                </Text>
                <Text
                  style={[
                    styles.exerciseBlockHistoryMetricValue,
                    styles.exerciseBlockHistoryCurrentValue,
                    isCurrentPrMetric(currentMetrics.highestWeight, maxMetrics.highestWeight)
                      ? styles.exerciseBlockHistoryPrValue
                      : null,
                  ]}
                  testID={`${panelTestId}-highest-current`}>
                  {formatExerciseBlockStat(currentMetrics.highestWeight, 1)}
                </Text>
                <Text
                  style={[
                    styles.exerciseBlockHistoryMetricValue,
                    maxMetrics.highestWeight !== null ? styles.exerciseBlockHistoryPrValue : null,
                  ]}
                  testID={`${panelTestId}-highest-max`}>
                  {formatExerciseBlockStat(maxMetrics.highestWeight, 1)}
                </Text>
              </View>
              <View style={styles.exerciseBlockHistoryComparisonRow}>
                <Text style={styles.exerciseBlockHistoryMetricLabel}>Working sets</Text>
                <Text
                  style={[
                    styles.exerciseBlockHistoryMetricValue,
                    isHistoricalPrMetric(activeBlock.workingSetCount, maxMetrics.workingSetCount)
                      ? styles.exerciseBlockHistoryPrValue
                      : null,
                  ]}
                  testID={`${panelTestId}-working-set-count-date`}>
                  {activeBlock.workingSetCount}
                </Text>
                <Text
                  style={[
                    styles.exerciseBlockHistoryMetricValue,
                    styles.exerciseBlockHistoryCurrentValue,
                    isCurrentPrMetric(currentMetrics.workingSetCount, maxMetrics.workingSetCount)
                      ? styles.exerciseBlockHistoryPrValue
                      : null,
                  ]}
                  testID={`${panelTestId}-working-set-count-current`}>
                  {currentMetrics.workingSetCount}
                </Text>
                <Text
                  style={[styles.exerciseBlockHistoryMetricValue, styles.exerciseBlockHistoryPrValue]}
                  testID={`${panelTestId}-working-set-count-max`}>
                  {maxMetrics.workingSetCount}
                </Text>
              </View>
          </View>
        </View>
      );
    },
    [
      consumeHorizontalSwipeEnd,
      exerciseBlockHistoryByExerciseId,
      moveExerciseBlockHistory,
      rememberHorizontalSwipeStart,
      toggleExerciseBlockHistoryCollapsed,
    ]
  );

  const openExerciseModal = (exerciseIdToChange: string | null = null) => {
    setState((current) => ({
      ...current,
      exercisePickerVisible: true,
      exerciseSelectionTargetId: exerciseIdToChange,
      exerciseActionMenuVisible: false,
      activeExerciseActionId: null,
    }));
    setExercisePickerOpenRequestId((current) => current + 1);
  };

  const dismissExerciseModal = () => {
    setState((current) => ({
      ...current,
      exercisePickerVisible: false,
      exerciseSelectionTargetId: null,
    }));
  };

  const consumePendingExerciseCardScroll = useCallback((exerciseId: string) => {
    if (pendingExerciseCardScrollIdRef.current !== exerciseId) {
      return;
    }

    const cardY = exerciseCardYByExerciseIdRef.current[exerciseId];
    const scrollView = recorderScrollViewRef.current;
    if (typeof cardY !== 'number' || !scrollView) {
      return;
    }

    scrollView.scrollTo({
      y: Math.max(cardY - 12, 0),
      animated: true,
    });
    pendingExerciseCardScrollIdRef.current = null;
  }, []);

  const expandExerciseCard = useCallback((exerciseId: string) => {
    setCollapsedExerciseIds((current) => {
      if (!current.has(exerciseId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(exerciseId);
      return next;
    });
  }, []);

  const toggleExerciseCollapsed = useCallback((exerciseId: string) => {
    const isCollapsed = collapsedExerciseIds.has(exerciseId);
    if (isCollapsed) {
      expandExerciseCard(exerciseId);
      return;
    }

    const exercise = stateRef.current.session.exercises.find(
      (candidate) => candidate.id === exerciseId
    );
    const exerciseSetIds = new Set(exercise?.sets.map((set) => set.id) ?? []);

    Keyboard.dismiss();
    focusedSetInputIdRef.current = null;
    setExpandedSetIds((current) => {
      const next = new Set(
        [...current].filter((setId) => !exerciseSetIds.has(setId))
      );
      return next.size === current.size ? current : next;
    });
    setActiveRowId((current) => (current && exerciseSetIds.has(current) ? null : current));
    setPendingFocusedWeightSetId((current) =>
      current && exerciseSetIds.has(current) ? null : current
    );
    setActiveSetTypePicker((current) =>
      current?.exerciseId === exerciseId ? null : current
    );
    void autosaveController.flushInputCommit();

    setCollapsedExerciseIds((current) => {
      const next = new Set(current);
      next.add(exerciseId);
      return next;
    });
  }, [autosaveController, collapsedExerciseIds, expandExerciseCard]);

  const revealExerciseCard = useCallback((exerciseId: string | null) => {
    if (!exerciseId) {
      return;
    }

    expandExerciseCard(exerciseId);

    pendingExerciseCardScrollIdRef.current = exerciseId;
    requestAnimationFrame(() => consumePendingExerciseCardScroll(exerciseId));
  }, [consumePendingExerciseCardScroll, expandExerciseCard]);

  const applySelectedExerciseSelection = (exerciseDefinitionId: string, exerciseName: string) => {
    const selectionTargetId = state.exerciseSelectionTargetId;
    const isNewSessionExercise = !selectionTargetId;
    const newSessionExercise = isNewSessionExercise ? createExercise(exerciseDefinitionId, exerciseName) : null;

    setState((current) => ({
      ...current,
      session: {
        ...current.session,
        exercises: current.exerciseSelectionTargetId
          ? current.session.exercises.map((exercise) =>
              exercise.id === current.exerciseSelectionTargetId
                ? { ...exercise, exerciseDefinitionId, name: exerciseName, tags: [] }
                : exercise
            )
          : [...current.session.exercises, newSessionExercise ?? createExercise(exerciseDefinitionId, exerciseName)],
      },
      exercisePickerVisible: false,
      exerciseSelectionTargetId: null,
    }));
    setPendingFocusedWeightSetId(newSessionExercise?.sets[0]?.id ?? null);
    if (selectionTargetId) {
      expandExerciseCard(selectionTargetId);
    }
    clearSubmitFeedback();
    markSessionStructuralMutation();

    if (isNewSessionExercise) {
      void logEvent({
        level: 'info',
        source: 'app',
        event: 'session.exercise_added',
        message: 'A session exercise was added to the active workout log.',
        userId: getAuthSnapshot().user?.id ?? null,
        context: {
          exerciseDefinitionId,
          exerciseName,
        },
      });
    }
  };

  const appendSuggestedPlanToSession = (
    pickedExercise: { id: string; name: string },
    suggestion: ExerciseBlockHistorySuggestedPlan
  ) => {
    if (suggestion.sets.length === 0) {
      return;
    }

    const createdExerciseId = createExerciseId();
    const { targetExerciseId } = appendSuggestedPlan(
      stateRef.current.session,
      pickedExercise,
      suggestion.sets,
      createdExerciseId
    );

    setState((current) => ({
      ...current,
      session: appendSuggestedPlan(
        current.session,
        pickedExercise,
        suggestion.sets,
        createdExerciseId
      ).session,
      exercisePickerVisible: false,
      exerciseSelectionTargetId: null,
    }));

    setPendingFocusedWeightSetId(null);
    revealExerciseCard(targetExerciseId);
    clearSubmitFeedback();
    markSessionStructuralMutation();

    void logEvent({
      level: 'info',
      source: 'app',
      event: 'session.exercise_plan_appended',
      message: 'A historical exercise plan was appended to the active workout log.',
      userId: getAuthSnapshot().user?.id ?? null,
      context: {
        exerciseDefinitionId: pickedExercise.id,
        exerciseName: pickedExercise.name,
        sourceSessionId: suggestion.sessionId,
        targetExerciseId,
        setCount: suggestion.sets.length,
      },
    });
  };

  const openExerciseCatalogFromRecorder = () => {
    pendingExercisePickerRestoreTargetRef.current = state.exerciseSelectionTargetId;
    setState((current) => ({
      ...current,
      exercisePickerVisible: false,
      exerciseActionMenuVisible: false,
      activeExerciseActionId: null,
    }));
    router.push('/exercise-catalog?source=session-recorder&intent=manage');
  };

  const activeActionExerciseDefinitionId =
    state.session.exercises.find((exercise) => exercise.id === state.activeExerciseActionId)?.exerciseDefinitionId ??
    null;

  const linkActiveExerciseFromMenu = () => {
    const exerciseDefinitionId = activeActionExerciseDefinitionId;
    dismissExerciseActionMenu();
    if (exerciseDefinitionId) {
      router.push(exerciseLinkHref(exerciseDefinitionId));
    }
  };

  const openExerciseActionMenu = (exerciseId: string) => {
    setState((current) => ({
      ...current,
      exerciseActionMenuVisible: true,
      activeExerciseActionId: exerciseId,
    }));
  };

  const dismissExerciseActionMenu = () => {
    setState((current) => ({
      ...current,
      exerciseActionMenuVisible: false,
      activeExerciseActionId: null,
    }));
  };

  const removeActiveExerciseFromMenu = () => {
    const removedExerciseId = state.activeExerciseActionId;
    setState((current) => {
      if (!current.activeExerciseActionId) {
        return {
          ...current,
          exerciseActionMenuVisible: false,
          activeExerciseActionId: null,
        };
      }

      return {
        ...current,
        session: {
          ...current.session,
          exercises: current.session.exercises.filter((exercise) => exercise.id !== current.activeExerciseActionId),
        },
        exerciseActionMenuVisible: false,
        activeExerciseActionId: null,
      };
    });
    if (removedExerciseId && activeTagExerciseId === removedExerciseId) {
      dismissTagModal();
    }
    if (removedExerciseId && activeSetTypePicker?.exerciseId === removedExerciseId) {
      setActiveSetTypePicker(null);
    }
    clearSubmitFeedback();
    markSessionStructuralMutation();
  };

  const changeActiveExerciseFromMenu = () => {
    if (!state.activeExerciseActionId) {
      dismissExerciseActionMenu();
      return;
    }

    openExerciseModal(state.activeExerciseActionId);
  };

  const addSetToExercise = (exerciseId: string) => {
    const exercise = state.session.exercises.find((candidate) => candidate.id === exerciseId);
    const previousSet = exercise?.sets[exercise.sets.length - 1];
    const newSet = createSetFromPrevious(previousSet);

    setState((current) => ({
      ...current,
      session: {
        ...current.session,
        exercises: current.session.exercises.map((exercise) =>
          exercise.id === exerciseId
            ? { ...exercise, sets: [...exercise.sets, newSet] }
            : exercise
        ),
      },
    }));
    setActiveRowId(newSet.id);
    setExpandedSetIds((current) => {
      const next = new Set(current);
      if (previousSet && hasValidActualValues(previousSet)) {
        next.delete(previousSet.id);
      }
      next.add(newSet.id);
      return next;
    });
    setPendingFocusedWeightSetId(newSet.id);
    clearSubmitFeedback();
    markSessionStructuralMutation();
  };

  const collapseDisplayableSetRows = () => {
    const displayableSetIds = new Set(
      stateRef.current.session.exercises.flatMap((exercise) =>
        exercise.sets
          .filter((set) => {
            const rowState = getSetRowState(set);
            return hasValidActualValues(set) || rowState === 'planned';
          })
          .map((set) => set.id)
      )
    );

    if (displayableSetIds.size === 0) {
      return;
    }

    setExpandedSetIds((current) => {
      let changed = false;
      const next = new Set(current);
      displayableSetIds.forEach((setId) => {
        if (next.delete(setId)) {
          changed = true;
        }
      });
      return changed ? next : current;
    });
  };

  const focusSetInput = (setId: string) => {
    focusedSetInputIdRef.current = setId;
    activateSetRow(setId);
    setExpandedSetIds(new Set([setId]));
  };

  const handleSetInputBlur = (setId: string) => {
    setPendingFocusedWeightSetId((currentSetId) => (currentSetId === setId ? null : currentSetId));
    if (focusedSetInputIdRef.current === setId) {
      focusedSetInputIdRef.current = null;
    }

    requestAnimationFrame(() => {
      if (!isMountedRef.current) {
        return;
      }

      if (focusedSetInputIdRef.current === null) {
        collapseDisplayableSetRows();

        const currentState = stateRef.current;
        const committedSession = canonicalizeSessionSetWeights(currentState.session);
        if (committedSession !== currentState.session) {
          const committedState = { ...currentState, session: committedSession };
          stateRef.current = committedState;
          setState(committedState);
          markSessionTextMutation();
        }
      }

      void autosaveController.flushInputCommit();
    });
  };

  const updateSetField = (
    exerciseId: string,
    setId: string,
    field: SetFieldName,
    value: string
  ) => {
    const constrainedValue = constrainSetFieldInput(field, value);
    if (constrainedValue === null) {
      return;
    }

    activateSetRow(setId);
    setState((current) => ({
      ...current,
      session: {
        ...current.session,
        exercises: current.session.exercises.map((exercise) =>
          exercise.id === exerciseId
            ? {
                ...exercise,
                sets: exercise.sets.map((set) =>
                  set.id === setId ? { ...set, [field]: constrainedValue } : set
                ),
              }
            : exercise
        ),
      },
    }));
    setExpandedSetIds((current) => {
      if (current.size === 1 && current.has(setId)) {
        return current;
      }
      return new Set([setId]);
    });
    clearSubmitFeedback();
    markSessionTextMutation();
  };

  const toggleSetPerformance = (exerciseId: string, setId: string) => {
    activateSetRow(setId);
    const targetSet = stateRef.current.session.exercises
      .find((exercise) => exercise.id === exerciseId)
      ?.sets.find((set) => set.id === setId);
    if (!targetSet) {
      return;
    }

    const isCurrentlyPerformed = hasPerformedActual(targetSet);
    const hasEnteredActualValues =
      targetSet.reps.trim().length > 0 || targetSet.weight.trim().length > 0;
    const usePlannedValues =
      !isCurrentlyPerformed &&
      hasPlannedTarget(targetSet) &&
      (targetSet.performanceStatus === 'planned' ||
        targetSet.performanceStatus === 'skipped' ||
        !hasEnteredActualValues);
    const nextReps = usePlannedValues
      ? targetSet.plannedReps ?? targetSet.reps
      : targetSet.reps;
    const nextWeight = canonicalizeWeightForReps(
      usePlannedValues ? targetSet.plannedWeight ?? targetSet.weight : targetSet.weight,
      nextReps
    );
    const nextSetType = usePlannedValues
      ? normalizeSessionSetType(targetSet.plannedSetType)
      : normalizeSessionSetType(targetSet.setType);

    if (
      !isCurrentlyPerformed &&
      !hasValidActualValues({ reps: nextReps, weight: nextWeight })
    ) {
      setExpandedSetIds(new Set([setId]));
      clearSubmitFeedback();
      return;
    }

    setState((current) => ({
      ...current,
      session: {
        ...current.session,
        exercises: current.session.exercises.map((exercise) =>
          exercise.id === exerciseId
            ? {
                ...exercise,
                sets: exercise.sets.map((set) =>
                  set.id === setId
                    ? {
                        ...set,
                        reps: isCurrentlyPerformed ? set.reps : nextReps,
                        weight: isCurrentlyPerformed ? set.weight : nextWeight,
                        setType: isCurrentlyPerformed ? set.setType : nextSetType,
                        performanceStatus: isCurrentlyPerformed ? 'unperformed' : null,
                      }
                    : set
                ),
              }
            : exercise
        ),
      },
    }));
    if (!isCurrentlyPerformed) {
      setExpandedSetIds((current) => {
        const next = new Set(current);
        next.delete(setId);
        return next;
      });
    }
    clearSubmitFeedback();
    markSessionTextMutation();
  };

  const consumeTapIfAnotherSetIsExpanded = (setId: string): boolean => {
    if (expandedSetIds.size === 0 || expandedSetIds.has(setId)) {
      return false;
    }

    setExpandedSetIds(new Set());
    return true;
  };

  const toggleSetExpandedForEditing = (exerciseId: string, setId: string) => {
    if (consumeTapIfAnotherSetIsExpanded(setId)) {
      return;
    }

    activateSetRow(setId);
    const shouldOpen = !expandedSetIds.has(setId);

    if (!shouldOpen) {
      setExpandedSetIds(new Set());
      return;
    }

    const targetSet = stateRef.current.session.exercises
      .find((exercise) => exercise.id === exerciseId)
      ?.sets.find((set) => set.id === setId);
    const shouldHydratePlan =
      targetSet !== undefined &&
      hasPlannedTarget(targetSet) &&
      getSetRowState(targetSet) === 'planned';

    if (shouldHydratePlan) {
      setState((current) => ({
        ...current,
        session: {
          ...current.session,
          exercises: current.session.exercises.map((exercise) =>
            exercise.id === exerciseId
              ? {
                  ...exercise,
                  sets: exercise.sets.map((set) =>
                    set.id === setId
                      ? hydratePlannedSetForEditing(set)
                      : set
                  ),
                }
              : exercise
          ),
        },
      }));
      clearSubmitFeedback();
      markSessionTextMutation();
    }
    setExpandedSetIds(new Set([setId]));
  };

  const updateSetType = (exerciseId: string, setId: string, setType: SessionSetTypeValue) => {
    const nextSetType = normalizeSessionSetType(setType);
    activateSetRow(setId);
    setState((current) => ({
      ...current,
      session: {
        ...current.session,
        exercises: current.session.exercises.map((exercise) =>
          exercise.id === exerciseId
            ? {
                ...exercise,
                sets: exercise.sets.map((set) => (set.id === setId ? { ...set, setType: nextSetType } : set)),
              }
            : exercise
        ),
      },
    }));
    clearSubmitFeedback();
    markSessionTextMutation();
  };

  const cycleSetType = (exerciseId: string, setId: string, currentSetType: SessionSetTypeValue) => {
    updateSetType(exerciseId, setId, getNextSetType(currentSetType));
  };

  const openSetTypePicker = (input: SetTypePickerState) => {
    activateSetRow(input.setId);
    setActiveSetTypePicker(input);
  };

  const dismissSetTypePicker = () => {
    setActiveSetTypePicker(null);
  };

  const selectSetTypeFromPicker = (setType: SessionSetTypeValue) => {
    if (!activeSetTypePicker) {
      return;
    }
    updateSetType(activeSetTypePicker.exerciseId, activeSetTypePicker.setId, setType);
    setActiveSetTypePicker(null);
  };

  const updateSessionStartDateTime = (value: string) => {
    setState((current) => ({
      ...current,
      session: {
        ...current.session,
        dateTime: value,
      },
    }));
    clearSubmitFeedback();
    setCompletedEditAutosaveNotice(null);
    markSessionTextMutation();
  };

  const updateCompletedEditEndDateTimeValue = (value: string) => {
    setCompletedEditEndDateTime(value);
    clearSubmitFeedback();
    setCompletedEditAutosaveNotice(null);
    markSessionTextMutation();
  };

  const handleCompletedEditStartBlur = () => {
    setCompletedEditStartTouched(true);
  };

  const handleCompletedEditEndBlur = () => {
    setCompletedEditEndTouched(true);
  };

  const removeSetFromExercise = (exerciseId: string, setId: string) => {
    clearSetRowMemory(setId);
    setState((current) => ({
      ...current,
      session: {
        ...current.session,
        exercises: current.session.exercises.map((exercise) =>
          exercise.id === exerciseId
            ? { ...exercise, sets: exercise.sets.filter((set) => set.id !== setId) }
            : exercise
        ),
      },
    }));
    if (
      activeSetTypePicker &&
      activeSetTypePicker.exerciseId === exerciseId &&
      activeSetTypePicker.setId === setId
    ) {
      setActiveSetTypePicker(null);
    }
    clearSubmitFeedback();
    markSessionStructuralMutation();
  };

  const resetTagModalState = useCallback(() => {
    setTagModalMode('picker');
    setActiveTagExerciseId(null);
    setTagSearchValue('');
    setTagDefinitions([]);
    setTagModalError(null);
    setShowDeletedTagsInManager(false);
    setEditingTagDefinitionId(null);
    setEditingTagName('');
    setIsTagDefinitionsLoading(false);
    setIsTagMutationInFlight(false);
  }, []);

  const dismissTagModal = useCallback(() => {
    setIsTagModalVisible(false);
    resetTagModalState();
  }, [resetTagModalState]);

  const openTagModal = useCallback(
    (exerciseId: string) => {
      const targetExercise = stateRef.current.session.exercises.find((exercise) => exercise.id === exerciseId);
      if (!targetExercise) {
        return;
      }

      setActiveTagExerciseId(exerciseId);
      setIsTagModalVisible(true);
      setTagModalMode('picker');
      setTagSearchValue('');
      setTagModalError(null);
      setShowDeletedTagsInManager(false);
      setEditingTagDefinitionId(null);
      setEditingTagName('');
      void reloadTagDefinitions(targetExercise.exerciseDefinitionId);
    },
    [reloadTagDefinitions]
  );

  const withTagMutation = useCallback(
    async (operation: () => Promise<void>) => {
      setIsTagMutationInFlight(true);
      setTagModalError(null);
      try {
        await operation();
      } catch (error) {
        setTagModalError(getTagErrorMessage(error));
      } finally {
        setIsTagMutationInFlight(false);
      }
    },
    []
  );

  const attachTagToExercise = useCallback(
    async (sessionExerciseId: string, tagDefinitionId: string) => {
      await withTagMutation(async () => {
        const persisted = await persistSessionGraphForTagOps();
        if (!persisted) {
          setTagModalError('Save session times first, then try adding tags.');
          return;
        }

        await attachExerciseTagToSessionExercise({
          sessionExerciseId,
          tagDefinitionId,
        });
        await refreshAssignedTagsForExercise(sessionExerciseId);
        markSessionStructuralMutation();
        dismissTagModal();
      });
    },
    [dismissTagModal, markSessionStructuralMutation, persistSessionGraphForTagOps, refreshAssignedTagsForExercise, withTagMutation]
  );

  const removeAssignedTagFromExercise = useCallback(
    async (sessionExerciseId: string, tagDefinitionId: string) => {
      await withTagMutation(async () => {
        await removeExerciseTagFromSessionExercise({
          sessionExerciseId,
          tagDefinitionId,
        });
        await refreshAssignedTagsForExercise(sessionExerciseId);
        markSessionStructuralMutation();
      });
    },
    [markSessionStructuralMutation, refreshAssignedTagsForExercise, withTagMutation]
  );

  const createTagForActiveExercise = useCallback(
    async (sessionExerciseId: string, exerciseDefinitionId: string, draftTagName: string) => {
      await withTagMutation(async () => {
        const persisted = await persistSessionGraphForTagOps();
        if (!persisted) {
          setTagModalError('Save session times first, then try adding tags.');
          return;
        }

        const createdTag = await createExerciseTagDefinition({
          exerciseDefinitionId,
          name: draftTagName,
        });
        await attachExerciseTagToSessionExercise({
          sessionExerciseId,
          tagDefinitionId: createdTag.id,
        });
        setTagSearchValue('');
        await reloadTagDefinitions(exerciseDefinitionId);
        await refreshAssignedTagsForExercise(sessionExerciseId);
        markSessionStructuralMutation();
        dismissTagModal();
      });
    },
    [
      dismissTagModal,
      markSessionStructuralMutation,
      persistSessionGraphForTagOps,
      refreshAssignedTagsForExercise,
      reloadTagDefinitions,
      withTagMutation,
    ]
  );

  const saveTagRename = useCallback(
    async (exerciseDefinitionId: string, tagDefinitionId: string, nextName: string) => {
      await withTagMutation(async () => {
        await renameExerciseTagDefinition({
          tagDefinitionId,
          name: nextName,
        });
        setEditingTagDefinitionId(null);
        setEditingTagName('');
        await reloadTagDefinitions(exerciseDefinitionId);
        const currentActiveExerciseId = activeTagExerciseId;
        if (currentActiveExerciseId) {
          await refreshAssignedTagsForExercise(currentActiveExerciseId);
        }
      });
    },
    [activeTagExerciseId, refreshAssignedTagsForExercise, reloadTagDefinitions, withTagMutation]
  );

  const setManagedTagDeletedState = useCallback(
    async (exerciseDefinitionId: string, tagDefinitionId: string, isDeleted: boolean) => {
      await withTagMutation(async () => {
        if (isDeleted) {
          await deleteExerciseTagDefinition(tagDefinitionId);
        } else {
          await undeleteExerciseTagDefinition(tagDefinitionId);
        }
        await reloadTagDefinitions(exerciseDefinitionId);
        const currentActiveExerciseId = activeTagExerciseId;
        if (currentActiveExerciseId) {
          await refreshAssignedTagsForExercise(currentActiveExerciseId);
        }
      });
    },
    [activeTagExerciseId, refreshAssignedTagsForExercise, reloadTagDefinitions, withTagMutation]
  );

  const finalizeSubmit = (submittedSession: Session) => {
    setState((current) => ({
      ...current,
      session: submittedSession,
    }));

    void (async () => {
      const parsedStartedAt = parseSessionDateTime(submittedSession.dateTime);
      if (!parsedStartedAt) {
        return;
      }
      const submittedGym =
        submittedSession.locationId === null
          ? null
          : stateRef.current.locations.find((location) => location.id === submittedSession.locationId) ?? null;
      await autosaveController.flushNow();

      if (submittedGym) {
        await upsertLocalGym({
          id: submittedGym.id,
          name: submittedGym.name,
        });
      }

      if (routeMode === 'completed-edit') {
        const endTimeText = completedEditEndDateTimeRef.current;
        if (!endTimeText || !persistedSessionIdRef.current) {
          return;
        }

        const parsedCompletedAt = parseSessionDateTime(endTimeText);
        if (!parsedCompletedAt) {
          return;
        }

        await persistCompletedSessionSnapshot({
          sessionId: persistedSessionIdRef.current,
          gymId: submittedGym?.id ?? null,
          startedAt: parsedStartedAt,
          completedAt: parsedCompletedAt,
          exercises: toPersistCompletedExercises(submittedSession),
        });

        hasSessionMutationRef.current = false;
        // Both routes live in the same (tabs) Stack screen, so dismissTo finds nothing to pop;
        // use replace to actually switch the active tab to Stats/History.
        router.replace('/progress');
        return;
      }

      const persisted = await persistSessionDraftSnapshot({
        sessionId: persistedSessionIdRef.current ?? undefined,
        gymId: submittedGym?.id ?? null,
        startedAt: parsedStartedAt,
        status: 'active',
        exercises: toPersistCompletedExercises(submittedSession),
      });

      await completeSessionDraft(persisted.sessionId);
      persistedSessionIdRef.current = null;
      hasSessionMutationRef.current = false;
      setHasActiveSession(false);
      router.replace(
        `/completed-session/${persisted.sessionId}?presentation=completion${
          shouldFailNextMaestroShare ? '&maestroShare=fail-once' : ''
        }`
      );
    })().catch(() => {
      // Keep recorder screen state available for retry if persistence/complete/navigation fails.
    });
  };

  const beginSubmitFlow = (sessionCandidate: Session) => {
    const committedSession = canonicalizeSessionSetWeights(sessionCandidate);
    const { session: withoutIncompleteSets, removedSets } = removeIncompleteSets(committedSession);
    if (removedSets > 0) {
      setSubmitCleanupPrompt({
        step: 'incomplete-sets',
        affectedCount: removedSets,
        nextSession: withoutIncompleteSets,
      });
      return;
    }

    const { session: withoutUnconfirmedSets, removedSets: removedUnconfirmedSets } =
      removeUnconfirmedSets(withoutIncompleteSets);
    if (removedUnconfirmedSets > 0) {
      setSubmitCleanupPrompt({
        step: 'unconfirmed-sets',
        affectedCount: removedUnconfirmedSets,
        nextSession: withoutUnconfirmedSets,
      });
      return;
    }

    const completedHistorySession = toCompletedHistorySession(withoutUnconfirmedSets);
    const { session: withoutEmptyExercises, removedExercises } = removeExercisesWithNoSets(completedHistorySession);
    if (removedExercises > 0) {
      setSubmitCleanupPrompt({
        step: 'empty-exercises',
        affectedCount: removedExercises,
        nextSession: withoutEmptyExercises,
      });
      return;
    }

    setSubmitCleanupPrompt(null);
    finalizeSubmit(completedHistorySession);
  };

  const handleSubmit = () => {
    if (routeMode === 'completed-edit') {
      const validationMessage = getDateTimeValidationMessage(state.session.dateTime, completedEditEndDateTime);
      if (validationMessage) {
        setCompletedEditSubmitAttempted(true);
        setCompletedEditStartTouched(true);
        setCompletedEditEndTouched(true);
        setCompletedEditAutosaveNotice(null);
        return;
      }
    }

    if (sessionHasInvalidSetValues(state.session)) {
      return;
    }

    beginSubmitFlow(state.session);
  };

  const confirmSubmitCleanup = () => {
    if (!submitCleanupPrompt) {
      return;
    }

    beginSubmitFlow(submitCleanupPrompt.nextSession);
  };

  const cancelSubmitCleanup = () => {
    setSubmitCleanupPrompt(null);
  };

  const gymEditorPrimaryLabel = state.editingLocationId ? 'Save' : 'Add';
  const gymEditorTitle = state.editingLocationId ? 'Edit Gym' : 'Add Gym';
  const gymEditorInputValue = state.editingLocationId ? state.editingLocationName : state.pendingLocationName;
  const editingGym = state.editingLocationId
    ? state.locations.find((location) => location.id === state.editingLocationId) ?? null
    : null;
  const editorCoordinateFeedbackId = editingGym?.id ?? NEW_GYM_COORDINATE_FEEDBACK_ID;
  const editorCoordinateFeedback =
    gymCoordinateFeedback?.gymId === editorCoordinateFeedbackId ? gymCoordinateFeedback : null;
  const isEditorCoordinateLoading = gymCoordinateLoadingId === editorCoordinateFeedbackId;
  const editingGymHasCoordinates = editingGym ? hasSavedGymCoordinates(editingGym) : false;
  const pendingEditorCoordinateAction =
    editingGym && pendingGymCoordinateAction?.gymId === editingGym.id ? pendingGymCoordinateAction.action : null;
  const activeTagExercise =
    activeTagExerciseId === null
      ? null
      : state.session.exercises.find((exercise) => exercise.id === activeTagExerciseId) ?? null;
  const activeTagExerciseDefinitionId = activeTagExercise?.exerciseDefinitionId ?? null;
  const activeTagExerciseAssignedTagIds = useMemo(
    () => new Set((activeTagExercise?.tags ?? []).map((tag) => tag.tagDefinitionId)),
    [activeTagExercise]
  );
  const normalizedTagSearch = normalizeTagName(tagSearchValue);
  const filteredActiveTagDefinitions = useMemo(
    () =>
      tagDefinitions.filter((tagDefinition) => {
        if (tagDefinition.deletedAt) {
          return false;
        }
        if (!normalizedTagSearch) {
          return true;
        }
        return tagDefinition.normalizedName.includes(normalizedTagSearch);
      }),
    [normalizedTagSearch, tagDefinitions]
  );
  const visibleManagedTagDefinitions = useMemo(
    () =>
      showDeletedTagsInManager
        ? tagDefinitions
        : tagDefinitions.filter((tagDefinition) => !tagDefinition.deletedAt),
    [showDeletedTagsInManager, tagDefinitions]
  );
  const hasTagDefinitionExactMatch = useMemo(
    () => (normalizedTagSearch ? tagDefinitions.some((tagDefinition) => tagDefinition.normalizedName === normalizedTagSearch) : false),
    [normalizedTagSearch, tagDefinitions]
  );
  const canCreateTagFromSearch = normalizedTagSearch.length > 0 && !hasTagDefinitionExactMatch;
  const addTagFromSearchDisabled =
    isTagMutationInFlight || !activeTagExerciseDefinitionId || !activeTagExercise || !canCreateTagFromSearch;
  const selectedSetTypeInPicker = useMemo(() => {
    if (!activeSetTypePicker) {
      return null;
    }
    const activeExercise = state.session.exercises.find((exercise) => exercise.id === activeSetTypePicker.exerciseId);
    const activeSet = activeExercise?.sets.find((set) => set.id === activeSetTypePicker.setId);
    return normalizeSessionSetType(activeSet?.setType);
  }, [activeSetTypePicker, state.session.exercises]);
  const cleanupModalTitle =
    submitCleanupPrompt?.step === 'incomplete-sets'
      ? 'Remove incomplete sets and submit?'
      : submitCleanupPrompt?.step === 'unconfirmed-sets'
        ? 'Discard unconfirmed sets and submit?'
        : 'Remove exercises with no sets and submit?';
  const cleanupModalMessage =
    submitCleanupPrompt?.step === 'incomplete-sets'
      ? `${submitCleanupPrompt.affectedCount} incomplete set${
          submitCleanupPrompt.affectedCount === 1 ? '' : 's'
        } missing reps or weight will be removed.`
      : submitCleanupPrompt?.step === 'unconfirmed-sets'
        ? `${submitCleanupPrompt.affectedCount} set${
            submitCleanupPrompt.affectedCount === 1 ? '' : 's'
          } with entered values ${
            submitCleanupPrompt.affectedCount === 1 ? 'is' : 'are'
          } not confirmed and will be discarded.`
        : `${submitCleanupPrompt?.affectedCount ?? 0} exercise${
            submitCleanupPrompt?.affectedCount === 1 ? '' : 's'
          } with no sets will be removed.`;
  const cleanupModalConfirmLabel =
    submitCleanupPrompt?.step === 'incomplete-sets'
      ? routeMode === 'completed-edit'
        ? 'Remove incomplete sets and save changes'
        : 'Remove incomplete sets and submit'
      : submitCleanupPrompt?.step === 'unconfirmed-sets'
        ? routeMode === 'completed-edit'
          ? 'Discard unconfirmed sets and save changes'
          : 'Discard unconfirmed sets and submit'
        : routeMode === 'completed-edit'
          ? 'Remove empty exercises and save changes'
          : 'Remove empty exercises and submit';

  const completedEditTimeValidationMessage =
    routeMode === 'completed-edit' ? getDateTimeValidationMessage(state.session.dateTime, completedEditEndDateTime) : null;
  const completedEditStartValidationMessage =
    routeMode === 'completed-edit'
      ? getCompletedEditStartTimeValidationMessage(state.session.dateTime)
      : null;
  const completedEditEndValidationMessage =
    routeMode === 'completed-edit'
      ? getCompletedEditEndTimeValidationMessage(state.session.dateTime, completedEditEndDateTime)
      : null;
  const showCompletedEditStartValidationError =
    Boolean(completedEditStartValidationMessage) && (completedEditStartTouched || completedEditSubmitAttempted);
  const showCompletedEditEndValidationError =
    Boolean(completedEditEndValidationMessage) && (completedEditEndTouched || completedEditSubmitAttempted);
  const showCompletedEditSaveBlockedNotice =
    routeMode === 'completed-edit' &&
    Boolean(completedEditTimeValidationMessage) &&
    (completedEditStartTouched || completedEditEndTouched || completedEditSubmitAttempted);
  const hasInvalidSetValues = useMemo(() => sessionHasInvalidSetValues(state.session), [state.session]);
  const currentExerciseNameByDefinitionId = useMemo(
    () => new Map(exerciseCatalog.exercises.map((exercise) => [exercise.id, exercise.name])),
    [exerciseCatalog.exercises]
  );
  const currentSessionInsightExercises = useMemo(
    () => toSessionInsightExercises(state.session, currentExerciseNameByDefinitionId),
    [currentExerciseNameByDefinitionId, state.session]
  );
  const currentSessionPerformedSetCount = useMemo(
    () =>
      state.session.exercises.reduce(
        (count, exercise) => count + exercise.sets.filter(hasPerformedActual).length,
        0
      ),
    [state.session.exercises]
  );
  const currentSessionWorkingSetCount = useMemo(
    () =>
      state.session.exercises.reduce(
        (count, exercise) =>
          count +
          exercise.sets.filter(
            (set) => hasPerformedActual(set) && isWorkingSessionSetType(set.setType)
          ).length,
        0
      ),
    [state.session.exercises]
  );
  const currentSessionMuscleSummary = useMemo(() => {
    if (routeMode !== 'active' || exerciseCatalog.status !== 'ready') {
      return null;
    }

    return summarizeCurrentSessionMuscleLoad({
      sessionId: persistedSessionIdRef.current ?? 'active-session',
      sessionAt: parseSessionDateTime(state.session.dateTime) ?? new Date(0),
      exercises: currentSessionInsightExercises,
      exerciseDefinitions: exerciseCatalog.exercises.map((exercise) => ({
        id: exercise.id,
        loadInputMode: exercise.loadInputMode ?? 'total_load',
      })),
      muscleMappings: exerciseCatalog.exercises.flatMap((exercise) =>
        exercise.mappings.map((mapping) => ({
          exerciseDefinitionId: exercise.id,
          muscleGroupId: mapping.muscleGroupId,
          role: mapping.role,
          weight: mapping.weight,
        }))
      ),
      muscleGroups: exerciseCatalog.muscleGroups,
    });
  }, [currentSessionInsightExercises, exerciseCatalog.exercises, exerciseCatalog.muscleGroups, exerciseCatalog.status, routeMode, state.session.dateTime]);
  const currentSessionPersonalRecordByExerciseId = useMemo(() => {
    const personalRecords = new Map<string, ExercisePersonalRecord>();
    if (routeMode !== 'active') {
      return personalRecords;
    }

    for (const exercise of state.session.exercises) {
      const panel = exerciseBlockHistoryByExerciseId[exercise.id];
      if (!panel || panel.status !== 'success') continue;
      const historicalBestEstimatedOneRepMax = getNullableMetricMax(
        panel.blocks.map((block) => block.estimatedOneRepMax)
      );
      const personalRecord = deriveExercisePersonalRecord({
        exerciseDefinitionId: exercise.exerciseDefinitionId,
        exercises: currentSessionInsightExercises,
        historicalBestEstimatedOneRepMax,
      });
      if (personalRecord && personalRecord.sessionExerciseId === exercise.id) {
        personalRecords.set(exercise.id, personalRecord);
      }
    }

    return personalRecords;
  }, [currentSessionInsightExercises, exerciseBlockHistoryByExerciseId, routeMode, state.session.exercises]);
  const currentSessionMuscleCatalogState =
    exerciseCatalog.status === 'error'
      ? 'error'
      : exerciseCatalog.status === 'ready'
        ? 'ready'
        : 'loading';
  const isSubmitDisabled =
    (routeMode === 'completed-edit' && Boolean(completedEditTimeValidationMessage)) || hasInvalidSetValues;
  const openCompletedSessionSummary = useCallback(() => {
    if (
      routeMode !== 'completed-edit' ||
      !routeSessionId ||
      isSubmitDisabled ||
      isOpeningCompletedSummary
    ) {
      return;
    }

    setIsOpeningCompletedSummary(true);
    void autosaveController
      .flushNow()
      .then(() => {
        hasSessionMutationRef.current = false;
        router.push(`/completed-session/${routeSessionId}?presentation=summary`);
      })
      .catch(() => {
        setCompletedEditAutosaveNotice(
          'Unable to save changes before opening the summary. Try again.'
        );
      })
      .finally(() => {
        setIsOpeningCompletedSummary(false);
      });
  }, [
    autosaveController,
    isOpeningCompletedSummary,
    isSubmitDisabled,
    routeMode,
    routeSessionId,
    router,
  ]);
  const gymButtonLabel = selectedGym ? selectedGym.name : 'No gym';
  const canLongPressRetryGymDetection = routeMode !== 'completed-edit' && hasActiveSession;
  const gymSelectionControl = (
    <View style={styles.gymSelectionStack}>
      <Pressable
        accessibilityHint={
          canLongPressRetryGymDetection
            ? 'Long press to retry current-location gym detection.'
            : undefined
        }
        accessibilityState={{ busy: isGpsDetectionInFlight }}
        style={styles.gymButton}
        onPress={openGymModal}
        onLongPress={() => {
          if (!canLongPressRetryGymDetection) {
            return;
          }
          void retryGpsGymSelection();
        }}>
        <Text numberOfLines={1} style={styles.gymButtonText}>
          {gymButtonLabel}
        </Text>
      </Pressable>
    </View>
  );

  if (routeMode === 'completed-edit' && isCompletedEditLoading) {
    return (
      <View style={styles.loadingState} testID="completed-edit-recorder-loading">
        <Text style={styles.loadingStateTitle}>Loading completed session...</Text>
      </View>
    );
  }

  if (routeMode === 'completed-edit' && completedEditLoadError) {
    return (
      <View style={styles.loadingState} testID="completed-edit-recorder-error">
        <Text style={styles.loadingStateTitle}>Unable to open completed session</Text>
        <Text style={styles.loadingStateBody}>{completedEditLoadError}</Text>
      </View>
    );
  }

  const showEmptyStartCta =
    routeMode !== 'completed-edit' && isPersistenceHydrated && !hasActiveSession;

  if (showEmptyStartCta) {
    return (
      <View style={styles.emptyStateScreen} testID="session-recorder-empty-state">
        <Pressable
          accessibilityLabel="Start session"
          accessibilityRole="button"
          disabled={isStartingSession}
          onPress={() => {
            void startSessionFromEmptyState();
          }}
          style={[
            styles.startSessionButton,
            isStartingSession ? styles.startSessionButtonDisabled : null,
          ]}
          testID="start-session-button">
          <Text style={styles.startSessionButtonText}>Start Session</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoidingRoot}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={collapseDisplayableSetRows}
        ref={recorderScrollViewRef}
        testID="session-recorder-screen">
      {routeMode === 'completed-edit' ? (
        <View style={styles.completedEditNavigationBar} testID="completed-edit-navigation-bar">
          <Pressable
            accessibilityLabel="Back to Session History"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.replace('/sessions')}
            style={styles.completedEditNavigationAction}
            testID="completed-edit-history-button">
            <Text style={styles.completedEditNavigationActionText}>History</Text>
          </Pressable>
          <Text style={styles.completedEditNavigationTitle}>Edit session</Text>
          <Pressable
            accessibilityLabel="Show session summary"
            accessibilityRole="button"
            accessibilityState={{
              busy: isOpeningCompletedSummary,
              disabled: isSubmitDisabled || isOpeningCompletedSummary,
            }}
            disabled={isSubmitDisabled || isOpeningCompletedSummary}
            hitSlop={8}
            onPress={openCompletedSessionSummary}
            style={styles.completedEditNavigationAction}
            testID="completed-edit-summary-button">
            <Text
              style={[
                styles.completedEditNavigationActionText,
                isSubmitDisabled || isOpeningCompletedSummary
                  ? styles.completedEditNavigationActionTextDisabled
                  : null,
              ]}>
              {isOpeningCompletedSummary ? 'Opening…' : 'Summary'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {routeMode === 'completed-edit' ? (
        <View style={styles.completedEditMetadataCard}>
          <View style={styles.completedEditMetadataRow}>
            <Text style={styles.completedEditMetadataLabel}>Start time</Text>
            <TextInput
              accessibilityLabel="Session start time"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="YYYY-MM-DD HH:mm"
              style={styles.input}
              testID="completed-edit-start-time-input"
              value={state.session.dateTime}
              onChangeText={updateSessionStartDateTime}
              onBlur={handleCompletedEditStartBlur}
            />
            {showCompletedEditStartValidationError ? (
              <Text style={styles.validationErrorText} testID="completed-edit-start-time-validation-error">
                {completedEditStartValidationMessage}
              </Text>
            ) : null}
          </View>

          <View style={[styles.completedEditMetadataRow, styles.completedEditMetadataRowDivider]}>
            <Text style={styles.completedEditMetadataLabel}>End time</Text>
            <TextInput
              accessibilityLabel="Session end time"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="YYYY-MM-DD HH:mm"
              style={styles.input}
              testID="completed-edit-end-time-input"
              value={completedEditEndDateTime ?? ''}
              onChangeText={updateCompletedEditEndDateTimeValue}
              onBlur={handleCompletedEditEndBlur}
            />
            {showCompletedEditEndValidationError ? (
              <Text style={styles.validationErrorText} testID="completed-edit-time-validation-error">
                {completedEditEndValidationMessage}
              </Text>
            ) : null}
            {completedEditAutosaveNotice ? (
              <Text style={styles.completedEditHintText} testID="completed-edit-autosave-notice">
                {completedEditAutosaveNotice}
              </Text>
            ) : null}
          </View>

          <View style={[styles.completedEditMetadataRow, styles.completedEditMetadataRowDivider]}>
            <Text style={styles.completedEditMetadataLabel}>Gym</Text>
            {gymSelectionControl}
          </View>
        </View>
      ) : null}

      <SessionContentLayout<SessionSet, SessionExercise>
        collapsedExerciseIds={collapsedExerciseIds}
        onToggleExerciseCollapse={toggleExerciseCollapsed}
        renderCollapsedExerciseSummary={({ exercise, exerciseIndex }) => {
          const performedSets = getPerformedExerciseSets(exercise.sets);
          const workingSetCount = performedSets.filter(
            (set) => {
              const setType = normalizeSessionSetType(set.setType);
              return isWorkingSessionSetType(setType);
            }
          ).length;

          return (
            <ExerciseCardCollapsedSummary
              workingSetCount={workingSetCount}
              newPersonalRecord={currentSessionPersonalRecordByExerciseId.get(exercise.id)}
              setCount={performedSets.length}
              testID={`exercise-collapsed-summary-${exerciseIndex + 1}`}
            />
          );
        }}
        showMetadataSection={routeMode !== 'completed-edit'}
        dateTimeValue={
          <View accessibilityLabel="Session date and time" style={styles.readOnlyInput}>
            <Text style={styles.readOnlyInputText}>{state.session.dateTime}</Text>
          </View>
        }
        gymValue={
          gymSelectionControl
        }
        exercises={state.session.exercises}
        getExerciseCardProps={({ exercise, exerciseIndex }) => ({
          accessibilityLabel: `Exercise ${exerciseIndex + 1}: ${exercise.name}`,
          onLayout: (event) => {
            exerciseCardYByExerciseIdRef.current[exercise.id] = event.nativeEvent.layout.y;
            if (pendingExerciseCardScrollIdRef.current === exercise.id) {
              requestAnimationFrame(() => consumePendingExerciseCardScroll(exercise.id));
            }
          },
          testID: `session-exercise-card-${exerciseIndex + 1}`,
        })}
        renderSetRow={({ exercise, exerciseIndex, set, setIndex }) => {
          const rowState = getSetRowState(set);
          const isPlannedRow = hasPlannedTarget(set);
          const exerciseHasPlannedTargets = exercise.sets.some(hasPlannedTarget);
          const isExpanded = expandedSetIds.has(set.id);
          const isAddedBeyondPlan = exerciseHasPlannedTargets && rowState === 'added';
          const isConfirmedPerformed = hasPerformedActual(set);
          const isDisplayableRow = rowState === 'planned' || hasValidActualValues(set);
          const isCompactSetRow = isDisplayableRow && !isExpanded;
          const compactQuality = getSetQualityForRow(set, rowState);
          const compactQualityAccessibilityLabel = getSetTypeAccessibilityLabel(compactQuality);
          const showQualityControl = rowState !== 'planned';
          const isMutedRow = rowState === 'planned';
          const isActiveRow = activeRowId === set.id;
          const plannedLabel = getPlannedSetLabel(set);
          const actualLabel = getActualSetLabel(set);
          const compactLabel =
            rowState === 'modified'
              ? `${plannedLabel}; actual ${actualLabel}`
              : rowState === 'added' || !isPlannedRow
                ? actualLabel
                : plannedLabel;
          const planStateLabel =
            rowState === 'matched'
              ? 'matched planned set'
              : rowState === 'modified'
                ? 'modified planned set'
                : rowState === 'planned'
                  ? 'planned set'
                  : isAddedBeyondPlan
                    ? 'added set'
                    : 'set';
          const stateLabel = `${isConfirmedPerformed ? 'confirmed' : 'unconfirmed'} ${planStateLabel}`;
          const swipeActionKey = `set:${exercise.id}:${set.id}`;
          const removeSetFromSwipe = (direction: HorizontalSwipeDirection) => {
            if (direction !== 'left') {
              return;
            }
            removeSetFromExercise(exercise.id, set.id);
          };

          const renderPerformanceControl = () => (
            <Pressable
              accessibilityHint={
                isConfirmedPerformed
                  ? 'Double tap to keep the values but mark this set unperformed.'
                  : 'Double tap to confirm valid entered values as performed.'
              }
              accessibilityLabel={`${
                isConfirmedPerformed ? 'Mark' : 'Confirm'
              } exercise ${exerciseIndex + 1} set ${setIndex + 1} ${
                isConfirmedPerformed ? 'unperformed' : 'performed'
              }`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isConfirmedPerformed }}
              hitSlop={6}
              style={styles.setPerformanceControl}
              testID={`set-performance-control-${exerciseIndex + 1}-${setIndex + 1}`}
              onPress={() => toggleSetPerformance(exercise.id, set.id)}>
              <Text
                style={[
                  styles.setPerformanceControlGlyph,
                  isConfirmedPerformed ? styles.setPerformanceControlGlyphConfirmed : null,
                ]}>
                {isConfirmedPerformed ? '✓' : '○'}
              </Text>
            </Pressable>
          );

          const renderQualityButton = (variant: 'compact' | 'edit') => {
            const displayedQuality =
              variant === 'compact' ? compactQuality : normalizeSessionSetType(set.setType);
            const qualityLabel = getSetQualityDisplayLabel(displayedQuality);
            const qualityAccessibilityLabel = getSetTypeAccessibilityLabel(displayedQuality);

            return (
              <Pressable
                accessibilityLabel={`Quality for exercise ${exerciseIndex + 1} set ${setIndex + 1}: ${qualityAccessibilityLabel}`}
                accessibilityHint="Double tap to cycle quality. Long press to choose from all options."
                accessibilityRole="button"
                style={[
                  styles.setQualityButton,
                  variant === 'compact' ? styles.setQualityButtonCompact : null,
                  displayedQuality === null ? styles.setQualityButtonEmpty : null,
                ]}
                testID={`set-quality-button-${exerciseIndex + 1}-${setIndex + 1}`}
                onPress={() => {
                  if (variant === 'compact' && consumeTapIfAnotherSetIsExpanded(set.id)) {
                    return;
                  }
                  if (suppressSetTypeCyclePressRef.current) {
                    suppressSetTypeCyclePressRef.current = false;
                    return;
                  }
                  cycleSetType(exercise.id, set.id, set.setType);
                }}
                onLongPress={() => {
                  if (variant === 'compact' && consumeTapIfAnotherSetIsExpanded(set.id)) {
                    return;
                  }
                  suppressSetTypeCyclePressRef.current = true;
                  openSetTypePicker({
                    exerciseId: exercise.id,
                    setId: set.id,
                    exerciseIndex,
                    setIndex,
                  });
                }}>
                <Text
                  adjustsFontSizeToFit
                  ellipsizeMode="clip"
                  minimumFontScale={0.75}
                  numberOfLines={1}
                  style={[
                    styles.setQualityButtonText,
                    displayedQuality === null ? styles.setQualityButtonTextEmpty : null,
                  ]}>
                  {qualityLabel}
                </Text>
              </Pressable>
            );
          };

          if (isCompactSetRow) {
            const setNumberLabel = `Set ${setIndex + 1}`;
            const plannedWeightLabel = formatSetWeightLabel(set.plannedWeight);
            const plannedRepsLabel = formatSetRepsLabel(set.plannedReps);
            const actualWeightLabel = formatSetWeightLabel(set.weight);
            const actualRepsLabel = formatSetRepsLabel(set.reps);
            const compactSetIndexTextStyle = [
              styles.compactSetIndexText,
              isMutedRow ? styles.compactSetMutedText : null,
            ];
            const compactSetWeightTextStyle = [
              styles.compactSetValueText,
              styles.compactSetWeightText,
              isMutedRow ? styles.compactSetMutedText : null,
            ];
            const compactSetRepsTextStyle = [
              styles.compactSetValueText,
              styles.compactSetRepsText,
              isMutedRow ? styles.compactSetMutedText : null,
            ];
            const inlineWeightLabel =
              rowState === 'added' || !isPlannedRow ? actualWeightLabel : plannedWeightLabel;
            const inlineRepsLabel =
              rowState === 'added' || !isPlannedRow ? actualRepsLabel : plannedRepsLabel;
            const renderCompactSetValueLine = (
              weightLabel: string,
              repsLabel: string,
              struck = false
            ) => (
              <View style={styles.compactSetValueLine}>
                <Text
                  adjustsFontSizeToFit
                  ellipsizeMode="clip"
                  minimumFontScale={0.75}
                  numberOfLines={1}
                  style={[compactSetWeightTextStyle, struck ? styles.compactSetPrescriptionText : null]}>
                  {weightLabel}
                </Text>
                <Text style={[styles.compactSetSeparatorText, isMutedRow ? styles.compactSetMutedText : null]}>
                  ·
                </Text>
                <Text
                  adjustsFontSizeToFit
                  ellipsizeMode="clip"
                  minimumFontScale={0.75}
                  numberOfLines={1}
                  style={[compactSetRepsTextStyle, struck ? styles.compactSetPrescriptionText : null]}>
                  {repsLabel}
                </Text>
              </View>
            );

            return (
              <SetRowContainer
                isPlanned={isPlannedRow}
                testID={
                  isPlannedRow
                    ? `planned-set-row-${exerciseIndex + 1}-${setIndex + 1}`
                    : `set-swipe-delete-${exerciseIndex + 1}-${setIndex + 1}`
                }
                onInteract={() => activateSetRow(set.id)}
                onSwipeAction={() => removeSetFromExercise(exercise.id, set.id)}
                onTouchSwipeStart={(event) => rememberHorizontalSwipeStart(swipeActionKey, event)}
                onTouchSwipeEnd={(event) => consumeHorizontalSwipeEnd(swipeActionKey, event, removeSetFromSwipe)}>
                <View
                  style={[
                    styles.compactSetRow,
                    isPlannedRow ? styles.setRowPlanned : null,
                    isActiveRow ? styles.setRowActive : null,
                  ]}
                  testID={`set-row-surface-${exerciseIndex + 1}-${setIndex + 1}`}>
                {renderPerformanceControl()}
                <Pressable
                  accessibilityLabel={`${stateLabel} ${setIndex + 1} for exercise ${exerciseIndex + 1}: ${compactLabel}${showQualityControl ? `; quality ${compactQualityAccessibilityLabel}` : ''}`}
                  accessibilityHint="Double tap to edit actual values."
                  accessibilityRole="button"
                  style={styles.compactSetMainPressable}
                  testID={`set-row-pressable-${exerciseIndex + 1}-${setIndex + 1}`}
                  onPress={() => toggleSetExpandedForEditing(exercise.id, set.id)}>
                  {rowState === 'modified' ? (
                    <View style={styles.compactSetModifiedLayout}>
                      <Text
                        adjustsFontSizeToFit
                        ellipsizeMode="clip"
                        minimumFontScale={0.75}
                        numberOfLines={1}
                        style={compactSetIndexTextStyle}>
                        {setNumberLabel}
                      </Text>
                      <View style={styles.compactSetModifiedStack}>
                        {renderCompactSetValueLine(plannedWeightLabel, plannedRepsLabel, true)}
                        {renderCompactSetValueLine(actualWeightLabel, actualRepsLabel)}
                      </View>
                    </View>
                  ) : (
                    <View style={styles.compactSetInlineLayout}>
                      <Text
                        adjustsFontSizeToFit
                        ellipsizeMode="clip"
                        minimumFontScale={0.75}
                        numberOfLines={1}
                        style={compactSetIndexTextStyle}>
                        {setNumberLabel}
                      </Text>
                      {renderCompactSetValueLine(inlineWeightLabel, inlineRepsLabel)}
                    </View>
                  )}
                </Pressable>
                {showQualityControl ? renderQualityButton('compact') : null}
                </View>
              </SetRowContainer>
            );
          }

          return (
            <SetRowContainer
              isPlanned={isPlannedRow}
              testID={
                isPlannedRow
                  ? `planned-set-row-${exerciseIndex + 1}-${setIndex + 1}`
                  : `set-swipe-delete-${exerciseIndex + 1}-${setIndex + 1}`
              }
              onInteract={() => activateSetRow(set.id)}
              onSwipeAction={() => removeSetFromExercise(exercise.id, set.id)}
              onTouchSwipeStart={(event) => rememberHorizontalSwipeStart(swipeActionKey, event)}
              onTouchSwipeEnd={(event) => consumeHorizontalSwipeEnd(swipeActionKey, event, removeSetFromSwipe)}>
            <View
              style={[
                styles.setRow,
                isPlannedRow ? styles.setRowPlanned : null,
                isActiveRow ? styles.setRowActive : null,
              ]}
              testID={`set-row-surface-${exerciseIndex + 1}-${setIndex + 1}`}>
              {renderPerformanceControl()}
              <Pressable
                accessible={false}
                style={[
                  styles.input,
                  styles.setWeightInputShell,
                  hasSetFieldValidationError('weight', set.weight) ? styles.inputInvalid : null,
                ]}
                testID={`set-weight-input-shell-${exerciseIndex + 1}-${setIndex + 1}`}
                onPress={() => {
                  focusedSetInputIdRef.current = set.id;
                  requestWeightInputFocus(weightInputBySetIdRef.current[set.id]);
                }}>
                <TextInput
                  accessibilityLabel={`Weight for exercise ${exerciseIndex + 1} set ${setIndex + 1}`}
                  autoFocus={pendingFocusedWeightSetId === set.id}
                  inputMode="decimal"
                  keyboardType="decimal-pad"
                  ref={(input) => {
                    weightInputBySetIdRef.current[set.id] = input;
                  }}
                  selectTextOnFocus
                  style={styles.setWeightTextInput}
                  value={set.weight}
                  onBlur={() => {
                    handleSetInputBlur(set.id);
                  }}
                  onChangeText={(value) => {
                    updateSetField(exercise.id, set.id, 'weight', value);
                    setPendingFocusedWeightSetId((currentSetId) => (currentSetId === set.id ? null : currentSetId));
                  }}
                  onFocus={() => {
                    focusSetInput(set.id);
                    if (pendingFocusedWeightSetId === set.id) {
                      requestWeightInputSelectAll(
                        weightInputBySetIdRef.current[set.id],
                        set.weight.length
                      );
                      setPendingFocusedWeightSetId(null);
                    }
                  }}
                  onPressIn={() => {
                    focusedSetInputIdRef.current = set.id;
                  }}
                />
                <Text testID={`set-weight-unit-${exerciseIndex + 1}-${setIndex + 1}`} style={styles.setWeightUnitText}>
                  kg
                </Text>
              </Pressable>
              <TextInput
                accessibilityLabel={`Reps for exercise ${exerciseIndex + 1} set ${setIndex + 1}`}
                inputMode="numeric"
                keyboardType="number-pad"
                placeholder="Reps"
                placeholderTextColor={uiColors.textDisabled}
                selectTextOnFocus
                style={[
                  styles.input,
                  styles.setRowInput,
                  hasSetFieldValidationError('reps', set.reps) ? styles.inputInvalid : null,
                ]}
                value={set.reps}
                onBlur={() => {
                  handleSetInputBlur(set.id);
                }}
                onChangeText={(value) => {
                  updateSetField(exercise.id, set.id, 'reps', value);
                }}
                onFocus={() => {
                  focusSetInput(set.id);
                }}
                onPressIn={() => {
                  focusedSetInputIdRef.current = set.id;
                }}
              />
              {showQualityControl ? renderQualityButton('edit') : null}
            </View>
            </SetRowContainer>
          );
        }}
        renderExerciseHeaderAction={({ exercise, exerciseIndex }) => (
          <View style={styles.exerciseHeaderActionRow}>
            <Pressable
              accessibilityLabel={`Add tag to exercise ${exerciseIndex + 1}`}
              style={styles.exerciseIconButton}
              onPress={() => openTagModal(exercise.id)}>
              <Text style={styles.exerciseIconButtonText}>#</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`Exercise options ${exerciseIndex + 1}`}
              style={styles.exerciseMenuButton}
              onPress={() => openExerciseActionMenu(exercise.id)}>
              <Text style={styles.exerciseMenuButtonText}>•••</Text>
            </Pressable>
          </View>
        )}
        renderExerciseMeta={({ exercise, exerciseIndex }) => {
          const loadInputMode =
            loadInputModeByExerciseDefinitionId.get(exercise.exerciseDefinitionId) ?? 'total_load';
          const loadInputModeLabel = loadInputMode === 'per_side_load' ? 'Per side' : 'Total load';
          const personalRecord = currentSessionPersonalRecordByExerciseId.get(exercise.id);

          return (
            <View style={styles.exerciseTagSection}>
              <Text
                style={styles.exerciseLoadModeText}
                testID={`exercise-load-mode-${exerciseIndex + 1}`}>
                Weight entry: {loadInputModeLabel}
              </Text>
              {exercise.sets.length > 0 ? (
                <Text style={styles.exerciseSetSummaryText}>{getExerciseSetSummary(exercise.sets)}</Text>
              ) : null}
              {personalRecord ? (
                <ExercisePersonalRecordCelebration
                  personalRecord={personalRecord}
                  testID={`exercise-expanded-pr-${exerciseIndex + 1}`}
                  variant="expanded"
                />
              ) : null}
              <View style={styles.exerciseTagChipWrap}>
                {exercise.tags.map((tag) => (
                  <View
                    key={tag.assignmentId}
                    style={[styles.exerciseTagChip, tag.deletedAt ? styles.exerciseTagChipDeleted : null]}>
                    <Text numberOfLines={1} style={styles.exerciseTagChipText}>
                      {tag.deletedAt ? `${tag.name} (deleted)` : tag.name}
                    </Text>
                    <Pressable
                      accessibilityLabel={`Remove tag ${tag.name} from exercise ${exerciseIndex + 1}`}
                      style={styles.exerciseTagChipRemoveButton}
                      onPress={() => {
                        void removeAssignedTagFromExercise(exercise.id, tag.tagDefinitionId);
                      }}>
                      <Text style={styles.exerciseTagChipRemoveButtonText}>X</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
              {renderExerciseBlockHistoryPanel(exercise, exerciseIndex)}
            </View>
          );
        }}
        renderExerciseFooter={({ exercise, exerciseIndex }) => (
          <Pressable
            accessibilityLabel={`Add set to exercise ${exerciseIndex + 1}`}
            style={styles.addSetButton}
            testID={`add-set-button-${exerciseIndex + 1}`}
            onPress={() => addSetToExercise(exercise.id)}>
            <Text style={styles.primaryActionButtonText}>Add set</Text>
          </Pressable>
        )}
        renderEmptyState={(text) => <Text style={styles.emptyText}>{text}</Text>}
      />

      <SessionMuscleLoad
        catalogState={currentSessionMuscleCatalogState}
        performedSetCount={currentSessionPerformedSetCount}
        summary={currentSessionMuscleSummary}
        visible={routeMode === 'active' && currentSessionPerformedSetCount > 0}
        workingSetCount={currentSessionWorkingSetCount}
        onRetry={() => {
          void ensureExerciseCatalogLoaded();
        }}
      />

      <Pressable
        accessibilityLabel="Log new exercise"
        style={styles.logExerciseButton}
        onPress={() => openExerciseModal()}>
        <Text style={styles.logExerciseButtonText}>Log new exercise</Text>
      </Pressable>

      {showCompletedEditSaveBlockedNotice ? (
        <View style={styles.completedEditSaveBlockedNotice} testID="completed-edit-save-blocked-notice">
          <Text style={styles.completedEditSaveBlockedNoticeText}>
            Fix Start/End time validation errors above before saving. Autosave stays paused until times are valid.
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityLabel={routeMode === 'completed-edit' ? 'Save changes' : 'Submit session'}
        testID="session-recorder-submit-button"
        style={[styles.submitButton, isSubmitDisabled ? styles.submitButtonDisabled : null]}
        disabled={isSubmitDisabled}
        onPress={handleSubmit}>
        <Text style={styles.submitButtonText}>
          {routeMode === 'completed-edit' ? 'Save Changes' : 'Submit Session'}
        </Text>
      </Pressable>

      <Modal
        animationType="fade"
        transparent
        visible={Boolean(submitCleanupPrompt)}
        onRequestClose={cancelSubmitCleanup}>
        <View style={styles.modalContainer}>
          <Pressable
            accessibilityLabel="Dismiss submit cleanup modal overlay"
            style={styles.modalBackdrop}
            onPress={cancelSubmitCleanup}
          />
          <View style={styles.confirmationModalCard}>
            <Text style={styles.confirmationTitle}>{cleanupModalTitle}</Text>
            <Text style={styles.confirmationBody}>{cleanupModalMessage}</Text>
            <View style={styles.confirmationButtonStack}>
              <Pressable style={styles.confirmationPrimaryButton} onPress={confirmSubmitCleanup}>
                <Text style={styles.confirmationPrimaryButtonText}>{cleanupModalConfirmLabel}</Text>
              </Pressable>
              <Pressable style={styles.confirmationSecondaryButton} onPress={cancelSubmitCleanup}>
                <Text style={styles.confirmationSecondaryButtonText}>Go back to edit session</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={Boolean(activeSetTypePicker)}
        onRequestClose={dismissSetTypePicker}>
        <View style={styles.modalContainer}>
          <Pressable
            accessibilityLabel="Dismiss set type modal overlay"
            style={styles.modalBackdrop}
            onPress={dismissSetTypePicker}
          />
          <View style={styles.setTypeModalCard}>
            <View style={styles.modalList}>
              {SET_TYPE_CYCLE_ORDER.map((setTypeOption) => {
                const normalizedOption = normalizeSessionSetType(setTypeOption);
                const isSelected = selectedSetTypeInPicker === normalizedOption;
                return (
                  <Pressable
                    key={setTypeOption ?? 'none'}
                    accessibilityLabel={`Choose ${getSetTypeMenuLabel(normalizedOption)} set type`}
                    style={[
                      styles.setTypePickerOption,
                      isSelected ? styles.setTypePickerOptionSelected : null,
                    ]}
                    onPress={() => selectSetTypeFromPicker(normalizedOption)}>
                    <Text style={styles.setTypePickerCode}>
                      {getSetTypeButtonLabel(normalizedOption)}
                    </Text>
                    <Text
                      style={[
                        styles.setTypePickerLabel,
                        isSelected ? styles.setTypePickerLabelSelected : null,
                      ]}>
                      {getSetTypeMenuLabel(normalizedOption)}
                    </Text>
                    <Text style={styles.setTypePickerSelectionMark}>{isSelected ? '✓' : ''}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent
        visible={state.gymPickerVisible}
        onRequestClose={dismissGymModal}>
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable
            accessibilityLabel="Dismiss gym modal overlay"
            style={styles.modalBackdrop}
            onPress={dismissGymModal}
          />

          <View style={styles.modalCard}>
            {state.gymModalMode === 'picker' ? (
              <>
                <Text style={styles.modalTitle}>Select Gym</Text>
                <ScrollView contentContainerStyle={styles.modalList}>
                  <Pressable
                    accessibilityLabel="Select no gym"
                    style={styles.pickerOption}
                    onPress={() => selectGym(null)}>
                    <Text style={styles.pickerOptionText}>No gym</Text>
                  </Pressable>
                  {activeGyms.map((location) => (
                    <Pressable
                      key={location.id}
                      accessibilityLabel={`Select gym ${location.name}`}
                      style={styles.pickerOption}
                      onPress={() => selectGym(location.id)}>
                      <Text style={styles.pickerOptionText}>{location.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>

                <View style={styles.equalButtonRow}>
                  <Pressable style={styles.secondaryActionButton} onPress={openManageGyms}>
                    <Text style={styles.secondaryActionButtonText}>Manage</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryActionButton} onPress={openAddGymEditor}>
                    <Text style={styles.secondaryActionButtonText}>Add new</Text>
                  </Pressable>
                </View>
              </>
            ) : null}

            {state.gymModalMode === 'manage' ? (
              <>
                <Text style={styles.modalTitle}>Manage Gyms</Text>

                <View style={styles.equalButtonRow}>
                  <Pressable style={styles.secondaryActionButton} onPress={returnToPickerFromManage}>
                    <Text style={styles.secondaryActionButtonText}>Back to picker</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryActionButton} onPress={toggleArchivedVisibility}>
                    <Text style={styles.secondaryActionButtonText}>
                      {state.showArchivedInManager ? 'Hide archived' : 'Show archived'}
                    </Text>
                  </Pressable>
                </View>

                <ScrollView contentContainerStyle={styles.modalList}>
                  {managedGyms.map((location) => {
                    const locationHasCoordinates = hasSavedGymCoordinates(location);

                    return (
                      <View key={location.id} style={styles.manageGymRow}>
                        <View style={styles.manageRowHeader}>
                          <View style={styles.manageRowTitleStack}>
                            <Text numberOfLines={1} style={styles.manageRowTitle}>
                              {location.name}
                            </Text>
                            <Text style={styles.gymCoordinateStatus}>
                              {locationHasCoordinates ? 'GPS saved' : 'No GPS coordinates'}
                            </Text>
                          </View>
                          <Pressable
                            accessibilityLabel={`Edit gym ${location.name}`}
                            style={styles.inlineSecondaryButton}
                            onPress={() => openEditGymEditor(location)}>
                            <Text style={styles.inlineSecondaryButtonText}>Edit</Text>
                          </Pressable>
                          <Pressable
                            accessibilityLabel={`${location.archived ? 'Unarchive' : 'Archive'} gym ${location.name}`}
                            style={[
                              styles.inlineArchiveButton,
                              location.archived ? styles.unarchiveButton : styles.archiveDangerButton,
                            ]}
                            onPress={() => toggleGymArchive(location.id, location.archived)}>
                            <Text style={styles.inlineArchiveButtonText}>
                              {location.archived ? 'Unarchive' : 'Archive'}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                  {managedGyms.length === 0 ? (
                    <Text style={styles.emptyText}>No gyms for the current filter.</Text>
                  ) : null}
                </ScrollView>
              </>
            ) : null}

            {state.gymModalMode === 'editor' ? (
              <>
                <Text style={styles.modalTitle}>{gymEditorTitle}</Text>
                <TextInput
                  autoFocus
                  placeholder="Gym name"
                  style={styles.input}
                  value={gymEditorInputValue}
                  onChangeText={state.editingLocationId ? handleEditingLocationNameChange : handlePendingLocationNameChange}
                />
                <View style={styles.gymCoordinateEditorPanel}>
                  <Text style={styles.gymCoordinateStatus}>
                    {editingGym
                      ? editingGymHasCoordinates
                        ? 'GPS saved'
                        : 'No GPS coordinates'
                      : pendingNewGymCoordinates
                        ? 'GPS ready'
                        : 'No GPS coordinates'}
                  </Text>

                  {editorCoordinateFeedback ? (
                    <Text
                      style={[
                        styles.gymCoordinateFeedback,
                        editorCoordinateFeedback.tone === 'success'
                          ? styles.gymCoordinateFeedbackSuccess
                          : styles.gymCoordinateFeedbackError,
                      ]}>
                      {editorCoordinateFeedback.message}
                    </Text>
                  ) : null}

                  {editingGym && pendingEditorCoordinateAction ? (
                    <View style={styles.gymCoordinateConfirmPanel}>
                      <Text style={styles.gymCoordinateConfirmText}>
                        {pendingEditorCoordinateAction === 'replace'
                          ? 'Replace saved coordinates with your current location?'
                          : 'Clear saved coordinates for this gym?'}
                      </Text>
                      <View style={styles.gymCoordinateActionRow}>
                        <Pressable
                          accessibilityLabel={`Cancel coordinate action for gym ${editingGym.name}`}
                          style={styles.gymCoordinateSecondaryButton}
                          onPress={() => cancelGymCoordinateAction(editingGym.id)}>
                          <Text style={styles.gymCoordinateSecondaryButtonText}>Cancel</Text>
                        </Pressable>
                        <Pressable
                          accessibilityLabel={
                            pendingEditorCoordinateAction === 'replace'
                              ? `Confirm replace coordinates for gym ${editingGym.name}`
                              : `Confirm clear coordinates for gym ${editingGym.name}`
                          }
                          accessibilityState={{ disabled: isEditorCoordinateLoading }}
                          disabled={isEditorCoordinateLoading}
                          style={[
                            pendingEditorCoordinateAction === 'replace'
                              ? styles.gymCoordinatePrimaryButton
                              : styles.gymCoordinateDangerButton,
                            isEditorCoordinateLoading ? styles.gymCoordinateButtonDisabled : null,
                          ]}
                          onPress={() =>
                            pendingEditorCoordinateAction === 'replace'
                              ? confirmReplaceGymCoordinates(editingGym)
                              : confirmClearGymCoordinates(editingGym)
                          }>
                          <Text style={styles.gymCoordinatePrimaryButtonText}>
                            {isEditorCoordinateLoading
                              ? 'Saving...'
                              : pendingEditorCoordinateAction === 'replace'
                                ? 'Confirm replace'
                                : 'Clear coordinates'}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.gymCoordinateActionRow}>
                      <Pressable
                        accessibilityLabel={
                          editingGym ? `Save current location for gym ${editingGym.name}` : 'Save current location for new gym'
                        }
                        accessibilityState={{ disabled: isEditorCoordinateLoading }}
                        disabled={isEditorCoordinateLoading}
                        style={[
                          styles.gymCoordinatePrimaryButton,
                          isEditorCoordinateLoading ? styles.gymCoordinateButtonDisabled : null,
                        ]}
                        onPress={() => {
                          if (editingGym) {
                            if (editingGymHasCoordinates) {
                              requestReplaceGymCoordinates(editingGym.id);
                            } else {
                              void saveGymCoordinatesFromCurrentLocation(editingGym);
                            }
                            return;
                          }

                          void savePendingNewGymCoordinatesFromCurrentLocation();
                        }}>
                        <Text style={styles.gymCoordinatePrimaryButtonText}>
                          {isEditorCoordinateLoading ? 'Saving...' : 'Save current location'}
                        </Text>
                      </Pressable>

                      {editingGym && editingGymHasCoordinates ? (
                        <Pressable
                          accessibilityLabel={`Clear coordinates for gym ${editingGym.name}`}
                          accessibilityState={{ disabled: isEditorCoordinateLoading }}
                          disabled={isEditorCoordinateLoading}
                          style={[
                            styles.gymCoordinateDangerOutlineButton,
                            isEditorCoordinateLoading ? styles.gymCoordinateButtonDisabled : null,
                          ]}
                          onPress={() => requestClearGymCoordinates(editingGym.id)}>
                          <Text style={styles.gymCoordinateDangerOutlineButtonText}>Clear</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  )}
                </View>
                <View style={styles.equalButtonRow}>
                  <Pressable style={styles.secondaryActionButton} onPress={returnFromEditor}>
                    <Text style={styles.secondaryActionButtonText}>Back</Text>
                  </Pressable>
                  <Pressable style={styles.primaryActionButton} onPress={saveGymFromEditor}>
                    <Text style={styles.primaryActionButtonText}>{gymEditorPrimaryLabel}</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ExercisePicker
        visible={state.exercisePickerVisible}
        openRequestId={exercisePickerOpenRequestId}
        mode={state.exerciseSelectionTargetId ? 'replace' : 'add'}
        onDismiss={dismissExerciseModal}
        onSelectExercise={applySelectedExerciseSelection}
        onAppendPlan={appendSuggestedPlanToSession}
        onOpenManage={openExerciseCatalogFromRecorder}
      />

      <Modal
        animationType="slide"
        transparent
        visible={isTagModalVisible}
        onRequestClose={dismissTagModal}>
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable
            accessibilityLabel="Dismiss add tag modal overlay"
            style={styles.modalBackdrop}
            onPress={dismissTagModal}
          />

          <View style={[styles.modalCard, styles.tagModalCard]}>
            {tagModalMode === 'picker' ? (
              <>
                <Text style={styles.modalTitle}>Add tag</Text>
                <View style={styles.tagPickerActionRow}>
                  <TextInput
                    accessibilityLabel="Tag search input"
                    autoCapitalize="words"
                    autoCorrect={false}
                    placeholder="Filter tags"
                    style={[styles.input, styles.tagSearchInput]}
                    value={tagSearchValue}
                    onChangeText={setTagSearchValue}
                  />
                  <Pressable
                    accessibilityLabel="Add tag"
                    style={[
                      styles.primaryActionButton,
                      styles.tagActionButton,
                      addTagFromSearchDisabled ? styles.tagActionButtonDisabled : null,
                    ]}
                    disabled={addTagFromSearchDisabled}
                    onPress={() => {
                      if (!activeTagExercise || !activeTagExerciseDefinitionId) {
                        return;
                      }
                      void createTagForActiveExercise(
                        activeTagExercise.id,
                        activeTagExerciseDefinitionId,
                        tagSearchValue
                      );
                    }}>
                    <Text style={styles.primaryActionButtonText}>Add</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Open manage tags"
                    style={[styles.secondaryActionButton, styles.tagActionButton]}
                    disabled={isTagMutationInFlight}
                    onPress={() => {
                      setTagModalMode('manage');
                      setEditingTagDefinitionId(null);
                      setEditingTagName('');
                      setTagModalError(null);
                    }}>
                    <Text style={styles.secondaryActionButtonText}>Manage</Text>
                  </Pressable>
                </View>

                {tagModalError ? <Text style={styles.validationErrorText}>{tagModalError}</Text> : null}

                <ScrollView style={styles.tagModalList} contentContainerStyle={styles.modalList}>
                  {isTagDefinitionsLoading ? <Text style={styles.emptyText}>Loading tags...</Text> : null}
                  {!isTagDefinitionsLoading && filteredActiveTagDefinitions.length === 0 ? (
                    <Text style={styles.emptyText}>No matching tags.</Text>
                  ) : null}
                  {!isTagDefinitionsLoading
                    ? filteredActiveTagDefinitions.map((tagDefinition) => {
                        const isAssignedToActiveExercise = activeTagExerciseAssignedTagIds.has(tagDefinition.id);
                        return (
                          <Pressable
                            key={tagDefinition.id}
                            accessibilityLabel={`Select tag ${tagDefinition.name}`}
                            style={[styles.pickerOption, isAssignedToActiveExercise ? styles.pickerOptionDisabled : null]}
                            disabled={isTagMutationInFlight || isAssignedToActiveExercise}
                            onPress={() => {
                              if (!activeTagExercise || isAssignedToActiveExercise) {
                                return;
                              }
                              void attachTagToExercise(activeTagExercise.id, tagDefinition.id);
                            }}>
                            <Text
                              style={[
                                styles.pickerOptionText,
                                isAssignedToActiveExercise ? styles.pickerOptionTextDisabled : null,
                              ]}>
                              {tagDefinition.name}
                            </Text>
                          </Pressable>
                        );
                      })
                    : null}
                </ScrollView>
              </>
            ) : null}

            {tagModalMode === 'manage' ? (
              <>
                <Text style={styles.modalTitle}>Manage tags</Text>
                {tagModalError ? <Text style={styles.validationErrorText}>{tagModalError}</Text> : null}

                <View style={styles.equalButtonRow}>
                  <Pressable
                    accessibilityLabel="Back to add tags"
                    style={styles.secondaryActionButton}
                    disabled={isTagMutationInFlight}
                    onPress={() => {
                      setTagModalMode('picker');
                      setEditingTagDefinitionId(null);
                      setEditingTagName('');
                      setTagModalError(null);
                    }}>
                    <Text style={styles.secondaryActionButtonText}>Back to add</Text>
                  </Pressable>
                  <Pressable
                    style={styles.secondaryActionButton}
                    disabled={isTagMutationInFlight}
                    onPress={() => setShowDeletedTagsInManager((current) => !current)}>
                    <Text style={styles.secondaryActionButtonText}>
                      {showDeletedTagsInManager ? 'Hide deleted' : 'Show deleted'}
                    </Text>
                  </Pressable>
                </View>

                <ScrollView style={styles.tagModalList} contentContainerStyle={styles.modalList}>
                  {isTagDefinitionsLoading ? <Text style={styles.emptyText}>Loading tags...</Text> : null}
                  {!isTagDefinitionsLoading && visibleManagedTagDefinitions.length === 0 ? (
                    <Text style={styles.emptyText}>No tags for this exercise.</Text>
                  ) : null}

                  {!isTagDefinitionsLoading && activeTagExerciseDefinitionId
                    ? visibleManagedTagDefinitions.map((tagDefinition) => (
                        <View
                          key={tagDefinition.id}
                          style={[styles.manageRow, tagDefinition.deletedAt ? styles.manageRowDeleted : null]}>
                          {editingTagDefinitionId === tagDefinition.id ? (
                            <View style={styles.manageTagEditorInlineRow}>
                              <TextInput
                                accessibilityLabel={`Rename tag ${tagDefinition.name}`}
                                autoCapitalize="words"
                                autoCorrect={false}
                                style={[styles.input, styles.manageTagEditorInput]}
                                value={editingTagName}
                                onChangeText={setEditingTagName}
                              />
                              <Pressable
                                accessibilityLabel="Cancel tag rename"
                                style={[styles.manageTagEditorIconButton, styles.manageTagCancelButton]}
                                disabled={isTagMutationInFlight}
                                onPress={() => {
                                  setEditingTagDefinitionId(null);
                                  setEditingTagName('');
                                  setTagModalError(null);
                                }}>
                                <Text style={[styles.manageTagEditorIconButtonText, styles.manageTagCancelIconText]}>X</Text>
                              </Pressable>
                              <Pressable
                                accessibilityLabel="Save tag rename"
                                style={[styles.manageTagEditorIconButton, styles.manageTagSaveButton]}
                                disabled={isTagMutationInFlight}
                                onPress={() => {
                                  void saveTagRename(
                                    activeTagExerciseDefinitionId,
                                    tagDefinition.id,
                                    editingTagName
                                  );
                                }}>
                                <Text style={styles.manageTagEditorIconButtonText}>✓</Text>
                              </Pressable>
                            </View>
                          ) : (
                            <>
                              <Text numberOfLines={1} style={styles.manageRowTitle}>
                                {tagDefinition.name}
                              </Text>
                              <Pressable
                                accessibilityLabel={`Rename tag ${tagDefinition.name}`}
                                style={[styles.manageTagIconButton, styles.manageTagRenameButton]}
                                disabled={isTagMutationInFlight}
                                onPress={() => {
                                  setEditingTagDefinitionId(tagDefinition.id);
                                  setEditingTagName(tagDefinition.name);
                                  setTagModalError(null);
                                }}>
                                <Text style={[styles.manageTagIconButtonText, styles.manageTagRenameIconText]}>✎</Text>
                              </Pressable>
                              <Pressable
                                accessibilityLabel={`${tagDefinition.deletedAt ? 'Undelete' : 'Delete'} tag ${tagDefinition.name}`}
                                style={[
                                  styles.manageTagIconButton,
                                  tagDefinition.deletedAt ? styles.manageTagUndeleteButton : styles.manageTagDeleteButton,
                                ]}
                                disabled={isTagMutationInFlight}
                                onPress={() => {
                                  void setManagedTagDeletedState(
                                    activeTagExerciseDefinitionId,
                                    tagDefinition.id,
                                    !Boolean(tagDefinition.deletedAt)
                                  );
                                }}>
                                <Text style={styles.manageTagIconButtonText}>{tagDefinition.deletedAt ? '↺' : '🗑'}</Text>
                              </Pressable>
                            </>
                          )}
                        </View>
                      ))
                    : null}
                </ScrollView>
              </>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={state.exerciseActionMenuVisible}
        onRequestClose={dismissExerciseActionMenu}>
        <View style={styles.modalContainer}>
          <Pressable
            accessibilityLabel="Dismiss exercise action menu overlay"
            style={styles.modalBackdrop}
            onPress={dismissExerciseActionMenu}
          />
          <View style={styles.actionMenuCard}>
            <Pressable
              accessibilityLabel="Change exercise"
              style={styles.actionMenuSecondaryButton}
              onPress={changeActiveExerciseFromMenu}>
              <Text style={styles.actionMenuSecondaryButtonText}>Change exercise</Text>
            </Pressable>
            {groupLinkingUserId && activeActionExerciseDefinitionId ? (
              <Pressable
                accessibilityLabel="Link to group exercise"
                style={styles.actionMenuSecondaryButton}
                testID="exercise-action-link-group"
                onPress={linkActiveExerciseFromMenu}>
                <Text style={styles.actionMenuSecondaryButtonText}>Link to group exercise…</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.dangerActionButton} onPress={removeActiveExerciseFromMenu}>
              <Text style={styles.dangerActionButtonText}>Remove exercise</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  exercisePickerSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  exercisePickerSearchInput: {
    flex: 1,
  },
  keyboardAvoidingRoot: {
    flex: 1,
  },
  content: {
    padding: uiSpace.xl,
    gap: uiSpace.xl,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: uiSpace.xl,
    gap: uiSpace.sm,
    backgroundColor: uiColors.surfacePage,
  },
  emptyStateScreen: {
    flex: 1,
    padding: uiSpace.lg,
    gap: uiSpace.lg,
    backgroundColor: uiColors.surfacePage,
  },
  startSessionButton: {
    borderRadius: uiRadius.md,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiColors.actionPrimary,
  },
  startSessionButtonDisabled: {
    backgroundColor: uiColors.actionPrimaryDisabled,
  },
  startSessionButtonText: {
    color: uiColors.surfaceDefault,
    fontWeight: '700',
  },
  loadingStateTitle: {
    fontSize: uiTypography.size.lg,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  loadingStateBody: {
    fontSize: uiTypography.size.md,
    color: uiColors.textSecondary,
    textAlign: 'center',
  },
  completedEditNavigationBar: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfacePage,
    paddingHorizontal: uiSpace.xs,
    paddingBottom: uiSpace.md,
  },
  completedEditNavigationAction: {
    width: 76,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completedEditNavigationActionText: {
    fontSize: uiTypography.size.base,
    fontWeight: '600',
    color: uiColors.actionPrimary,
  },
  completedEditNavigationActionTextDisabled: {
    color: uiColors.textDisabled,
  },
  completedEditNavigationTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: uiTypography.size.lg,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  completedEditMetadataCard: {
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.md,
    gap: uiSpace.sm,
  },
  completedEditMetadataRow: {
    gap: uiSpace.sm,
  },
  completedEditMetadataRowDivider: {
    borderTopWidth: 1,
    borderTopColor: uiColors.borderMuted,
    paddingTop: uiSpace.md,
    marginTop: uiSpace.xs,
  },
  completedEditMetadataLabel: {
    fontSize: uiTypography.size.md,
    fontWeight: '600',
    color: uiColors.textPrimary,
  },
  completedEditHintText: {
    fontSize: uiTypography.size.sm,
    color: uiColors.textSecondary,
  },
  completedEditSaveBlockedNotice: {
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderWarning,
    backgroundColor: uiColors.surfaceWarning,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  completedEditSaveBlockedNoticeText: {
    fontSize: uiTypography.size.sm,
    color: uiColors.textWarning,
    fontWeight: '600',
  },
  validationErrorText: {
    fontSize: uiTypography.size.sm,
    color: uiColors.actionDangerText,
    fontWeight: '600',
  },
  section: {
    padding: uiSpace.md,
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderDefault,
    gap: uiSpace.md,
    backgroundColor: uiColors.surfaceMuted,
  },
  topRow: {
    flexDirection: 'row',
    gap: uiSpace.md,
    alignItems: 'flex-end',
  },
  rowField: {
    flex: 1,
    gap: uiSpace.sm,
  },
  label: {
    fontSize: uiTypography.size.md,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: uiColors.borderDefault,
    borderRadius: uiRadius.sm,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  readOnlyInput: {
    borderWidth: 1,
    borderColor: uiColors.borderDefault,
    borderRadius: uiRadius.sm,
    backgroundColor: uiColors.surfaceReadOnly,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.md,
  },
  readOnlyInputText: {
    color: uiColors.textPrimary,
    fontWeight: '500',
  },
  gymButton: {
    borderWidth: 1,
    borderColor: uiColors.actionPrimary,
    borderRadius: uiRadius.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.md,
    backgroundColor: uiColors.surfaceDefault,
  },
  gymButtonText: {
    color: uiColors.actionPrimary,
    fontWeight: '600',
  },
  gymSelectionStack: {
    gap: uiSpace.sm,
  },
  logExerciseButton: {
    borderRadius: uiRadius.sm,
    backgroundColor: uiColors.actionPrimary,
    paddingVertical: uiSpace.md,
    alignItems: 'center',
  },
  logExerciseButtonText: {
    color: uiColors.surfaceDefault,
    fontWeight: '700',
  },
  exerciseList: {
    gap: uiSpace.md,
  },
  exerciseCard: {
    borderWidth: 1,
    borderColor: uiColors.borderDefault,
    borderRadius: uiRadius.md,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.md,
    gap: uiSpace.sm,
  },
  exerciseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  exerciseCardTitle: {
    fontSize: uiTypography.size.lg,
    fontWeight: '700',
    flex: 1,
  },
  exerciseMenuButton: {
    width: 32,
    height: 32,
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiColors.surfaceDefault,
  },
  exerciseMenuButtonText: {
    color: uiColors.textMuted,
    fontWeight: '700',
    fontSize: uiTypography.size.base,
    lineHeight: 16,
  },
  exerciseHeaderActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  exerciseIconButton: {
    width: 32,
    height: 32,
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiColors.surfaceDefault,
  },
  exerciseIconButtonText: {
    color: uiColors.actionPrimary,
    fontWeight: '800',
    fontSize: uiTypography.size.base,
    lineHeight: 16,
  },
  exerciseTagSection: {
    gap: uiSpace.sm,
  },
  exerciseLoadModeText: {
    fontSize: uiTypography.size.sm,
    lineHeight: 15,
    fontWeight: '600',
    color: uiColors.textSecondary,
  },
  exerciseSetSummaryText: {
    fontSize: uiTypography.size.sm,
    lineHeight: 15,
    fontWeight: '700',
    color: uiColors.textSecondary,
  },
  exerciseTagChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.sm,
    alignItems: 'center',
  },
  exerciseTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    borderWidth: 1,
    borderColor: uiColors.actionPrimarySubtleBorder,
    backgroundColor: uiColors.actionPrimarySubtleBg,
    borderRadius: uiRadius.full,
    paddingVertical: uiSpace.xs,
    paddingHorizontal: uiSpace.sm,
    maxWidth: '100%',
  },
  exerciseTagChipDeleted: {
    borderColor: uiColors.actionNeutralSubtleBorder,
    backgroundColor: uiColors.actionNeutralSubtleBg,
  },
  exerciseTagChipText: {
    fontSize: uiTypography.size.sm,
    color: uiColors.textAccentStrong,
    fontWeight: '600',
    maxWidth: 180,
  },
  exerciseTagChipRemoveButton: {
    width: 18,
    height: 18,
    borderRadius: uiRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiColors.surfaceDefault,
    borderWidth: 1,
    borderColor: uiColors.actionPrimarySubtleBorder,
  },
  exerciseTagChipRemoveButtonText: {
    fontSize: uiTypography.size.xs,
    lineHeight: 12,
    fontWeight: '700',
    color: uiColors.textMuted,
  },
  exerciseBlockHistoryPanel: {
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    borderRadius: uiRadius.sm,
    backgroundColor: uiColors.surfaceMuted,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.sm,
  },
  exerciseBlockHistoryPanelCollapsed: {
    minHeight: 34,
    paddingVertical: uiSpace.sm,
    justifyContent: 'center',
  },
  exerciseBlockHistoryHeader: {
    gap: uiSpace.sm,
  },
  exerciseBlockHistoryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  exerciseBlockHistoryHeadingText: {
    flex: 1,
    gap: uiSpace.xs,
  },
  exerciseBlockHistoryTitle: {
    fontSize: uiTypography.size.sm,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  exerciseBlockHistoryAge: {
    fontSize: uiTypography.size.sm,
    fontWeight: '600',
    color: uiColors.textSecondary,
  },
  exerciseBlockHistoryStateText: {
    fontSize: uiTypography.size.sm,
    color: uiColors.textSecondary,
    fontWeight: '600',
  },
  exerciseBlockHistoryToggle: {
    minHeight: 36,
    minWidth: 54,
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.md,
  },
  exerciseBlockHistoryToggleText: {
    fontSize: uiTypography.size.sm,
    lineHeight: 14,
    fontWeight: '800',
    color: uiColors.actionPrimary,
  },
  exerciseBlockHistoryMetricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.sm,
  },
  exerciseBlockHistoryMetric: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 92,
    gap: uiSpace.xs,
  },
  exerciseBlockHistoryMetricLabel: {
    flex: 1,
    minWidth: 82,
    fontSize: uiTypography.size.xs,
    lineHeight: 13,
    fontWeight: '600',
    color: uiColors.textSecondary,
  },
  exerciseBlockHistoryMetricValue: {
    flex: 1,
    minWidth: 64,
    textAlign: 'right',
    fontSize: uiTypography.size.base,
    lineHeight: 17,
    fontWeight: '800',
    color: uiColors.textPrimary,
  },
  exerciseBlockHistoryComparisonTable: {
    gap: uiSpace.sm,
  },
  exerciseBlockHistoryComparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    minHeight: 22,
  },
  exerciseBlockHistoryColumnHeader: {
    flex: 1,
    minWidth: 70,
    textAlign: 'right',
    fontSize: uiTypography.size.xs,
    lineHeight: 13,
    fontWeight: '700',
    color: uiColors.textSecondary,
  },
  exerciseBlockHistoryCurrentHeader: {
    color: uiColors.actionPrimary,
  },
  exerciseBlockHistoryCurrentValue: {
    color: uiColors.actionPrimary,
  },
  exerciseBlockHistoryPrValue: {
    color: uiColors.heatmapBucket4,
  },
  setList: {
    gap: uiSpace.sm,
  },
  swipeableSetRow: {
    borderRadius: uiRadius.sm,
    overflow: 'hidden',
    position: 'relative',
  },
  swipeActionBackground: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: uiSpace.lg,
  },
  swipeDeleteBackground: {
    backgroundColor: uiColors.rowSwipeDeleteBackground,
  },
  swipeActionCue: {
    minWidth: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: uiSpace.xs,
  },
  swipeActionIcon: {
    fontSize: uiTypography.size.lg,
    lineHeight: 18,
    fontWeight: '800',
    color: uiColors.rowSwipeIcon,
  },
  swipeActionText: {
    fontSize: uiTypography.size.xs,
    lineHeight: 13,
    fontWeight: '800',
    color: uiColors.rowSwipeText,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: uiColors.surfacePage,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.sm,
  },
  compactSetRow: {
    minHeight: 38,
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  setRowActive: {
    backgroundColor: uiColors.rowActiveBackground,
    borderColor: uiColors.rowActiveBorder,
  },
  setRowPlanned: {
    backgroundColor: uiColors.rowPlannedBackground,
    borderColor: uiColors.rowPlannedBorder,
  },
  setPerformanceControl: {
    width: 32,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setPerformanceControlGlyph: {
    fontSize: uiTypography.size.xxl,
    lineHeight: 24,
    fontWeight: '800',
    color: uiColors.textSecondary,
    textAlign: 'center',
  },
  setPerformanceControlGlyphConfirmed: {
    color: uiColors.actionSuccess,
  },
  compactSetMainPressable: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  compactSetInlineLayout: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.lg,
  },
  compactSetModifiedLayout: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.lg,
  },
  compactSetModifiedStack: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xs,
  },
  compactSetValueLine: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    position: 'relative',
  },
  compactSetIndexText: {
    width: 50,
    fontSize: uiTypography.size.md,
    lineHeight: 16,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  compactSetValueText: {
    width: 58,
    minWidth: 0,
    fontSize: uiTypography.size.md,
    lineHeight: 16,
    fontWeight: '600',
    color: uiColors.textPrimary,
  },
  compactSetWeightText: {
    textAlign: 'right',
  },
  compactSetRepsText: {
    width: 72,
    textAlign: 'left',
  },
  compactSetSeparatorText: {
    width: 16,
    fontSize: uiTypography.size.md,
    lineHeight: 16,
    fontWeight: '600',
    color: uiColors.textPrimary,
    textAlign: 'center',
  },
  compactSetPrescriptionText: {
    textDecorationLine: 'line-through',
  },
  compactSetMutedText: {
    color: uiColors.textSecondary,
  },
  setRowInput: {
    flex: 1,
    paddingVertical: uiSpace.sm,
  },
  setWeightInputShell: {
    flex: 1,
    minWidth: 82,
    paddingVertical: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  setWeightTextInput: {
    flex: 1,
    minWidth: 44,
    paddingVertical: uiSpace.sm,
    color: uiColors.textPrimary,
  },
  setWeightUnitText: {
    color: uiColors.textDisabled,
    fontSize: uiTypography.size.md,
    fontWeight: '700',
  },
  setQualityButton: {
    width: 74,
    height: 34,
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: uiSpace.sm,
  },
  setQualityButtonCompact: {
    height: 30,
  },
  setQualityButtonEmpty: {
    backgroundColor: uiColors.surfaceMuted,
  },
  setQualityButtonText: {
    fontSize: uiTypography.size.sm,
    lineHeight: 14,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  setQualityButtonTextEmpty: {
    color: uiColors.textSecondary,
  },
  inputInvalid: {
    borderColor: uiColors.actionDangerSubtleBorder,
    backgroundColor: uiColors.actionDangerSubtleBg,
  },
  addSetButton: {
    borderRadius: uiRadius.sm,
    paddingVertical: uiSpace.md,
    alignItems: 'center',
    backgroundColor: uiColors.actionPrimary,
  },
  submitButton: {
    borderRadius: uiRadius.sm,
    paddingVertical: uiSpace.md,
    alignItems: 'center',
    backgroundColor: uiColors.actionPrimary,
  },
  submitButtonDisabled: {
    backgroundColor: uiColors.actionPrimaryDisabled,
  },
  submitButtonText: {
    color: uiColors.surfaceDefault,
    fontWeight: '700',
  },
  successCard: {
    borderWidth: 1,
    borderColor: uiColors.borderSuccess,
    borderRadius: uiRadius.md,
    backgroundColor: uiColors.surfaceSuccess,
    padding: uiSpace.md,
    gap: uiSpace.sm,
  },
  successTitle: {
    fontSize: uiTypography.size.lg,
    fontWeight: '700',
    color: uiColors.textSuccess,
  },
  successLine: {
    fontSize: uiTypography.size.base,
    color: uiColors.textPrimary,
  },
  nonPersistenceNotice: {
    fontSize: uiTypography.size.md,
    color: uiColors.textWarning,
    fontWeight: '600',
  },
  successResetButton: {
    marginTop: uiSpace.xs,
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.textSuccess,
    paddingVertical: uiSpace.md,
    alignItems: 'center',
    backgroundColor: uiColors.surfaceDefault,
  },
  successResetButtonText: {
    color: uiColors.textSuccess,
    fontWeight: '700',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: uiSpace.lg,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrim,
  },
  modalCard: {
    maxHeight: '90%',
    borderRadius: uiRadius.md,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  exercisePickerModalCard: {
    height: '80%',
  },
  exercisePickerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.md,
  },
  exercisePickerHeaderActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  exercisePickerIconButton: {
    width: 34,
    height: 34,
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiColors.surfaceDefault,
  },
  exercisePickerIconButtonText: {
    fontSize: uiTypography.size.xl,
    lineHeight: 18,
    fontWeight: '700',
    color: uiColors.textMuted,
  },
  exercisePickerOptionsPanel: {
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    borderRadius: uiRadius.sm,
    backgroundColor: uiColors.surfacePage,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  exercisePickerPreselectionPanel: {
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    borderRadius: uiRadius.sm,
    backgroundColor: uiColors.surfacePage,
    padding: uiSpace.md,
    gap: uiSpace.md,
  },
  exercisePickerPreselectionTitle: {
    fontSize: uiTypography.size.lg,
    lineHeight: 20,
    fontWeight: '800',
    color: uiColors.textPrimary,
  },
  exercisePickerPreselectionActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: uiSpace.sm,
  },
  exercisePickerAppendPlanButtonDisabled: {
    backgroundColor: uiColors.actionPrimaryDisabled,
  },
  exercisePickerPlanPreview: {
    gap: uiSpace.sm,
  },
  exercisePickerPlanPreviewSource: {
    fontSize: uiTypography.size.md,
    lineHeight: 16,
    fontWeight: '700',
    color: uiColors.textSecondary,
  },
  exercisePickerPlanSetList: {
    maxHeight: 238,
  },
  exercisePickerPlanSetListContent: {
    gap: uiSpace.sm,
  },
  exercisePickerPlanSetRow: {
    minHeight: 34,
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  exercisePickerPlanSetIndex: {
    width: 48,
    fontSize: uiTypography.size.md,
    lineHeight: 16,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  exercisePickerPlanSetValue: {
    flex: 1,
    minWidth: 0,
    fontSize: uiTypography.size.md,
    lineHeight: 16,
    fontWeight: '600',
    color: uiColors.textPrimary,
  },
  exercisePickerPlanSetQuality: {
    width: 48,
    fontSize: uiTypography.size.sm,
    lineHeight: 16,
    fontWeight: '700',
    color: uiColors.textSecondary,
    textAlign: 'right',
  },
  exercisePickerPreselectionDismissArea: {
    minHeight: 120,
  },
  tagModalCard: {
    height: '80%',
  },
  setTypeModalCard: {
    borderRadius: uiRadius.md,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  setTypePickerOption: {
    borderWidth: 1,
    borderColor: uiColors.borderDefault,
    borderRadius: uiRadius.sm,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
  },
  setTypePickerOptionSelected: {
    borderColor: uiColors.actionPrimary,
    backgroundColor: uiColors.actionPrimarySubtleBg,
  },
  setTypePickerCode: {
    width: 26,
    fontSize: uiTypography.size.sm,
    lineHeight: 14,
    fontWeight: '700',
    color: uiColors.actionPrimary,
    textAlign: 'center',
  },
  setTypePickerLabel: {
    flex: 1,
    fontSize: uiTypography.size.base,
    color: uiColors.textPrimary,
    fontWeight: '600',
  },
  setTypePickerLabelSelected: {
    color: uiColors.textAccentStrong,
  },
  setTypePickerSelectionMark: {
    width: 14,
    fontSize: uiTypography.size.base,
    lineHeight: 16,
    fontWeight: '700',
    color: uiColors.actionPrimary,
    textAlign: 'center',
  },
  confirmationModalCard: {
    borderRadius: uiRadius.md,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  confirmationTitle: {
    fontSize: uiTypography.size.xl,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  confirmationBody: {
    fontSize: uiTypography.size.base,
    color: uiColors.textSecondary,
  },
  confirmationButtonStack: {
    gap: uiSpace.sm,
  },
  confirmationPrimaryButton: {
    borderRadius: uiRadius.sm,
    paddingVertical: uiSpace.md,
    alignItems: 'center',
    backgroundColor: uiColors.actionPrimary,
  },
  confirmationPrimaryButtonText: {
    color: uiColors.surfaceDefault,
    fontWeight: '700',
  },
  confirmationSecondaryButton: {
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.borderStrong,
    paddingVertical: uiSpace.md,
    alignItems: 'center',
    backgroundColor: uiColors.surfaceDefault,
  },
  confirmationSecondaryButtonText: {
    color: uiColors.textMuted,
    fontWeight: '600',
  },
  actionMenuCard: {
    borderRadius: uiRadius.md,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  actionMenuSecondaryButton: {
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.borderStrong,
    paddingVertical: uiSpace.md,
    alignItems: 'center',
    backgroundColor: uiColors.surfaceDefault,
  },
  actionMenuSecondaryButtonText: {
    color: uiColors.textMuted,
    fontWeight: '600',
  },
  modalTitle: {
    fontSize: uiTypography.size.xxl,
    fontWeight: '700',
  },
  tagPickerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  tagSearchInput: {
    flex: 1,
    marginBottom: 0,
  },
  tagActionButton: {
    flex: 0,
    minWidth: 74,
    paddingHorizontal: uiSpace.md,
  },
  tagActionButtonDisabled: {
    backgroundColor: uiColors.actionPrimaryDisabled,
    borderColor: uiColors.actionPrimaryDisabled,
  },
  tagModalList: {
    flex: 1,
  },
  modalList: {
    gap: uiSpace.sm,
    paddingBottom: uiSpace.xs,
  },
  pickerOption: {
    borderWidth: 1,
    borderColor: uiColors.borderDefault,
    borderRadius: uiRadius.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.md,
    backgroundColor: uiColors.surfaceDefault,
  },
  pickerOptionText: {
    fontSize: uiTypography.size.base,
  },
  pickerOptionDisabled: {
    backgroundColor: uiColors.surfaceMuted,
    borderColor: uiColors.borderStrong,
  },
  pickerOptionTextDisabled: {
    color: uiColors.textSecondary,
  },
  equalButtonRow: {
    flexDirection: 'row',
    gap: uiSpace.sm,
  },
  secondaryActionButton: {
    flex: 1,
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.borderStrong,
    paddingVertical: uiSpace.md,
    alignItems: 'center',
  },
  secondaryActionButtonText: {
    color: uiColors.textMuted,
    fontWeight: '600',
  },
  primaryActionButton: {
    flex: 1,
    borderRadius: uiRadius.sm,
    paddingVertical: uiSpace.md,
    alignItems: 'center',
    backgroundColor: uiColors.actionPrimary,
  },
  primaryActionButtonText: {
    color: uiColors.surfaceDefault,
    fontWeight: '700',
  },
  dangerActionButton: {
    borderRadius: uiRadius.sm,
    paddingVertical: uiSpace.md,
    alignItems: 'center',
    backgroundColor: uiColors.actionDanger,
  },
  dangerActionButtonText: {
    color: uiColors.surfaceDefault,
    fontWeight: '700',
  },
  manageGymRow: {
    gap: uiSpace.sm,
    borderWidth: 1,
    borderColor: uiColors.borderDefault,
    borderRadius: uiRadius.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  manageRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    borderWidth: 1,
    borderColor: uiColors.borderDefault,
    borderRadius: uiRadius.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  manageRowDeleted: {
    backgroundColor: uiColors.surfaceMuted,
  },
  manageTagEditorInlineRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  manageTagEditorInput: {
    flex: 1,
    marginBottom: 0,
  },
  manageTagEditorIconButton: {
    width: 34,
    height: 34,
    borderRadius: uiRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageTagCancelButton: {
    borderWidth: 1,
    borderColor: uiColors.borderStrong,
    backgroundColor: uiColors.surfaceDefault,
  },
  manageTagSaveButton: {
    backgroundColor: uiColors.actionPrimary,
  },
  manageTagEditorIconButtonText: {
    fontSize: uiTypography.size.base,
    fontWeight: '700',
    color: uiColors.surfaceDefault,
  },
  manageTagCancelIconText: {
    color: uiColors.textMuted,
  },
  manageTagIconButton: {
    width: 34,
    height: 34,
    borderRadius: uiRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageTagRenameButton: {
    borderWidth: 1,
    borderColor: uiColors.actionPrimary,
    backgroundColor: uiColors.surfaceDefault,
  },
  manageTagDeleteButton: {
    backgroundColor: uiColors.actionDanger,
  },
  manageTagUndeleteButton: {
    backgroundColor: uiColors.actionSuccess,
  },
  manageTagIconButtonText: {
    fontSize: uiTypography.size.lg,
    lineHeight: 19,
    color: uiColors.surfaceDefault,
    fontWeight: '700',
  },
  manageTagRenameIconText: {
    color: uiColors.actionPrimary,
  },
  manageRowTitle: {
    flex: 1,
    fontSize: uiTypography.size.base,
    fontWeight: '600',
  },
  manageRowTitleStack: {
    flex: 1,
    gap: uiSpace.xs,
    minWidth: 0,
  },
  gymCoordinateStatus: {
    fontSize: uiTypography.size.sm,
    color: uiColors.textMuted,
    fontWeight: '600',
  },
  gymCoordinateEditorPanel: {
    gap: uiSpace.sm,
    borderWidth: 1,
    borderColor: uiColors.borderDefault,
    borderRadius: uiRadius.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    backgroundColor: uiColors.surfaceMuted,
  },
  gymCoordinateFeedback: {
    fontSize: uiTypography.size.sm,
    fontWeight: '600',
  },
  gymCoordinateFeedbackSuccess: {
    color: uiColors.textSuccess,
  },
  gymCoordinateFeedbackError: {
    color: uiColors.textWarning,
  },
  gymCoordinateConfirmPanel: {
    gap: uiSpace.sm,
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.borderWarning,
    backgroundColor: uiColors.surfaceWarning,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  gymCoordinateConfirmText: {
    fontSize: uiTypography.size.sm,
    color: uiColors.textWarning,
    fontWeight: '600',
  },
  gymCoordinateActionRow: {
    flexDirection: 'row',
    gap: uiSpace.sm,
  },
  gymCoordinatePrimaryButton: {
    flex: 1,
    borderRadius: uiRadius.sm,
    paddingVertical: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    alignItems: 'center',
    backgroundColor: uiColors.actionPrimary,
  },
  gymCoordinatePrimaryButtonText: {
    color: uiColors.surfaceDefault,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
  },
  gymCoordinateSecondaryButton: {
    flex: 1,
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.borderStrong,
    paddingVertical: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    alignItems: 'center',
    backgroundColor: uiColors.surfaceDefault,
  },
  gymCoordinateSecondaryButtonText: {
    color: uiColors.textMuted,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
  },
  gymCoordinateDangerButton: {
    flex: 1,
    borderRadius: uiRadius.sm,
    paddingVertical: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    alignItems: 'center',
    backgroundColor: uiColors.actionDanger,
  },
  gymCoordinateDangerOutlineButton: {
    flex: 1,
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.actionDanger,
    paddingVertical: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    alignItems: 'center',
    backgroundColor: uiColors.surfaceDefault,
  },
  gymCoordinateDangerOutlineButtonText: {
    color: uiColors.actionDanger,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
  },
  gymCoordinateButtonDisabled: {
    opacity: 0.6,
  },
  inlineSecondaryButton: {
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.actionPrimary,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    alignItems: 'center',
  },
  inlineSecondaryButtonText: {
    color: uiColors.actionPrimary,
    fontWeight: '600',
  },
  inlineArchiveButton: {
    borderRadius: uiRadius.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    alignItems: 'center',
  },
  archiveDangerButton: {
    backgroundColor: uiColors.actionDanger,
  },
  unarchiveButton: {
    backgroundColor: uiColors.actionSuccess,
  },
  inlineArchiveButtonText: {
    color: uiColors.surfaceDefault,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: uiTypography.size.base,
    color: uiColors.textMuted,
  },
});
