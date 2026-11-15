import { useSyncExternalStore } from 'react';

import { getHealthImportSnapshot, subscribeHealthImport, type HealthImportSnapshot } from './lifecycle';

export const useHealthImport = (): HealthImportSnapshot =>
  useSyncExternalStore(subscribeHealthImport, getHealthImportSnapshot, getHealthImportSnapshot);
