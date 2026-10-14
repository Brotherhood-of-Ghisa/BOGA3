import wave from '../fixtures/rm-curve-weekly-wave.json';
import { EMPTY_SESSION_WEIGHT } from '@/src/bodyweight/as-of';
import type { RmCurveGraph } from '@/src/data/rm-curve';
import { personalLoadContext } from '@/src/exercise-calculations/analytics';

/** Preserve the frozen inputs; split the third set into a repeated exercise block. */
export function waveGraph(scenario: keyof typeof wave.scenarios = 'plateau'): RmCurveGraph {
  return { definition: { id: 'curve', name: 'Synthetic exercise', loadInputMode: 'total_load' },
    rows: [...wave.prior, ...wave.scenarios[scenario]].map(set => ({
      ...EMPTY_SESSION_WEIGHT, setId: `${set.session}:${set.set}`, sessionId: set.session,
      sessionExerciseId: `${set.session}:block:${set.set === 3 ? 1 : 0}`,
      blockOrder: set.set === 3 ? 1 : 0, setOrder: set.set === 3 ? 0 : set.set - 1,
      startedAt: new Date(set.startedAt), completedAt: new Date(set.completedAt),
      gymId: set.gym, gymName: 'Synthetic gym', weightValue: set.weightValue,
      repsValue: set.repsValue, setType: set.setType, performanceStatus: set.performanceStatus,
      loadContext: personalLoadContext(false, { loadInputMode: 'total_load' }),
    })) };
}
