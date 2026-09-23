import { SEEDED_LOCATIONS, type SessionLocation } from '@/components/session-recorder/types';
import {
  listLocalGymsIncludingArchived,
  setLocalGymArchived,
  upsertLocalGym,
  type LocalGymDirectoryRecord,
  type LocalGymLookupRecord,
} from '@/src/data';
import type { GymCoordinates } from '@/src/location/gym-location-reads';

/**
 * The gyms a session can be at: the recorder's seeded gyms merged with the
 * local `gyms` table. Shared by the recorder's gym picker, the session view's
 * gym sheet and the Gyms screen, so all three offer the same list.
 */
const SEEDED_LOCATION_NAME_BY_ID = new Map(SEEDED_LOCATIONS.map((location) => [location.id, location.name]));

function mapLocalGymToSessionLocation(gym: LocalGymLookupRecord): SessionLocation {
  return {
    id: gym.id,
    name: gym.name,
    archived: false,
    latitude: gym.latitude,
    longitude: gym.longitude,
    coordinateAccuracyM: gym.coordinateAccuracyM,
    coordinatesUpdatedAt: gym.coordinatesUpdatedAt,
  };
}

export function mergeLocalGymsIntoLocations(
  currentLocations: SessionLocation[],
  localGyms: LocalGymLookupRecord[]
): SessionLocation[] {
  let didChange = false;
  const nextLocations = [...currentLocations];

  for (const localGym of localGyms) {
    const existingIndex = nextLocations.findIndex((location) => location.id === localGym.id);

    if (existingIndex === -1) {
      nextLocations.push(mapLocalGymToSessionLocation(localGym));
      didChange = true;
      continue;
    }

    const existing = nextLocations[existingIndex];
    const seededName = SEEDED_LOCATION_NAME_BY_ID.get(existing.id);
    const mergedLocation: SessionLocation = {
      ...existing,
      name: seededName && existing.name === seededName ? localGym.name : existing.name,
      latitude: localGym.latitude,
      longitude: localGym.longitude,
      coordinateAccuracyM: localGym.coordinateAccuracyM,
      coordinatesUpdatedAt: localGym.coordinatesUpdatedAt,
    };

    if (
      mergedLocation.name !== existing.name ||
      mergedLocation.latitude !== existing.latitude ||
      mergedLocation.longitude !== existing.longitude ||
      mergedLocation.coordinateAccuracyM !== existing.coordinateAccuracyM ||
      mergedLocation.coordinatesUpdatedAt !== existing.coordinatesUpdatedAt
    ) {
      nextLocations[existingIndex] = mergedLocation;
      didChange = true;
    }
  }

  return didChange ? nextLocations : currentLocations;
}

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

/** The session view's gym choices, in the recorder picker's order. */
export const listSessionGymOptions = async (): Promise<SessionGymOption[]> =>
  activeGymOptions(await listGymDirectory());

// The recorder's id shape for a gym the lifter adds.
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
