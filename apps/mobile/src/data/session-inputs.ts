import type { MergeWireEntity } from '@/src/exercise-core/merge-types';
import type { SessionSetTypeValue } from './set-types';
import type { SessionSetPerformanceStatus } from '@/src/exercise-calculations/set-semantics';

export type SessionDraftStatus = 'active';
export type SessionTimingBaseline = { revision: number; startedAt: Date; completedAt: Date };
export type SessionDraftSetInput = {
  id?: string; repsValue: string; weightValue: string; setType?: SessionSetTypeValue;
  plannedRepsValue?: string | null; plannedWeightValue?: string | null; plannedSetType?: SessionSetTypeValue;
  performanceStatus?: SessionSetPerformanceStatus;
  sourcePlanSetId?: string | null; sourcePlanUseId?: string | null;
};
export type SessionDraftExerciseInput = {
  id?: string; exerciseDefinitionId: string; mergeRevision?: number; name: string; machineName?: string | null;
  sets: SessionDraftSetInput[]; sourcePlanExerciseId?: string | null; sourcePlanUseId?: string | null;
};
export type WorkoutEditInput = {
  sessionId?: string; gymId: string | null; startedAt: Date; status?: SessionDraftStatus;
  completedAt?: Date; durationSec?: number; sourcePlanId?: string | null; sourcePlanUseId?: string | null;
  editBaseline?: MergeWireEntity[]; exercises: SessionDraftExerciseInput[];
};
