import { formatCompetitionValue, formatCompetitionHistoricalValue, buildCompetitionRow } from '@/src/groups/competition-view-model';
import { hasValidAddedOneRepMax } from '@/src/groups/competition-set-display';
import { isCompetitionBoardWire } from '@/src/groups/competition-wire-guards';
import { isCoWResultWire } from '@/src/groups/cow-wire';
import { coWFigure } from '@/src/groups/cow-presentation';
import { buildCompetitionSession } from '@/src/groups/competition-session-view-model';
import { competitionRow, competitionBoard, competitionEvent, competitionSession } from './helpers/competition-fixtures';
import { cowResult } from './helpers/cow-fixtures';

it.each([[128.3,28.3,'28.3'],[100,0,'0.0'],[98.3,28.3,'28.3']])(
  'displays server-projected added 1RM %s as %s without changing the ranked score', (value,display_value,expected) => {
    const row={ ...competitionRow,value,display_value };
    expect(formatCompetitionValue(row)).toBe(`${expected} %BW`);
    expect(isCompetitionBoardWire({ ...competitionBoard,entries: [row] })).toBe(true);
    expect(row.value).toBe(value);
    expect(buildCompetitionRow(row,'all','me','YYYY-MM-DD').accessibilityLabel).toContain(`${expected} %BW`);
  });
it('uses the historical projection even when current contribution differs, and keeps previous values independent', () => {
  const historic={ ...competitionEvent.values[0],value: 128.3,display_value: 28.3 };
  expect(formatCompetitionHistoricalValue(historic)).toBe('1RM 28.3 %BW');
  expect(formatCompetitionHistoricalValue({ ...historic,role: 'previous',value: 98.3 })).toBe('1RM 28.3 %BW');
});
it.each([null,undefined])('does not invent a total-load 1RM when its added-load projection is %s', display_value => {
  expect(formatCompetitionValue({ ...competitionRow,display_value })).toBe('Score unavailable');
});
it.each([-1,NaN,Infinity,129,'28',{}])('rejects malformed safe display values: %p', display_value => {
  expect(hasValidAddedOneRepMax({ value: 128.3,display_value },'e1rm','percent_bw')).toBe(false);
});
it('only accepts the extra score field for normalized 1RM', () => {
  expect(hasValidAddedOneRepMax({ value: null,display_value: null },'e1rm','percent_bw')).toBe(true);
  expect(hasValidAddedOneRepMax({ value: 100,display_value: 0 },'volume','percent_bw_reps')).toBe(false);
});
it('frozen CoW projection ignores current exercise rules, preserves numeric zero, and leaves improvement intact', () => {
  const result=cowResult();
  result.exercise={ ...result.exercise!,rules: { ...result.exercise!.rules,bodyweight_contribution: 0.7 } };
  const ranking=result.rankings[0];
  ranking.entries[0]={ ...ranking.entries[0],value: 100,display_value: 0 };
  expect(isCoWResultWire(result)).toBe(true);
  expect(coWFigure(ranking.entries[0],ranking)).toBe('0.0');
  expect(coWFigure({ value: 20 },{ metric: 'improvement',unit: 'percent' })).toBe('+20.0%');
});
it('shared session 1RM shows zero from the safe projection while set load and Volume retain their metrics', () => {
  const session=competitionSession.session;
  const exercise=session.exercises[0];
  const metrics={ added_load_percent_bw: 0,e1rm_percent_bw: 100,e1rm_added_load_percent_bw: 0,volume_percent_bw_reps: 100 };
  const model=buildCompetitionSession({ ...session,exercises: [{ ...exercise,visibility: 'normalized',
    sets: [{ ...exercise.sets[0],reps_value: '1',normalized_metrics: metrics }] }] });
  expect(model.cards[0].rows[0]).toMatchObject({ oneRepMax: '0.0 %BW',weightReps: '100.0 %BW × 1',volume: '100.0 %BW·reps' });
});
