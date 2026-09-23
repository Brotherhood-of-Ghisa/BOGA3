export const SESSION_SET_TYPES = ['warm_up', 'rir_0', 'rir_1', 'rir_2', 'rir_3'] as const;
export const WORKING_SESSION_SET_TYPES = ['rir_0', 'rir_1', 'rir_2', 'rir_3'] as const;

export type SessionSetType = (typeof SESSION_SET_TYPES)[number];
export type SessionSetTypeValue = SessionSetType | null;

const sessionSetTypeSet = new Set<string>(SESSION_SET_TYPES);
const workingSessionSetTypeSet = new Set<string>(WORKING_SESSION_SET_TYPES);

export const normalizeSessionSetType = (value: unknown): SessionSetTypeValue => {
  if (typeof value !== 'string') {
    return null;
  }

  return sessionSetTypeSet.has(value) ? (value as SessionSetType) : null;
};

export const isWorkingSessionSetType = (value: unknown): boolean =>
  typeof value === 'string' && workingSessionSetTypeSet.has(value);

/** Effort moves from warm-up through unspecified, then easiest to hardest. */
export const SESSION_SET_TYPE_CYCLE: readonly SessionSetTypeValue[] = [
  'warm_up', null, ...[...WORKING_SESSION_SET_TYPES].reverse(),
];

export const nextSessionSetType = (value: SessionSetTypeValue): SessionSetTypeValue => {
  const index = SESSION_SET_TYPE_CYCLE.indexOf(normalizeSessionSetType(value));
  return SESSION_SET_TYPE_CYCLE[(index + 1) % SESSION_SET_TYPE_CYCLE.length];
};

/** Undefined means no previous set; null means an explicitly unspecified effort. */
export const defaultSessionSetType = (previous: SessionSetTypeValue | undefined): SessionSetTypeValue =>
  previous === undefined ? 'warm_up' : isWorkingSessionSetType(previous) ? previous : null;
