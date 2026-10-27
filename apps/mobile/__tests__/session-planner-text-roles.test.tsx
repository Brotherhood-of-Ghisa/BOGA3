/* eslint-disable import/first */
/**
 * The session planner and programmes on the shared text roles
 * (`design-language.md` §3, "Text roles"): titles are `title`, row names
 * `bodyStrong`, headings and statuses `label`, supporting lines `meta`, errors
 * `meta` in `danger`; words never take Plex Mono, only the figures inside them
 * do (`FigureText`).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

import { NextProgrammeBlockCard } from '@/components/session-planner/next-programme-block-card';
import { PlanBlockEditor } from '@/components/session-planner/plan-block-editor';
import { PlanCardChoiceSheet } from '@/components/session-planner/plan-card-choice-sheet';
import { PlanDetailBlocks } from '@/components/session-planner/plan-detail-blocks';
import { PlanDetailSummary } from '@/components/session-planner/plan-detail-summary';
import { PlanFormScreen } from '@/components/session-planner/plan-form-screen';
import { PlanSection } from '@/components/session-planner/plan-sections';
import { ProgrammeDetailHeader } from '@/components/session-planner/programme-detail-header';
import { ProgrammeFormScreen } from '@/components/session-planner/programme-form-screen';
import { ProgrammePlanList } from '@/components/session-planner/programme-plan-list';
import { uiFonts, uiRoles, uiTypography } from '@/components/ui/tokens';
import type { PlanBlockView, PlanDetailView, ProgrammeDetailView } from '@/src/session-planner';

const style = (node: { props: { style?: unknown } }): TextStyle => StyleSheet.flatten(node.props.style as never) as TextStyle;

const TITLE = { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.lg, lineHeight: uiTypography.lineHeight.lg };
const BODY = { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base };
const BODY_STRONG = { ...BODY, fontWeight: '600' };
const META = { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm };
const LABEL = { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, textTransform: 'uppercase' };
const FIGURE = { fontFamily: uiFonts.figure.family, fontWeight: '500' };

/** The line is in Source Sans and `figure` inside it is in Plex Mono. */
const expectFigureInWords = (line: ReturnType<typeof screen.getByText>, figure: string) => {
  expect(style(line).fontFamily).toBe(uiFonts.body.family);
  within(line).getAllByText(figure).forEach((node) => expect(style(node)).toMatchObject(FIGURE));
};

const counts = { pending: 2, attached: 0, completed: 1, skipped: 0 };

const block = (overrides: Partial<PlanBlockView> = {}): PlanBlockView => ({
  id: 'b1',
  planId: 'p1',
  exerciseDefinitionId: null,
  name: 'Bench Press',
  orderIndex: 0,
  progressStatus: 'pending',
  status: 'pending',
  resolvedAt: null,
  attachedSessionId: null,
  attachedSessionExerciseId: null,
  targets: [
    { id: 't1', orderIndex: 0, targetWeightValue: '100', targetReps: 5, targetSetType: 'rir_2' },
    { id: 't2', orderIndex: 1, targetWeightValue: '105', targetReps: 3, targetSetType: 'rir_2' },
  ],
  ...overrides,
});

const plan = (overrides: Partial<PlanDetailView> = {}): PlanDetailView => ({
  id: 'p1',
  title: 'Heavy day',
  gymId: null,
  scheduledFor: new Date(2026, 9, 28, 7, 0),
  programmeId: 'prog1',
  programmeOrderIndex: 1,
  provenance: 'agent',
  progress: 'planned',
  blockCounts: counts,
  blocks: [block()],
  ...overrides,
});

describe('Plan detail', () => {
  it('titles the plan in title, its supporting lines in meta with figures in Plex Mono', () => {
    render(<PlanDetailSummary deletable detail={plan()} onDelete={jest.fn()} onDuplicate={jest.fn()} onEdit={jest.fn()} onStartAll={jest.fn()} />);
    expect(style(screen.getByTestId('plan-detail-title'))).toMatchObject({ ...TITLE, color: uiRoles.ink });
    expectFigureInWords(screen.getByTestId('plan-detail-schedule'), '28-10-2026');
    expectFigureInWords(screen.getByTestId('plan-detail-progress'), '3');
    expectFigureInWords(screen.getByTestId('plan-detail-programme-badge'), '2');
    expect(style(screen.getByTestId('plan-detail-provenance'))).toMatchObject({ ...META, color: uiRoles.inkMuted });
  });

  it('titles each block in title, its state in meta and its targets in ink, figures in Plex Mono', () => {
    render(<PlanDetailBlocks detail={plan()} onAdd={jest.fn()} onOpenSession={jest.fn()} onSkip={jest.fn()} />);
    expect(style(screen.getByText('Bench Press'))).toMatchObject(TITLE);
    const state = screen.getByTestId('plan-detail-block-1-state');
    expect(style(state)).toMatchObject({ ...META, color: uiRoles.inkMuted });
    expectFigureInWords(state, '1');
    const targets = screen.getByTestId('plan-detail-block-1-targets');
    expect(style(targets)).toMatchObject({ ...META, color: uiRoles.ink });
    expect(style(within(targets).getByText('100'))).toMatchObject(FIGURE);
  });
});

describe('Programme detail', () => {
  const detail: ProgrammeDetailView = {
    id: 'prog1',
    name: 'Strength block',
    description: 'Four weeks of triples.',
    progress: 'planned',
    planCount: 3,
    blockCounts: counts,
    plans: [plan()],
    nextBlock: block(),
  };

  it('titles the programme, its description and stats in meta', () => {
    render(<ProgrammeDetailHeader detail={detail} onDelete={jest.fn()} onDuplicate={jest.fn()} onEdit={jest.fn()} />);
    expect(style(screen.getByText('Strength block'))).toMatchObject(TITLE);
    expect(style(screen.getByText('Four weeks of triples.'))).toMatchObject(META);
    expectFigureInWords(screen.getByTestId('programme-detail-stats'), '3');
  });

  it('heads the next block in a faint label, its name in bodyStrong, its targets in meta', () => {
    render(<NextProgrammeBlockCard blockCounts={counts} nextBlock={block()} onAdd={jest.fn()} onSkip={jest.fn()} />);
    expect(style(screen.getByText('Next up'))).toMatchObject({ ...LABEL, color: uiRoles.inkFaint });
    expect(style(screen.getByTestId('programme-next-block-name'))).toMatchObject(BODY_STRONG);
    expectFigureInWords(screen.getByTestId('programme-next-block-targets'), '100');
  });

  it('writes the empty next-block card in meta', () => {
    render(<NextProgrammeBlockCard blockCounts={counts} nextBlock={null} onAdd={jest.fn()} onSkip={jest.fn()} />);
    expect(style(screen.getByText('Next block'))).toMatchObject({ ...LABEL, color: uiRoles.inkFaint });
    expect(style(screen.getByTestId('programme-next-block-empty-text'))).toMatchObject(META);
  });

  it('lists sessions under a faint label, names in bodyStrong, status in label, detail in meta', () => {
    render(<ProgrammePlanList onOpenPlan={jest.fn()} plans={[plan()]} />);
    // A micro-label's count stays in the label's own face: Plex Mono 500 would sit lighter than its caps.
    const heading = screen.getByText('Sessions (1)');
    expect(style(heading)).toMatchObject({ ...LABEL, color: uiRoles.inkFaint });
    expect(within(heading).queryAllByText('1')).toHaveLength(0);
    expect(style(screen.getByText('Heavy day'))).toMatchObject({ ...BODY_STRONG, flex: 1 });
    expect(style(screen.getByText('Planned'))).toMatchObject({ ...LABEL, color: uiRoles.inkMuted });
    expectFigureInWords(screen.getByText(/· 3 blocks$/), '28-10-2026');
  });

  it('asks which card in body, names each card in bodyStrong and counts its sets in meta', () => {
    render(
      <PlanCardChoiceSheet
        blockName="Bench Press"
        candidates={[{ id: 'c1', exerciseName: 'Bench Press', setCount: 2 }]}
        onConfirm={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(style(screen.getByText('Which Bench Press card?'))).toMatchObject(BODY);
    expect(style(within(screen.getByTestId('plan-card-choice-c1')).getByText('Bench Press'))).toMatchObject(BODY_STRONG);
    expectFigureInWords(screen.getByText('2 sets'), '2');
  });
});

describe('Sessions planning sections', () => {
  it('heads a section in a faint label, names rows in bodyStrong, details in meta', () => {
    render(
      <PlanSection
        label="Unscheduled"
        onOpenPlan={jest.fn()}
        plans={[plan({ scheduledFor: null })]}
        programmes={[{ id: 'prog1', name: 'Strength block', description: null, progress: 'planned', planCount: 3, blockCounts: counts }]}
        testID="section"
      />,
    );
    expect(style(screen.getByText('Unscheduled'))).toMatchObject({ ...LABEL, color: uiRoles.inkFaint });
    expect(style(screen.getByText('Strength block'))).toMatchObject(BODY_STRONG);
    expect(style(screen.getByText('Heavy day'))).toMatchObject(BODY_STRONG);
    expectFigureInWords(screen.getByText(/^Programme ·/), '3');
    expectFigureInWords(screen.getByText(/^Unscheduled ·/), '3');
  });
});

describe('Plan and programme forms', () => {
  const formBlock = { id: 'fb1', sourceBlockId: null, exerciseDefinitionId: null, name: 'Bench Press', loadInputMode: null, sets: [{ id: 's1', targetWeightText: '', targetRepsText: '', targetSetType: 'rir_2' as const }] };

  it('titles a block in title and draws its errors in meta, danger', () => {
    render(
      <PlanBlockEditor
        block={formBlock}
        count={1}
        errors={new Map([['exercises.0.name', 'Pick an exercise.'], ['exercises.0.sets.0.targetReps', 'Enter reps.']])}
        index={0}
        onAddSets={jest.fn()}
        onChangeSet={jest.fn()}
        onMoveBlock={jest.fn()}
        onPickExercise={jest.fn()}
        onRemoveBlock={jest.fn()}
        onRemoveSet={jest.fn()}
      />,
    );
    expect(style(within(screen.getByTestId('plan-form-block-1-pick')).getByText('Bench Press'))).toMatchObject(TITLE);
    expect(style(screen.getByTestId('plan-form-block-1-name-error'))).toMatchObject({ ...META, color: uiRoles.danger });
    expect(style(screen.getByTestId('plan-form-block-1-set-1-reps-error'))).toMatchObject({ ...META, color: uiRoles.danger });
  });

  it('draws the plan form\'s blocks error in meta, danger and its hint in muted body', async () => {
    render(<PlanFormScreen initialForm={{ title: '', scheduleText: '', gymId: null, blocks: [] }} onSave={jest.fn()} saveLabel="Save plan" />);
    await act(async () => {});
    await act(async () => fireEvent.press(screen.getByTestId('plan-form-save')));
    expect(style(screen.getByTestId('plan-form-blocks-error'))).toMatchObject({ ...META, color: uiRoles.danger });
    expect(style(screen.getByTestId('plan-form-blocks-empty'))).toMatchObject({ ...BODY, color: uiRoles.inkMuted });
  });

  it('heads the programme\'s sessions in a faint label, names each in bodyStrong, its error in meta, danger', async () => {
    render(
      <ProgrammeFormScreen
        initialForm={{ name: 'Strength block', description: '', plans: [{ id: 'cp1', sourcePlanId: null, title: 'Week 1', scheduleText: '', gymId: null, blocks: [] }] }}
        onSave={jest.fn()}
        saveLabel="Save programme"
      />,
    );
    await act(async () => {});
    const heading = screen.getByText('Sessions (1)');
    expect(style(heading)).toMatchObject({ ...LABEL, color: uiRoles.inkFaint });
    expect(within(heading).queryAllByText('1')).toHaveLength(0);
    expect(style(screen.getByText('Week 1'))).toMatchObject(BODY_STRONG);
    expectFigureInWords(screen.getByText(/· 0 blocks$/), '0');
    await act(async () => fireEvent.press(screen.getByTestId('programme-form-save')));
    expect(style(screen.getByText('Please review errors inside this session.'))).toMatchObject({ ...META, color: uiRoles.danger });
  });

  it('heads the child session editor\'s fields in label, its empty-blocks hint in muted body', async () => {
    render(
      <ProgrammeFormScreen
        initialForm={{ name: 'Strength block', description: '', plans: [{ id: 'cp1', sourcePlanId: null, title: 'Week 1', scheduleText: '', gymId: null, blocks: [] }] }}
        onSave={jest.fn()}
        saveLabel="Save programme"
      />,
    );
    await act(async () => {});
    await act(async () => fireEvent.press(screen.getByTestId('programme-form-plan-1-edit')));
    ['Exercise blocks', 'Schedule (optional)', 'Gym'].forEach((text) =>
      expect(style(screen.getByText(text))).toMatchObject({ ...LABEL, color: uiRoles.inkMuted }),
    );
    expect(style(screen.getByTestId('programme-child-plan-blocks-empty'))).toMatchObject({ ...BODY, color: uiRoles.inkMuted });
  });
});
