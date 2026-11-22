import { useEffect } from 'react';

import { startHealthImportLifecycle } from '@/src/health-import';
import { startBodyWeightImportLifecycle } from '@/src/health-import/bodyweight-lifecycle';

/** Starts the Apple Health import's foreground and account triggers for the app's lifetime. Renders nothing. */
export function HealthImportBridge() {
  useEffect(() => {
    const stopWorkouts = startHealthImportLifecycle();
    const stopWeight = startBodyWeightImportLifecycle();
    return () => { stopWorkouts(); stopWeight(); };
  }, []);
  return null;
}
