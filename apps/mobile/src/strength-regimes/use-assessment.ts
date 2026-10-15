import { useEffect, useState } from 'react';
import type { RmCurveModel } from '@/src/rm-curve/model';
import { iterateStrengthRegimes } from './fit';
import { assessRegimes, assessSingleCurve, type CurveMode, type RegimeAssessment, type UncertaintyMethod } from './assessment';

type Result = { model: RmCurveModel; mode: CurveMode; method: UncertaintyMethod; data: RegimeAssessment | null; error: boolean };

/** Each scheduled chunk fits one trajectory; invalidated snapshots stop before the next chunk. */
export function useRegimeAssessment(model: RmCurveModel, mode: CurveMode, method: UncertaintyMethod) {
  const [state, setState] = useState<Result | null>(null);
  useEffect(() => {
    let active = true;
    const fits = mode === 'two' ? iterateStrengthRegimes(model.inferenceSessions, { method }) : null;
    let timer: ReturnType<typeof setTimeout>;
    const advance = () => {
      if (!active) return;
      try {
        const next = fits?.next();
        if (next && !next.done) { timer = setTimeout(advance, 0); return; }
        const data = next?.done ? assessRegimes(model, next.value) : assessSingleCurve(model, method);
        if (active) setState({ model, mode, method, data, error: false });
      } catch {
        if (active) setState({ model, mode, method, data: null, error: true });
      }
    };
    timer = setTimeout(advance, 0);
    return () => { active = false; clearTimeout(timer); fits?.return(undefined as never); };
  }, [model, mode, method]);
  return state?.model === model && state.mode === mode && state.method === method ? state : null;
}
