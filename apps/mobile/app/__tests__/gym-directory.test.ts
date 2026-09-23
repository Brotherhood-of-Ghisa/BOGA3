/* eslint-disable import/first */


jest.mock('@/src/data', () => ({
  listLocalGymsIncludingArchived: jest.fn(),
  setLocalGymArchived: jest.fn(),
  upsertLocalGym: jest.fn(),
}));

import {
  activeGymOptions,
  createGymId,
  listGymDirectory,
  listSessionGymOptions,
  saveGym,
  setGymArchived,
  type GymDirectoryEntry,
} from '@/src/session-recorder/gym-options';

const data = jest.requireMock('@/src/data') as Record<string, jest.Mock>;

const row = (id: string, name: string, archivedAt: Date | null = null) => ({
  id,
  name,
  latitude: null,
  longitude: null,
  coordinateAccuracyM: null,
  coordinatesUpdatedAt: null,
  archivedAt,
});

describe('gym directory', () => {
  beforeEach(() => {
    data.listLocalGymsIncludingArchived.mockReset().mockResolvedValue([]);
    data.setLocalGymArchived.mockReset().mockResolvedValue(undefined);
    data.upsertLocalGym.mockReset().mockResolvedValue(undefined);
  });

  it('lists the seeded gyms first, then local ones, with a written seed row winning', async () => {
    data.listLocalGymsIncludingArchived.mockResolvedValue([
      row('alpha-gym', 'Alpha Gym'),
      row('westside-barbell-club', 'Westside Renamed', new Date('2026-09-20T00:00:00Z')),
    ]);

    const directory = await listGymDirectory();

    expect(directory.map((gym) => [gym.id, gym.name, gym.archived, gym.persisted])).toEqual([
      ['downtown-iron-temple', 'Downtown Iron Temple', false, false],
      ['westside-barbell-club', 'Westside Renamed', true, true],
      ['north-end-strength-lab', 'North End Strength Lab', false, false],
      ['alpha-gym', 'Alpha Gym', false, true],
    ]);
    // The session picker drops archived gyms, seeded ones included.
    expect(activeGymOptions(directory).map((gym) => gym.id)).toEqual([
      'downtown-iron-temple',
      'north-end-strength-lab',
      'alpha-gym',
    ]);
    await expect(listSessionGymOptions()).resolves.toEqual(activeGymOptions(directory));
  });

  it('adds a gym under a new custom id and renames without touching the location', async () => {
    expect(createGymId('Canal Street Gym', new Date(1_700_000_000_000))).toBe('custom-canal-street-gym-1700000000000');

    const id = await saveGym({ gym: null, name: 'Canal Street Gym' });
    expect(data.upsertLocalGym).toHaveBeenLastCalledWith({ id, name: 'Canal Street Gym', coordinates: null });

    const existing = (await listGymDirectory())[0] as GymDirectoryEntry;
    await saveGym({ gym: existing, name: 'Downtown Iron Works' });
    expect(data.upsertLocalGym).toHaveBeenLastCalledWith({ id: 'downtown-iron-temple', name: 'Downtown Iron Works' });
  });

  it('writes a seeded gym row before archiving it, and only then', async () => {
    const [seeded] = await listGymDirectory();
    await setGymArchived(seeded, true);
    expect(data.upsertLocalGym).toHaveBeenCalledWith({ id: 'downtown-iron-temple', name: 'Downtown Iron Temple' });
    expect(data.setLocalGymArchived).toHaveBeenCalledWith({ id: 'downtown-iron-temple', archived: true });

    data.upsertLocalGym.mockClear();
    await setGymArchived({ ...seeded, persisted: true, archived: true }, false);
    expect(data.upsertLocalGym).not.toHaveBeenCalled();
    expect(data.setLocalGymArchived).toHaveBeenLastCalledWith({ id: 'downtown-iron-temple', archived: false });
  });
});
