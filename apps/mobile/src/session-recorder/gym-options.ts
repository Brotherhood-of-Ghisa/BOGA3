import { SEEDED_LOCATIONS } from '@/components/session-recorder/types';
import {
  listLocalGymsIncludingArchived,
  setLocalGymArchived,
  upsertLocalGym,
  type LocalGymDirectoryRecord,
} from '@/src/data';
import type { GymCoordinates } from '@/src/location/gym-location-reads';

/**
 * The gyms a session can be at: the seeded gyms merged with the local `gyms`
 * table. Shared by the session view's gym sheet and the Gyms screen, so both
 * offer the same list.
 */
export type SessionGymOption = { id: string; name: string };

export type GymDirectoryEntry = {
  id: string;
  name: string;
  archived: boolean;
  latitude: number | null;
  longitude: number | null;
  coordinateAccuracyM: number | null;
  coordinatesUpdatedAt: Date | null;
  // False for a seeded gym never written yet: its first write creates the row.
  persisted: boolean;
};

const SEEDED_LOCATION_IDS = new Set(SEEDED_LOCATIONS.map((location) => location.id));

const toDirectoryEntry = (row: LocalGymDirectoryRecord): GymDirectoryEntry => ({
  id: row.id,
  name: row.name,
  archived: row.archivedAt !== null,
  latitude: row.latitude,
  longitude: row.longitude,
  coordinateAccuracyM: row.coordinateAccuracyM,
  coordinatesUpdatedAt: row.coordinatesUpdatedAt,
  persisted: true,
});

/**
 * Every gym, archived ones included, in the picker's order: the seeded gyms
 * first, then the local ones by name. A seeded gym's row, once written, wins
 * over the seed — its rename, location and archive stick.
 */
export const listGymDirectory = async (): Promise<GymDirectoryEntry[]> => {
  const rows = await listLocalGymsIncludingArchived();
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const seeded = SEEDED_LOCATIONS.map((location): GymDirectoryEntry => {
    const row = rowById.get(location.id);
    return row
      ? toDirectoryEntry(row)
      : {
          id: location.id,
          name: location.name,
          archived: false,
          latitude: null,
          longitude: null,
          coordinateAccuracyM: null,
          coordinatesUpdatedAt: null,
          persisted: false,
        };
  });
  const local = rows.filter((row) => !SEEDED_LOCATION_IDS.has(row.id)).map(toDirectoryEntry);
  return [...seeded, ...local];
};

export const gymHasSavedLocation = (gym: Pick<GymDirectoryEntry, 'latitude' | 'longitude'>): boolean =>
  typeof gym.latitude === 'number' &&
  Number.isFinite(gym.latitude) &&
  typeof gym.longitude === 'number' &&
  Number.isFinite(gym.longitude);

/** The gyms a session can pick: the directory without the archived ones. */
export const activeGymOptions = (directory: GymDirectoryEntry[]): SessionGymOption[] =>
  directory.filter((gym) => !gym.archived).map(({ id, name }) => ({ id, name }));

/** The session view's gym choices: seeded gyms first, then the lifter's own. */
export const listSessionGymOptions = async (): Promise<SessionGymOption[]> =>
  activeGymOptions(await listGymDirectory());

// The id shape for a gym the lifter adds.
export const createGymId = (name: string, now: Date = new Date()): string =>
  `custom-${name.toLowerCase().replace(/\s+/g, '-')}-${now.getTime()}`;

/**
 * Adds a gym (`gym` null) or renames one, returning its id. A new gym may
 * carry the location staged in its editor; a rename leaves the location alone.
 */
export const saveGym = async (input: {
  gym: GymDirectoryEntry | null;
  name: string;
  coordinates?: GymCoordinates | null;
}): Promise<string> => {
  const id = input.gym?.id ?? createGymId(input.name);
  await upsertLocalGym({
    id,
    name: input.name,
    ...(input.gym ? {} : { coordinates: input.coordinates ?? null }),
  });
  return id;
};

/** Saves (`coordinates`) or clears (`null`) a gym's private location. */
export const saveGymLocation = async (gym: GymDirectoryEntry, coordinates: GymCoordinates | null): Promise<void> => {
  await upsertLocalGym({ id: gym.id, name: gym.name, coordinates });
};

/**
 * Archives or unarchives a gym: the synced soft delete. A seeded gym never
 * written yet gets its row first, so the archive sticks.
 */
export const setGymArchived = async (gym: GymDirectoryEntry, archived: boolean): Promise<void> => {
  if (!gym.persisted) {
    await upsertLocalGym({ id: gym.id, name: gym.name });
  }
  await setLocalGymArchived({ id: gym.id, archived });
};
