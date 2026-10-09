import { calculateAnalyticsSetMetrics, formatVolumeFigure, ordinaryLoadContext } from '@/src/exercise-calculations/analytics';
import { sumVolume, type SetMetrics } from '@/src/exercise-calculations/load-metrics';
import { parseSetReps, parseSetWeight } from '@/src/exercise-calculations/parse';
import { canonicalizeWeightForReps, isVolumeSet, isWorkingSetType } from '@/src/exercise-calculations/set-semantics';
import { formatSetRow } from '@/src/session-recorder/session-view-model';
import type { CompetitionSessionWire } from './competition-wire';

type CompetitionSessionRow = ReturnType<typeof formatSetRow> & { working: boolean };
export type CompetitionSessionExerciseCard = { id: string; name: string; rows: CompetitionSessionRow[]; hideDerivedMetrics: boolean };

/**
 * Permitted set context only. Volume sums the volume-included sets whose kg the
 * group may see (ordinary exercises), with no note: a normalized exercise's
 * hidden kg never enters it, so it can never be recovered by subtraction.
 * `—` when no such set exists.
 */
export function buildCompetitionSession(session: CompetitionSessionWire) {
  const volumeSets: SetMetrics[] = [];
  const cards: CompetitionSessionExerciseCard[] = session.exercises.flatMap(exercise => {
    const loadContext = ordinaryLoadContext(exercise.load_input_mode ?? 'total_load');
    const rows=exercise.sets.flatMap(set => {
      const reps=parseSetReps(set.reps_value);
      if (set.performance_status !== null || reps === null) return [];
      const weight=exercise.visibility === 'ordinary' && 'weight_value' in set
        ? parseSetWeight(canonicalizeWeightForReps(set.weight_value,set.reps_value)) : null;
      if (exercise.visibility === 'ordinary' && weight === null) return [];
      if (exercise.visibility === 'ordinary' && 'weight_value' in set &&
        isVolumeSet({ weight: set.weight_value, reps: set.reps_value, setType: set.set_type })) {
        volumeSets.push(calculateAnalyticsSetMetrics({ ...loadContext, weightValue: set.weight_value, repsValue: set.reps_value }));
      }
      const row=formatSetRow({ id: set.set_id,weight,reps,setType: set.set_type,done: true,loadContext });
      return [{ ...row,weightReps: exercise.visibility === 'normalized' ? `${reps} reps` : row.weightReps,
        working: isWorkingSetType(set.set_type) }];
    });
    return rows.length ? [{ id: exercise.session_exercise_id,name: exercise.name,rows,
      hideDerivedMetrics: exercise.visibility === 'normalized' }] : [];
  });
  return { cards,setCount: cards.flatMap(card => card.rows).filter(row => row.working).length,
    exerciseCount: cards.filter(card => card.rows.some(row => row.working)).length,
    volume: volumeSets.length ? formatVolumeFigure(sumVolume(volumeSets)) : formatVolumeFigure(null) };
}
