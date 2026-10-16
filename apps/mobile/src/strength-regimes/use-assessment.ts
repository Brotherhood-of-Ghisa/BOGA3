import { useEffect, useState } from 'react';
import type { RmCurveModel } from '@/src/rm-curve/model';
import { FitWorkLimitError } from './fit';
import { iterateCurveAssessment, type CurveMode, type RegimeAssessment, type UncertaintyMethod } from './assessment';

type Result = { model: RmCurveModel; mode: CurveMode; method: UncertaintyMethod; data: RegimeAssessment | null; error: boolean; limited?: boolean };

/** Optimizer chunks yield within trajectories; invalidated snapshots stop at the next chunk. */
export function useRegimeAssessment(model: RmCurveModel, mode: CurveMode, method: UncertaintyMethod) {
  const [state, setState] = useState<Result | null>(null);
  useEffect(() => {
    let active = true;
    const fits = iterateCurveAssessment(model, mode, method);
    let timer: ReturnType<typeof setTimeout>;
    const advance = () => {
      if (!active) return;
      try {
        const next = fits.next();
        if (!next.done) { timer = setTimeout(advance, 0); return; }
        const data = next.value;
        if (active) setState({ model, mode, method, data, error: false });
      } catch (cause) {
        if (active) setState({ model, mode, method, data: null, error: true, limited: cause instanceof FitWorkLimitError });
      }
    };
    timer = setTimeout(advance, 0);
    return () => { active = false; clearTimeout(timer); fits.return(undefined as never); };
  }, [model, mode, method]);
  return state?.model === model && state.mode === mode && state.method === method ? state : null;
}
