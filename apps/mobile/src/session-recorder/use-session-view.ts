import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import type { Session } from '@/components/session-recorder/types';
import { loadLatestSessionDraftSnapshot, loadLocalGymById, loadRecentExerciseBlocks } from '@/src/data';

import { mapDraftSnapshotToSession } from './session-model';
import { historicalBestOneRepMax } from './session-view-model';

export type SessionViewData = {
  sessionId: string;
  gymId: string | null;
  gymName: string | null;
  startedAt: Date;
  session: Session;
  // Keyed by exercise definition; filled once each history read settles.
  historicalBestByDefinitionId: ReadonlyMap<string, number | null>;
};

export type SessionViewState =
  | { status: 'loading' }
  // The route's session is no longer the active draft: finished, abandoned,
  // or never existed.
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; data: SessionViewData };

/**
 * Loads the active draft for the session view on every focus, as the recorder
 * does, so edits made on the exercise page (or in the recorder) show on return.
 * History for records is optional enrichment: while it loads, or if it fails,
 * cards show no record rather than blocking the view.
 */
export function useSessionView(sessionId: string | null) {
  const [state, setState] = useState<SessionViewState>({ status: 'loading' });
  const generationRef = useRef(0);

  const reload = useCallback(async () => {
    const generation = ++generationRef.current;
    const isCurrent = () => generation === generationRef.current;

    try {
      const snapshot = await loadLatestSessionDraftSnapshot();
      if (!isCurrent()) return;
      if (!snapshot || snapshot.sessionId !== sessionId) {
        setState({ status: 'missing' });
        return;
      }

      const gym = snapshot.gymId ? await loadLocalGymById(snapshot.gymId).catch(() => null) : null;
      if (!isCurrent()) return;

      const session = mapDraftSnapshotToSession(snapshot);
      const base: SessionViewData = {
        sessionId: snapshot.sessionId,
        gymId: snapshot.gymId,
        gymName: gym?.name ?? null,
        startedAt: snapshot.startedAt,
        session,
        historicalBestByDefinitionId: new Map(),
      };
      setState((current) =>
        // Keep the records already known for these exercises while history reloads.
        current.status === 'ready' && current.data.sessionId === base.sessionId
          ? { status: 'ready', data: { ...base, historicalBestByDefinitionId: current.data.historicalBestByDefinitionId } }
          : { status: 'ready', data: base }
      );

      const definitionIds = [...new Set(session.exercises.map((exercise) => exercise.exerciseDefinitionId))];
      const bests = await Promise.all(
        definitionIds.map(async (exerciseDefinitionId) => {
          try {
            const history = await loadRecentExerciseBlocks({ exerciseDefinitionId });
            return [exerciseDefinitionId, historicalBestOneRepMax(history.blocks)] as const;
          } catch {
            return null;
          }
        })
      );
      if (!isCurrent()) return;
      const historicalBestByDefinitionId = new Map(
        bests.filter((entry): entry is readonly [string, number | null] => entry !== null)
      );
      setState({ status: 'ready', data: { ...base, historicalBestByDefinitionId } });
    } catch {
      if (isCurrent()) {
        setState({ status: 'error' });
      }
    }
  }, [sessionId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
      return () => {
        // A read still in flight when the screen blurs must not land later.
        generationRef.current += 1;
      };
    }, [reload])
  );

  return { state, reload };
}
