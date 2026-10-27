/**
 * The exercise page's parts on the shared text roles (`design-language.md` §3,
 * "Text roles"): the title is `title`, field and type labels `label`, a set's
 * weight × reps `figure`, a headline record `figureLarge`; words never take
 * Plex Mono, only the figures inside them do (`FigureText`).
 */
import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { ExerciseTopBar } from '@/components/exercise-page/exercise-top-bar';
import { RecordsPanel, type RecordsView } from '@/components/exercise-page/records-panel';
import { SetLogger } from '@/components/exercise-page/set-logger';
import { SetRow } from '@/components/exercise-page/set-row';
import { uiFonts, uiRoles, uiTypography } from '@/components/ui/tokens';
import type { SetRowView } from '@/src/session-recorder/exercise-page-model';
import type { ExerciseRecords, LastSession } from '@/src/session-recorder/exercise-records';
import type { ExerciseRecordsState } from '@/src/session-recorder/use-exercise-records';

const style = (node: { props: { style?: unknown } }): TextStyle => StyleSheet.flatten(node.props.style as never) as TextStyle;

const TITLE = { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.lg, lineHeight: uiTypography.lineHeight.lg };
const LABEL = { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, textTransform: 'uppercase' };
const BODY = { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base };
const META = { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm };
const FIGURE = { fontFamily: uiFonts.figure.family, fontWeight: '500', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base };

// A line of words whose figures take the figure face (`FigureText`).
const expectWordsWithFigures = (line: ReturnType<typeof screen.getByTestId>, figure: string) => {
  expect(style(line)).toMatchObject(META);
  expect(style(within(line).getByText(figure))).toMatchObject({ fontFamily: uiFonts.figure.family, fontWeight: '500' });
};

describe('Exercise page: title bar', () => {
  it.each([
    ['plain', undefined],
    ['switcher', jest.fn()],
  ])('draws the %s title in the title role', (_, onOpenSwitcher) => {
    render(<ExerciseTopBar onBack={jest.fn()} onOpenSwitcher={onOpenSwitcher} title="Barbell Bench Press" />);
    expect(style(screen.getByText('Barbell Bench Press'))).toMatchObject({ ...TITLE, color: uiRoles.ink });
  });
});

describe('Exercise page: the logger', () => {
  const renderLogger = () =>
    render(
      <SetLogger
        loadContext={{ policy: 'personal', bodyweightContribution: 0, loadInputMode: 'total_load' }}
        number={3}
        onChangeReps={jest.fn()}
        onChangeWeight={jest.fn()}
        onCommit={jest.fn()}
        onCycleEffort={jest.fn()}
        onOpenEffort={jest.fn()}
        repsValue="6"
        setType="rir_1"
        weightValue="82.5"
      />,
    );

  it('labels the set in accent and its fields faint', () => {
    renderLogger();
    expect(style(screen.getByText('Set 3'))).toMatchObject({ ...LABEL, color: uiRoles.accent });
    for (const label of ['Effort', 'Weight', 'Reps']) {
      expect(style(screen.getByText(label))).toMatchObject({ ...LABEL, color: uiRoles.inkFaint });
    }
  });

  it('draws the effort as a title and the inputs as the hero figure', () => {
    renderLogger();
    expect(style(screen.getByText('RIR 1'))).toMatchObject(TITLE);
    const hero = { fontFamily: uiFonts.figure.family, fontWeight: '700', fontSize: uiTypography.size.xxl, lineHeight: uiTypography.lineHeight.xxl };
    expect(style(screen.getByLabelText('Set 3 weight'))).toMatchObject(hero);
    expect(style(screen.getByLabelText('Set 3 reps'))).toMatchObject(hero);
  });

  it('writes the preview in words with its figures in the figure face', () => {
    renderLogger();
    const preview = screen.getByTestId('exercise-set-logger-preview');
    expectWordsWithFigures(preview, '99.3');
    expect(style(within(preview).getByText(/VOL/))).not.toHaveProperty('fontFamily', uiFonts.figure.family);
  });
});

describe('Exercise page: a set row', () => {
  const row = (over: Partial<SetRowView>): SetRowView => ({
    id: 's1',
    number: 1,
    kind: 'performed',
    isCursor: false,
    setType: 'rir_2',
    weight: 80,
    reps: 8,
    oneRepMax: 101.3,
    volume: 640,
    weightRecord: false,
    oneRepMaxRecord: false,
    ...over,
  });
  const renderRow = (over: Partial<SetRowView>) =>
    render(<SetRow divider={false} onOpen={jest.fn()} onToggle={jest.fn()} row={row(over)} />);

  it('draws a performed set in ink: its type a label, its values the row figure', () => {
    renderRow({});
    expect(style(screen.getByText('RIR 2'))).toMatchObject({ ...LABEL, color: uiRoles.ink });
    expect(style(screen.getByTestId('exercise-set-1-values'))).toMatchObject({ ...FIGURE, color: uiRoles.ink });
  });

  it('fades a planned set', () => {
    renderRow({ kind: 'pending' });
    expect(style(screen.getByText('RIR 2'))).toMatchObject({ ...LABEL, color: uiRoles.inkFaint });
    expect(style(screen.getByTestId('exercise-set-1-values'))).toMatchObject({ ...FIGURE, color: uiRoles.inkFaint });
  });

  it('draws a record weight heavy in the record colour', () => {
    renderRow({ weightRecord: true });
    expect(style(screen.getByTestId('exercise-set-1-values'))).toMatchObject({
      fontFamily: uiFonts.figure.family,
      fontSize: uiTypography.size.base,
      fontWeight: '700',
      color: uiRoles.record,
    });
  });
});

describe('Exercise page: the records panel', () => {
  const SEP_12 = new Date(2026, 8, 12, 18, 0);
  const RECORDS: ExerciseRecords = {
    oneRepMax: { value: 142.5, completedAt: SEP_12, weight: 130, reps: 3, gymName: 'Iron Den' },
    maxWeight: { weight: 135, reps: 1, completedAt: SEP_12, gymName: null },
    volume: { value: 3210.4, completedAt: SEP_12, setCount: 5, gymName: null },
  };
  const LAST: LastSession = {
    completedAt: SEP_12,
    gymName: 'Iron Den',
    oneRepMax: 140,
    maxWeight: 100,
    volume: 1800,
    sets: [{ setType: 'warm_up', weight: 60, reps: 8, oneRepMax: 75, volume: 480 }],
  };
  const renderPanel = (state: ExerciseRecordsState, view: RecordsView = 'records', expanded = true) =>
    render(
      <RecordsPanel
        dateFormat="YYYY-MM-DD"
        expanded={expanded}
        now={new Date(2026, 8, 14, 9, 0)}
        onOpenProgress={jest.fn()}
        onSelectView={jest.fn()}
        onToggleExpanded={jest.fn()}
        state={state}
        view={view}
      />,
    );
  const ready = (records: ExerciseRecords, last: LastSession | null): ExerciseRecordsState => ({ status: 'ready', summary: { records, last } });

  it('links to Progress as the heading link: a muted label, not an accent one', () => {
    renderPanel(ready(RECORDS, LAST));
    expect(style(within(screen.getByTestId('exercise-records-progress')).getByText('Progress'))).toMatchObject({
      ...LABEL,
      color: uiRoles.inkMuted,
    });
  });

  it('draws a record line as a faint label, a large figure and a line of words', () => {
    renderPanel(ready(RECORDS, LAST));
    const line = screen.getByTestId('exercise-record-1rm');
    expect(style(within(line).getByText('1RM'))).toMatchObject({ ...LABEL, color: uiRoles.inkFaint });
    expect(style(within(line).getByText('142.5'))).toMatchObject({
      fontFamily: uiFonts.figure.family,
      fontWeight: '600',
      fontSize: uiTypography.size.lg,
    });
    const detail = within(line).getByText(/Iron Den/);
    expect(style(detail)).toMatchObject(META);
    expect(style(within(detail).getByText('130.0'))).toMatchObject({ fontFamily: uiFonts.figure.family });
  });

  it('draws the last session as lines of words, each set a label and a row figure', () => {
    renderPanel(ready(RECORDS, LAST), 'last');
    const last = screen.getByTestId('exercise-records-last');
    const summary = within(last).getByText(/^1RM .* · VOL/);
    expectWordsWithFigures(summary, '140.0');
    expect(style(within(last).getByText(/Iron Den/))).toMatchObject(META);
    const set = screen.getByTestId('exercise-records-last-set-0');
    expect(style(within(set).getByText('W-Up'))).toMatchObject({ ...LABEL, color: uiRoles.ink });
    expect(style(within(set).getByText('60.0 × 8'))).toMatchObject(FIGURE);
  });

  it.each([
    ['message', { status: 'error' } as ExerciseRecordsState],
    ['empty', ready({ oneRepMax: null, maxWeight: null, volume: null }, null)],
  ])('writes the %s line as muted body', (kind, state) => {
    renderPanel(state);
    expect(style(screen.getByTestId(`exercise-records-${kind}`))).toMatchObject({ ...BODY, color: uiRoles.inkMuted });
  });
});
