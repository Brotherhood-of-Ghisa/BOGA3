import {
  DEFAULT_LOCATION_READ_TIMEOUT_MS,
  getCurrentForegroundPosition,
  requestForegroundLocationPermission,
} from '@/src/location/foreground-location-service';

type FakeLocationApi = NonNullable<Parameters<typeof requestForegroundLocationPermission>[0]>;

const createApi = (overrides: Partial<FakeLocationApi> = {}): FakeLocationApi => ({
  Accuracy: {
    Balanced: 3,
  },
  getCurrentPositionAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn().mockResolvedValue(true),
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({
    canAskAgain: true,
    granted: true,
    status: 'granted',
  }),
  ...overrides,
});

describe('requestForegroundLocationPermission', () => {
  it('returns granted when services are enabled and foreground permission is granted', async () => {
    const api = createApi();

    await expect(requestForegroundLocationPermission(api)).resolves.toEqual({
      status: 'granted',
    });
    expect(api.hasServicesEnabledAsync).toHaveBeenCalledTimes(1);
    expect(api.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('returns unavailable when device location services are disabled', async () => {
    const api = createApi({
      hasServicesEnabledAsync: jest.fn().mockResolvedValue(false),
    });

    await expect(requestForegroundLocationPermission(api)).resolves.toEqual({
      status: 'unavailable',
      reason: 'services_disabled',
    });
    expect(api.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns permission_denied when foreground permission is denied', async () => {
    const api = createApi({
      requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({
        canAskAgain: false,
        granted: false,
        status: 'denied',
      }),
    });

    await expect(requestForegroundLocationPermission(api)).resolves.toEqual({
      status: 'permission_denied',
      canAskAgain: false,
    });
  });
});

describe('getCurrentForegroundPosition', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('normalizes a successful foreground position reading', async () => {
    const api = createApi({
      getCurrentPositionAsync: jest.fn().mockResolvedValue({
        coords: {
          accuracy: 14,
          latitude: 51.5007,
          longitude: -0.1246,
        },
        timestamp: 1779537600000,
      }),
    });

    await expect(getCurrentForegroundPosition({ locationApi: api })).resolves.toEqual({
      status: 'success',
      position: {
        accuracyM: 14,
        capturedAt: new Date('2026-05-23T12:00:00.000Z'),
        latitude: 51.5007,
        longitude: -0.1246,
      },
    });
    expect(api.getCurrentPositionAsync).toHaveBeenCalledWith({
      accuracy: api.Accuracy.Balanced,
    });
  });

  it('passes through permission denial without reading position', async () => {
    const api = createApi({
      requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({
        canAskAgain: false,
        granted: false,
        status: 'denied',
      }),
    });

    await expect(getCurrentForegroundPosition({ locationApi: api })).resolves.toEqual({
      status: 'permission_denied',
      canAskAgain: false,
    });
    expect(api.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('returns timeout when the current-position read does not settle in time', async () => {
    jest.useFakeTimers();
    const api = createApi({
      getCurrentPositionAsync: jest.fn().mockReturnValue(new Promise(() => {})),
    });
    const resultPromise = getCurrentForegroundPosition({
      locationApi: api,
      timeoutMs: DEFAULT_LOCATION_READ_TIMEOUT_MS,
    });

    await jest.advanceTimersByTimeAsync(DEFAULT_LOCATION_READ_TIMEOUT_MS);

    await expect(resultPromise).resolves.toEqual({
      status: 'timeout',
      timeoutMs: DEFAULT_LOCATION_READ_TIMEOUT_MS,
    });
  });

  it('returns read_failure when the current-position read rejects', async () => {
    const error = new Error('provider failed');
    const api = createApi({
      getCurrentPositionAsync: jest.fn().mockRejectedValue(error),
    });

    await expect(getCurrentForegroundPosition({ locationApi: api })).resolves.toEqual({
      status: 'read_failure',
      error,
    });
  });

  it('returns unexpected_error when service or permission checks fail unexpectedly', async () => {
    const error = new Error('native module unavailable');
    const api = createApi({
      hasServicesEnabledAsync: jest.fn().mockRejectedValue(error),
    });

    await expect(getCurrentForegroundPosition({ locationApi: api })).resolves.toEqual({
      status: 'unexpected_error',
      error,
    });
  });
});
