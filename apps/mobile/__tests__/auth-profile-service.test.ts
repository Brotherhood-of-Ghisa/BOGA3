/* eslint-disable import/first */

const mockGetRequiredSupabaseMobileClient = jest.fn();

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: () => mockGetRequiredSupabaseMobileClient(),
}));

import { loadUserProfile, saveUsername } from '@/src/auth/profile';

type MockProfileRow = {
  created_at: string;
  id: string;
  updated_at: string;
  username: string | null;
};

type MockProfileTable = {
  eq: jest.Mock;
  insert: jest.Mock;
  maybeSingle: jest.Mock;
  select: jest.Mock;
  single: jest.Mock;
  update: jest.Mock;
};

const createProfileRow = (overrides: Partial<MockProfileRow> = {}): MockProfileRow => ({
  created_at: '2026-03-04T12:00:00.000Z',
  id: 'user-1',
  updated_at: '2026-03-04T12:05:00.000Z',
  username: 'existing-user',
  ...overrides,
});

const createProfileTable = (): MockProfileTable => {
  const table: MockProfileTable = {
    eq: jest.fn(() => table),
    insert: jest.fn(() => table),
    maybeSingle: jest.fn(),
    select: jest.fn(() => table),
    single: jest.fn(),
    update: jest.fn(() => table),
  };

  return table;
};

describe('auth profile service', () => {
  const mockSchema = jest.fn();
  const mockFrom = jest.fn();
  const table = createProfileTable();

  beforeEach(() => {
    table.eq.mockClear();
    table.insert.mockClear();
    table.maybeSingle.mockClear();
    table.select.mockClear();
    table.single.mockClear();
    table.update.mockClear();
    mockFrom.mockReset();
    mockSchema.mockReset();
    mockGetRequiredSupabaseMobileClient.mockReset();

    mockFrom.mockReturnValue(table);
    mockSchema.mockReturnValue({
      from: mockFrom,
    });
    mockGetRequiredSupabaseMobileClient.mockReturnValue({
      schema: mockSchema,
    });
  });

  it('returns the existing profile row without provisioning when one already exists', async () => {
    table.maybeSingle.mockResolvedValue({
      data: createProfileRow(),
      error: null,
    });

    const result = await loadUserProfile('user-1');

    expect(mockSchema).toHaveBeenCalledWith('app_public');
    expect(mockFrom).toHaveBeenCalledWith('user_profiles');
    expect(table.insert).not.toHaveBeenCalled();
    expect(result.wasProvisioned).toBe(false);
    expect(result.profile.username).toBe('existing-user');
  });

  it('provisions a missing profile row lazily during load', async () => {
    table.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });
    table.single.mockResolvedValue({
      data: createProfileRow({
        username: null,
      }),
      error: null,
    });

    const result = await loadUserProfile('user-1');

    expect(table.insert).toHaveBeenCalledWith({
      id: 'user-1',
    });
    expect(result.wasProvisioned).toBe(true);
    expect(result.profile.username).toBeNull();
  });

  it('recovers from a duplicate-row race by re-reading the provisioned profile', async () => {
    table.maybeSingle
      .mockResolvedValueOnce({
        data: null,
        error: null,
      })
      .mockResolvedValueOnce({
        data: createProfileRow({
          username: 'race-created-user',
        }),
        error: null,
      });
    table.single.mockResolvedValueOnce({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "user_profiles_pkey"',
      },
    });

    const result = await loadUserProfile('user-1');

    expect(table.insert).toHaveBeenCalledWith({
      id: 'user-1',
    });
    expect(result.wasProvisioned).toBe(true);
    expect(result.profile.username).toBe('race-created-user');
  });

  it('trims usernames and provisions before updating when save is the first profile write', async () => {
    table.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    table.single
      .mockResolvedValueOnce({
        data: createProfileRow({
          username: null,
        }),
        error: null,
      })
      .mockResolvedValueOnce({
        data: createProfileRow({
          updated_at: '2026-03-04T12:10:00.000Z',
          username: 'trimmed-name',
        }),
        error: null,
      });

    const result = await saveUsername('user-1', '  trimmed-name  ');

    expect(table.insert).toHaveBeenCalledWith({
      id: 'user-1',
    });
    expect(table.update).toHaveBeenCalledWith({
      username: 'trimmed-name',
    });
    expect(result.username).toBe('trimmed-name');
  });

  it('surfaces save failures with the profile-service fallback message', async () => {
    table.maybeSingle.mockResolvedValueOnce({
      data: createProfileRow({
        username: 'existing-user',
      }),
      error: null,
    });
    table.single.mockResolvedValueOnce({
      data: null,
      error: {
        message: '',
      },
    });

    await expect(saveUsername('user-1', 'next-name')).rejects.toThrow('Unable to save username right now.');
  });
});
