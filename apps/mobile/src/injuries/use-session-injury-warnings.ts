import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { listInjuries, type InjuryView } from '@/src/data/injuries';
import { subscribeToInjuries } from '@/src/data/injury-invalidation';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import {
  matchInjuriesToExercise,
  type ExerciseAnatomyTarget,
  type ExerciseWarningResult,
  type InjuryWarningSeverity,
} from './injury-warning-engine';

// In-memory dismissal registry across the active app process:
// keyed by `${sessionId}:${injuryId}` and `${sessionId}:${exerciseId}:${injuryId}`
const dismissedInjuryKeys = new Set<string>();
const dismissalListeners = new Set<() => void>();

function notifyDismissalChange() {
  for (const listener of dismissalListeners) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
}

export function clearSessionInjuryDismissals(sessionId?: string): void {
  if (!sessionId) {
    dismissedInjuryKeys.clear();
  } else {
    for (const key of Array.from(dismissedInjuryKeys)) {
      if (key.startsWith(`${sessionId}:`)) {
        dismissedInjuryKeys.delete(key);
      }
    }
  }
  notifyDismissalChange();
}

export type SessionExerciseTarget = {
  id: string; // sessionExerciseId
  exerciseDefinitionId: string;
  name: string;
};

export type SessionInjuryWarningsState = {
  activeInjuries: readonly InjuryView[];
  loading: boolean;
  warningsByExerciseId: Map<string, ExerciseWarningResult>;
  warningSeveritiesByExerciseId: Map<string, InjuryWarningSeverity>;
  hasAnyWarning: boolean;
  hasAcuteWarning: boolean;
  getWarningForExercise: (
    exercise: { id?: string; exerciseDefinitionId: string; name: string }
  ) => ExerciseWarningResult;
  dismissWarning: (injuryId: string, exerciseId?: string) => void;
  isDismissed: (injuryId: string, exerciseId?: string) => boolean;
};

export function useSessionInjuryWarnings(
  sessionId?: string | null,
  sessionExercises?: readonly SessionExerciseTarget[]
): SessionInjuryWarningsState {
  const [activeInjuries, setActiveInjuries] = useState<readonly InjuryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissalRev, setDismissalRev] = useState(0);
  const catalog = useExerciseCatalog();
  const latestReq = useRef(0);

  const loadActive = useCallback(() => {
    const req = ++latestReq.current;
    listInjuries({ status: 'active' }).then(
      (items) => {
        if (latestReq.current === req) {
          setActiveInjuries(items);
          setLoading(false);
        }
      },
      () => {
        if (latestReq.current === req) {
          setLoading(false);
        }
      }
    );
  }, []);

  useEffect(() => {
    loadActive();
    return subscribeToInjuries(loadActive);
  }, [loadActive]);

  useEffect(() => {
    const onDismissal = () => setDismissalRev((r) => r + 1);
    dismissalListeners.add(onDismissal);
    return () => {
      dismissalListeners.delete(onDismissal);
    };
  }, []);

  const isDismissed = useCallback(
    (injuryId: string, exerciseId?: string): boolean => {
      if (!sessionId) return false;
      if (dismissedInjuryKeys.has(`${sessionId}:${injuryId}`)) return true;
      if (exerciseId && dismissedInjuryKeys.has(`${sessionId}:${exerciseId}:${injuryId}`)) {
        return true;
      }
      return false;
    },
    [sessionId]
  );

  const dismissWarning = useCallback(
    (injuryId: string, exerciseId?: string) => {
      if (!sessionId) return;
      dismissedInjuryKeys.add(`${sessionId}:${injuryId}`);
      if (exerciseId) {
        dismissedInjuryKeys.add(`${sessionId}:${exerciseId}:${injuryId}`);
      }
      notifyDismissalChange();
    },
    [sessionId]
  );

  const getDismissedSetForExercise = useCallback(
    (exerciseId?: string): Set<string> => {
      const set = new Set<string>();
      for (const injury of activeInjuries) {
        if (isDismissed(injury.id, exerciseId)) {
          set.add(injury.id);
        }
      }
      return set;
    },
    [activeInjuries, isDismissed]
  );

  const getWarningForExercise = useCallback(
    (exercise: { id?: string; exerciseDefinitionId: string; name: string }): ExerciseWarningResult => {
      const catalogEx = catalog.exercises.find((e) => e.id === exercise.exerciseDefinitionId);
      const target: ExerciseAnatomyTarget = {
        exerciseDefinitionId: exercise.exerciseDefinitionId,
        name: exercise.name,
        mappings: catalogEx?.mappings,
      };

      const dismissedSet = getDismissedSetForExercise(exercise.id);
      return matchInjuriesToExercise(target, activeInjuries, {
        dismissedInjuryIds: dismissedSet,
      });
    },
    [catalog.exercises, activeInjuries, getDismissedSetForExercise]
  );

  const { warningsByExerciseId, warningSeveritiesByExerciseId, hasAnyWarning, hasAcuteWarning } =
    useMemo(() => {
      // dismissalRev is accessed here to recompute when a dismissal changes
      void dismissalRev;

      const warningsMap = new Map<string, ExerciseWarningResult>();
      const severitiesMap = new Map<string, InjuryWarningSeverity>();
      let anyWarning = false;
      let acuteWarning = false;

      if (sessionExercises && sessionExercises.length > 0) {
        for (const ex of sessionExercises) {
          const res = getWarningForExercise(ex);
          warningsMap.set(ex.id, res);
          if (res.hasWarning && res.activeWarning && !res.activeWarning.isDismissed) {
            severitiesMap.set(ex.id, res.activeWarning.severity);
            anyWarning = true;
            if (res.activeWarning.severity === 'acute') {
              acuteWarning = true;
            }
          }
        }
      }

      return {
        warningsByExerciseId: warningsMap,
        warningSeveritiesByExerciseId: severitiesMap,
        hasAnyWarning: anyWarning,
        hasAcuteWarning: acuteWarning,
      };
    }, [dismissalRev, sessionExercises, getWarningForExercise]);

  return {
    activeInjuries,
    loading,
    warningsByExerciseId,
    warningSeveritiesByExerciseId,
    hasAnyWarning,
    hasAcuteWarning,
    getWarningForExercise,
    dismissWarning,
    isDismissed,
  };
}
