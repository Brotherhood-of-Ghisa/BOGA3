/* eslint-disable import/first */

/**
 * The session recorder and session view on the shared text roles
 * (`design-language.md` §3, "Text roles"): titles are `title`, row names
 * `bodyStrong`, headings and controls `label`; words never take Plex Mono,
 * only the figures inside them do (`FigureText`).
 */

const mockListAvailablePlanBlocks = jest.fn();
jest.mock('@/src/session-planner/available-blocks', () => ({
  listAvailablePlanBlocks: () => mockListAvailablePlanBlocks(),
}));
jest.mock('@/src/session-recorder/gym-options', () => ({
  activeGymOptions: (gyms: unknown[]) => gyms,
  listGymDirectory: () => Promise.resolve([]),
}));

import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { PickerPreselectionCard } from '@/components/session-recorder/picker-preselection-card';
import { PlannerBlockSection } from '@/components/session-recorder/planner-block-section';
import { RestTimerBar } from '@/components/session-recorder/rest-timer-bar';
import { SessionInsightPresentation } from '@/components/session-recorder/session-insight-presentation';
import { TitleBarTimer } from '@/components/session-recorder/title-bar-timer';
import { SessionGymSheet } from '@/components/session-view/session-gym-sheet';
import { SessionTimesFields } from '@/components/session-view/session-times-fields';
import { SessionTopBar } from '@/components/session-view/session-top-bar';
import { ViewSessionTopBar } from '@/components/view-session/view-session-top-bar';
import { uiFonts, uiRoles, uiTypography } from '@/components/ui/tokens';
import type { ExercisePickerPreselectionState } from '@/components/session-recorder/types';
import type { RestTimerView } from '@/src/session-recorder/rest-timer';

const style = (node: { props: { style?: unknown } }): TextStyle => StyleSheet.flatten(node.props.style as never) as TextStyle;

const TITLE = { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.lg, lineHeight: uiTypography.lineHeight.lg };
const BODY = { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base };
const BODY_STRONG = { fontFamily: uiFonts.body.family, fontWeight: '600', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base };
const META = { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm };
const LABEL = { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, textTransform: 'uppercase' };
const FIGURE_LARGE = { fontFamily: uiFonts.figure.family, fontWeight: '600', fontSize: uiTypography.size.lg, lineHeight: uiTypography.lineHeight.lg };
const INLINE_FIGURE = { fontFamily: uiFonts.figure.family, fontWeight: '500' };

describe('Recorder: the picker', () => {
  it('titles the preselection card and labels its source, the date in figures', () => {
    const state = {
      exercise: { name: 'Bench Press' },
      status: 'ready',
      suggestion: {
        sessionId: 's1',
        completedAt: new Date(2026, 9, 12, 7, 0),
        sessionExerciseIds: ['e1'],
        sets: [{ setId: 'set-1', weightValue: '60', repsValue: '8', setType: null }],
      },
    } as unknown as ExercisePickerPreselectionState;
    render(<PickerPreselectionCard onAddEmptySet={jest.fn()} onRepeat={jest.fn()} repeatDisabled={false} state={state} />);
    expect(style(screen.getByText('Bench Press'))).toMatchObject(TITLE);
    const source = screen.getByTestId('exercise-picker-plan-source');
    expect(style(source)).toMatchObject({ ...LABEL, color: uiRoles.inkMuted });
    expect(style(within(source).getByText('07:00'))).toMatchObject(INLINE_FIGURE);
  });

  it('names a planned block in bodyStrong, its source in meta with figures', async () => {
    mockListAvailablePlanBlocks.mockResolvedValue([
      { block: { id: 'b1', name: 'Squat', orderIndex: 1 }, planTitle: 'Push day', planBlockCount: 4 },
    ]);
    render(<PlannerBlockSection onPickBlock={jest.fn()} />);
    expect(style(await screen.findByText('Squat'))).toMatchObject(BODY_STRONG);
    expect(style(screen.getByText('From planner'))).toMatchObject(LABEL);
    const source = screen.getByText(/Push day/);
    expect(style(source)).toMatchObject({ ...META, color: uiRoles.inkMuted });
    expect(style(within(source).getByText('2'))).toMatchObject(INLINE_FIGURE);
    expect(style(within(source).getByText('4'))).toMatchObject(INLINE_FIGURE);
  });
});

describe('Recorder: the rest timer', () => {
  const bar = (view: RestTimerView) =>
    render(<RestTimerBar onAdjust={jest.fn()} onDismiss={jest.fn()} onRestart={jest.fn()} view={view} />);

  it('labels a running rest muted, its countdown in figureLarge', () => {
    bar({ mode: 'rest', status: 'running', sessionId: 's1', remainingSec: 90, formatted: '1:30', durationSec: 90 });
    expect(style(screen.getByTestId('rest-timer-status'))).toMatchObject({ ...LABEL, color: uiRoles.inkMuted });
    expect(style(screen.getByTestId('rest-timer-countdown'))).toMatchObject({ ...FIGURE_LARGE, color: uiRoles.ink });
  });

  it('labels a finished rest in ink', () => {
    bar({ mode: 'rest', status: 'completed', sessionId: 's1', remainingSec: 0, formatted: '0:00', durationSec: 90 } as RestTimerView);
    expect(screen.getByTestId('rest-timer-status')).toHaveTextContent('Rest complete');
    expect(style(screen.getByTestId('rest-timer-status'))).toMatchObject({ ...LABEL, color: uiRoles.ink });
  });

  it('draws the round number of a repeating timer in the figure face', () => {
    bar({
      mode: 'repeating', status: 'running', sessionId: 's1', round: 3, remainingSec: 30, formatted: '0:30', intervalSec: 60, isPaused: false,
    } as RestTimerView);
    const round = screen.getByTestId('repeating-timer-round');
    expect(style(round)).toMatchObject(LABEL);
    expect(style(within(round).getByText('3'))).toMatchObject(INLINE_FIGURE);
  });

  it.each([
    ['running', { mode: 'rest', status: 'running', sessionId: 's1', remainingSec: 60, formatted: '1:00', durationSec: 90 }, uiRoles.ink],
    ['done', { mode: 'rest', status: 'completed', sessionId: 's1', remainingSec: 0, formatted: '0:00', durationSec: 90 }, uiRoles.surface],
    ['paused', {
      mode: 'repeating', status: 'paused', sessionId: 's1', round: 2, remainingSec: 30, formatted: '0:30', intervalSec: 60, isPaused: true,
    }, uiRoles.inkMuted],
  ])('draws the title-bar countdown in figureLarge (%s)', (_name, view, color) => {
    render(<TitleBarTimer onLongPress={jest.fn()} onPress={jest.fn()} testID="tb" view={view as RestTimerView} />);
    expect(style(screen.getByTestId('tb-countdown'))).toMatchObject({ ...FIGURE_LARGE, color });
  });
});

describe('Recorder: comparisons', () => {
  it('states a loading comparison in meta', () => {
    render(<SessionInsightPresentation exerciseComparisons={[]} historyState="loading" />);
    expect(style(screen.getByTestId('session-insight-empty'))).toMatchObject({ ...META, color: uiRoles.inkMuted });
  });
});

describe('Session view: the gym sheet', () => {
  const sheet = (options: Parameters<typeof SessionGymSheet>[0]['options']) =>
    render(
      <SessionGymSheet
        gpsPanel={{
          state: {
            status: 'available',
            position: { latitude: 51.5, longitude: -0.12, accuracyM: 30, capturedAt: new Date('2026-09-23T10:00:00Z') },
            attempts: 2,
            lastRead: { status: 'success', accuracyM: 30 },
            gaveUpReason: null,
          },
          nearbyGymCount: 3,
          suggestionCount: 2,
        }}
        onDismiss={jest.fn()}
        onManage={jest.fn()}
        onSelect={jest.fn()}
        options={options}
        selectedGymId={null}
        suggestions={[]}
        visible
      />,
    );

  it('labels Manage gyms in ink and states loading in muted body', () => {
    sheet(null);
    expect(style(screen.getByText('Manage gyms'))).toMatchObject({ ...LABEL, color: uiRoles.ink });
    expect(style(screen.getByText('Loading gyms…'))).toMatchObject({ ...BODY, color: uiRoles.inkMuted });
  });

  it('heads the GPS panel with a label, its rows in meta, values strong with strong figures', () => {
    sheet([]);
    expect(style(screen.getByText('GPS state'))).toMatchObject({ ...LABEL, color: uiRoles.inkMuted });
    expect(style(screen.getByText('Fix'))).toMatchObject({ ...META, color: uiRoles.inkMuted });
    const value = screen.getByTestId('session-gps-value-fix');
    expect(style(value)).toMatchObject({ ...META, fontWeight: '600', color: uiRoles.ink, textAlign: 'right' });
    expect(style(within(value).getByText('30'))).toMatchObject({ fontFamily: uiFonts.figure.family, fontWeight: '600' });
  });
});

describe('Session view: the times and the title bars', () => {
  it('states the autosave-paused notice in meta', () => {
    render(
      <SessionTimesFields
        errors={{ start: null, end: null }}
        notice="Autosave paused until Start/End times are valid."
        onChangeEnd={jest.fn()}
        onChangeStart={jest.fn()}
        onCommitEnd={jest.fn()}
        onCommitStart={jest.fn()}
        text={{ start: '2026-10-27 07:00', end: '2026-10-27 08:00' }}
      />,
    );
    expect(style(screen.getByTestId('session-view-times-notice'))).toMatchObject({ ...META, color: uiRoles.inkMuted });
  });

  it('titles an active session in title, its elapsed time in strong figures', () => {
    const startedAt = new Date(2026, 8, 23, 18, 0, 0);
    render(
      <SessionTopBar
        mode="active"
        now={() => new Date(2026, 8, 23, 18, 42, 17)}
        onFinish={jest.fn()}
        onOpenOptions={jest.fn()}
        startedAt={startedAt}
      />,
    );
    const title = screen.getByTestId('session-view-title');
    expect(style(title)).toMatchObject({ ...TITLE, flex: 1 });
    expect(style(within(title).getByText('42:17'))).toMatchObject({ fontFamily: uiFonts.figure.family, fontWeight: '600' });
  });

  it('titles a completed edit in title', () => {
    render(<SessionTopBar mode="completed" onDone={jest.fn()} />);
    expect(style(screen.getByText('Edit session'))).toMatchObject(TITLE);
  });

  it('titles View Session in title, the date in strong figures', () => {
    render(<ViewSessionTopBar onBack={jest.fn()} title="Morning training · 27-10-2026" />);
    const title = screen.getByTestId('completed-session-detail-title');
    expect(style(title)).toMatchObject({ ...TITLE, flex: 1 });
    expect(style(within(title).getByText('27-10-2026'))).toMatchObject({ fontFamily: uiFonts.figure.family, fontWeight: '600' });
  });
});
