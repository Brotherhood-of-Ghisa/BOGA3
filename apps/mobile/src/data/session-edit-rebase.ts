import { eq } from 'drizzle-orm';

import type { LocalDatabase } from './bootstrap';
import { PRIMARY_RUNTIME_STATE_ID } from './clock';
import { preserveMergeEntity } from './exercise-merge-store';
import { syncRuntimeState } from './schema';
import { captureSessionEditBaseline, WorkoutChangesSavedForReview } from './session-edit-baseline';
import type { SessionDraftExerciseInput, WorkoutEditInput } from './session-inputs';
import { hydrateSessionSetPerformanceStatus, type SessionSetPerformanceStatus } from '@/src/exercise-calculations/set-semantics';
import { normalizeSessionSetType } from './set-types';
import type { MergeValue, MergeWireEntity } from '@/src/exercise-core/merge-types';
import { rebaseWorkoutEdit } from '@/src/exercise-core/workout-rebase';

const newId = (type: string) => type + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);

function editedRows(input: WorkoutEditInput): MergeWireEntity[] {
  const baseline = input.editBaseline!;
  const now = Date.now();
  const rows = new Map(baseline.map(row => [row.type + ':' + row.id, { ...row, fields: { ...row.fields } }]));
  const header = rows.get('sessions:' + input.sessionId)!;
  header.client_updated_at_ms = now;
  header.fields.updated_at = now;
  Object.assign(header.fields, { gym_id: input.gymId, started_at: input.startedAt.getTime(),
    ...(input.completedAt ? { completed_at: input.completedAt.getTime(), duration_sec: input.durationSec ?? null } : {}),
  });
  const liveIds = new Set<string>();
  const put = (type: string, id: string, fields: Record<string, MergeValue>) => {
    const key = type + ':' + id;
    liveIds.add(key);
    const previous = rows.get(key);
    rows.set(key, { type, id, client_updated_at_ms: now, fields: {
      created_at: now, merge_revision: Number(header.fields.merge_revision ?? 0), ...previous?.fields,
      ...fields, updated_at: now, deleted_at: null,
    } });
  };
  input.exercises.forEach((block, index) => {
    const id = block.id ?? newId('exercise');
    const previous = rows.get('session_exercises:' + id);
    put('session_exercises', id, { session_id: input.sessionId!, exercise_definition_id: block.exerciseDefinitionId,
      name: block.name, machine_name: block.machineName ?? null, order_index: index,
      source_plan_exercise_id: block.sourcePlanExerciseId === undefined ? previous?.fields.source_plan_exercise_id ?? null : block.sourcePlanExerciseId,
      source_plan_use_id: block.sourcePlanUseId === undefined ? previous?.fields.source_plan_use_id ?? null : block.sourcePlanUseId,
    });
    block.sets.forEach((set, order) => {
      const setId = set.id ?? newId('set');
      const old = rows.get('exercise_sets:' + setId);
      const hydrated = hydrateSessionSetPerformanceStatus(old?.fields.performance_status as SessionSetPerformanceStatus, {
        reps: String(old?.fields.reps_value ?? ''), weight: String(old?.fields.weight_value ?? ''),
      });
      put('exercise_sets', setId, { session_exercise_id: id, order_index: order,
        weight_value: set.weightValue, reps_value: set.repsValue, set_type: set.setType ?? null,
        planned_weight_value: set.plannedWeightValue ?? null, planned_reps_value: set.plannedRepsValue ?? null,
        planned_set_type: set.plannedSetType ?? null,
        performance_status: old && set.performanceStatus === hydrated ? old.fields.performance_status : set.performanceStatus ?? null,
        source_plan_set_id: set.sourcePlanSetId === undefined ? old?.fields.source_plan_set_id ?? null : set.sourcePlanSetId,
        source_plan_use_id: set.sourcePlanUseId === undefined ? old?.fields.source_plan_use_id ?? null : set.sourcePlanUseId,
      });
    });
  });
  for (const [key, row] of rows) {
    if (row.type === 'sessions' || row.type === 'session_exercise_tags' || row.fields.deleted_at || liveIds.has(key)) continue;
    row.fields.deleted_at = now; row.client_updated_at_ms = now;
  }
  return [...rows.values()];
}

function exercisesFromRows(rows: MergeWireEntity[]): SessionDraftExerciseInput[] {
  const live = rows.filter(row => !row.fields.deleted_at);
  const ordered = (type: string) => live.filter(row => row.type === type)
    .sort((a, b) => Number(a.fields.order_index) - Number(b.fields.order_index));
  return ordered('session_exercises').map(block => ({
    id: block.id, exerciseDefinitionId: String(block.fields.exercise_definition_id), name: String(block.fields.name),
    machineName: block.fields.machine_name as string | null, mergeRevision: Number(block.fields.merge_revision),
    sourcePlanExerciseId: block.fields.source_plan_exercise_id as string | null,
    sourcePlanUseId: block.fields.source_plan_use_id as string | null,
    sets: ordered('exercise_sets').filter(set => set.fields.session_exercise_id === block.id).map(set => ({
      id: set.id, weightValue: String(set.fields.weight_value), repsValue: String(set.fields.reps_value),
      setType: normalizeSessionSetType(set.fields.set_type),
      plannedWeightValue: set.fields.planned_weight_value as string | null,
      plannedRepsValue: set.fields.planned_reps_value as string | null,
      plannedSetType: normalizeSessionSetType(set.fields.planned_set_type),
      performanceStatus: set.fields.performance_status as SessionSetPerformanceStatus,
      sourcePlanSetId: set.fields.source_plan_set_id as string | null,
      sourcePlanUseId: set.fields.source_plan_use_id as string | null,
    })),
  }));
}

export function rebaseSessionEdit<T extends WorkoutEditInput>(database: LocalDatabase, input: T): T {
  if (!input.sessionId || !input.editBaseline?.length) return input;
  const baseline = input.editBaseline;
  const current = captureSessionEditBaseline(database, input.sessionId);
  const known = new Map(baseline.map(row => [row.type + ':' + row.id, row]));
  const loadedRevision = Number(baseline.find(row => row.type === 'sessions')?.fields.merge_revision ?? 0);
  input = { ...input, exercises: input.exercises.map(block => ({ ...block,
    mergeRevision: Number(known.get('session_exercises:' + block.id)?.fields.merge_revision ?? loadedRevision),
  })) };
  const advanced = current.some(row => Number(row.fields.merge_revision ?? 0) >
    Number(known.get(row.type + ':' + row.id)?.fields.merge_revision ?? 0));
  if (!advanced) return input;
  const result = rebaseWorkoutEdit(baseline, editedRows(input), current);
  const before = baseline.find(row => row.type === 'sessions');
  const header = current.find(row => row.type === 'sessions');
  const closed = ['status', 'deleted_at', 'completed_at'].some(key => before?.fields[key] !== header?.fields[key]);
  if (result.preserved.length || closed) {
    database.transaction(tx => {
      const owner = tx.select().from(syncRuntimeState).where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID)).get()?.accountUserId;
      if (!owner) throw new Error('Refresh this workout before saving.');
      for (const row of result.preserved) preserveMergeEntity(tx, owner, row);
    });
    throw new WorkoutChangesSavedForReview(result.preserved.length > 0);
  }
  const editedHeader = result.rows.find(row => row.type === 'sessions')!;
  return { ...input, gymId: editedHeader.fields.gym_id as string | null,
    startedAt: new Date(Number(editedHeader.fields.started_at)),
    ...(input.completedAt ? { completedAt: new Date(Number(editedHeader.fields.completed_at)),
      durationSec: Number(editedHeader.fields.duration_sec) } : {}),
    exercises: exercisesFromRows(result.rows),
    mergeRevisions: Object.fromEntries(result.rows.filter(row => row.type === 'session_exercises')
      .map(row => [row.id, Number(row.fields.merge_revision)])),
  };
}
