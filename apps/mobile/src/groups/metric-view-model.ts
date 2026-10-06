// Presentation only: the rules line shown beside a comparison.
import type { GroupMetricExerciseWire } from './metric-wire';

export function describeGroupRules(exercise: Pick<GroupMetricExerciseWire,
  'rules_revision' | 'load_input_mode'>): string {
  return [`Rules ${exercise.rules_revision}`,
    exercise.load_input_mode === 'per_side_load' ? 'per-side Weight' : 'total Weight'].join(' · ');
}
