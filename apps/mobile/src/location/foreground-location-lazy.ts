import { NativeModulesProxy } from 'expo-modules-core';
import { NativeModules } from 'react-native';

import type { CurrentForegroundPositionResult } from './foreground-location-service';

export const getCurrentForegroundPositionLazy = async (): Promise<CurrentForegroundPositionResult> => {
  if (!NativeModules.ExpoLocation && !NativeModulesProxy.ExpoLocation) {
    return {
      status: 'read_failure',
      error: new Error('ExpoLocation native module is unavailable. Rebuild the dev client before using GPS detection.'),
    };
  }

  try {
    const { getCurrentForegroundPosition } = await import('./foreground-location-service');
    return await getCurrentForegroundPosition();
  } catch (error) {
    return {
      status: 'read_failure',
      error,
    };
  }
};
