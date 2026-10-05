import { ordinaryLoadContext } from '@/src/exercise-calculations/analytics';
import { parseSetReps, parseSetWeight } from '@/src/exercise-calculations/parse';
import { canonicalizeWeightForReps, isWorkingSetType } from '@/src/exercise-calculations/set-semantics';
import { formatSetRow } from '@/src/session-recorder/session-view-model';
import type { CompetitionSessionWire } from './competition-wire';

/** Permitted set context only; no absolute session total is reconstructed. */
export function buildCompetitionSession(session: CompetitionSessionWire) {
  const cards=session.exercises.flatMap(exercise => {
    const rows=exercise.sets.flatMap(set => {
      const reps=parseSetReps(set.reps_value);
      if (set.performance_status !== null || reps === null) return [];
      const weight=exercise.visibility === 'ordinary' && 'weight_value' in set
        ? parseSetWeight(canonicalizeWeightForReps(set.weight_value,set.reps_value)) : null;
      if (exercise.visibility === 'ordinary' && weight === null) return [];
      const row=formatSetRow({ id: set.set_id,weight,reps,setType: set.set_type,done: true,
        loadContext: ordinaryLoadContext(exercise.load_input_mode ?? 'total_load') });
      return [{ ...row,weightReps: exercise.visibility === 'normalized' ? `${reps} reps` : row.weightReps,
        working: isWorkingSetType(set.set_type) }];
    });
    return rows.length ? [{ id: exercise.session_exercise_id,name: exercise.name,rows,
      hideDerivedMetrics: exercise.visibility === 'normalized' }] : [];
  });
  return { cards,setCount: cards.flatMap(card => card.rows).filter(row => row.working).length,
    exerciseCount: cards.filter(card => card.rows.some(row => row.working)).length };
}
