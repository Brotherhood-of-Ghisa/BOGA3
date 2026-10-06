/** Fixed logging choices. Legacy RIR labels remain readable but are not selectable. */
export const EFFORT_CHOICES = [
  { id: 'warm_up', label: 'Warm-up' },
  { id: 'unspecified', label: 'Unspecified' },
  { id: 'rir_4', label: 'RIR-4' },
  { id: 'rir_3', label: 'RIR-3' },
  { id: 'rir_2', label: 'RIR-2' },
  { id: 'rir_1', label: 'RIR-1' },
  { id: 'rir_0', label: 'RIR-0' },
  { id: 'technique', label: 'Technique' },
  { id: 'cooldown', label: 'Cooldown' },
] as const;

export type EffortChoice = typeof EFFORT_CHOICES[number]['id'];
export type EffortCalculationPolicy = {
  workingSetEfforts: readonly EffortChoice[];
  volumeEfforts: readonly EffortChoice[];
};
export const DEFAULT_DISPLAY_EFFORTS: EffortChoice[] = EFFORT_CHOICES.map(choice => choice.id);
const contributingEfforts: EffortChoice[] = ['unspecified', 'rir_4', 'rir_3', 'rir_2', 'rir_1', 'rir_0'];
export const DEFAULT_PERSONAL_EFFORT_POLICY: EffortCalculationPolicy = {
  workingSetEfforts: contributingEfforts,
  volumeEfforts: contributingEfforts,
};
/**
 * The fixed group and coaching rule (`set.eligibility`): the personal defaults,
 * never a device's policy. Groups store it as each fact's `working` flag.
 */
export const SHARED_EFFORT_POLICY: EffortCalculationPolicy = DEFAULT_PERSONAL_EFFORT_POLICY;

export const isEffortChoice = (value: unknown): value is EffortChoice =>
  EFFORT_CHOICES.some(choice => choice.id === value);

export const isEffortSelection = (value: unknown): value is EffortChoice[] =>
  Array.isArray(value) && value.every(isEffortChoice) && new Set(value).size === value.length;

/** Canonical stored RIR, including values outside today's selectable range. */
export const getSessionSetRir = (value: unknown): number | null => {
  if (typeof value !== 'string' || !/^rir_(0|[1-9]\d*)$/.test(value)) return null;
  const rir = Number(value.slice(4));
  return Number.isSafeInteger(rir) && value === `rir_${rir}` ? rir : null;
};

/** Preserve historical labels; RIR above four follows RIR-4, unknown follows Unspecified. */
export function includesEffort(choices: readonly EffortChoice[], setType: unknown): boolean {
  const id = setType == null ? 'unspecified' : setType;
  const choice = isEffortChoice(id) ? id : getSessionSetRir(id) !== null ? 'rir_4' : 'unspecified';
  return choices.includes(choice);
}

/** Stable cache identity, independent of checkbox write order. */
export const effortPolicyKey = (policy: EffortCalculationPolicy): string =>
  EFFORT_CHOICES.map(({ id }) => `${Number(policy.workingSetEfforts.includes(id))}${Number(policy.volumeEfforts.includes(id))}`).join('');
