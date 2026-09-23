import type { SessionSetTypeValue } from '@/src/data/set-types';
import type { SessionSetPerformanceStatus } from '@/src/session-recorder/set-semantics';

export type { SessionSetPerformanceStatus } from '@/src/session-recorder/set-semantics';

export type SessionSet = {
  id: string;
  reps: string;
  weight: string;
  setType: SessionSetTypeValue;
  plannedReps: string | null;
  plannedWeight: string | null;
  plannedSetType: SessionSetTypeValue;
  performanceStatus: SessionSetPerformanceStatus;
};

export type SessionExercise = {
  id: string;
  exerciseDefinitionId: string;
  name: string;
  machineName: string;
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
