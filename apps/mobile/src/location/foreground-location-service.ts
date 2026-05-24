import * as Location from 'expo-location';

export const DEFAULT_LOCATION_READ_TIMEOUT_MS = 10_000;

export type ForegroundLocationPosition = {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  capturedAt: Date;
};

export type ForegroundLocationPermissionResult =
  | {
      status: 'granted';
    }
  | {
      status: 'permission_denied';
      canAskAgain: boolean;
    }
  | {
      status: 'unavailable';
      reason: 'services_disabled';
    }
  | {
      status: 'unexpected_error';
      error: unknown;
    };

export type CurrentForegroundPositionResult =
  | {
      status: 'success';
      position: ForegroundLocationPosition;
    }
  | ForegroundLocationPermissionResult
  | {
      status: 'timeout';
      timeoutMs: number;
    }
  | {
      status: 'read_failure';
      error: unknown;
    };

type LocationApi = {
  Accuracy: {
    Balanced: number;
  };
  getCurrentPositionAsync: (options: { accuracy: number }) => Promise<{
    coords: {
      accuracy: number | null;
      latitude: number;
      longitude: number;
    };
    timestamp: number;
  }>;
  hasServicesEnabledAsync: () => Promise<boolean>;
  requestForegroundPermissionsAsync: () => Promise<{
    canAskAgain: boolean;
    granted: boolean;
    status: string;
  }>;
};

const defaultLocationApi: LocationApi = Location;

class LocationReadTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Timed out reading foreground location after ${timeoutMs}ms`);
    this.name = 'LocationReadTimeoutError';
  }
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new LocationReadTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export const requestForegroundLocationPermission = async (
  locationApi: LocationApi = defaultLocationApi
): Promise<ForegroundLocationPermissionResult> => {
  try {
    const servicesEnabled = await locationApi.hasServicesEnabledAsync();

    if (!servicesEnabled) {
      return {
        status: 'unavailable',
        reason: 'services_disabled',
      };
    }

    const permission = await locationApi.requestForegroundPermissionsAsync();

    if (!permission.granted) {
      return {
        status: 'permission_denied',
        canAskAgain: permission.canAskAgain,
      };
    }

    return {
      status: 'granted',
    };
  } catch (error) {
    return {
      status: 'unexpected_error',
      error,
    };
  }
};

export const getCurrentForegroundPosition = async ({
  locationApi = defaultLocationApi,
  timeoutMs = DEFAULT_LOCATION_READ_TIMEOUT_MS,
}: {
  locationApi?: LocationApi;
  timeoutMs?: number;
} = {}): Promise<CurrentForegroundPositionResult> => {
  const permission = await requestForegroundLocationPermission(locationApi);

  if (permission.status !== 'granted') {
    return permission;
  }

  try {
    const position = await withTimeout(
      locationApi.getCurrentPositionAsync({
        accuracy: locationApi.Accuracy.Balanced,
      }),
      timeoutMs
    );

    return {
      status: 'success',
      position: {
        accuracyM: position.coords.accuracy,
        capturedAt: new Date(position.timestamp),
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      },
    };
  } catch (error) {
    if (error instanceof LocationReadTimeoutError) {
      return {
        status: 'timeout',
        timeoutMs: error.timeoutMs,
      };
    }

    return {
      status: 'read_failure',
      error,
    };
  }
};
