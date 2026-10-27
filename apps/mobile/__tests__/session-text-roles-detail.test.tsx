/**
 * The session's exercise cards, View Session and the completion summary on
 * the shared text roles (`design-language.md` §3, "Text roles"): titles are
 * `title`, row names `bodyStrong`, column heads `label`, every number in a row
 * `figure`; words never take Plex Mono, only the figures inside them do
 * (`FigureText`). An absent value is a `faint` dash.
 */
import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { ComparisonUnavailableCard } from '@/components/session-complete/comparison-unavailable-card';
import { ExerciseVolumeCard } from '@/components/session-complete/exercise-volume-card';
import { PersonalRecordCard } from '@/components/session-complete/personal-record-card';
import { SessionBreakdownPager } from '@/components/session-complete/session-breakdown-pager';
import { SessionMuscleBreakdown, SessionSummaryContent } from '@/components/session-complete/session-summary-content';
import { ExerciseSetsCard } from '@/components/session-detail/exercise-sets-card';
import { RecordBand } from '@/components/session-detail/record-band';
import { SessionFactsCard } from '@/components/session-detail/session-facts-card';
import { SetSummaryRow } from '@/components/session-detail/set-summary-row';
import { uiFonts, uiRoles, uiTypography } from '@/components/ui/tokens';
import type { CurrentSessionMuscleSummary, ExercisePersonalRecord, ExerciseVolumeComparison } from '@/src/session-insights';
import { formatSetRow } from '@/src/session-recorder/session-view-model';

const style = (node: { props: { style?: unknown } }): TextStyle => StyleSheet.flatten(node.props.style as never) as TextStyle;

const TITLE = { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.lg, lineHeight: uiTypography.lineHeight.lg };
const BODY = { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base };
const BODY_STRONG = { fontFamily: uiFonts.body.family, fontWeight: '600', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base };
const META = { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm };
const LABEL = { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, textTransform: 'uppercase' };
const FIGURE = { fontFamily: uiFonts.figure.family, fontWeight: '500', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base };
const FIGURE_SMALL = { fontFamily: uiFonts.figure.family, fontWeight: '500', fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm };
const FIGURE_HERO = { fontFamily: uiFonts.figure.family, fontWeight: '700', fontSize: uiTypography.size.xxl, lineHeight: uiTypography.lineHeight.xxl };
const INLINE_FIGURE = { fontFamily: uiFonts.figure.family, fontWeight: '500' };
const RECORD = { color: uiRoles.record, fontWeight: '700' };

const row = formatSetRow({ id: 'set', weight: 60, reps: 8, setType: 'rir_2', done: true });

describe('Exercise cards', () => {
  it('titles the card, its name a strong-figure line, its count in meta', () => {
    render(<ExerciseSetsCard count="3/5" name="Squat 27-10-2026" rows={[]} testID="card" />);
    const name = screen.getByText(/^Squat/);
    expect(style(name)).toMatchObject({ ...TITLE, flex: 1 });
    expect(style(within(name).getByText('27-10-2026'))).toMatchObject({ fontFamily: uiFonts.figure.family, fontWeight: '600' });
    const count = screen.getByTestId('card-count');
    expect(style(count)).toMatchObject({ ...META, color: uiRoles.inkMuted });
    expect(style(within(count).getByText('3'))).toMatchObject(INLINE_FIGURE);
  });

  it('fades a count with nothing done to faint', () => {
    render(<ExerciseSetsCard count="0/5" countMuted name="Bench Press" rows={[]} testID="card" />);
    expect(style(screen.getByTestId('card-count'))).toMatchObject({ ...META, color: uiRoles.inkFaint });
  });

  it('labels a record line in record, its figures as heavy as its words; the set in record figureSmall', () => {
    render(<RecordBand lines={[{ key: 'a', label: 'New 1RM record · 116.7', set: '100.0 × 5', spoken: '' }]} placement="footer" testID="band" />);
    const label = screen.getByText(/New 1RM record/);
    expect(style(label)).toMatchObject({ ...LABEL, ...RECORD });
    expect(style(within(label).getByText('116.7'))).toMatchObject({ fontFamily: uiFonts.figure.family, ...RECORD });
    expect(style(screen.getByText('100.0 × 5'))).toMatchObject({ ...FIGURE_SMALL, ...RECORD, marginLeft: 'auto' });
  });

  it('labels the set type in ink, its digits in the figure face, and the set in figure', () => {
    render(<SetSummaryRow row={row} testID="row" />);
    const type = screen.getByText(/^RIR/);
    expect(style(type)).toMatchObject({ ...LABEL, color: uiRoles.ink });
    expect(style(within(type).getByText('2'))).toMatchObject(INLINE_FIGURE);
    expect(style(screen.getByTestId('row-values'))).toMatchObject({ ...FIGURE, color: uiRoles.ink });
  });

  it('fades a planned set to faint and draws a Weight record in record', () => {
    const { rerender } = render(<SetSummaryRow row={{ ...row, done: false }} testID="row" />);
    expect(style(screen.getByText(/^RIR/))).toMatchObject({ ...LABEL, color: uiRoles.inkFaint });
    expect(style(screen.getByTestId('row-values'))).toMatchObject({ ...FIGURE, color: uiRoles.inkFaint });
    rerender(<SetSummaryRow row={{ ...row, weightRecord: true }} testID="row" />);
    expect(style(screen.getByTestId('row-values'))).toMatchObject({ ...FIGURE, ...RECORD });
  });

  it('draws a %BW row\'s 1RM and Vol in figureSmall: ink, record, or faint when planned', () => {
    const percentage = { ...row, weightReps: '100.0 %BW × 8', oneRepMax: '127.7 %BW', volume: '800.0 %BW·reps' };
    const { rerender } = render(<SetSummaryRow percentageMetrics row={{ ...percentage, oneRepMaxRecord: true }} testID="row" />);
    expect(style(screen.getByTestId('row-1rm'))).toMatchObject({ ...FIGURE_SMALL, ...RECORD, textAlign: 'right' });
    expect(style(screen.getByTestId('row-vol'))).toMatchObject({ ...FIGURE_SMALL, color: uiRoles.ink, textAlign: 'right' });
    rerender(<SetSummaryRow percentageMetrics row={{ ...percentage, oneRepMaxRecord: false }} testID="row" />);
    expect(style(screen.getByTestId('row-1rm'))).toMatchObject({ ...FIGURE_SMALL, color: uiRoles.ink });
    rerender(<SetSummaryRow percentageMetrics row={{ ...percentage, done: false }} testID="row" />);
    expect(style(screen.getByTestId('row-1rm'))).toMatchObject({ ...FIGURE_SMALL, color: uiRoles.inkFaint });
    expect(style(screen.getByTestId('row-vol'))).toMatchObject({ ...FIGURE_SMALL, color: uiRoles.inkFaint });
  });

  it('labels the session times faint, their values in body with figures', () => {
    render(<SessionFactsCard facts={[]} times={{ start: '27-10-2026 07:00', duration: '1h 5m' }} />);
    expect(style(screen.getByText('Start'))).toMatchObject({ ...LABEL, color: uiRoles.inkFaint });
    const start = screen.getByText('27-10-2026 07:00');
    expect(style(start)).toMatchObject(BODY);
    expect(style(within(start).getByText('07:00'))).toMatchObject(INLINE_FIGURE);
    expect(style(screen.getByText(/h 5m/))).toMatchObject(BODY);
  });
});

const record: ExercisePersonalRecord = {
  exerciseDefinitionId: 'bench', exerciseName: 'Bench Press', sessionExerciseId: 'e1', sessionExerciseOrderIndex: 0,
  sets: [], volume: 2370, baseline: {} as ExercisePersonalRecord['baseline'],
};

const comparison: ExerciseVolumeComparison = {
  exerciseDefinitionId: 'bench', exerciseName: 'Bench Press', sessionExerciseIds: ['bench'], sessionExerciseOrderIndex: 0,
  workingSetCount: 2, currentVolume: 500, historicalSessionCount: 6,
  medianVolume: 400, percentile25Volume: 300, percentile75Volume: 600, state: 'distribution',
};

describe('Completion: records and comparisons', () => {
  it('titles a personal record card, its count in meta with figures', () => {
    render(<PersonalRecordCard personalRecord={record} testID="pr" />);
    expect(style(screen.getByText('Bench Press'))).toMatchObject({ ...TITLE, flex: 1 });
    const count = screen.getByTestId('pr-count');
    expect(style(count)).toMatchObject({ ...META, color: uiRoles.inkMuted });
    expect(style(within(count).getByText('1'))).toMatchObject(INLINE_FIGURE);
  });

  it('states an unavailable comparison in bodyStrong, its figure strong, and names in bodyStrong', () => {
    render(<ComparisonUnavailableCard names={['Bench Press']} />);
    const statement = screen.getByText(/Comparison unavailable/);
    expect(style(statement)).toMatchObject(BODY_STRONG);
    expect(style(within(statement).getByText(/^\d+$/))).toMatchObject({ fontFamily: uiFonts.figure.family, fontWeight: '600' });
    expect(style(screen.getByText('Bench Press'))).toMatchObject(BODY_STRONG);
  });

  it('names the volume card in bodyStrong and draws its Volume as the hero figure', () => {
    render(<ExerciseVolumeCard comparison={comparison} testID="card" />);
    expect(style(screen.getByText('Bench Press').parent!)).toMatchObject({ ...BODY_STRONG, flexShrink: 1 });
    const counts = screen.getByText(/sets$/);
    expect(style(counts)).toMatchObject({ ...META, color: uiRoles.inkMuted });
    expect(style(within(counts).getByText('2'))).toMatchObject(INLINE_FIGURE);
    expect(style(screen.getByText('Vol'))).toMatchObject({ ...LABEL, color: uiRoles.inkFaint });
    expect(style(screen.getByText('500'))).toMatchObject({ ...FIGURE_HERO, color: uiRoles.ink });
  });

  it('draws the comparison line strong in its change colour, its figures strong', () => {
    render(<ExerciseVolumeCard comparison={comparison} testID="card" />);
    const delta = screen.getByText(/vs median|above|below/);
    expect(style(delta)).toMatchObject({ ...META, fontWeight: '600', color: uiRoles.gain, textAlign: 'right' });
    expect(style(within(delta).getAllByText(/^\d+$/)[0])).toMatchObject({ fontFamily: uiFonts.figure.family, fontWeight: '600' });
  });

  it('labels the quartiles faint with figure digits, their values in figureSmall', () => {
    render(<ExerciseVolumeCard comparison={comparison} testID="card" />);
    const hidden = { includeHiddenElements: true };
    const annotation = within(screen.getByTestId('card-p25-annotation', hidden));
    const p25 = annotation.getByText('P25', hidden);
    expect(style(p25)).toMatchObject({ ...LABEL, color: uiRoles.inkFaint });
    expect(style(within(p25).getByText('25', hidden))).toMatchObject(INLINE_FIGURE);
    expect(style(annotation.getByText('300', hidden))).toMatchObject({ ...FIGURE_SMALL, color: uiRoles.inkMuted });
  });
});

describe('Completion: the breakdown', () => {
  it('titles the pager, labels its heads faint, names rows in bodyStrong and draws figures muted, totals ink, absent faint', () => {
    render(
      <SessionBreakdownPager
        exerciseRows={[{ id: 'x1', exerciseDefinitionId: 'bench', name: 'Bench Press', workingSetCount: 3, volume: 1500, topWeight: 100, recordCount: 0 }]}
        muscleRows={[{ id: 'm1', displayName: 'Quads', primarySetCount: 3, secondarySetCount: 0, weightedSetCount: 3, volume: 750, recordCount: 2 }]}
      />,
    );
    expect(style(screen.getByTestId('session-completion-breakdown-title'))).toMatchObject({ ...TITLE, flex: 1 });
    expect(style(screen.getByText('Muscle'))).toMatchObject({ ...LABEL, color: uiRoles.inkFaint });
    expect(style(screen.getByText('Quads'))).toMatchObject(BODY_STRONG);
    expect(style(screen.getByText('Bench Press').parent!)).toMatchObject(BODY_STRONG);
    const muscle = within(screen.getByTestId('session-completion-breakdown-muscle-m1'));
    expect(style(muscle.getByText('750'))).toMatchObject({ ...FIGURE, color: uiRoles.ink });
    expect(style(muscle.getByText('2'))).toMatchObject({ ...FIGURE, color: uiRoles.inkMuted });
    expect(style(muscle.getByText('—'))).toMatchObject({ ...FIGURE, color: uiRoles.inkFaint });
  });

  it('states an empty page in muted body', () => {
    render(<SessionBreakdownPager catalogState="loading" exerciseRows={[]} muscleRows={[]} />);
    expect(style(screen.getByTestId('session-completion-breakdown-muscle-empty'))).toMatchObject({ ...BODY, color: uiRoles.inkMuted });
  });

  it('titles Sets by muscle, labels its heads, names rows in bodyStrong and counts in figure', () => {
    const summary = {
      workingSetsByMuscle: [{ id: 'quads', displayName: 'Quads', primarySetCount: 3, secondarySetCount: 0, weightedSetCount: 3 }],
    } as unknown as CurrentSessionMuscleSummary;
    render(<SessionMuscleBreakdown muscleCatalogState="ready" muscleSummary={summary} workingSetCount={3} />);
    expect(style(screen.getByText('Sets by muscle'))).toMatchObject(TITLE);
    expect(style(screen.getByText('Muscle'))).toMatchObject({ ...LABEL, color: uiRoles.inkFaint });
    expect(style(screen.getByText('Quads'))).toMatchObject(BODY_STRONG);
    const quads = within(screen.getByTestId('session-completion-muscle-quads'));
    const [primary, total] = quads.getAllByText('3');
    expect(style(primary)).toMatchObject({ ...FIGURE, color: uiRoles.inkMuted });
    expect(style(total)).toMatchObject({ ...FIGURE, color: uiRoles.ink });
    expect(style(quads.getByText('—'))).toMatchObject({ ...FIGURE, color: uiRoles.inkFaint });
  });

  it('states an empty muscle breakdown in muted body', () => {
    render(<SessionMuscleBreakdown muscleCatalogState="loading" muscleSummary={null} workingSetCount={3} />);
    expect(style(screen.getByTestId('session-completion-muscle-empty-state'))).toMatchObject({ ...BODY, color: uiRoles.inkMuted });
  });

  it('titles the Personal records section', () => {
    render(
      <SessionSummaryContent
        completedAt="2026-10-27T08:00:00Z"
        durationDisplay="1h 5m"
        exerciseCount={1}
        exerciseVolumeComparisons={[]}
        personalRecords={[record]}
        workingSetCount={3}
      />,
    );
    expect(style(screen.getByText('Personal records'))).toMatchObject(TITLE);
  });
});
