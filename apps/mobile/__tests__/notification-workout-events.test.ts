import { entityToWire } from '@/src/sync/cycle';
import { buildCompletionManifest, countWorkoutRankChanges, workoutContributions,
  type NotificationRank, type WorkoutTarget } from '@/src/notifications/workout-events';

const ranks = (members: string[], certified = false): NotificationRank[] =>
  members.map((member_user_id, index) => ({ metric: 'e1rm', certified, member_user_id, rank: index + 1 }));
const target = (group_id = 'group-a'): WorkoutTarget => ({ group_id, group_exercise_id: 'bench',
  best_metrics: ['e1rm', 'volume'], before: ranks(['a', 'b', 'c', 'lifter']),
  final: ranks(['a', 'lifter', 'b', 'c']), without_workout: ranks(['a', 'b', 'c', 'lifter']) });

describe('workout notification final outcomes', () => {
  test('counts every affected position, including downward non-first movement', () => {
    const result = target();
    expect(countWorkoutRankChanges(result.before, result.final, result.without_workout, 'lifter')).toBe(3);
  });
  test('counts one final move per board and retains independent scopes', () => {
    const before = ranks(['a', 'b', 'c', 'lifter']);
    const final = ranks(['a', 'b', 'lifter', 'c']);
    expect(countWorkoutRankChanges(before, final, before, 'lifter')).toBe(2);
    expect(countWorkoutRankChanges([...before, ...ranks(['a', 'b', 'c', 'lifter'], true)],
      [...final, ...ranks(['a', 'b', 'lifter', 'c'], true)],
      [...before, ...ranks(['a', 'b', 'c', 'lifter'], true)], 'lifter')).toBe(4);
  });
  test('a returned lifter counts zero while another attributable member counts once', () => {
    const before = ranks(['a', 'b', 'c', 'lifter']);
    const final = ranks(['newcomer', 'a', 'b', 'lifter', 'c']);
    const without = ranks(['newcomer', 'a', 'b', 'c', 'lifter']);
    expect(countWorkoutRankChanges(before, final, without, 'lifter')).toBe(1);
    // The lifter is #4 in both actual snapshots; only C's net downward movement is attributable.
  });
  test('restoring a published source contribution excludes unchanged cutover and peer-only movement', () => {
    const before = ranks(['lifter', 'a', 'b']);
    const final = ranks(['newcomer', 'lifter', 'a', 'b']);
    // The private producer restores the lifter's original contribution instead of removing it.
    expect(countWorkoutRankChanges(before, final, final, 'lifter')).toBe(0);
    // L95→99 and peer100→90 leaves the restored L95 in the same final position.
    expect(countWorkoutRankChanges(ranks(['a', 'b', 'lifter']), ranks(['a', 'lifter', 'b']),
      ranks(['a', 'lifter', 'b']), 'lifter')).toBe(0);
    // L95→105 crosses an unchanged peer100; the restored original contribution remains below it.
    expect(countWorkoutRankChanges(ranks(['a', 'b', 'lifter']), ranks(['a', 'lifter', 'b']),
      ranks(['a', 'b', 'lifter']), 'lifter')).toBe(2);
  });
  test('does not attribute an opposite-direction move or another member initial placement', () => {
    const before = ranks(['a', 'b', 'c', 'lifter']);
    const final = ranks(['new-a', 'new-b', 'a', 'b', 'lifter', 'c']);
    const without = ranks(['new-a', 'new-b', 'a', 'b', 'c', 'lifter']);
    expect(countWorkoutRankChanges(before, final, without, 'lifter')).toBe(1);
  });
  test('only the lifter can earn its own initial placement', () => {
    expect(countWorkoutRankChanges(ranks(['a', 'b']), ranks(['a', 'lifter', 'b']), ranks(['a', 'b']), 'lifter')).toBe(2);
    expect(countWorkoutRankChanges(ranks(['a', 'b']), ranks(['a', 'newcomer', 'lifter', 'b']),
      ranks(['a', 'newcomer', 'b']), 'lifter')).toBe(2);
  });
  test('does not attribute unrelated lost placement from certification or deletion', () => {
    expect(countWorkoutRankChanges(ranks(['a', 'b', 'lifter']), ranks(['lifter', 'a']), ranks(['a']), 'lifter')).toBe(2);
    // B is absent with and without the workout, so its lost placement is not attributable.
  });
  test('two metrics and two group comparisons count separately, duplicate metric evidence once', () => {
    const first = target();
    first.best_metrics.push('e1rm');
    expect(workoutContributions([first, target('group-b')], 'lifter')).toEqual([
      { group_id: 'group-a', best_count: 2, rank_count: 3 }, { group_id: 'group-b', best_count: 2, rank_count: 3 },
    ]);
    expect(() => workoutContributions([first, first], 'lifter')).toThrow('Duplicate');
    expect(() => workoutContributions([{ ...first, best_metrics: ['weight'] }], 'lifter')).toThrow('Invalid');
  });
  test('an unprovable rank counterfactual preserves independently verified bests', () => {
    const result = target();
    result.without_workout = result.final;
    expect(workoutContributions([result], 'lifter')).toEqual([
      { group_id: 'group-a', best_count: 2, rank_count: 0 },
    ]);
  });
});

describe('canonical completion graph', () => {
  const session = (clock: number) => entityToWire({ id: 'session', status: 'completed', startedAt: new Date(1000),
    completedAt: new Date(2000), deletedAt: null, localUpdatedAtMs: clock }, 'sessions');
  test('reuses real sync domain serialization while excluding clamped bookkeeping', () => {
    expect(buildCompletionManifest([session(900000)])).toEqual(buildCompletionManifest([session(300000)]));
    expect(buildCompletionManifest([session(900000)])[0]).not.toHaveProperty('client_updated_at_ms');
  });
  test('preserves exact values and tombstones, and copies the declared graph', () => {
    const set = { type: 'exercise_sets', id: 'set', fields: { session_exercise_id: 'block', deleted_at: 2000 } };
    const result = buildCompletionManifest([session(1), set]);
    set.fields.deleted_at = 3000;
    expect(result[0].fields.deleted_at).toBe(2000);
  });
  test.each([
    [], [session(1), session(2)], [{ ...session(1), type: 'gyms' }],
    [{ ...session(1), id: '' }], [{ ...session(1), fields: { ...session(1).fields, status: 'active' } }],
    [{ ...session(1), fields: { ...session(1).fields, owner_user_id: 'another-account' } }],
    [{ ...session(1), fields: { ...session(1).fields, completed_at: Infinity } }],
  ].map(entities => ({ entities })))('rejects an invalid completion declaration %#', ({ entities }) => {
    expect(() => buildCompletionManifest(entities)).toThrow();
  });
});
