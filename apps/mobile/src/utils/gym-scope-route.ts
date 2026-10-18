/**
 * The gym scope across a route boundary.
 *
 * In-process, a gym scope is three-state: unset is every gym, `null` is the
 * sessions with no gym, an id is that gym. A route param carries a value or
 * nothing at all, so `null` has no representation — the no-gym scope travels
 * as this reserved value instead, and the reader decodes it straight back.
 * Gym ids are generated hex, so no gym can claim it.
 */
export const NO_GYM_ROUTE_PARAM = 'no-gym';

/** The three-state gym scope a route param names; `null` from the reserved value. */
export const decodeGymRouteParam = (raw: string | null | undefined): string | null | undefined => {
  if (raw === null || raw === undefined) return undefined;
  return raw === NO_GYM_ROUTE_PARAM ? null : raw;
};

/** The route param for a three-state gym scope; unset (every gym) is no param. */
export const encodeGymRouteParam = (gymId: string | null | undefined): string | undefined => {
  if (gymId === undefined) return undefined;
  return gymId === null ? NO_GYM_ROUTE_PARAM : gymId;
};

/** One choice a gym picker offers: a gym, or (`gymId: null`) the sessions with no gym. */
export type GymScopeOption = {
  gymId: string | null;
  name: string | null;
  /** The sessions the choice holds, when the view counts them. */
  sessionCount?: number;
};

export const ALL_GYMS_LABEL = 'All gyms';
export const NO_GYM_LABEL = 'No gym';
/** A chosen gym whose name the view cannot read. */
export const SELECTED_GYM_LABEL = 'Selected gym';

/** How a picker names one of its choices. */
export const gymOptionLabel = (option: GymScopeOption): string =>
  option.gymId === null ? NO_GYM_LABEL : option.name?.trim() || 'Unnamed gym';

/** How a view names a gym scope: every gym, no gym, or the gym's name. */
export const gymScopeLabel = (
  gymId: string | null | undefined,
  options: readonly GymScopeOption[],
): string => {
  if (gymId === undefined) return ALL_GYMS_LABEL;
  const option = options.find((candidate) => candidate.gymId === gymId);
  return option ? gymOptionLabel(option) : gymId === null ? NO_GYM_LABEL : SELECTED_GYM_LABEL;
};
