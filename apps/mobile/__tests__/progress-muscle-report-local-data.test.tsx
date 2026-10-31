/* eslint-disable import/first */

/**
 * Progress under the user's muscles over real data ([[muscle.report-groups]]):
 * the production Progress and history routes, repositories and catalogue cache
 * over the migrated in-memory SQLite database, with Broad (Calves off) written
 * onto the `muscle_groups` rows as the Settings choice does. The pure
 * transform is `muscle-report.test.ts`; the 3D projection, helpers and
 * report re-keying are `progress-muscle-report.test.ts`. This suite proves
 * the user's setup reaches each Progress surface.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockPush = jest.fn();
let mockSearchParams: Record<string, string | string[]> = {};
let mockScreenOptions: { title?: string; headerRight?: () => mockReact.ReactNode } = {};

jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options: typeof mockScreenOptions }) => {
      mockScreenOptions = options;
      return mockReact.createElement(mockReact.Fragment, null, options.headerRight?.());
    },
  },
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  useIsFocused: () => true,
  useLocalSearchParams: () => mockSearchParams,
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
}));
jest.mock('@/src/auth', () => ({ useAuth: () => ({ user: null }) }));

import ProgressHistoryRoute from '../app/progress-history';
import StatsRoute from '../app/(tabs)/stats-history';
import * as statsRepository from '@/src/data/stats';
import { EXERCISE_BLOCK_HISTORY_FIXTURE } from '@/src/maestro/exercise-block-history-fixture';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import { __resetAccountLocalPreferencesForTests, ensureAccountLocalPreferencesLoaded, setAccountLocalPreferenceAccount } from '@/src/preferences/account-local';
import { updatePreferences } from '@/src/preferences/hooks';
import { calendarWeekBounds } from '@/src/utils/calendar-weeks';
import { projectMuscleBody } from '@/components/stats/muscle-body-projection';
import { chooseBroadLocally } from './helpers/broad-muscle-report';
import { closeLocalData, loadMaestroFixture, localDataClient, resetLocalData } from './helpers/local-data';
import { waitForGone } from './helpers/wait-for-gone';

const SQUAT = EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId;
const BENCH = EXERCISE_BLOCK_HISTORY_FIXTURE.secondaryExerciseId;
const ENTRIES_OF_BROAD = ['serratus_anterior', 'back_upper', 'traps_upper', 'traps_lower', 'brachialis', 'abs_obliques',
  'adductors', 'hip_flexors', 'hamstrings', 'hip_abductors', 'tibialis_anterior'];
const UNTRACKED = ['rotator_cuff', 'forearms_grip', 'spinal_erectors'];
const TRACKED_BROAD = ['chest', 'delts_front', 'delts_lateral', 'delts_rear', 'back_lats', 'biceps', 'triceps', 'abs_rectus', 'quads', 'glutes_max'];

const choose = async (setup: 'broad' | 'detailed') => {
  await loadMaestroFixture('exercise-block-history');
  if (setup === 'broad') chooseBroadLocally(localDataClient(), ['calves', ...UNTRACKED]);
  await act(async () => invalidateExerciseCatalogCache());
};

const renderProgress = async (breakdown: 'muscle' | 'exercise') => {
  mockSearchParams = { period: '7', breakdown };
  render(<StatsRoute />);
  await screen.findByTestId('stats-history-screen');
};

const muscleBlocks = () => screen.queryAllByTestId(/^stats-muscle-block-/).map(row => String(row.props.testID).replace('stats-muscle-block-', ''));
const familyHeaders = (prefix: string) => screen.queryAllByTestId(new RegExp(`^${prefix}`)).map(row => row.props.children);
const now = (id: string) => Number(screen.getByTestId(`stats-muscle-row-${id}-now`).props.children);

beforeEach(async () => {
  resetLocalData();
  mockPush.mockClear();
  mockSearchParams = {};
  mockScreenOptions = {};
  __resetAccountLocalPreferencesForTests();
  setAccountLocalPreferenceAccount('A', true);
  await ensureAccountLocalPreferencesLoaded();
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'performance', 'queueMicrotask', 'hrtime'] });
  jest.setSystemTime(new Date('2026-10-03T12:00:00Z'));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  closeLocalData();
});

describe('Progress muscle list under Broad', () => {
  it('lists the ten tracked muscles, with no merged or untracked entry and Calves off', async () => {
    await choose('broad');
    await renderProgress('muscle');
    await waitFor(() => expect(muscleBlocks().length).toBeGreaterThan(0));
    expect([...muscleBlocks()].sort()).toEqual([...TRACKED_BROAD].sort());
    for (const hidden of [...ENTRIES_OF_BROAD, ...UNTRACKED, 'calves']) {
      expect(screen.queryByTestId(`stats-muscle-block-${hidden}`)).toBeNull();
    }
    expect(screen.getByLabelText('Open Back history')).toBeTruthy();
    expect(screen.getByLabelText('Open Glutes & Hams history')).toBeTruthy();
    expect(screen.queryByText('Lats')).toBeNull();
  });

  it('leaves the entries Broad does not merge as muscles of their own until the user switches them off', async () => {
    await loadMaestroFixture('exercise-block-history');
    chooseBroadLocally(localDataClient());
    await act(async () => invalidateExerciseCatalogCache());
    await renderProgress('muscle');
    await waitFor(() => expect(muscleBlocks().length).toBe(14));
    expect(muscleBlocks()).toEqual(expect.arrayContaining(['rotator_cuff', 'forearms_grip', 'spinal_erectors', 'calves']));
    expect(muscleBlocks()).not.toContain('serratus_anterior');
  });

  it('retains each Broad muscle’s original shares without reallocating hidden work', async () => {
    await choose('broad');
    await renderProgress('muscle');
    await waitFor(() => expect(now('quads')).toBeGreaterThan(0));
    // 7 squat sets: Quads counts its Primary 7 alone; Glutes & Hams' Secondary 3.5 shows as 3.
    expect(now('quads')).toBe(7);
    expect(now('glutes_max')).toBe(3);
  });

  it('shows a family header only above two or more muscles and lists headerless muscles first', async () => {
    await choose('broad');
    await renderProgress('muscle');
    await waitFor(() => expect(muscleBlocks().length).toBe(10));
    expect(familyHeaders('stats-family-header-')).toEqual(['Shoulders', 'Arms', 'Legs']);
    // Within a section the rows follow the figures; the sections follow the family order.
    const blocks = muscleBlocks();
    expect(blocks.slice(0, 3)).toEqual(['chest', 'back_lats', 'abs_rectus']);
    expect(new Set(blocks.slice(3, 6))).toEqual(new Set(['delts_front', 'delts_lateral', 'delts_rear']));
    expect(new Set(blocks.slice(6, 8))).toEqual(new Set(['biceps', 'triceps']));
    expect(new Set(blocks.slice(8))).toEqual(new Set(['quads', 'glutes_max']));
  });

  it('keeps every entry and every family header under Detailed', async () => {
    await choose('detailed');
    await renderProgress('muscle');
    await waitFor(() => expect(muscleBlocks().length).toBe(25));
    expect(muscleBlocks()).toContain('serratus_anterior');
    expect(familyHeaders('stats-family-header-')).toEqual(['Chest', 'Shoulders', 'Back', 'Arms', 'Core', 'Legs', 'Lower Legs']);
  });

  it('shades the 3D body with the ten muscles only', async () => {
    await choose('broad');
    act(() => updatePreferences({ progressMuscleLayout: '3d' }));
    await renderProgress('muscle');
    await screen.findByTestId('stats-muscle-body-card');
    const targets = screen.getAllByTestId(/^stats-muscle-body-target-/).map(row => String(row.props.testID).replace('stats-muscle-body-target-', ''));
    expect([...targets].sort()).toEqual([...TRACKED_BROAD].sort());
  });
});

// A tap on the rendered 3D body, on the facet of one anatomy entry seen from behind.
const tapEntryOnBody = async (entry: string) => {
  const viewport = screen.getByTestId('stats-muscle-body-viewport');
  fireEvent(viewport, 'layout', { nativeEvent: { layout: { width: 280, height: 280 } } });
  fireEvent.press(screen.getByTestId('stats-muscle-body-angle-back'));
  const detailed = projectMuscleBody({ angleDeg: 180, width: 280, height: 280, scores: new Map() });
  const facet = detailed.triangles.filter(tri => tri.muscleGroupId === entry).at(-1)!;
  const tap = viewport.props.gesture.gestures.find((gesture: { type: string }) => gesture.type === 'tap');
  await act(async () => {
    tap.handlers.onEnd({ x: (facet.x0 + facet.x1 + facet.x2) / 3, y: (facet.y0 + facet.y1 + facet.y2) / 3 });
  });
};

describe('The 3D body on the Progress screens under Broad', () => {
  it.each(['back_upper', 'traps_lower'])('selects Back when its %s facet is tapped in Muscle 3D', async entry => {
    await choose('broad');
    act(() => updatePreferences({ progressMuscleLayout: '3d' }));
    await renderProgress('muscle');
    await screen.findByTestId('stats-muscle-body-card');
    await tapEntryOnBody(entry);
    expect(screen.getByTestId('stats-muscle-body-selected')).toHaveTextContent('Back');
    expect(screen.getByTestId('stats-contributions')).toBeTruthy();
  });

  it('does not select an untracked facet when tapped in Muscle 3D', async () => {
    await choose('broad');
    act(() => updatePreferences({ progressMuscleLayout: '3d' }));
    await renderProgress('muscle');
    await screen.findByTestId('stats-muscle-body-card');
    const initialSelected = screen.getByTestId('stats-muscle-body-selected').props.children;
    await tapEntryOnBody('spinal_erectors');
    expect(screen.getByTestId('stats-muscle-body-selected')).toHaveTextContent(initialSelected);
    expect(screen.queryByText('Spinal erectors')).toBeNull();
  });

  it('selects the entry itself under Detailed', async () => {
    await choose('detailed');
    act(() => updatePreferences({ progressMuscleLayout: '3d' }));
    await renderProgress('muscle');
    await screen.findByTestId('stats-muscle-body-card');
    await tapEntryOnBody('back_upper');
    expect(screen.getByTestId('stats-muscle-body-selected')).toHaveTextContent('Upper back');
  });
});

describe('Progress exercise list under Broad', () => {
  const sectionHeaders = () => familyHeaders('stats-exercise-family-header-');
  const exerciseOrder = () => screen.getAllByTestId(/^stats-exercise-name-/).map(row => String(row.props.testID).replace('stats-exercise-name-', ''));

  it('sections by the user’s muscles: no header over the single-muscle Chest family, whose exercises come first', async () => {
    await choose('broad');
    await renderProgress('exercise');
    await screen.findByTestId(`stats-exercise-row-${SQUAT}`);
    expect(sectionHeaders()).toEqual(['Legs', 'Other']);
    expect(exerciseOrder().indexOf(BENCH)).toBeLessThan(exerciseOrder().indexOf(SQUAT));
  });

  it('keeps every family header under Detailed', async () => {
    await choose('detailed');
    await renderProgress('exercise');
    await screen.findByTestId(`stats-exercise-row-${SQUAT}`);
    expect(sectionHeaders()).toEqual(['Chest', 'Legs', 'Other']);
  });

  it('searches by muscle name, finding the squat as Quads and never by a merged entry', async () => {
    await choose('broad');
    await renderProgress('exercise');
    await screen.findByTestId(`stats-exercise-row-${SQUAT}`);
    fireEvent.changeText(screen.getByTestId('stats-search-input'), 'quads');
    expect(exerciseOrder()).toEqual([SQUAT]);
    fireEvent.changeText(screen.getByTestId('stats-search-input'), 'serratus');
    expect(screen.queryAllByTestId(/^stats-exercise-name-/)).toHaveLength(0);
  });
});

describe('Muscle history under Broad', () => {
  const open = async (params: Record<string, string>) => {
    mockSearchParams = params;
    render(<ProgressHistoryRoute />);
    await screen.findByTestId('progress-history-screen');
  };
  const history = (muscleGroupIds: string[]) => statsRepository.computeSelectedMuscleHistoryEffort({
    ...calendarWeekBounds(8), muscleGroupIds, timeZone: 'UTC',
  });

  it('opens on a merged muscle under its name and counts its entries together', async () => {
    await choose('broad');
    // The squat's Quads primary and Adductors secondary are one muscle: each set counts once, as Primary.
    const broadQuads = await history(['quads']);
    const squatSets = broadQuads.daily.reduce((sum, day) => sum + day.workingSetCount, 0);
    expect(squatSets).toBeGreaterThan(0);
    await open({ muscleGroupId: 'glutes_max' });
    await waitFor(() => expect(mockScreenOptions.title).toBe('Glutes & Hams'));
    await waitForGone(() => screen.queryByTestId('stats-muscle-history-loading'));
    const hams = await history(['glutes_max']);
    expect(hams.daily.reduce((sum, day) => sum + day.workingSetCount, 0)).toBeCloseTo(squatSets / 2, 10);
  });

  it('opens a merged muscle whose anchor entry alone is switched off, as the Progress list shows it', async () => {
    await loadMaestroFixture('exercise-block-history');
    chooseBroadLocally(localDataClient(), [], ['back_lats']);
    // The squat also trains Upper back: the muscle's only tracked entry.
    localDataClient().prepare("INSERT INTO exercise_muscle_mappings (id, exercise_definition_id, muscle_group_id, weight, role) VALUES ('squat_upper_back', ?, 'back_upper', 1, 'primary')").run(SQUAT);
    await act(async () => invalidateExerciseCatalogCache());
    await open({ muscleGroupId: 'back_lats' });
    await waitFor(() => expect(mockScreenOptions.title).toBe('Back'));
    expect(screen.queryByTestId('progress-history-unavailable')).toBeNull();
    const back = await history(['back_lats']);
    expect(back.daily.reduce((sum, day) => sum + day.workingSetCount, 0)).toBeGreaterThan(0);
  });

  it('adds Broad entry shares on the same days as Detailed', async () => {
    await choose('broad');
    const broad = await history(['quads']);
    localDataClient().prepare('UPDATE muscle_groups SET report_group = NULL, tracked = 1').run();
    const detailed = await history(['quads']);
    // Broad Quads counts at its strongest role: Adductors' Secondary adds nothing.
    expect(broad.daily.map(day => day.dateKey)).toEqual(detailed.daily.map(day => day.dateKey));
    for (let index = 0; index < broad.daily.length; index += 1) {
      expect(broad.daily[index].workingSetCount).toBeCloseTo(detailed.daily[index].workingSetCount, 10);
    }
  });

  it.each(['serratus_anterior', 'back_upper', 'forearms_grip', 'calves'])(
    'has no history page for %s, which the user does not have', async entry => {
      await choose('broad');
      const read = jest.spyOn(statsRepository, 'computeSelectedMuscleHistoryEffort');
      await open({ muscleGroupId: entry });
      await waitFor(() => expect(screen.getByTestId('progress-history-unavailable')).toBeTruthy());
      expect(read).not.toHaveBeenCalled();
    });

  it('links an exercise to the muscles the user has, once each', async () => {
    await choose('broad');
    await open({ exerciseDefinitionId: SQUAT });
    await waitFor(() => expect(mockScreenOptions.title).toMatch(/Squat/));
    fireEvent.press(screen.getByTestId('progress-history-options-button'));
    const links = screen.getAllByTestId(/^progress-history-muscle-/).map(row => String(row.props.testID).replace('progress-history-muscle-', ''));
    expect(links).toEqual(['quads', 'glutes_max']);
  });
});
