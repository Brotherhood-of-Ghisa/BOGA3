import { useSyncExternalStore } from 'react';
import { getBodyWeightContextRevision, subscribeToBodyWeightContext } from './invalidation';

/** Every mounted analytics consumer observes one shared, durable revision. */
export function useBodyWeightContextRevision() {
  return useSyncExternalStore(
    subscribeToBodyWeightContext,
    getBodyWeightContextRevision,
    getBodyWeightContextRevision,
  );
}
