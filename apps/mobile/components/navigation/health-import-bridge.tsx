import { useEffect } from 'react';

import { startHealthImportLifecycle } from '@/src/health-import';

/** Starts the Apple Health import's foreground and account triggers for the app's lifetime. Renders nothing. */
export function HealthImportBridge() {
  useEffect(() => startHealthImportLifecycle(), []);
  return null;
}
