import { useRef, useState } from 'react';

import { createRoutineActionId, skipSessionPlanUse } from '@/src/session-planner';

/** One caller token survives an uncertain write and its Retry. */
export const useRoutineSkip = (planId: string | null, reload: () => Promise<void>, onActiveConflict: (sessionId: string) => void) => {
  const actionId = useRef<string | null>(null);
  const pending = useRef(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipBusy, setSkipBusy] = useState(false);
  const [skipError, setSkipError] = useState<string | null>(null);
  const openRoutineSkip = () => {
    actionId.current ??= createRoutineActionId();
    setSkipError(null);
    setSkipOpen(true);
  };
  const confirmRoutineSkip = async () => {
    if (!planId || !actionId.current || pending.current) return;
    pending.current = true;
    setSkipBusy(true);
    setSkipError(null);
    try {
      const result = await skipSessionPlanUse(planId, actionId.current);
      if (result.status === 'active-conflict') {
        setSkipOpen(false);
        onActiveConflict(result.activeSessionId);
      } else if (result.status === 'skipped') {
        await reload();
        setSkipOpen(false);
        actionId.current = null;
      } else {
        await reload();
        actionId.current = createRoutineActionId();
        setSkipError('Another use was saved first. Try again.');
      }
    } catch {
      setSkipError("Couldn't skip this use. Try again.");
    } finally {
      pending.current = false;
      setSkipBusy(false);
    }
  };
  return { skipOpen, skipBusy, skipError, openRoutineSkip,
    dismissRoutineSkip: () => { if (!pending.current) setSkipOpen(false); },
    confirmRoutineSkip: () => void confirmRoutineSkip() };
};
