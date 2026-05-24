import type { SessionSetTypeValue } from '@/src/data/set-types';

export type SessionSet = {
  id: string;
  reps: string;
  weight: string;
  setType: SessionSetTypeValue;
};

export type SessionExerciseTag = {
  assignmentId: string;
  tagDefinitionId: string;
  name: string;
  deletedAt: Date | null;
  assignedAt: Date;
};

export type SessionExercise = {
  id: string;
  exerciseDefinitionId: string;
  name: string;
  machineName: string;
  tags: SessionExerciseTag[];
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
};

export type GymModalMode = 'picker' | 'manage' | 'editor';
export type GymEditorReturnMode = 'picker' | 'manage';

export type SessionRecorderState = {
  session: Session;
  locations: SessionLocation[];
  pendingLocationName: string;
  gymPickerVisible: boolean;
  gymModalMode: GymModalMode;
  editorReturnMode: GymEditorReturnMode;
  showArchivedInManager: boolean;
  editingLocationId: string | null;
  editingLocationName: string;
  exercisePickerVisible: boolean;
  exerciseSelectionTargetId: string | null;
  exerciseActionMenuVisible: boolean;
  activeExerciseActionId: string | null;
};

export const SEEDED_LOCATIONS: SessionLocation[] = [
  { id: 'downtown-iron-temple', name: 'Downtown Iron Temple', archived: false },
  { id: 'westside-barbell-club', name: 'Westside Barbell Club', archived: false },
  { id: 'north-end-strength-lab', name: 'North End Strength Lab', archived: false },
];
