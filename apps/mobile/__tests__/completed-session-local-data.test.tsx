/* eslint-disable import/first */

/**
 * The completed-session screen over real data: the production route and its
 * default data client (session snapshot, insights, historical bests, append,
 * delete) over the migrated in-memory SQLite database, seeded through the
 * Maestro harness with the fixtures `exercise-block-history` and
 * `completion-two-prs` (the latter is also what the `ios-data-smoke` share
 * flow loads). Only the native database open, the router, and the
 * native capture/share modules are replaced.
 *
 * `completed-session-detail-screen.test.tsx` keeps the states real data cannot
 * produce: pending/failed/obsolete insight reads, failed writes and loads,
 * double-taps, share failures, and the hardware back handler.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

let mockParams: Record<string, string | undefined> = {};
let mockCanGoBack = true;
const mockStackScreen = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockFocusEffects = new Map<() => void | (() => void), void | (() => void)>();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    dismissTo: jest.fn(),
    canGoBack: () => mockCanGoBack,
  }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => {
      mockFocusEffects.set(callback, callback());
      return () => {
        mockFocusEffects.get(callback)?.();
        mockFocusEffects.delete(callback);
      };
    }, [callback]);
  },
  Stack: {
    Screen: (props: unknown) => {
      mockStackScreen(props);
      return null;
    },
  },
}));

jest.mock('@/src/utils/isDevMode', () => ({ isDevMode: () => true }));

jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn().mockResolvedValue('file:///tmp/boga-session.png'),
  releaseCapture: jest.fn(),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

import CompletedSessionDetailRoute from '../app/completed-session/[sessionId]';
import {
  __resetBodyweightCalculationPreferenceForTests,
  setBodyweightCalculationsEnabled,
} from '@/src/bodyweight/calculation-preference';
import { saveBodyWeightReading } from '@/src/data/bodyweight';
import { upsertLocalGym } from '@/src/data/local-gyms';
import { uiRoles } from '@/components/ui/tokens';
import { exerciseDefinitions, exerciseSets, sessions } from '@/src/data/schema';
import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import type { SessionSetTypeValue } from '@/src/data/set-types';
import { configurePersonalEffortPolicy } from '@/src/config/personal-effort';
import { DEFAULT_PERSONAL_EFFORT_POLICY } from '@/src/exercise-calculations/effort-policy';
import { EXERCISE_BLOCK_HISTORY_FIXTURE } from '@/src/maestro/exercise-block-history-fixture';
import {
  bootLocalApp,
  closeLocalData,
  loadMaestroFixture,
  localDatabase,
  resetLocalData,
} from './helpers/local-data';

const ONE_PR = EXERCISE_BLOCK_HISTORY_FIXTURE.onePrCompletionSessionId;
const NO_PR = EXERCISE_BLOCK_HISTORY_FIXTURE.noPrCompletionSessionId;
const UNMAPPED = EXERCISE_BLOCK_HISTORY_FIXTURE.unmappedCompletionSessionId;
const TWO_PRS = EXERCISE_BLOCK_HISTORY_FIXTURE.twoPrCompletionSessionId;
const ONE_PR_SQUAT = 'maestro_m24_completion_one_pr_squat';
const SQUAT_PR = 'session-completion-pr-seed_barbell_back_squat';

// Let the screen's initial reads (session, insights, bests) land inside act.
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const triggerFocus = () => {
  for (const [callback, cleanup] of mockFocusEffects) {
    cleanup?.();
    mockFocusEffects.set(callback, callback());
  }
};

const openSession = async (
  params: Record<string, string>,
  fixture: 'exercise-block-history' | 'completion-two-prs' = 'exercise-block-history',
  afterSeed?: () => void
) => {
  await loadMaestroFixture(fixture);
  afterSeed?.();
  await bootLocalApp();
  mockParams = params;
  render(<CompletedSessionDetailRoute />);
  // Loaded: the presentation, the detail summary, or one of the missing-session exits.
  await waitFor(() =>
    expect(
      [
        'session-completion-presentation',
        'session-completion-safe-exit',
        'completed-session-detail-summary',
        'view-session-section-sets',
        'completed-session-detail-empty',
      ].some((id) => screen.queryByTestId(id))
    ).toBe(true)
  );
  await settle();
};

const openSets = async () => {
  fireEvent.press(await screen.findByTestId('view-session-section-sets'));
};

// A completed session written through the app's own draft → complete path:
// Barbell Bench Press (mapped) with a warm-up and three working sets, and an
// unmapped Lat Pulldown with one untyped set, 58 minutes at a named gym.
const DESIGN = {
  sessionId: 'design_session',
  bench: 'design_bench',
  pulldown: 'design_pulldown',
  pulldownExerciseId: 'design_unmapped_pulldown',
  gymId: 'design_gym',
} as const;

type SeedSet = {
  weight: string;
  reps: string;
  type: SessionSetTypeValue | null;
  status?: 'planned' | 'unperformed';
};

const toDraftSets = (prefix: string, sets: SeedSet[]) =>
  sets.map(({ weight, reps, type, status }, index) =>
    status === 'planned'
      ? {
          id: `${prefix}_set_${index + 1}`,
          weightValue: '',
          repsValue: '',
          setType: null,
          plannedWeightValue: weight,
          plannedRepsValue: reps,
          plannedSetType: type,
          performanceStatus: 'planned' as const,
        }
      : {
          id: `${prefix}_set_${index + 1}`,
          weightValue: weight,
          repsValue: reps,
          setType: type,
          performanceStatus: status ?? null,
        }
  );

const BENCH_SETS: SeedSet[] = [
  { weight: '135', reps: '8', type: 'warm_up' },
  { weight: '185', reps: '8', type: 'rir_0' },
  { weight: '185', reps: '6', type: 'rir_1' },
  { weight: '185', reps: '5', type: 'rir_3' },
];
const PULLDOWN_SETS: SeedSet[] = [{ weight: '120', reps: '12', type: null }];

const seedDesignSession = async ({
  benchSets = BENCH_SETS,
  pulldownSets = PULLDOWN_SETS,
}: { benchSets?: SeedSet[]; pulldownSets?: SeedSet[] } = {}) => {
  const completedAt = new Date(Date.now() - 60 * 60 * 1000);
  const startedAt = new Date(completedAt.getTime() - 58 * 60 * 1000);
  await upsertLocalGym({ id: DESIGN.gymId, name: 'Westside Barbell Club', now: startedAt });
  localDatabase()
    .insert(exerciseDefinitions)
    .values({
      id: DESIGN.pulldownExerciseId,
      name: 'Lat Pulldown',
      loadInputMode: 'total_load',
      deletedAt: null,
      localDirty: false,
      localUpdatedAtMs: 0,
      createdAt: startedAt,
      updatedAt: startedAt,
    })
    .run();
  const exercises = [
    benchSets.length > 0 && {
      id: DESIGN.bench,
      exerciseDefinitionId: 'seed_barbell_bench_press',
      name: 'Barbell Bench Press',
      sets: toDraftSets(DESIGN.bench, benchSets),
    },
    pulldownSets.length > 0 && {
      id: DESIGN.pulldown,
      exerciseDefinitionId: DESIGN.pulldownExerciseId,
      name: 'Lat Pulldown',
      sets: toDraftSets(DESIGN.pulldown, pulldownSets),
    },
  ].filter((exercise) => exercise !== false);
  await persistSessionDraftSnapshot(
    { sessionId: DESIGN.sessionId, gymId: DESIGN.gymId, startedAt, exercises },
    { now: completedAt }
  );
  await completeSessionDraft(DESIGN.sessionId, { completedAt, now: completedAt });
};

// A completed session the day before the design session, with its exercises.
const seedEarlierDesignSession = async ({ benchSets, pulldownSets }: { benchSets: SeedSet[]; pulldownSets: SeedSet[] }) => {
  const completedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await persistSessionDraftSnapshot(
    {
      sessionId: 'design_earlier',
      gymId: DESIGN.gymId,
      startedAt: new Date(completedAt.getTime() - 45 * 60 * 1000),
      exercises: [
        { id: 'earlier_bench', exerciseDefinitionId: 'seed_barbell_bench_press', name: 'Barbell Bench Press', sets: toDraftSets('earlier_bench', benchSets) },
        { id: 'earlier_pulldown', exerciseDefinitionId: DESIGN.pulldownExerciseId, name: 'Lat Pulldown', sets: toDraftSets('earlier_pulldown', pulldownSets) },
      ],
    },
    { now: completedAt }
  );
  await completeSessionDraft('design_earlier', { completedAt, now: completedAt });
};

const openDesignSession = async (
  params: Record<string, string> = {},
  seed?: Parameters<typeof seedDesignSession>[0]
) => {
  await seedDesignSession(seed);
  await bootLocalApp();
  mockParams = { sessionId: DESIGN.sessionId, ...params };
  render(<CompletedSessionDetailRoute />);
  await waitFor(() =>
    expect(
      ['session-completion-presentation', 'view-session-section-sets', 'completed-session-detail-empty'].some(
        (id) => screen.queryByTestId(id)
      )
    ).toBe(true)
  );
  await settle();
};

const markOnePrDeleted = () => {
  localDatabase().update(sessions).set({ deletedAt: new Date() }).where(eq(sessions.id, ONE_PR)).run();
};

const label = (testID: string) => screen.getByTestId(testID).props.accessibilityLabel;

beforeEach(() => {
  resetLocalData();
  __resetBodyweightCalculationPreferenceForTests();
  mockParams = {};
  mockCanGoBack = true;
  mockStackScreen.mockReset();
  mockPush.mockReset();
  mockReplace.mockReset();
  mockBack.mockReset();
  mockFocusEffects.clear();
});

afterEach(() => {
  closeLocalData();
});

describe('completion presentation over real data', () => {
  it('shows the one-PR session: its record, sets and muscle row, with no pager', async () => {
    await openSession({ sessionId: ONE_PR, presentation: 'completion' });

    expect(await screen.findByTestId(SQUAT_PR)).toBeTruthy();
    expect(screen.getByTestId('session-completion-presentation')).toBeTruthy();
    expect(screen.getByText('Session complete')).toBeTruthy();
    expect(screen.getByText('Personal records')).toBeTruthy();
    expect(screen.queryByTestId('session-completion-pr-pager')).toBeNull();
    expect(screen.getByTestId('session-completion-sets')).toBeTruthy();
    expect(screen.getByTestId('session-completion-muscle-quads')).toBeTruthy();
    expect(screen.getByTestId(`session-completion-exercise-${ONE_PR_SQUAT}`)).toBeTruthy();
  });

  it('shows the two-PR session side by side, with exercise volume and its untagged sets as working sets', async () => {
    await openSession({ sessionId: TWO_PRS, presentation: 'completion' }, 'completion-two-prs');

    expect(await screen.findByTestId(SQUAT_PR)).toBeTruthy();
    expect(screen.getByTestId('session-completion-pr-seed_barbell_bench_press')).toBeTruthy();
    expect(screen.queryByTestId('session-completion-pr-pager')).toBeNull();
    // One fixed heading above the grouping; no subtitle.
    expect(screen.getByText('Volume')).toBeTruthy();
    expect(screen.queryByText('Session vs history')).toBeNull();
    // The squat has completed history in the fixture, so it is compared, not "no history".
    expect(screen.getByTestId('session-completion-exercise-maestro_m24_completion_two_prs_squat')).toHaveTextContent(
      /\d+% (above|below) median|At median/
    );
    // Neither set has an effort; untagged sets are working sets.
    expect(label('session-completion-muscle-quads')).toBe('Quads, 1 set: 1 primary, 0 secondary');
    expect(screen.queryByText('No mapped working sets for this session.')).toBeNull();
    expect(screen.queryByTestId('session-completion-view-muscle-load')).toBeNull();
  });

  it('keeps a no-PR session informational when the catalog read fails, and Done goes to Stats', async () => {
    await openSession({ sessionId: NO_PR, presentation: 'completion', maestroCatalog: 'fail-once' });

    expect(await screen.findByText('Muscle breakdown unavailable.')).toBeTruthy();
    expect(screen.getByText('Session complete')).toBeTruthy();
    expect(screen.queryByText('Personal records')).toBeNull();
    expect(screen.getByTestId('session-completion-muscle-empty-state')).toBeTruthy();
    expect(screen.queryByText('Retry session muscle load')).toBeNull();
    expect(screen.queryByTestId('session-completion-view-muscle-load')).toBeNull();

    fireEvent.press(screen.getByTestId('session-completion-done'));
    expect(mockReplace).toHaveBeenCalledWith('/progress');
  });

  it('says so when no completed set maps to a muscle', async () => {
    await openSession({ sessionId: UNMAPPED, presentation: 'completion' });

    expect(await screen.findByText('No mapped working sets for this session.')).toBeTruthy();
    expect(screen.getByText('Session complete')).toBeTruthy();
    expect(screen.queryByText('Personal records')).toBeNull();
    expect(screen.queryByTestId('session-completion-view-muscle-load')).toBeNull();
  });

  it('offers one safe exit when the session does not exist', async () => {
    await openSession({ sessionId: 'maestro_missing_session', presentation: 'completion' });

    expect(await screen.findByTestId('session-completion-safe-exit')).toBeTruthy();
    expect(screen.queryByTestId('session-completion-done')).toBeNull();
  });
});

describe('completed-session detail over real data', () => {
  it('opens the Summary with the record, switches grouping locally, and lists the sets', async () => {
    await openSession({ sessionId: ONE_PR, presentation: 'summary' });

    expect(await screen.findByTestId(SQUAT_PR)).toBeTruthy();
    expect(screen.getByTestId('view-session-section-summary')).toHaveProp('accessibilityState', {
      selected: true,
    });

    fireEvent.press(screen.getByTestId('session-insight-mode-muscle'));
    expect(await screen.findByTestId('session-completion-muscle-comparison-quads')).toBeTruthy();
    expect(screen.queryByText('Muscle volume')).toBeNull();
    // The share image compares exercises whatever the on-screen grouping.
    fireEvent.press(screen.getByTestId('session-completion-share-session'));
    expect(screen.getByTestId(`session-share-exercise-${ONE_PR_SQUAT}`)).toBeTruthy();
    expect(screen.queryByTestId('session-share-exercise-quads')).toBeNull();
    fireEvent(screen.getByTestId('session-share-preview'), 'accessibilityEscape');
    fireEvent.press(screen.getByTestId('session-insight-mode-exercise'));
    expect(screen.getByTestId(`session-completion-exercise-${ONE_PR_SQUAT}`)).toBeTruthy();

    fireEvent.press(screen.getByTestId('view-session-section-sets'));
    expect(screen.getByTestId(`completed-session-detail-exercise-${ONE_PR_SQUAT}`)).toBeTruthy();
    expect(screen.getByTestId(`completed-session-detail-exercise-${ONE_PR_SQUAT}-record`)).toBeTruthy();
    expect(screen.queryByTestId('session-summary-edit')).toBeNull();
    expect(screen.queryByTestId('session-summary-view-sets')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows no-history and unmapped copy for a session without mapped history', async () => {
    await openSession({ sessionId: UNMAPPED });

    expect(await screen.findByText('No mapped working sets for this session.')).toBeTruthy();
    expect(
      within(screen.getByTestId('session-completion-exercise-maestro_m24_completion_unmapped_exercise'))
        .getByText(/No comparison history yet/)
    ).toBeTruthy();

    fireEvent.press(screen.getByTestId('session-insight-mode-muscle'));
    expect(await screen.findByTestId('session-insight-empty')).toHaveTextContent('No mapped working sets for this session.');
  });

  it('renders the empty state, with a way back, when the session does not exist', async () => {
    await openSession({ sessionId: 'maestro_missing_session' });

    expect(await screen.findByTestId('completed-session-detail-empty')).toBeTruthy();
    expect(screen.getByTestId('completed-session-detail-back')).toBeTruthy();
  });

  it('deletes and undeletes the session in the database, hiding Edit while deleted', async () => {
    await openSession({ sessionId: ONE_PR });
    await screen.findByTestId('completed-session-detail-edit-button');
    const deletedAt = () =>
      localDatabase()
        .select({ deletedAt: sessions.deletedAt })
        .from(sessions)
        .where(eq(sessions.id, ONE_PR))
        .get()?.deletedAt ?? null;

    fireEvent.press(screen.getByTestId('completed-session-detail-options-button'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('completed-session-detail-delete-button'));
    });

    expect(await screen.findByTestId('completed-session-detail-deleted-band')).toBeTruthy();
    expect(screen.queryByTestId('completed-session-detail-edit-button')).toBeNull();
    expect(deletedAt()).not.toBeNull();

    fireEvent.press(screen.getByTestId('completed-session-detail-options-button'));
    expect(screen.getByText('Undelete session')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('completed-session-detail-delete-button'));
    });

    await waitFor(() => expect(screen.queryByTestId('completed-session-detail-deleted-band')).toBeNull());
    expect(screen.getByTestId('completed-session-detail-edit-button')).toBeTruthy();
    expect(deletedAt()).toBeNull();
  });

  it('reads edits back from the database when the screen regains focus', async () => {
    await openSession({ sessionId: ONE_PR });
    await openSets();
    const exerciseCard = await screen.findByTestId(`completed-session-detail-exercise-${ONE_PR_SQUAT}`);
    expect(exerciseCard).toHaveTextContent(/275/);
    expect(exerciseCard).not.toHaveTextContent(/280/);

    localDatabase()
      .update(exerciseSets)
      .set({ weightValue: '280', repsValue: '6' })
      .where(eq(exerciseSets.id, `${ONE_PR_SQUAT}_set`))
      .run();
    act(() => {
      triggerFocus();
    });

    await waitFor(() =>
      expect(screen.getByTestId(`completed-session-detail-exercise-${ONE_PR_SQUAT}`)).toHaveTextContent(
        /280/
      )
    );
  });
});

describe('a session written through the app', () => {
  it('renders loading, then the facts and every performed set in the design language', async () => {
    await seedDesignSession();
    await bootLocalApp();
    mockParams = { sessionId: DESIGN.sessionId };
    render(<CompletedSessionDetailRoute />);

    expect(screen.getByTestId('completed-session-detail-loading')).toBeTruthy();
    await screen.findByTestId('view-session-section-sets');
    // The detail draws its own top bar: no native header.
    expect(mockStackScreen).toHaveBeenLastCalledWith({
      options: { title: 'View Session', headerShown: false },
    });
    // The bar names the session by when it started.
    expect(screen.getByTestId('completed-session-detail-title'))
      .toHaveTextContent(/^(Morning|Afternoon|Evening|Night) training · \d{1,2} [A-Z][a-z]{2}$/);
    expect(screen.getByTestId('completed-session-detail-edit-button')).toBeTruthy();
    expect(label('completed-session-detail-times-start')).toMatch(/^Start \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(label('completed-session-detail-times-duration')).toBe('Duration 58m');
    expect(screen.queryByTestId('completed-session-detail-times-end')).toBeNull();
    expect(label('completed-session-detail-gym')).toBe('Gym Westside Barbell Club');
    expect(label('completed-session-detail-exercises')).toBe('Exercises 2');
    // Working sets only: 185×8 + 185×6 + 185×5 + 120×12, no thousands
    // separator; the 135×8 warm-up is neither a set nor volume.
    expect(label('completed-session-detail-sets')).toBe('Sets 4');
    expect(label('completed-session-detail-volume')).toBe('Volume 4955');
    // The bench comparison reads the same working sets: 185×8 + 185×6 + 185×5.
    expect(
      (await screen.findByTestId(`session-completion-exercise-${DESIGN.bench}`)).findByProps({ accessible: true })
        .props.accessibilityLabel
    ).toMatch(/Session volume 3515 kg/);

    fireEvent.press(screen.getByTestId('view-session-section-sets'));
    const bench = within(screen.getByTestId(`completed-session-detail-exercise-${DESIGN.bench}`));
    expect(bench.getByText('Barbell Bench Press')).toBeTruthy();
    // Three working sets; the warm-up keeps its row.
    expect(bench.getByTestId(`completed-session-detail-exercise-${DESIGN.bench}-count`)).toHaveTextContent('3 sets');
    for (const type of ['W-Up', 'RIR 0', 'RIR 1', 'RIR 3']) {
      expect(bench.getByText(type)).toBeTruthy();
    }
    expect(
      bench.getByTestId(`completed-session-detail-exercise-${DESIGN.bench}-set-1-values`)
    ).toHaveTextContent('135.0 × 8');
    expect(label(`completed-session-detail-exercise-${DESIGN.bench}-set-2-vol`)).toBe('Vol 1480');
    // The warm-up row keeps its own volume, though the summary leaves it out.
    expect(label(`completed-session-detail-exercise-${DESIGN.bench}-set-1-vol`)).toBe('Vol 1080');
    const pulldown = within(screen.getByTestId(`completed-session-detail-exercise-${DESIGN.pulldown}`));
    expect(pulldown.getByTestId(`completed-session-detail-exercise-${DESIGN.pulldown}-count`)).toHaveTextContent(
      '1 set'
    );
    // No effort reads as an em dash, not `-`.
    expect(pulldown.getByText('—')).toBeTruthy();
    // No collapse, no set table, no tags, and no Append.
    expect(screen.queryByText('Weight')).toBeNull();
    expect(screen.queryByText('Append')).toBeNull();
    expect(screen.queryByTestId('completed-session-detail-deleted-band')).toBeNull();
  });

  // A session restored from the server has no stored weight; the private
  // reading that applies to it stays off the screen in either preference.
  it.each([false, true])(
    'shows no body-weight UI when a reading applies (calculations %s)',
    async (calculations) => {
      await seedDesignSession();
      await act(async () => {
        await setBodyweightCalculationsEnabled(calculations);
        await saveBodyWeightReading({ weightValue: '82', measuredAt: new Date(Date.now() - 3 * 60 * 60 * 1000) });
      });
      await bootLocalApp();
      mockParams = { sessionId: DESIGN.sessionId };
      render(<CompletedSessionDetailRoute />);
      await screen.findByTestId('completed-session-detail-summary');
      await settle();
      expect(screen.queryByText(/Body weight|BW \+|82(\.0)? ?kg/i)).toBeNull();

      fireEvent.press(screen.getByTestId('view-session-section-sets'));
      await screen.findByTestId(`completed-session-detail-exercise-${DESIGN.bench}`);
      expect(screen.queryByText(/Body weight|BW \+|82(\.0)? ?kg/i)).toBeNull();
    }
  );

  it('shows confirmed sets, blank weight as zero, and leaves out exercises with none', async () => {
    await openDesignSession(
      {},
      {
        benchSets: [
          ...BENCH_SETS,
          { weight: '', reps: '5', type: 'rir_0' },
          { weight: '-1', reps: '5', type: 'rir_0' },
          { weight: '500', reps: '10', type: 'rir_0', status: 'unperformed' },
        ],
        pulldownSets: [{ weight: '120', reps: '12', type: null, status: 'planned' }],
      }
    );
    fireEvent.press(screen.getByTestId('view-session-section-sets'));

    // The warm-up keeps its row but is no set.
    expect(screen.getByTestId(`completed-session-detail-exercise-${DESIGN.bench}-count`)).toHaveTextContent(
      '4 sets'
    );
    expect(screen.getByText('0.0 × 5')).toBeTruthy();
    expect(screen.queryByText('-1.0 × 5')).toBeNull();
    expect(screen.queryByText('500.0 × 10')).toBeNull();
    expect(screen.queryByTestId(`completed-session-detail-exercise-${DESIGN.pulldown}`)).toBeNull();
    expect(label('completed-session-detail-sets')).toBe('Sets 4');
  });

  it("counts Sets under the account's effort policy, not the fixed group rule", async () => {
    // By default the technique set is no working set (`Sets 4`); this account counts it.
    configurePersonalEffortPolicy({
      workingSetEfforts: [...DEFAULT_PERSONAL_EFFORT_POLICY.workingSetEfforts, 'technique'],
      volumeEfforts: DEFAULT_PERSONAL_EFFORT_POLICY.volumeEfforts,
    });
    try {
      await openDesignSession(
        { presentation: 'completion' },
        { benchSets: [...BENCH_SETS, { weight: '100', reps: '5', type: 'technique' }] }
      );
      expect(label('session-completion-sets')).toBe('Sets 5');
    } finally {
      configurePersonalEffortPolicy(DEFAULT_PERSONAL_EFFORT_POLICY);
    }
  });

  it('renders the no-PR completion hierarchy and hides ordinary detail actions', async () => {
    await openDesignSession({ presentation: 'completion' });

    // Its own top bar, `Session complete` · Done, and no back gesture.
    expect(mockStackScreen).toHaveBeenLastCalledWith({
      options: { title: 'Session complete', headerShown: false, gestureEnabled: false },
    });
    expect(within(screen.getByTestId('session-completion-top-bar')).getByText('Session complete')).toBeTruthy();
    expect(label('session-completion-duration')).toBe('Duration 58m');
    expect(label('session-completion-exercises')).toBe('Exercises 2');
    // One set count, the working sets: no separate `Working` fact.
    expect(label('session-completion-sets')).toBe('Sets 4');
    expect(screen.queryByTestId('session-completion-working-sets')).toBeNull();
    expect(label('session-completion-gym')).toBe('Gym Westside Barbell Club');
    expect(screen.queryByTestId('session-completion-personal-records')).toBeNull();
    expect(label('session-completion-muscle-chest')).toBe('Chest, 3 sets: 3 primary, 0 secondary');
    // Bench maps triceps as secondary: its 3 sets count half, with no primary sets.
    expect(label('session-completion-muscle-triceps')).toBe('Triceps, 1.5 sets: 0 primary, 3 secondary');
    expect(screen.getByTestId('session-completion-muscle-triceps')).toHaveTextContent('Triceps—31.5');
    // The card's title is a header; the table carries no formula footnote.
    expect(screen.getByRole('header', { name: 'Sets by muscle' })).toBeTruthy();
    expect(screen.queryByText('Sets = primary + ½ secondary')).toBeNull();
    // Each comparison card counts working sets only, with no second count.
    expect(screen.getByText('3 sets')).toBeTruthy();
    // The untagged pulldown set is a working set.
    expect(screen.getByText('1 set')).toBeTruthy();
    expect(screen.queryByText(/· \d+ working/)).toBeNull();
    expect(screen.queryByText('Numbers in brackets are working sets.')).toBeNull();
    expect(screen.queryByTestId('session-completion-view-muscle-load')).toBeNull();
    expect(screen.queryByTestId('completed-session-detail-action-bar')).toBeNull();
    expect(screen.queryByText('Append')).toBeNull();

    fireEvent.press(screen.getByTestId('session-completion-done'));
    expect(mockReplace).toHaveBeenCalledWith('/progress');

    // The share image shows one set count, the working sets.
    fireEvent.press(screen.getByTestId('session-completion-share-session'));
    const shareCard = within(screen.getByTestId('session-share-card'));
    expect(shareCard.getByText('58m · 2 exercises · 4 sets')).toBeTruthy();
    expect(shareCard.queryByText(/working/)).toBeNull();
  });

  it('restores section and grouping on return from editing, re-reading facts, sets and comparisons', async () => {
    await openDesignSession();
    fireEvent.press(screen.getByTestId('session-insight-mode-muscle'));
    const chestBefore = (await screen.findByLabelText(/^Chest,.*Session volume \d+/)).props.accessibilityLabel;
    fireEvent.press(screen.getByTestId('view-session-section-sets'));
    fireEvent.press(screen.getByTestId('completed-session-detail-edit-button'));
    expect(mockPush).toHaveBeenCalledWith(`/session/${DESIGN.sessionId}`);

    await upsertLocalGym({ id: DESIGN.gymId, name: 'Edited gym' });
    localDatabase()
      .update(exerciseSets)
      .set({ weightValue: '200', repsValue: '10' })
      .where(eq(exerciseSets.id, `${DESIGN.bench}_set_2`))
      .run();
    act(() => {
      triggerFocus();
    });

    expect(await screen.findByText('Edited gym')).toBeTruthy();
    expect(screen.getByTestId('view-session-section-sets')).toHaveProp('accessibilityState', { selected: true });
    expect(
      screen.getByTestId(`completed-session-detail-exercise-${DESIGN.bench}-set-2-values`)
    ).toHaveTextContent('200.0 × 10');
    // 200×10 + 185×6 + 185×5 + 120×12.
    expect(label('completed-session-detail-volume')).toBe('Volume 5475');
    fireEvent.press(screen.getByTestId('view-session-section-summary'));
    expect(screen.getByTestId('session-insight-mode-muscle')).toHaveProp('accessibilityState', { selected: true });
    await waitFor(() =>
      expect(screen.getByLabelText(/^Chest,.*Session volume \d+/).props.accessibilityLabel).not.toBe(chestBefore)
    );
  });

  it('resets section and grouping when a different session opens', async () => {
    await openDesignSession();
    fireEvent.press(screen.getByTestId('session-insight-mode-muscle'));
    fireEvent.press(screen.getByTestId('view-session-section-sets'));

    await loadMaestroFixture('exercise-block-history');
    mockParams = { sessionId: ONE_PR };
    screen.rerender(<CompletedSessionDetailRoute />);

    await screen.findByTestId(`session-completion-exercise-${ONE_PR_SQUAT}`);
    expect(screen.getByTestId('view-session-section-summary')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId('session-insight-mode-exercise')).toHaveProp('accessibilityState', { selected: true });
  });

  it('says so when a completed session has no exercises, in completion and in detail', async () => {
    await openDesignSession({ presentation: 'completion' }, { benchSets: [], pulldownSets: [] });

    expect(label('session-completion-sets')).toBe('Sets 0');
    expect(screen.queryByTestId('session-completion-muscle-breakdown')).toBeNull();
    expect(screen.queryByTestId('session-completion-view-muscle-load')).toBeNull();
    expect(screen.getByTestId('session-completion-done')).toBeTruthy();

    screen.unmount();
    mockParams = { sessionId: DESIGN.sessionId };
    render(<CompletedSessionDetailRoute />);
    expect(await screen.findByText('No working sets to compare.')).toBeTruthy();
    expect(label('completed-session-detail-sets')).toBe('Sets 0');
    fireEvent.press(screen.getByTestId('view-session-section-sets'));
    expect(screen.getByTestId('completed-session-detail-no-exercises')).toHaveTextContent(
      'No exercises logged in this session.'
    );
  });

  it('Edit opens the session view; back returns, or goes to Progress when there is nowhere to return', async () => {
    await openDesignSession();

    fireEvent.press(screen.getByTestId('completed-session-detail-edit-button'));
    expect(mockPush).toHaveBeenCalledWith(`/session/${DESIGN.sessionId}`);
    fireEvent.press(screen.getByTestId('completed-session-detail-back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    mockCanGoBack = false;
    fireEvent.press(screen.getByTestId('completed-session-detail-back'));
    expect(mockReplace).toHaveBeenCalledWith('/progress');
  });
});

describe('records, sharing and deleted sessions over real data', () => {
  it.each(['completion', 'summary'] as const)(
    'shows both PRs at once and previews the whole session image in %s',
    async (presentation) => {
      await openSession({ sessionId: TWO_PRS, presentation }, 'completion-two-prs');

      const squat = await screen.findByTestId(SQUAT_PR);
      expect(screen.getByTestId('session-completion-pr-seed_barbell_bench_press')).toBeTruthy();
      expect(screen.queryByTestId('session-completion-pr-pager')).toBeNull();
      expect(screen.queryByText('Share PR')).toBeNull();
      // Every record in plain words, without `kg` or "est.".
      expect(
        within(squat).getByLabelText(/^Barbell Back Squat, 2 records: 1RM \d+\.\d and Top weight, \d+\.\d × \d+$/)
      ).toBeTruthy();

      fireEvent.press(screen.getByTestId('session-completion-share-session'));
      expect(screen.getByTestId('session-share-preview')).toBeTruthy();
      expect(screen.getByTestId('session-share-card-pr-seed_barbell_back_squat')).toBeTruthy();
      expect(screen.getByTestId('session-share-card-pr-seed_barbell_bench_press')).toBeTruthy();
      expect(screen.getAllByTestId(/^session-share-exercise-/).length).toBeGreaterThan(0);
      // The gym stays private.
      expect(within(screen.getByTestId('session-share-card')).queryByText('Maestro Block History Gym')).toBeNull();
      expect(screen.getByText('Nothing is shared until you choose an app.')).toBeTruthy();
    }
  );

  it('bands the set whose 1RM and Weight beat every earlier session on one line', async () => {
    await openSession({ sessionId: ONE_PR });
    await openSets();

    const band = await screen.findByTestId(`completed-session-detail-exercise-${ONE_PR_SQUAT}-record`);
    expect(band).toHaveTextContent(/^New 1RM · \d+\.\d \+ top weight275\.0 × 5$/);
    expect(label(`completed-session-detail-exercise-${ONE_PR_SQUAT}`)).toMatch(
      /^Barbell Back Squat, 1 set, new 1RM \d+\.\d and top weight 275\.0 × 5$/
    );
  });

  it('shows a Weight record beside a 1RM record on completion, the share image and the set cards', async () => {
    await seedDesignSession();
    // The day before: Bench 180 × 12 (a higher 1RM, a lighter Weight), Pulldown 100 × 12.
    await seedEarlierDesignSession({
      benchSets: [{ weight: '180', reps: '12', type: 'rir_0' }],
      pulldownSets: [{ weight: '100', reps: '12', type: null }],
    });
    await bootLocalApp();
    mockParams = { sessionId: DESIGN.sessionId, presentation: 'completion' };
    render(<CompletedSessionDetailRoute />);

    const bench = await screen.findByTestId('session-completion-pr-seed_barbell_bench_press');
    const pulldown = screen.getByTestId(`session-completion-pr-${DESIGN.pulldownExerciseId}`);
    // Its 185 × 8 is heavier than 180 × 12 but its 1RM 236.2 is below 254.7: a
    // Weight record; its 3515 volume beats 2160 too.
    expect(within(bench).getByLabelText('Barbell Bench Press, 2 records: Top weight, 185.0 × 8; Volume 3515')).toBeTruthy();
    expect(within(bench).getByTestId('session-completion-pr-seed_barbell_bench_press-line-1')).toHaveTextContent('Top weight185.0 × 8');
    expect(within(bench).getByTestId('session-completion-pr-seed_barbell_bench_press-line-2')).toHaveTextContent('Volume 3515');
    // A plain list: no `record` emphasis.
    expect(within(bench).getByText('185.0 × 8')).toHaveStyle({ color: uiRoles.ink });
    expect(within(pulldown).getByLabelText(/^Lat Pulldown, 3 records: 1RM \d+\.\d and Top weight, 120\.0 × 12; Volume 1440$/)).toBeTruthy();

    fireEvent.press(screen.getByTestId('session-completion-share-session'));
    expect(within(screen.getByTestId('session-share-card-personal-records')).getByText('2 new records')).toBeTruthy();
    expect(screen.getByTestId('session-share-card-pr-seed_barbell_bench_press')).toHaveTextContent(
      'Barbell Bench PressTop weight185.0 × 8  1RM 236.2'
    );
    expect(screen.getByTestId(`session-share-card-pr-${DESIGN.pulldownExerciseId}-kind`)).toHaveTextContent('1RM');

    // The detail's set cards band the same records, a line each.
    screen.unmount();
    mockParams = { sessionId: DESIGN.sessionId };
    render(<CompletedSessionDetailRoute />);
    await openSets();
    expect(await screen.findByTestId(`completed-session-detail-exercise-${DESIGN.bench}-record-1`))
      .toHaveTextContent('New top weight185.0 × 8');
    expect(screen.getByTestId(`completed-session-detail-exercise-${DESIGN.bench}-record-2`))
      .toHaveTextContent('New volume record · 3515');
    expect(label(`completed-session-detail-exercise-${DESIGN.bench}`)).toBe(
      'Barbell Bench Press, 3 sets, new top weight 185.0 × 8, new volume record 3515'
    );
    expect(screen.getByTestId(`completed-session-detail-exercise-${DESIGN.pulldown}-record-1`))
      .toHaveTextContent(/^New 1RM · \d+\.\d \+ top weight120\.0 × 12$/);
  });

  it('opens a deleted session with its band, in Summary, and restores Edit and comparisons on undelete', async () => {
    await openSession({ sessionId: ONE_PR, presentation: 'summary' }, 'exercise-block-history', markOnePrDeleted);

    expect(await screen.findByTestId('completed-session-detail-deleted-band')).toBeTruthy();
    // A deleted session shows no comparisons; they come back with a re-read on undelete.
    expect(screen.queryByTestId(`session-completion-exercise-${ONE_PR_SQUAT}`)).toBeNull();
    expect(screen.getByTestId('view-session-section-summary')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.queryByTestId('completed-session-detail-edit-button')).toBeNull();

    fireEvent.press(screen.getByTestId('completed-session-detail-options-button'));
    expect(screen.getByText('Undelete session')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('completed-session-detail-delete-button'));
    });

    expect(await screen.findByTestId('completed-session-detail-edit-button')).toBeTruthy();
    expect(screen.queryByTestId('completed-session-detail-deleted-band')).toBeNull();
    expect(await screen.findByTestId(`session-completion-exercise-${ONE_PR_SQUAT}`)).toBeTruthy();
  });

  it('offers one safe exit to Stats when a completion target was deleted', async () => {
    await openSession({ sessionId: ONE_PR, presentation: 'completion' }, 'exercise-block-history', markOnePrDeleted);

    expect(screen.getByTestId('completed-session-detail-empty')).toBeTruthy();
    expect(screen.queryByTestId('session-completion-presentation')).toBeNull();
    fireEvent.press(screen.getByTestId('session-completion-safe-exit'));
    expect(mockReplace).toHaveBeenCalledWith('/progress');
  });
});
