/* eslint-disable import/first */

const mockGetSupabaseMobileClient = jest.fn();
const mockInsert = jest.fn();

jest.mock('@/src/auth/supabase', () => ({
  getSupabaseMobileClient: (...args: unknown[]) => mockGetSupabaseMobileClient(...args),
}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.2.3',
  nativeBuildVersion: '45',
}));

jest.mock('expo-constants', () => ({
  expoConfig: {
    extra: {
      env: 'test',
    },
    version: '9.9.9',
  },
}));

jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
  },
}));

import { logEvent } from '@/src/logging/logEvent';

describe('logEvent', () => {
  beforeEach(() => {
    mockGetSupabaseMobileClient.mockReset();
    mockInsert.mockReset();
    mockInsert.mockResolvedValue({
      data: null,
      error: null,
    });
  });

  it('returns without inserting when the Supabase mobile client is unavailable', async () => {
    mockGetSupabaseMobileClient.mockReturnValue(null);

    await expect(
      logEvent({
        level: 'error',
        event: 'auth.restore_failed',
      })
    ).resolves.toBeUndefined();

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('inserts default source, client metadata, and sanitized context', async () => {
    mockGetSupabaseMobileClient.mockReturnValue({
      from: jest.fn(() => ({
        insert: mockInsert,
      })),
    });

    await logEvent({
      level: 'warn',
      event: 'sync.flush_transport_failed',
      message: 'network failed',
      userId: 'user-1',
      context: {
        retryCount: 2,
        password: 'secret',
        nested: {
          accessToken: 'token',
          status: 'transport_failure',
        },
      },
    });

    expect(mockInsert).toHaveBeenCalledWith({
      level: 'warn',
      source: 'app',
      event: 'sync.flush_transport_failed',
      message: 'network failed',
      user_id: 'user-1',
      client_platform: 'ios',
      client_app_version: '1.2.3',
      client_build_number: '45',
      client_runtime_version: null,
      client_update_id: null,
      client_channel: null,
      client_variant: 'test',
      context: {
        retryCount: 2,
        nested: {
          status: 'transport_failure',
        },
      },
    });
  });

  it('never throws when the insert fails', async () => {
    mockGetSupabaseMobileClient.mockReturnValue({
      from: jest.fn(() => ({
        insert: mockInsert,
      })),
    });
    mockInsert.mockRejectedValueOnce(new Error('insert failed'));

    await expect(
      logEvent({
        level: 'error',
        source: 'auth',
        event: 'auth.sign_in_failed',
      })
    ).resolves.toBeUndefined();
  });

  it('never throws when Supabase returns an insert error', async () => {
    mockGetSupabaseMobileClient.mockReturnValue({
      from: jest.fn(() => ({
        insert: mockInsert,
      })),
    });
    mockInsert.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'permission denied for table app_logs',
      },
    });

    await expect(
      logEvent({
        level: 'info',
        source: 'auth',
        event: 'auth.sign_in_succeeded',
      })
    ).resolves.toBeUndefined();
  });
});
