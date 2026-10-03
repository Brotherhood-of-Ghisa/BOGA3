import {
  canonicalizeSetValues,
  canonicalizeWeightForReps,
  hasValidActualValues,
  hasPositiveIntegerReps,
  countedSessionIds,
  hydrateSessionSetPerformanceStatus,
  isConfirmedPerformedSet,
  isCountedSession,
  isPerformedSet,
  isWorkingSet,
  normalizeSessionSetPerformanceStatus,
} from '@/src/exercise-calculations/set-semantics';

describe('one parser decides validity everywhere', () => {
  // `Number()` accepts these, the calculation parser does not: a set must be
  // valid for every figure or for none.
  it.each(['1e3', '0x10', '-1', '1,5', 'Infinity', '20kg'])('rejects weight %p as not performed', (weight) => {
    expect(hasValidActualValues({ weight, reps: '5' })).toBe(false);
    expect(isConfirmedPerformedSet({ weight, reps: '5', performanceStatus: null })).toBe(false);
  });

  it.each(['42.', '.5', '0', '', ' 12.5 '])('accepts weight %p like the calculation parser', (weight) => {
    expect(hasValidActualValues({ weight, reps: '5' })).toBe(true);
  });
});

describe('the counted-set and counted-session rules', () => {
  const set = (setType: string | null, extra: Partial<{ weight: string; reps: string; performanceStatus: 'unperformed' | null }> = {}) => ({
    weight: '100', reps: '5', performanceStatus: null, setType, ...extra,
  });

  it('counts every confirmed set but a warm-up', () => {
    expect(isWorkingSet(set(null))).toBe(true);
    expect(isWorkingSet(set('rir_0'))).toBe(true);
    expect(isWorkingSet(set('unknown_future'))).toBe(true);
    expect(isWorkingSet(set('warm_up'))).toBe(false);
    expect(isWorkingSet(set(null, { performanceStatus: 'unperformed' }))).toBe(false);
    expect(isWorkingSet(set(null, { reps: '' }))).toBe(false);
  });

  it('counts a session with at least one working set', () => {
    const identity = <T,>(value: T) => value;
    expect(isCountedSession([set('warm_up'), set('rir_2')], identity)).toBe(true);
    expect(isCountedSession([set('warm_up'), set('warm_up')], identity)).toBe(false);
    expect(isCountedSession([set(null, { performanceStatus: 'unperformed' })], identity)).toBe(false);
    expect(isCountedSession([], identity)).toBe(false);
  });

  it('collects the counted sessions by id', () => {
    const ids = countedSessionIds([
      { sessionId: 'working', ...set('warm_up') },
      { sessionId: 'working', ...set(null) },
      { sessionId: 'warm-up-only', ...set('warm_up') },
      { sessionId: 'unconfirmed', ...set(null, { performanceStatus: 'unperformed' }) },
      { sessionId: null, ...set(null) },
    ], (row) => row);
    expect([...ids]).toEqual(['working']);
  });
});

describe('session set semantics', () => {
  it.each(['1', '5', '0012'])('accepts positive integer reps: %s', (reps) => {
    expect(hasPositiveIntegerReps(reps)).toBe(true);
  });

  it.each(['', ' ', '0', '-1', '1.5', 'five'])('rejects incomplete or invalid reps: %s', (reps) => {
    expect(hasPositiveIntegerReps(reps)).toBe(false);
  });

  it('canonicalizes blank weight to zero only when reps are positive', () => {
    expect(canonicalizeWeightForReps('', '5')).toBe('0');
    expect(canonicalizeWeightForReps('   ', '5')).toBe('0');
    expect(canonicalizeWeightForReps('', '')).toBe('');
    expect(canonicalizeWeightForReps('', '0')).toBe('');
    expect(canonicalizeWeightForReps('12.5', '5')).toBe('12.5');
  });

  it('returns the same set when no canonicalization is needed', () => {
    const unchanged = { id: 'set-1', reps: '', weight: '' };
    expect(canonicalizeSetValues(unchanged)).toBe(unchanged);
  });

  it('treats blank and explicit zero weight with positive reps as performed', () => {
    expect(isPerformedSet({ reps: '5', weight: '' })).toBe(true);
    expect(isPerformedSet({ reps: '5', weight: '0' })).toBe(true);
    expect(isPerformedSet({ reps: '5', weight: '12.5' })).toBe(true);
  });

  it('keeps missing or invalid reps incomplete', () => {
    expect(isPerformedSet({ reps: '', weight: '20' })).toBe(false);
    expect(isPerformedSet({ reps: '0', weight: '20' })).toBe(false);
    expect(isPerformedSet({ reps: '2.5', weight: '20' })).toBe(false);
  });

  it('keeps valid actual values separate from explicit performance confirmation', () => {
    expect(hasValidActualValues({ reps: '5', weight: '20' })).toBe(true);
    expect(
      isConfirmedPerformedSet({ reps: '5', weight: '20', performanceStatus: 'unperformed' })
    ).toBe(false);
    expect(
      isConfirmedPerformedSet({ reps: '5', weight: '20', performanceStatus: null })
    ).toBe(true);
  });

  it('hydrates legacy null rows by validity while preserving explicit statuses', () => {
    expect(hydrateSessionSetPerformanceStatus(null, { reps: '5', weight: '20' })).toBeNull();
    expect(hydrateSessionSetPerformanceStatus(null, { reps: '', weight: '' })).toBe('unperformed');
    expect(hydrateSessionSetPerformanceStatus('planned', { reps: '5', weight: '20' })).toBe('planned');
    expect(hydrateSessionSetPerformanceStatus('skipped', { reps: '5', weight: '20' })).toBe('planned');
    expect(hydrateSessionSetPerformanceStatus('unperformed', { reps: '5', weight: '20' })).toBe(
      'unperformed'
    );
  });

  it('normalizes unsupported persisted statuses to the legacy performed representation', () => {
    expect(normalizeSessionSetPerformanceStatus('unperformed')).toBe('unperformed');
    expect(normalizeSessionSetPerformanceStatus('unexpected')).toBeNull();
  });
});
