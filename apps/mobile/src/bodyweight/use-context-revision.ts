import { useEffect, useState } from 'react';
import { subscribeToBodyWeightContext } from './invalidation';

/** A reading write or sync pull refreshes focused projections and open sheets. */
export function useBodyWeightContextRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => subscribeToBodyWeightContext(() => setRevision(value => value + 1)), []);
  return revision;
}
