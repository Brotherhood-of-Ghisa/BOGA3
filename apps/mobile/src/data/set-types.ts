import { EFFORT_LOGGING_POLICY, WORKING_SET_POLICY } from '../config/training';

export type RirSessionSetType = `rir_${number}`;
export type SessionSetType = 'warm_up' | RirSessionSetType;
export type SessionSetTypeValue = SessionSetType | null;

const rirTypesThrough = (maxRir: number): RirSessionSetType[] =>
  Array.from({ length: maxRir + 1 }, (_, rir): RirSessionSetType => `rir_${rir}`);

/** Current selectable efforts; persisted values are validated independently. */
export const RIR_SESSION_SET_TYPES = rirTypesThrough(EFFORT_LOGGING_POLICY.maxSelectableRir);
export const SESSION_SET_TYPES: readonly SessionSetType[] = ['warm_up', ...RIR_SESSION_SET_TYPES];
export const WORKING_SESSION_SET_TYPES = rirTypesThrough(WORKING_SET_POLICY.maxRir);

/** Canonical stored RIR, including values outside today's selectable range. */
export const getSessionSetRir = (value: unknown): number | null => {
  if (typeof value !== 'string' || !/^rir_(0|[1-9]\d*)$/.test(value)) return null;
  const rir = Number(value.slice(4));
  return Number.isSafeInteger(rir) && value === `rir_${rir}` ? rir : null;
};

export const isSessionSetType = (value: unknown): value is SessionSetType =>
  value === 'warm_up' || getSessionSetRir(value) !== null;

export const normalizeSessionSetType = (value: unknown): SessionSetTypeValue =>
  isSessionSetType(value) ? value : null;

export const isWorkingSessionSetType = (value: unknown): boolean => {
  const rir = getSessionSetRir(value);
  return rir !== null && rir <= WORKING_SET_POLICY.maxRir;
};

/** Shared by current controls, history, completed sessions and group views. */
export const formatSessionSetType = (value: unknown, style: 'full' | 'compact' = 'full'): string | null => {
  if (value === 'warm_up') return 'W-Up';
  const rir = getSessionSetRir(value);
  return rir === null ? null : `${style === 'compact' ? 'R' : 'RIR '}${rir}`;
};

/** Effort moves from warm-up through unspecified, then easiest to hardest. */
export const SESSION_SET_TYPE_CYCLE: readonly SessionSetTypeValue[] = [
  'warm_up', null, ...[...RIR_SESSION_SET_TYPES].reverse(),
];

export const nextSessionSetType = (value: SessionSetTypeValue): SessionSetTypeValue => {
  const index = SESSION_SET_TYPE_CYCLE.indexOf(normalizeSessionSetType(value));
  // A historical effort outside the configured range re-enters at Warm-up.
  return SESSION_SET_TYPE_CYCLE[(index + 1) % SESSION_SET_TYPE_CYCLE.length];
};

/** Undefined means no previous set; any stored RIR is inherited losslessly. */
export const defaultSessionSetType = (previous: SessionSetTypeValue | undefined): SessionSetTypeValue => {
  if (previous === undefined) return 'warm_up';
  return getSessionSetRir(previous) !== null ? previous : null;
};
