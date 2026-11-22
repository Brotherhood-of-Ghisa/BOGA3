import { exerciseScopeIds, normalizeExerciseSelection, parseExerciseSelection } from '@/src/utils/exercise-selection';
import { exerciseHistoryHref, historyDetailHref, progressHistoryHref } from '@/src/navigation/routes';
import { NO_GYM_ROUTE_PARAM } from '@/src/utils/gym-scope-route';
import { reportedExercisesMuscles } from '@/src/exercise-catalog/reported-muscles';

describe('visit-local exercise selection', () => {
  it('keeps distinct identities, trims them and bounds the selection', () => {
    expect(normalizeExerciseSelection([' a ', 'b', 'a'])).toEqual(['a', 'b']);
    expect(normalizeExerciseSelection(['a', 'b', 'c', 'd', 'e'])).toHaveLength(5);
    expect(normalizeExerciseSelection(['a', 'b', 'c', 'd', 'e', 'f'])).toBeNull();
    expect(normalizeExerciseSelection(['a', 'a'])).toBeNull();
  });

  it.each([null, {}, 'a,b', [], ['a'], ['a', ''], ['a', 1]])('rejects malformed selection %j', value => {
    expect(normalizeExerciseSelection(value)).toBeNull();
  });

  it('rejects malformed or ambiguous encoded arrays', () => {
    expect(parseExerciseSelection(undefined)).toBeNull();
    expect(parseExerciseSelection('broken')).toBeNull();
    expect(parseExerciseSelection(['["a","b"]', '["c","d"]'])).toBeNull();
    expect(parseExerciseSelection(['["a","b"]'])).toEqual(['a', 'b']);
    expect(exerciseScopeIds({ exerciseDefinitionId: 'a' })).toEqual(['a']);
    expect(() => exerciseScopeIds({ exerciseDefinitionIds: ['a'] })).toThrow('Choose between 2 and 5 exercises.');
  });

  it('carries punctuation-safe selection, metric, gym and detail scope through existing routes', () => {
    const ids = ['a,&?', 'b:[]'];
    const progress = String(progressHistoryHref({ exerciseDefinitionIds: ids, gymId: null }, 'workingSetCount', 'weekly'));
    const params = new URLSearchParams(progress.split('?')[1]);
    expect(parseExerciseSelection(params.get('exerciseDefinitionIds')!)).toEqual(ids);
    expect(params.get('metric')).toBe('sets');
    expect(params.get('view')).toBe('weekly');
    expect(params.get('gymId')).toBe(NO_GYM_ROUTE_PARAM);
    expect(String(exerciseHistoryHref(ids, 'gym'))).toContain('exerciseDefinitionIds=');
    expect(String(historyDetailHref({ exerciseDefinitionIds: ids }, { week: '2026-11-16' }, 'totalVolume'))).toContain('&week=2026-11-16');
  });
});

it('unions reported muscles and promotes Secondary to Primary across exercises', () => {
  const mapping = (muscleGroupId: string, role: 'primary' | 'secondary') => ({ id: `${muscleGroupId}-${role}`, muscleGroupId, role, weight: 1 });
  expect(reportedExercisesMuscles([
    { mappings: [mapping('chest', 'primary'), mapping('triceps', 'secondary')] },
    { mappings: [mapping('triceps', 'primary'), mapping('deltoids', 'secondary')] },
  ], new Map())).toEqual([
    { muscleGroupId: 'chest', role: 'primary' }, { muscleGroupId: 'triceps', role: 'primary' },
    { muscleGroupId: 'deltoids', role: 'secondary' },
  ]);
});
