import { buildMedalBoard } from '@/src/groups/medal-view-model';
import type { CompetitionPodiumsWire, CompetitionBoardRowWire } from '@/src/groups/competition-wire';
import { competitionBoard, competitionExercise, competitionRow } from './helpers/competition-fixtures';

const row = (rank: number, userId: string, username = userId, former = false): CompetitionBoardRowWire =>
  ({ ...competitionRow, rank, member: { user_id: userId, username }, former });
const podium = (entries: CompetitionBoardRowWire[], id = 'exercise'): CompetitionPodiumsWire['podiums'][number] => ({
  exercise: { ...competitionExercise, group_exercise_id: id },
  board: { ...competitionBoard, group_exercise_id: id, entries, entry_count: entries.length },
});
const payload = (...podiums: CompetitionPodiumsWire['podiums']): CompetitionPodiumsWire => ({ contract_version: 4, certified: false, podiums });
const tuples = (data: CompetitionPodiumsWire) => buildMedalBoard(data, 'me').rows.map(r => [r.userId, r.rank, r.gold, r.silver, r.bronze]);

it('counts server places across mixed default metrics and short boards, without comparing values or rounded ties', () => {
  const volume = podium([row(2, 'me'), row(1, 'other')], 'volume');
  volume.exercise.rules = { ...competitionExercise.rules, default_metric: 'volume' };
  volume.board.metric = 'volume';
  volume.board.entries = volume.board.entries.map(entry => ({ ...entry, metric: 'volume', unit: 'percent_bw_reps' }));
  expect(tuples(payload(podium([row(3, 'me'), row(1, 'other'), row(2, 'third'), row(4, 'unranked')]),
    volume, podium([row(1, 'me')], 'solo')))).toEqual([
    ['other', 1, 2, 0, 0], ['me', 2, 1, 1, 1], ['third', 3, 0, 1, 0],
  ]);
});

it('sorts gold, silver, bronze with shared competition ranks; name then stable ID orders identical tuples', () => {
  const data = payload(podium([row(1, 'z', 'Same'), row(2, 'silver'), row(3, 'bronze')]),
    podium([row(1, 'a', 'Same'), row(2, 'silver'), row(3, 'bronze')], 'second'),
    podium([row(1, 'first', 'Alice'), row(2, 'bronze')], 'third'));
  expect(tuples(data)).toEqual([
    ['first', 1, 1, 0, 0], ['a', 1, 1, 0, 0], ['z', 1, 1, 0, 0], ['silver', 4, 0, 2, 0], ['bronze', 5, 0, 1, 2],
  ]);
  const bronzeTieBreak = payload(podium([row(1, 'a'), row(2, 'b'), row(3, 'a-bronze')]),
    podium([row(1, 'b'), row(2, 'a'), row(3, 'other')], 'second'),
    podium([row(1, 'c'), row(2, 'd'), row(3, 'a')], 'third'));
  expect(tuples(bronzeTieBreak).slice(0, 2)).toEqual([['a', 1, 1, 1, 1], ['b', 2, 1, 1, 0]]);
  expect(tuples({ ...data, podiums: [...data.podiums].reverse() })).toEqual(tuples(data));
});

it('keeps former podium holders and excludes archived exercises without promoting anyone', () => {
  const archived = podium([row(1, 'excluded')]);
  archived.exercise.archived_at_ms = 1;
  archived.exercise.rebuilding = true;
  const archivedBoard = podium([row(1, 'also-excluded')]);
  archivedBoard.board.state = 'archived';
  const result = buildMedalBoard(payload(podium([row(1, 'former', 'Long full name', true), row(2, 'me', 'Viewer')]),
    archived, archivedBoard), 'me');
  expect(result.rows.map(r => r.memberLabel)).toEqual(['Long full name (former)', 'You']);
  expect(result.rows[0].accessibilityLabel).toBe('1st, Long full name, Former, Gold 1, Silver 0, Bronze 0');
  expect(result.me?.accessibilityLabel).toBe('2nd, You, Viewer, Gold 0, Silver 1, Bronze 0');
});

it.each(['exercise', 'board'] as const)('withholds the entire tally while an active %s rebuilds', source => {
  const rebuilding = podium([]);
  if (source === 'exercise') rebuilding.exercise.rebuilding = true;
  else rebuilding.board.state = 'rebuilding';
  expect(buildMedalBoard(payload(podium([row(1, 'me')]), rebuilding), 'me'))
    .toEqual({ state: 'rebuilding', rows: [], me: null });
});

it('returns valid empty data and keeps members without medals outside the ranking', () => {
  expect(buildMedalBoard(payload(podium([])), 'me')).toEqual({ state: 'ready', rows: [], me: null });
  expect(buildMedalBoard(payload(), 'me').rows).toEqual([]);
  const noMedal = podium([row(1, 'other')]);
  noMedal.board.me = row(5, 'me');
  expect(buildMedalBoard(payload(noMedal), 'me').me).toBeNull();
  const unnamed = buildMedalBoard(payload(podium([row(1, 'me', '  ')])), 'me');
  expect(unnamed.me?.name).toBe('Unnamed member');
});
