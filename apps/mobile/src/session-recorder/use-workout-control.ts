import { useCallback, useEffect, useRef, useState } from 'react';

import { listConnectedAgents, type ConnectedAgent } from '@/src/auth/connected-agents';
import { loadPendingWorkoutControl, type WorkoutControlAction } from '@/src/data/workout-control';
import type { MergeWireEntity } from '@/src/exercise-core/merge-types';
import { workoutLoggingClientId } from '@/src/exercise-core/workout-control';
import { changeWorkoutControl, WorkoutControlError } from '@/src/sync/workout-control';

export function useWorkoutControl(sessionId: string | null, baseline: MergeWireEntity[] | undefined, reload: () => Promise<void>) {
  const [pending, setPending] = useState<WorkoutControlAction | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [choices, setChoices] = useState<ConnectedAgent[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refreshPending = useCallback(async () => {
    if (!sessionId) return;
    setPending(await loadPendingWorkoutControl(sessionId));
    setChecking(false);
  }, [sessionId]);
  useEffect(() => {
    let current = true;
    if (sessionId) void loadPendingWorkoutControl(sessionId).then(action => {
      if (current) { setPending(action); setChecking(false); }
    }).catch(() => {
      if (current) setNotice('Session control is unavailable. Reopen the session before editing.');
    });
    return () => { current = false; };
  }, [sessionId, baseline]);
  const run = async (agent: ConnectedAgent | null) => {
    if (!sessionId || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setNotice(null); setChoices(null);
    try { await changeWorkoutControl(sessionId, agent); return true; }
    catch (error) {
      setNotice(error instanceof WorkoutControlError ? error.message : 'Session control is unavailable. Check your account in Profile and try again.');
      return false;
    }
    finally {
      try { await refreshPending(); await reload(); }
      catch { setChecking(true); }
      busyRef.current = false; setBusy(false);
    }
  };
  const aiControlled = workoutLoggingClientId(baseline) !== null;
  const openControl = async () => {
    if (busyRef.current) return;
    if (pending || aiControlled) return run(null);
    busyRef.current = true; setBusy(true); setNotice(null);
    try {
      const agents = (await listConnectedAgents()).filter(agent => agent.workoutLoggingEnabled === true);
      if (agents.length === 1) {
        busyRef.current = false; setBusy(false);
        return await run(agents[0]);
      } else setChoices(agents);
    } catch { setNotice('Could not load connected agents. Try again.'); }
    finally { busyRef.current = false; setBusy(false); }
    return false;
  };
  return {
    aiControlled, blocked: aiControlled || pending !== null || checking || busy,
    pending: pending !== null, busy: busy || checking, notice, choices,
    openControl, choose: run, closeChoices: () => setChoices(null),
  };
}
