import { calculateAnalyticsSetMetrics, formatVolumeFigure, ordinaryLoadContext } from '@/src/exercise-calculations/analytics';
import { sumVolume, type SetMetrics } from '@/src/exercise-calculations/load-metrics';
import { parseSetDuration, parseSetReps, parseSetWeight } from '@/src/exercise-calculations/parse';
import { canonicalizeSetValues, isConfirmedPerformedSet, isVolumeSet, isWorkingSetType } from '@/src/exercise-calculations/set-semantics';
import { formatSetRow } from '@/src/session-recorder/session-view-model';
import { formatCompetitionFigure } from './competition-view-model';
import type { CompetitionSessionWire } from './competition-wire';

type CompetitionSessionRow = ReturnType<typeof formatSetRow> & { working: boolean };
export type CompetitionSessionExerciseCard = { id: string; name: string; rows: CompetitionSessionRow[]; hideDerivedMetrics: boolean; percentageMetrics: boolean };

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
      const hold = set.recording_mode === 'hold';
      const durationSec = parseSetDuration(set.duration_sec);
      const reps=hold ? null : parseSetReps(set.reps_value);
      if (set.performance_status !== null || (hold
        ? durationSec === null || set.reps_value.trim() !== '' : reps === null || set.duration_sec != null)) return [];
      const values = { recordingMode: set.recording_mode, durationSec: set.duration_sec,
        weight: 'weight_value' in set ? set.weight_value : '', reps: set.reps_value, setType: set.set_type };
      const weight=exercise.visibility === 'ordinary' && 'weight_value' in set
        ? parseSetWeight(canonicalizeSetValues(values).weight) : null;
      if (exercise.visibility === 'ordinary' && !isConfirmedPerformedSet(values)) return [];
      // A current evaluator fact validates hidden kg without exposing or fabricating it.
      if (exercise.visibility === 'normalized' && hold && set.performed !== true) return [];
      if (exercise.visibility === 'ordinary' && 'weight_value' in set &&
        isVolumeSet(values)) {
        volumeSets.push(calculateAnalyticsSetMetrics({ ...loadContext, weightValue: set.weight_value, repsValue: set.reps_value }));
      }
      const row=formatSetRow({ id: set.set_id,weight,reps,setType: set.set_type,done: true,loadContext,
        recordingMode: set.recording_mode, durationSec });
      const metrics = !hold && exercise.visibility === 'normalized' && 'normalized_metrics' in set ? set.normalized_metrics : null;
      const loadPercent = metrics?.added_load_percent_bw;
      const figure = (value: number | null | undefined, unit: string) => value === null || value === undefined
        ? '—' : formatCompetitionFigure(value, unit);
      return [{ ...row, weightReps: exercise.visibility === 'ordinary' ? row.weightReps
        : hold ? `${durationSec} s` : loadPercent == null ? `${reps} reps`
          : `${figure(loadPercent, 'percent_bw')} × ${reps}`,
        ...(metrics ? { oneRepMax: figure(metrics.added_e1rm_percent_bw, 'percent_bw'),
          volume: figure(metrics.volume_percent_bw_reps, 'percent_bw_reps') } : {}),
        working: isWorkingSetType(set.set_type) }];
    });
    return rows.length ? [{ id: exercise.session_exercise_id,name: exercise.name,rows,
      hideDerivedMetrics: rows.every(row => row.recordingMode === 'hold') ||
        exercise.visibility === 'normalized' && !exercise.sets.some(set => set.normalized_metrics),
      percentageMetrics: exercise.visibility === 'normalized' }] : [];
  });
  return { cards,setCount: cards.flatMap(card => card.rows).filter(row => row.working).length,
    exerciseCount: cards.filter(card => card.rows.some(row => row.working)).length,
    volume: volumeSets.length ? formatVolumeFigure(sumVolume(volumeSets)) : formatVolumeFigure(null) };
}
