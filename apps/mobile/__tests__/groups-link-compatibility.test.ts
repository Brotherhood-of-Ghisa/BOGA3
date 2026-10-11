import { checkGroupLinkCompatibility, groupEnteredWeightFactor } from '@/src/groups/link-compatibility';
import loadFactorVectors from '@/src/groups/load-factor-vectors.json';
import type { LoadInputMode } from '@/src/exercise-core';

const pull = { loadInputMode: 'total_load' as const };

describe('group link compatibility', () => {
  it('matches the shared D6 load-factor vectors', () => {
    expect(loadFactorVectors.cases).toHaveLength(4);
    for (const { source, target, factor } of loadFactorVectors.cases) {
      expect(groupEnteredWeightFactor(source as LoadInputMode, target as LoadInputMode)).toBe(factor);
    }
  });

  it('converts Weight distribution from the source mode to the target mode', () => {
    const source = { loadInputMode: 'total_load' };
    expect(checkGroupLinkCompatibility(source, pull)).toEqual({ compatible: true, enteredWeightFactor: 1 });
    expect(checkGroupLinkCompatibility({ loadInputMode: 'per_side_load' }, pull))
      .toEqual({ compatible: true, enteredWeightFactor: 2 });
    expect(checkGroupLinkCompatibility(source, { loadInputMode: 'per_side_load' }))
      .toEqual({ compatible: true, enteredWeightFactor: 0.5 });
  });

  it('rejects an unknown source or target load mode', () => {
    expect(checkGroupLinkCompatibility({ loadInputMode: 'unknown' }, pull))
      .toEqual({ compatible: false, reason: 'load_input_mode_invalid' });
    expect(checkGroupLinkCompatibility({ loadInputMode: 'total_load' }, { loadInputMode: 'unknown' as LoadInputMode }))
      .toEqual({ compatible: false, reason: 'load_input_mode_invalid' });
  });
});
