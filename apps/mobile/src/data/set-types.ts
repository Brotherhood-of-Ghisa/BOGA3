// The group-eval Edge Function loads this file (via src/groups/set-facts.ts), so
// its imports name their .ts files.
import { DEFAULT_DISPLAY_EFFORTS, getSessionSetRir, type EffortChoice } from '../exercise-calculations/effort-policy.ts';
export { getSessionSetRir } from '../exercise-calculations/effort-policy.ts';

export type RirSessionSetType = `rir_${number}`;
export type SessionSetType = 'warm_up' | 'technique' | 'cooldown' | RirSessionSetType;
export type SessionSetTypeValue = SessionSetType | null;

/** Current selectable efforts; persisted values are validated independently. */
export const RIR_SESSION_SET_TYPES: readonly RirSessionSetType[] = ['rir_0', 'rir_1', 'rir_2', 'rir_3', 'rir_4'];
export const SESSION_SET_TYPES: readonly SessionSetType[] = ['warm_up', ...RIR_SESSION_SET_TYPES, 'technique', 'cooldown'];

export const isSessionSetType = (value: unknown): value is SessionSetType =>
  value === 'warm_up' || value === 'technique' || value === 'cooldown' || getSessionSetRir(value) !== null;

export const normalizeSessionSetType = (value: unknown): SessionSetTypeValue =>
  isSessionSetType(value) ? value : null;

/** Shared by current controls, history, completed sessions and group views. */
export const formatSessionSetType = (value: unknown, style: 'full' | 'compact' = 'full'): string | null => {
  if (value === 'warm_up') return 'W-Up';
  if (value === 'technique') return style === 'compact' ? 'Tech' : 'Technique';
  if (value === 'cooldown') return style === 'compact' ? 'CD' : 'Cooldown';
  const rir = getSessionSetRir(value);
  return rir === null ? null : `${style === 'compact' ? 'R' : 'RIR '}${rir}`;
};

/** Effort moves from warm-up through unspecified, then easiest to hardest. */
export const getSessionSetTypeCycle = (display: readonly EffortChoice[] = DEFAULT_DISPLAY_EFFORTS): readonly SessionSetTypeValue[] =>
  DEFAULT_DISPLAY_EFFORTS.filter(id => display.includes(id)).map(id => id === 'unspecified' ? null : id);
export const SESSION_SET_TYPE_CYCLE = getSessionSetTypeCycle();

export const nextSessionSetType = (value: SessionSetTypeValue, display?: readonly EffortChoice[]): SessionSetTypeValue => {
  const cycle = getSessionSetTypeCycle(display);
  const index = cycle.indexOf(normalizeSessionSetType(value));
  // A hidden historical effort re-enters at the first displayed choice.
  return cycle[(index + 1) % cycle.length] ?? null;
};

/** New rows inherit visible effort, advance hidden RIR, or use a visible fallback. */
export const defaultSessionSetType = (previous: SessionSetTypeValue | undefined, display: readonly EffortChoice[] = DEFAULT_DISPLAY_EFFORTS): SessionSetTypeValue => {
  const cycle = getSessionSetTypeCycle(display);
  if (previous === undefined) return cycle[0] ?? null;
  if (cycle.includes(previous) && previous !== 'warm_up') return previous;
  const rir = getSessionSetRir(previous);
  if (rir !== null) {
    const next = cycle.find(value => { const grade = getSessionSetRir(value); return grade !== null && grade < rir; });
    if (next !== undefined) return next;
  }
  return cycle.includes(null) ? null : cycle[0] ?? null;
};
