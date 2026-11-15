import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { listInjuries, type InjuryView } from '@/src/data/injuries';
import { subscribeToInjuries } from '@/src/data/injury-invalidation';

export type InjuriesState =
  | { status: 'loading'; active: readonly InjuryView[]; resolved: readonly InjuryView[] }
  | { status: 'ready'; active: readonly InjuryView[]; resolved: readonly InjuryView[] }
  | { status: 'error'; active: readonly InjuryView[]; resolved: readonly InjuryView[] };

export const INJURIES_LOAD_ERROR = 'Couldn’t load injuries.';

export function useInjuries(options: { muscleGroupId?: string } = {}) {
  const [state, setState] = useState<InjuriesState>({
    status: 'loading',
    active: [],
    resolved: [],
  });
  const latest = useRef(0);

  const reload = useCallback(() => {
    const request = ++latest.current;
    setState((current) =>
      current.status === 'ready'
        ? current
        : { status: 'loading', active: current.active, resolved: current.resolved }
    );

    return Promise.all([
      listInjuries({ status: 'active', muscleGroupId: options.muscleGroupId }),
      listInjuries({ status: 'resolved', muscleGroupId: options.muscleGroupId }),
    ]).then(
      ([active, resolved]) => {
        if (latest.current === request) {
          setState({ status: 'ready', active, resolved });
        }
      },
      () => {
        if (latest.current === request) {
          setState((current) => ({
            status: 'error',
            active: current.active,
            resolved: current.resolved,
          }));
        }
      }
    );
  }, [options.muscleGroupId]);

  // Reload when the screen is focused
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  // Reload when invalidation changes (e.g. from an editor sheet mutation)
  useEffect(() => {
    return subscribeToInjuries(() => {
      void reload();
    });
  }, [reload]);

  return { state, reload };
}
