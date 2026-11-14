import {
  DEFAULT_DISPLAY_EFFORTS,
  DEFAULT_PERSONAL_EFFORT_POLICY,
  EFFORT_CHOICES,
  effortPolicyKey,
  isEffortChoice,
  SHARED_EFFORT_POLICY,
  type EffortCalculationPolicy,
} from '@/src/exercise-calculations/effort-policy';
import {
  defaultSessionSetType,
  formatSessionSetType,
  isRehabSessionSetType,
  isSessionSetType,
  nextSessionSetType,
  SESSION_SET_TYPE_CYCLE,
  SESSION_SET_TYPES,
} from '@/src/data/set-types';

describe('rehab effort policy and choice contracts', () => {
  it('includes rehab as the tenth selectable effort choice in EFFORT_CHOICES', () => {
    expect(EFFORT_CHOICES).toHaveLength(10);
    expect(EFFORT_CHOICES[9]).toEqual({ id: 'rehab', label: 'Rehab' });
    expect(isEffortChoice('rehab')).toBe(true);
  });

  it('includes rehab in default display efforts', () => {
    expect(DEFAULT_DISPLAY_EFFORTS).toContain('rehab');
    expect(DEFAULT_DISPLAY_EFFORTS[DEFAULT_DISPLAY_EFFORTS.length - 1]).toBe('rehab');
  });

  it('excludes rehab from default personal and shared working and volume calculations', () => {
    expect(DEFAULT_PERSONAL_EFFORT_POLICY.workingSetEfforts).not.toContain('rehab');
    expect(DEFAULT_PERSONAL_EFFORT_POLICY.volumeEfforts).not.toContain('rehab');
    expect(SHARED_EFFORT_POLICY.workingSetEfforts).not.toContain('rehab');
    expect(SHARED_EFFORT_POLICY.volumeEfforts).not.toContain('rehab');
  });

  it('generates a 20-character binary string for effortPolicyKey', () => {
    // 10 choices * 2 bits per choice = 20 characters
    // warm_up (00), unspecified (11), rir_4..0 (11 each, 5 choices = 10 bits),
    // technique (00), cooldown (00), rehab (00)
    // '00' + '11'*6 + '00' + '00' + '00' = '00111111111111000000'
    const key = effortPolicyKey(DEFAULT_PERSONAL_EFFORT_POLICY);
    expect(key).toHaveLength(20);
    expect(key).toBe('00111111111111000000');
  });

  it('updates effortPolicyKey when user custom policy includes rehab', () => {
    const customPolicy: EffortCalculationPolicy = {
      workingSetEfforts: [...DEFAULT_PERSONAL_EFFORT_POLICY.workingSetEfforts, 'rehab'],
      volumeEfforts: [...DEFAULT_PERSONAL_EFFORT_POLICY.volumeEfforts, 'rehab'],
    };
    const customKey = effortPolicyKey(customPolicy);
    expect(customKey).toHaveLength(20);
    expect(customKey).toBe('00111111111111000011');
    expect(customKey).not.toBe(effortPolicyKey(DEFAULT_PERSONAL_EFFORT_POLICY));
  });

  it('recognizes rehab in SessionSetType and SESSION_SET_TYPES', () => {
    expect(isSessionSetType('rehab')).toBe(true);
    expect(isRehabSessionSetType('rehab')).toBe(true);
    expect(isRehabSessionSetType('cooldown')).toBe(false);
    expect(isRehabSessionSetType('warm_up')).toBe(false);
    expect(isRehabSessionSetType('rir_0')).toBe(false);
    expect(SESSION_SET_TYPES).toContain('rehab');
  });

  it('formats rehab as Rehab in both full and compact styles', () => {
    expect(formatSessionSetType('rehab')).toBe('Rehab');
    expect(formatSessionSetType('rehab', 'full')).toBe('Rehab');
    expect(formatSessionSetType('rehab', 'compact')).toBe('Rehab');
  });

  it('places rehab in the cycle after cooldown and wraps back to warm_up', () => {
    expect(SESSION_SET_TYPE_CYCLE).toContain('rehab');
    expect(SESSION_SET_TYPE_CYCLE[SESSION_SET_TYPE_CYCLE.length - 1]).toBe('rehab');
    expect(nextSessionSetType('cooldown')).toBe('rehab');
    expect(nextSessionSetType('rehab')).toBe('warm_up');
  });

  it('inherits rehab effort when adding a subsequent set after a rehab set', () => {
    expect(defaultSessionSetType('rehab')).toBe('rehab');
  });
});
