import NetInfo from '@react-native-community/netinfo';
import { getSignedInUserId } from '@/src/auth/session-user';
import type { ConnectedAgent } from '@/src/auth/connected-agents';
import { bootstrapLocalDataLayer } from '@/src/data/bootstrap';
import { deleteMergeLocal, writeMergeLocal } from '@/src/data/exercise-merge-store';
import {
  loadWorkoutControlHeader, pendingWorkoutControl, workoutControlStorageId,
  type WorkoutControlAction,
} from '@/src/data/workout-control';
import { runSyncCycle } from './cycle';
import { mergeRpc, MergeRpcError } from './exercise-merge';

const CONTROL_ERRORS: Record<string, string> = {
  WORKOUT_PERMISSION_REQUIRED: 'This agent no longer has workout logging permission. Check workout logging in More → Connect an AI.',
  WORKOUT_REVIEW_REQUIRED: 'Review this workout’s saved changes in Data & Sync before giving AI control.',
  WORKOUT_REQUIRES_APP: 'Continue this planned workout in BoGa.',
  WORKOUT_NOT_ACTIVE: 'This session is no longer active.',
  WORKOUT_AI_OWNED: 'AI already controls this session. Take over logging before choosing another agent.',
  REVISION_CONFLICT: 'This workout changed. Its current state has been refreshed; try the handoff again.',
};

export class WorkoutControlError extends Error {}

async function converge(): Promise<void> {
  if (await runSyncCycle() !== 'converged') {
    throw new WorkoutControlError('Connect and finish syncing before changing session control. Retry the handoff to confirm it.');
  }
}

/** The durable request keeps editing locked across a timeout, restart or lost acknowledgement. */
export async function changeWorkoutControl(sessionId: string, agent: ConnectedAgent | null): Promise<void> {
  const owner = await getSignedInUserId();
  if (!owner) throw new WorkoutControlError('Sign in to change session control.');
  if (!(await NetInfo.fetch()).isConnected) throw new WorkoutControlError('Connect before changing session control.');
  await converge();
  const database = await bootstrapLocalDataLayer();
  if (await getSignedInUserId() !== owner) throw new WorkoutControlError('Your account changed. Open the session again.');
  const pending = pendingWorkoutControl(database, sessionId);
  const header = await loadWorkoutControlHeader(sessionId);
  if (await getSignedInUserId() !== owner) throw new WorkoutControlError('Your account changed. Open the session again.');
  if (!header) throw new WorkoutControlError('Finish syncing this workout’s pending changes before handing over.');
  if (!pending && agent && agent.workoutLoggingEnabled !== true) throw new WorkoutControlError(CONTROL_ERRORS.WORKOUT_PERMISSION_REQUIRED);
  const action: WorkoutControlAction = pending ?? {
    p_id: 'control:' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2),
    p_session_id: sessionId, p_base_revision: header.mergeRevision,
    p_client_id: agent?.clientId ?? null, p_granted_at: agent?.grantedAt ?? null,
  };
  database.transaction(tx => writeMergeLocal(tx, {
    ownerUserId: owner, id: workoutControlStorageId(sessionId), kind: 'state', payload: action,
  }));
  try {
    await mergeRpc('workout_set_control', action, owner);
  } catch (error) {
    if (error instanceof MergeRpcError && error.code === 'P0001') {
      // A SQL rejection proves rollback. Refresh before removing the local lock.
      await converge();
      if (await getSignedInUserId() !== owner) throw new WorkoutControlError('Your account changed. Open the session again.');
      database.transaction(tx => deleteMergeLocal(tx, owner, workoutControlStorageId(sessionId)));
      const code = Object.keys(CONTROL_ERRORS).find(key => error.message.includes(key));
      throw new WorkoutControlError(code ? CONTROL_ERRORS[code] : 'Session control is unavailable. Reopen the session and try again.');
    }
    throw new WorkoutControlError('Session control could not be confirmed. Retry the handoff in Session options before editing.');
  }
  await converge();
  if (await getSignedInUserId() !== owner) throw new WorkoutControlError('Your account changed. Open the session again.');
  database.transaction(tx => deleteMergeLocal(tx, owner, workoutControlStorageId(sessionId)));
}
