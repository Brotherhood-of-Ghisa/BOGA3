// The group-eval Edge Function loads this file (via src/groups/set-facts.ts), so
// its imports name their .ts files.
import { EFFORT_LOGGING_POLICY } from '../config/training.ts';

export type RirSessionSetType = `rir_${number}`;
export type SessionSetType = 'warm_up' | RirSessionSetType;
export type SessionSetTypeValue = SessionSetType | null;

const rirTypesThrough = (maxRir: number): RirSessionSetType[] =>
  Array.from({ length: maxRir + 1 }, (_, rir): RirSessionSetType => `rir_${rir}`);

/** Current selectable efforts; persisted values are validated independently. */
export const RIR_SESSION_SET_TYPES = rirTypesThrough(EFFORT_LOGGING_POLICY.maxSelectableRir);
export const SESSION_SET_TYPES: readonly SessionSetType[] = ['warm_up', ...RIR_SESSION_SET_TYPES];

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

export const getSessionSetTypeCycle = (grades: readonly number[] = RIR_SESSION_SET_TYPES.map(value => Number(value.slice(4)))): readonly SessionSetTypeValue[] =>
  ['warm_up', null, ...[...grades].sort((left, right) => right - left).map((rir): RirSessionSetType => `rir_${rir}`)];

export const nextSessionSetType = (value: SessionSetTypeValue, grades?: readonly number[]): SessionSetTypeValue => {
  const cycle = getSessionSetTypeCycle(grades);
  const index = cycle.indexOf(normalizeSessionSetType(value));
  // A historical effort outside the configured range re-enters at Warm-up.
  return cycle[(index + 1) % cycle.length];
};

/** Hidden RIR advances toward harder visible effort; no successor keeps the inherited value. */
export const defaultSessionSetType = (previous: SessionSetTypeValue | undefined, grades?: readonly number[]): SessionSetTypeValue => {
  if (previous === undefined) return 'warm_up';
  const rir = getSessionSetRir(previous);
  if (rir === null) return null;
  if (!grades || grades.includes(rir)) return previous;
  const next = [...grades].sort((left, right) => right - left).find(grade => grade < rir);
  return next === undefined ? previous : `rir_${next}`;
};
