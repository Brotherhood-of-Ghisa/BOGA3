import { createEmptySet, createSetFromPrevious, createPlannedSetFromSuggestedSet } from '@/src/session-recorder/session-model';
import { isWorkingSessionSetType, normalizeSessionSetType } from '@/src/data/set-types';

describe('new recorder set effort defaults', () => {
  it('starts each exercise with an unconfirmed warm-up', () => {
    expect(createEmptySet()).toMatchObject({ setType: 'warm_up', performanceStatus: 'unperformed' });
    expect(createSetFromPrevious(undefined).setType).toBe('warm_up');
  });

  it.each(['warm_up', null, 'rir_3', 'rir_2', 'rir_1', 'rir_0'] as const)(
    'copies values and only inherits RIR after %s', (setType) => {
      const previous = { ...createEmptySet(), weight: '80', reps: '8', setType };
      const next = createSetFromPrevious(previous);
      expect(next).toMatchObject({
        weight: '80', reps: '8', performanceStatus: 'unperformed',
        setType: setType === 'warm_up' ? null : setType,
      });
      expect(next.id).not.toBe(previous.id);
      expect(previous.setType).toBe(setType);
    }
  );

  it('keeps prescribed RIR 3 separate from unentered actual effort', () => {
    expect(createPlannedSetFromSuggestedSet({ setId: 'source-set', sessionExerciseId: 'source-exercise', weightValue: '80', repsValue: '8', setType: 'rir_3' }))
      .toMatchObject({ setType: null, plannedSetType: 'rir_3', performanceStatus: 'planned' });
  });

  it('recognizes RIR 3 while preserving blank and rejecting unknown effort', () => {
    expect(normalizeSessionSetType('rir_3')).toBe('rir_3');
    expect(isWorkingSessionSetType('rir_3')).toBe(true);
    expect(normalizeSessionSetType(null)).toBeNull();
    expect(normalizeSessionSetType('rir_4')).toBeNull();
    expect(isWorkingSessionSetType('warm_up')).toBe(false);
    expect(isWorkingSessionSetType(null)).toBe(false);
  });
});
