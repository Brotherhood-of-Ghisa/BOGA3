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
    expect(normalizeSessionSetType('rir_4')).toBe('rir_4');
    expect(normalizeSessionSetType('rir_-1')).toBeNull();
    expect(isWorkingSessionSetType('warm_up')).toBe(false);
    expect(isWorkingSessionSetType(null)).toBe(false);
  });
});

describe('file-configured working-set effort threshold', () => {
  afterEach(() => {
    jest.dontMock('@/src/config/training');
  });

  it.each([
    [0, ['rir_0']],
    [1, ['rir_0', 'rir_1']],
    [2, ['rir_0', 'rir_1', 'rir_2']],
    [3, ['rir_0', 'rir_1', 'rir_2', 'rir_3']],
  ] as const)('counts RIR %i or harder without changing logging', (maxRir, workingEfforts) => {
    jest.doMock('@/src/config/training', () => ({ ...jest.requireActual('@/src/config/training'), WORKING_SET_POLICY: { maxRir } }));
    jest.isolateModules(() => {
      const types = jest.requireActual<typeof import('@/src/data/set-types')>('@/src/data/set-types');
      expect(types.WORKING_SESSION_SET_TYPES).toEqual(workingEfforts);
      expect(types.SESSION_SET_TYPES.filter(types.isWorkingSessionSetType)).toEqual(workingEfforts);
      expect([null, undefined, 'rir_4', 'warm_up'].some(types.isWorkingSessionSetType)).toBe(false);

      expect(types.SESSION_SET_TYPE_CYCLE).toEqual(['warm_up', null, 'rir_3', 'rir_2', 'rir_1', 'rir_0']);
      expect(types.nextSessionSetType(null)).toBe('rir_3');
      expect(types.nextSessionSetType('rir_0')).toBe('warm_up');
      expect(types.RIR_SESSION_SET_TYPES.map(types.defaultSessionSetType)).toEqual(types.RIR_SESSION_SET_TYPES);
      expect(types.defaultSessionSetType('warm_up')).toBeNull();
    });
  });

  it('applies a stricter threshold to analytics without excluding performed sets', () => {
    jest.doMock('@/src/config/training', () => ({ ...jest.requireActual('@/src/config/training'), WORKING_SET_POLICY: { maxRir: 1 } }));
    jest.isolateModules(() => {
      const analytics = jest.requireActual<typeof import('@/src/data/muscle-analytics')>('@/src/data/muscle-analytics');
      const input = {
        sessions: [{ id: 'session', completedAt: new Date('2026-09-23T12:00:00Z') }],
        sessionExercises: [{ id: 'exercise', sessionId: 'session', exerciseDefinitionId: null }],
        exerciseSets: ['rir_0', 'rir_1', 'rir_2', 'rir_3', 'warm_up', null].map((setType) => ({
          sessionExerciseId: 'exercise', setType, weightValue: '80', repsValue: '8',
        })),
        muscleMappings: [],
        muscleGroups: [],
      };
      expect(analytics.countMuscleAnalyticsWorkingSets(input)).toBe(2);
      expect(analytics.countMuscleAnalyticsPerformedSets(input)).toBe(6);
    });
  });
});

describe('file-configured selectable RIR range', () => {
  afterEach(() => {
    jest.dontMock('@/src/config/training');
  });

  it.each([
    [0, ['warm_up', null, 'rir_0']],
    [2, ['warm_up', null, 'rir_2', 'rir_1', 'rir_0']],
    [4, ['warm_up', null, 'rir_4', 'rir_3', 'rir_2', 'rir_1', 'rir_0']],
  ] as const)('uses maximum RIR %i for cycling, the picker and import enrichment', (maxSelectableRir, cycle) => {
    jest.doMock('@/src/config/training', () => ({
      ...jest.requireActual('@/src/config/training'),
      EFFORT_LOGGING_POLICY: { maxSelectableRir },
    }));
    jest.isolateModules(() => {
      const types = jest.requireActual<typeof import('@/src/data/set-types')>('@/src/data/set-types');
      const page = jest.requireActual<typeof import('@/src/session-recorder/exercise-page-model')>('@/src/session-recorder/exercise-page-model');
      const importer = jest.requireActual<typeof import('../../scripts/import/set-type-enricher')>('../../scripts/import/set-type-enricher');
      expect(types.SESSION_SET_TYPE_CYCLE).toEqual(cycle);
      expect(page.EFFORT_OPTIONS).toEqual(cycle);
      const visited = [types.SESSION_SET_TYPE_CYCLE[0]];
      for (let i = 1; i < cycle.length; i += 1) visited.push(types.nextSessionSetType(visited[i - 1]));
      expect(visited).toEqual(cycle);
      expect(types.nextSessionSetType(visited[visited.length - 1])).toBe('warm_up');
      expect(importer.setTypeForRank(2, 3)).toBe(`rir_${maxSelectableRir}`);
      expect(page.formatEffort(`rir_${maxSelectableRir}`)).toBe(`RIR ${maxSelectableRir}`);
    });
  });

  it('preserves stored effort and independent working-set policy after reducing the picker range', () => {
    jest.doMock('@/src/config/training', () => ({
      EFFORT_LOGGING_POLICY: { maxSelectableRir: 2 },
      WORKING_SET_POLICY: { maxRir: 4 },
    }));
    jest.isolateModules(() => {
      const types = jest.requireActual<typeof import('@/src/data/set-types')>('@/src/data/set-types');
      expect(types.SESSION_SET_TYPES).not.toContain('rir_4');
      expect(types.normalizeSessionSetType('rir_4')).toBe('rir_4');
      expect(types.formatSessionSetType('rir_4')).toBe('RIR 4');
      expect(types.formatSessionSetType('rir_4', 'compact')).toBe('R4');
      expect(types.defaultSessionSetType('rir_4')).toBe('rir_4');
      expect(types.isWorkingSessionSetType('rir_4')).toBe(true);
      expect(types.isWorkingSessionSetType('rir_5')).toBe(false);
      expect(types.nextSessionSetType('rir_4')).toBe('warm_up');
    });
  });

  it.each(['rir_-1', 'rir_1.5', 'rir_01', 'rir_NaN', 'rir_9007199254740992', 'rir_3\n', 'rir_ 3', 'drop_set'])(
    'rejects malformed or unsafe stored effort %s', (value) => {
      expect(normalizeSessionSetType(value)).toBeNull();
      expect(isWorkingSessionSetType(value)).toBe(false);
    }
  );
});
