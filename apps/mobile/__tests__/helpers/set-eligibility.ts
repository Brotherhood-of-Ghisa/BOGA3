/**
 * The groups-and-coaching column of `set.eligibility` (`docs/product/set.md`):
 * one row per effort label, as stored. The rule is fixed: a set counts as a
 * working set and as volume-included together.
 */
export const GROUP_COACHING_ELIGIBILITY: readonly (readonly [label: string, setType: string | null, counts: boolean])[] = [
  ['Warm-up', 'warm_up', false],
  ['Unspecified', null, true],
  ['RIR 4', 'rir_4', true],
  ['RIR 3', 'rir_3', true],
  ['RIR 2', 'rir_2', true],
  ['RIR 1', 'rir_1', true],
  ['RIR 0', 'rir_0', true],
  ['Stored RIR above 4', 'rir_12', true],
  ['Technique', 'technique', false],
  ['Cooldown', 'cooldown', false],
  ['Unknown stored label', 'working', true],
  ['Unknown stored label (case)', 'RIR_1', true],
];
