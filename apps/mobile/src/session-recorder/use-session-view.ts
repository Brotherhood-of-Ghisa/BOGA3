import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import type { ResolvedSessionWeight } from '@/src/bodyweight/as-of';
import type { Session } from '@/components/session-recorder/types';
import { loadSessionInsightHistory, type PersonalRecordSessionInput } from '@/src/session-insights';
import { loadLatestSessionDraftSnapshot, loadLocalGymById, loadSessionSnapshotById } from '@/src/data';

import { loadHistoricalBestsExcluding } from './historical-bests';
import { mapDraftSnapshotToSession } from './session-model';

export type SessionViewData = ResolvedSessionWeight & {
  sessionId: string;
  // `completed`: a finished session opened to edit it (History, completed
  // session `Edit`); `completedAt` is then its persisted End.
  status: 'active' | 'completed';
  gymId: string | null;
  gymName: string | null;
  startedAt: Date;
  completedAt: Date | null;
  session: Session;
  comparisonAt: Date;
  insightHistory: PersonalRecordSessionInput[];
  insightHistoryState: 'loading' | 'ready' | 'error';
  // Keyed by exercise definition; filled once each history read settles.
  historicalBestByDefinitionId: ReadonlyMap<string, number | null>;
};

export type SessionViewState =
  | { status: 'loading' }
  // The route's session is neither the active draft nor a completed session:
  // abandoned, deleted, or never existed.
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; data: SessionViewData };

// The route's session: the active draft when it is still `sessionId`, else a
// completed (not deleted) session with that id.
const loadViewedSession = async (sessionId: string | null) => {
  const draft = await loadLatestSessionDraftSnapshot();
  if (draft && draft.sessionId === sessionId) {
    return { ...draft, status: 'active' as const, completedAt: null };
  }
  if (!sessionId) return null;
  const snapshot = await loadSessionSnapshotById(sessionId);
  return snapshot && snapshot.status === 'completed' && snapshot.deletedAt === null
    ? { ...snapshot, status: 'completed' as const, completedAt: snapshot.completedAt ?? snapshot.startedAt }
    : null;
};

/**
 * Loads the session for the session view on every focus, as the recorder
 * does, so edits made on the exercise page (or in the recorder) show on return.
 * History for records is optional enrichment: while it loads, or if it fails,
 * cards show no record rather than blocking the view. A completed session is
 * measured against the rest of history, not against itself.
 */
export function useSessionView(sessionId: string | null) {
  const [state, setState] = useState<SessionViewState>({ status: 'loading' });
  const datedWeightRevision = useBodyWeightContextRevision();
  const generationRef = useRef(0);

  const reload = useCallback(async () => {
    const generation = ++generationRef.current;
    const isCurrent = () => generation === generationRef.current;

    try {
      const snapshot = await loadViewedSession(sessionId);
      if (!isCurrent()) return;
      if (!snapshot) {
        setState({ status: 'missing' });
        return;
      }

      const gym = snapshot.gymId ? await loadLocalGymById(snapshot.gymId).catch(() => null) : null;
      if (!isCurrent()) return;

      const session = mapDraftSnapshotToSession(snapshot);
      const base: SessionViewData = {
        sessionId: snapshot.sessionId,
        bodyWeightKg: snapshot.bodyWeightKg,
        bodyWeightSource: snapshot.bodyWeightSource,
        bodyWeightMeasurementId: snapshot.bodyWeightMeasurementId,
        bodyWeightMeasuredAt: snapshot.bodyWeightMeasuredAt,

        status: snapshot.status,
        gymId: snapshot.gymId,
        gymName: gym?.name ?? null,
        startedAt: snapshot.startedAt,
        completedAt: snapshot.completedAt,
        session,
        comparisonAt: snapshot.completedAt ?? new Date(),
        insightHistory: [],
        insightHistoryState: 'loading',
        historicalBestByDefinitionId: new Map(),
      };
      setState((current) =>
        // Keep the records already known for these exercises while history reloads.
        current.status === 'ready' && current.data.sessionId === base.sessionId
          ? { status: 'ready', data: { ...base, historicalBestByDefinitionId: current.data.historicalBestByDefinitionId } }
          : { status: 'ready', data: base }
      );

      // Independent optional enrichments: a failed comparison read must not
      // block logging or hide a record, and a blurred generation cannot land.
      await Promise.all([
        loadHistoricalBestsExcluding(
          snapshot.sessionId,
          session.exercises.map((exercise) => exercise.exerciseDefinitionId)
        ).then((historicalBestByDefinitionId) => {
          if (!isCurrent()) return;
          setState((current) => current.status === 'ready'
            ? { status: 'ready', data: { ...current.data, historicalBestByDefinitionId } }
            : current);
        }),
        loadSessionInsightHistory({
          targetSessionId: snapshot.sessionId,
          completedAt: base.comparisonAt,
        }).then((insightHistory) => {
          if (!isCurrent()) return;
          setState((current) => current.status === 'ready'
            ? { status: 'ready', data: { ...current.data, insightHistory, insightHistoryState: 'ready' } }
            : current);
        }).catch(() => {
          if (!isCurrent()) return;
          setState((current) => current.status === 'ready'
            ? { status: 'ready', data: { ...current.data, insightHistoryState: 'error' } }
            : current);
        }),
      ]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- A committed timeline change must reload the focused projection.
    }, [reload, datedWeightRevision])
  );

  return { state, reload };
}
