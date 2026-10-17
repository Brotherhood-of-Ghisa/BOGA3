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
