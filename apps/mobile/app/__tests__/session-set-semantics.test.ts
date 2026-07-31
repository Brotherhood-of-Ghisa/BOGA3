import {
  canonicalizeSetValues,
  canonicalizeWeightForReps,
  hasValidActualValues,
  hasPositiveIntegerReps,
  hydrateSessionSetPerformanceStatus,
  isConfirmedPerformedSet,
  isPerformedSet,
  normalizeSessionSetPerformanceStatus,
} from '@/src/session-recorder/set-semantics';

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
    expect(hydrateSessionSetPerformanceStatus('skipped', { reps: '5', weight: '20' })).toBe('skipped');
    expect(hydrateSessionSetPerformanceStatus('unperformed', { reps: '5', weight: '20' })).toBe(
      'unperformed'
    );
  });

  it('normalizes unsupported persisted statuses to the legacy performed representation', () => {
    expect(normalizeSessionSetPerformanceStatus('unperformed')).toBe('unperformed');
    expect(normalizeSessionSetPerformanceStatus('unexpected')).toBeNull();
  });
});
