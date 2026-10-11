import type { LoadContext } from '@/src/exercise-calculations/load-metrics';
import type { ExerciseListItem } from '@/src/exercise-catalog/list-model';
import type { ExerciseBlockHistorySuggestedPlan } from '@/src/data';
import type { SessionSetTypeValue } from '@/src/data/set-types';
import type { SessionSetPerformanceStatus } from '@/src/exercise-calculations/set-semantics';

/** The picker's picked row while its historical plan preview loads. */
export type ExercisePickerPreselectionState = {
  exercise: ExerciseListItem;
  status: 'loading' | 'ready' | 'error';
  suggestion: ExerciseBlockHistorySuggestedPlan | null;
};

export type { SessionSetPerformanceStatus } from '@/src/exercise-calculations/set-semantics';

export type SessionSet = {
  id: string;
  reps: string;
  weight: string;
  setType: SessionSetTypeValue;
  plannedReps: string | null;
  plannedWeight: string | null;
  plannedSetType: SessionSetTypeValue;
  performanceStatus: SessionSetPerformanceStatus;
  /** Block provenance; manual sets are null. */
  sourcePlanSetId?: string | null;
};

export type SessionExercise = {
  loadContext?: LoadContext;
  id: string;
  exerciseDefinitionId: string;
  name: string;
  machineName: string;
  /** Block provenance; unsourced cards are null. */
  sourcePlanExerciseId?: string | null;
  sets: SessionSet[];
};

export type Session = {
  dateTime: string;
  locationId: string | null;
  exercises: SessionExercise[];
};

export type SessionLocation = {
  id: string;
  name: string;
  archived: boolean;
  latitude?: number | null;
  longitude?: number | null;
  coordinateAccuracyM?: number | null;
  coordinatesUpdatedAt?: Date | null;
};

export const SEEDED_LOCATIONS: SessionLocation[] = [
  { id: 'downtown-iron-temple', name: 'Downtown Iron Temple', archived: false },
  { id: 'westside-barbell-club', name: 'Westside Barbell Club', archived: false },
  { id: 'north-end-strength-lab', name: 'North End Strength Lab', archived: false },
];
