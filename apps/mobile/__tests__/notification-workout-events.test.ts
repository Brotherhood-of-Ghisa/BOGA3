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
  test('an incomparable Volume board preserves valid independent 1RM movements', () => {
    const volumeBefore = ranks(['lifter', 'peer']).map(row => ({ ...row, metric: 'volume' as const }));
    const volumeFinal = ranks(['peer', 'lifter']).map(row => ({ ...row, metric: 'volume' as const }));
    const first = target();
    first.before = [...volumeBefore, ...ranks(['peer', 'lifter'])];
    first.final = [...volumeFinal, ...ranks(['lifter', 'peer'])];
    first.without_workout = [...volumeFinal, ...ranks(['peer', 'lifter'])];
    expect(workoutContributions([first], 'lifter')).toEqual([
      { group_id: 'group-a', best_count: 2, rank_count: 2 },
    ]);
  });
  test('metadata promotion and first Certified admission retain the original qualified contribution', () => {
    // Mode-only promotion of a formerly lower source is held in the producer's counterfactual.
    expect(countWorkoutRankChanges(ranks(['peer', 'lifter']), ranks(['lifter', 'peer']),
      ranks(['lifter', 'peer']), 'lifter')).toBe(0);
    // An unchanged originally counted set gains a witness, so qualification appears in both current boards.
    expect(countWorkoutRankChanges([], ranks(['lifter'], true), ranks(['lifter'], true), 'lifter')).toBe(0);
  });
  test('frozen control admission separates fresh performance from an existing placement', () => {
    const before = ranks(['peer']);
    // Retroactive admission puts L below the peer; edits and fresh sets remaining below change no position.
    expect(countWorkoutRankChanges(before, ranks(['peer', 'lifter']), ranks(['peer', 'lifter']), 'lifter')).toBe(0);
    // A genuinely fresh improvement crosses the peer; its original control-admitted contribution stays below.
    expect(countWorkoutRankChanges(before, ranks(['lifter', 'peer']), ranks(['peer', 'lifter']), 'lifter')).toBe(1);
    // Admission originally put L above the peer: old120→80 plus fresh130 leaves the original position intact.
    expect(countWorkoutRankChanges(before, ranks(['lifter', 'peer']), ranks(['lifter', 'peer']), 'lifter')).toBe(0);
  });
  test('current withdrawal permits a genuinely improved Certified source without retaining the withdrawn score', () => {
    expect(countWorkoutRankChanges(ranks(['peer', 'lifter'], true), ranks(['lifter', 'peer'], true),
      ranks(['peer'], true), 'lifter')).toBe(2);
  });
  test('an admitted planned set has no numeric contribution before its first performed placement', () => {
    const bothMetrics = (rows: NotificationRank[]): NotificationRank[] => [...rows,
      ...rows.map(row => ({ ...row, metric: 'volume' as const }))];
    const result = { ...target(), best_metrics: [], before: bothMetrics(ranks(['peer'])),
      final: bothMetrics(ranks(['lifter', 'peer'])), without_workout: bothMetrics(ranks(['peer'])) };
    expect(workoutContributions([result], 'lifter')).toEqual([{ group_id: 'group-a', best_count: 0, rank_count: 4 }]);
  });
  test('withdrawn lower originals cannot veto a fresh qualified crossing, while physical voiding retains lost placement', () => {
    const bothMetrics = (rows: NotificationRank[]): NotificationRank[] => [...rows,
      ...rows.map(row => ({ ...row, metric: 'volume' as const }))];
    const before = bothMetrics(ranks(['peer', 'lifter'], true));
    const final = bothMetrics(ranks(['lifter', 'peer'], true));
    // Both original witnesses are withdrawn; an edited lower source imposes no missing old Certified scalar.
    expect(countWorkoutRankChanges(before, final, bothMetrics(ranks(['peer'], true)), 'lifter')).toBe(4);
    // A physical source edit voids its original placement; the old eligible contribution stays in the counter.
    expect(countWorkoutRankChanges(before, bothMetrics(ranks(['peer'], true)), before, 'lifter')).toBe(2);
    expect(countWorkoutRankChanges(before, bothMetrics(ranks(['peer'], true)),
      bothMetrics(ranks(['peer'], true)), 'lifter')).toBe(0);
  });
  test('current qualification shares frozen scalars between scopes without changing historical placement', () => {
    const bothMetrics = (rows: NotificationRank[]): NotificationRank[] => [...rows,
      ...rows.map(row => ({ ...row, metric: 'volume' as const }))];
    const before = [...bothMetrics(ranks(['peer', 'lifter'])), ...bothMetrics(ranks(['peer'], true))];
    const final = [...bothMetrics(ranks(['lifter', 'peer'])), ...bothMetrics(ranks(['lifter', 'peer'], true))];
    const counter = [...bothMetrics(ranks(['peer', 'lifter'])), ...bothMetrics(ranks(['peer', 'lifter'], true))];
    // Newly qualified original90 remains a Certified counterfactual after its own physical edit; initial placement is control-origin.
    expect(countWorkoutRankChanges(before, final, counter, 'lifter')).toBe(6);
    // A frozen Certified100 below an unlinked original All120 can still prove the physical All100→90 loss versus peer95.
    expect(countWorkoutRankChanges(bothMetrics(ranks(['lifter', 'peer'])), bothMetrics(ranks(['peer', 'lifter'])),
      bothMetrics(ranks(['lifter', 'peer'])), 'lifter')).toBe(4);
  });
  test('a mode-invalidated old witness cannot invent a Certified contribution after the mode returns', () => {
    const bothMetrics = (rows: NotificationRank[]): NotificationRank[] => [...rows,
      ...rows.map(row => ({ ...row, metric: 'volume' as const }))];
    const before = [...bothMetrics(ranks(['lifter', 'peer'])), ...bothMetrics(ranks(['peer'], true))];
    const final = [...bothMetrics(ranks(['lifter', 'peer'])), ...bothMetrics(ranks(['lifter', 'peer'], true))];
    // All100 is an eligible baseline, but its obsolete witness cannot supply a phantom Certified100.
    const counter = [...bothMetrics(ranks(['lifter', 'peer'])), ...bothMetrics(ranks(['peer'], true))];
    expect(countWorkoutRankChanges(before, final, counter, 'lifter')).toBe(4);
  });
  test('a stale Certified label cannot use a lower surviving maximum to prove unknown original performance', () => {
    const before = ranks(['peer'], true);
    const final = ranks(['lifter', 'peer'], true);
    // Current-scope proof cannot bound unknown original110 with surviving Certified100; the producer defers attribution on that board.
    expect(countWorkoutRankChanges(before, final, final, 'lifter')).toBe(0);
    expect(countWorkoutRankChanges(before, final, ranks(['peer', 'lifter'], true), 'lifter')).toBe(1);
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
