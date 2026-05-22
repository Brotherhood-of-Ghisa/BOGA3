import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  default as StatsRoute,
  StatsScreenShell,
  formatDelta,
} from '../(tabs)/stats-history';
import type { StatsSummary } from '@/src/data';

jest.mock('@/src/data', () => ({
  computeStatsSummary: jest.fn(),
}));

jest.mock('expo-router', () => {
  const mockPush = jest.fn();
  let latestFocusCallback: (() => void) | null = null;

  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (callback: () => void) => {
      latestFocusCallback = callback;
    },
    __mockPush: mockPush,
    __triggerFocus: () => {
      latestFocusCallback?.();
    },
  };
});

const { computeStatsSummary: mockComputeStatsSummary } = jest.requireMock('@/src/data') as {
  computeStatsSummary: jest.Mock;
};

const { __mockPush: mockPush, __triggerFocus: triggerFocus } = jest.requireMock(
  'expo-router'
) as { __mockPush: jest.Mock; __triggerFocus: () => void };

const buildSummary = (overrides: Partial<StatsSummary> = {}): StatsSummary => ({
  current: {
    period: {
      days: 7,
      start: new Date('2026-05-12T15:00:00.000Z'),
      end: new Date('2026-05-19T15:00:00.000Z'),
    },
    totals: {
      sessionCount: 4,
      totalSets: 38,
      muscleFamilies: [
        {
          familyName: 'Chest',
          sortOrder: 10,
          sessionCount: 3,
          totalWeight: 1800,
          muscles: [
            {
              muscleGroupId: 'chest',
              displayName: 'Chest',
              familyName: 'Chest',
              sortOrder: 10,
              sessionCount: 3,
              totalWeight: 1800,
            },
          ],
        },
        {
          familyName: 'Shoulders',
          sortOrder: 20,
          sessionCount: 2,
          totalWeight: 900,
          muscles: [
            {
              muscleGroupId: 'front_delts',
              displayName: 'Front Delts',
              familyName: 'Shoulders',
              sortOrder: 20,
              sessionCount: 2,
              totalWeight: 600,
            },
            {
              muscleGroupId: 'rear_delts',
              displayName: 'Rear Delts',
              familyName: 'Shoulders',
              sortOrder: 21,
              sessionCount: 1,
              totalWeight: 300,
            },
          ],
        },
        {
          familyName: 'Legs',
          sortOrder: 40,
          sessionCount: 0,
          totalWeight: 0,
          muscles: [
            {
              muscleGroupId: 'calves',
              displayName: 'Calves',
              familyName: 'Legs',
              sortOrder: 40,
              sessionCount: 0,
              totalWeight: 0,
            },
          ],
        },
      ],
    },
  },
  previous: {
    period: {
      days: 7,
      start: new Date('2026-05-05T15:00:00.000Z'),
      end: new Date('2026-05-12T15:00:00.000Z'),
    },
    totals: {
      sessionCount: 3,
      totalSets: 30,
      muscleFamilies: [
        {
          familyName: 'Chest',
          sortOrder: 10,
          sessionCount: 2,
          totalWeight: 1500,
          muscles: [
            {
              muscleGroupId: 'chest',
              displayName: 'Chest',
              familyName: 'Chest',
              sortOrder: 10,
              sessionCount: 2,
              totalWeight: 1500,
            },
          ],
        },
        {
          familyName: 'Shoulders',
          sortOrder: 20,
          sessionCount: 1,
          totalWeight: 600,
          muscles: [
            {
              muscleGroupId: 'front_delts',
              displayName: 'Front Delts',
              familyName: 'Shoulders',
              sortOrder: 20,
              sessionCount: 1,
              totalWeight: 400,
            },
            {
              muscleGroupId: 'rear_delts',
              displayName: 'Rear Delts',
              familyName: 'Shoulders',
              sortOrder: 21,
              sessionCount: 1,
              totalWeight: 200,
            },
          ],
        },
        {
          familyName: 'Legs',
          sortOrder: 40,
          sessionCount: 0,
          totalWeight: 0,
          muscles: [
            {
              muscleGroupId: 'calves',
              displayName: 'Calves',
              familyName: 'Legs',
              sortOrder: 40,
              sessionCount: 0,
              totalWeight: 0,
            },
          ],
        },
      ],
    },
  },
  ...overrides,
});

beforeEach(() => {
  mockComputeStatsSummary.mockReset();
  mockPush.mockReset();
});

describe('formatDelta', () => {
  it('renders em-dash when both periods are zero', () => {
    expect(formatDelta(0, 0)).toEqual({ text: '—', tone: 'neutral' });
  });

  it('renders the "new" tone when previous was zero but current is positive', () => {
    expect(formatDelta(4, 0)).toEqual({ text: '+4 (new)', tone: 'new' });
  });

  it('renders positive delta with absolute and percent change', () => {
    expect(formatDelta(8, 6)).toEqual({
      text: '+2 (+33%)',
      tone: 'positive',
    });
  });

  it('renders negative delta with minus sign and percent change', () => {
    const delta = formatDelta(3, 6);
    expect(delta.tone).toBe('negative');
    expect(delta.text).toContain('3');
    expect(delta.text).toContain('50%');
  });
});

describe('StatsScreenShell', () => {
  it('renders summary cards with deltas', () => {
    render(
      <StatsScreenShell
        summary={buildSummary()}
        periodDays={7}
        onSelectPeriod={jest.fn()}
        onPressSessionsCard={jest.fn()}
        isLoading={false}
        errorMessage={null}
      />
    );

    const sessionsCard = screen.getByTestId('stats-card-sessions');
    expect(sessionsCard).toHaveTextContent(/Sessions/);
    expect(sessionsCard).toHaveTextContent(/4/);
    expect(sessionsCard).toHaveTextContent(/\+1 \(\+33%\)/);

    const setsCard = screen.getByTestId('stats-card-sets');
    expect(setsCard).toHaveTextContent(/38/);
    expect(setsCard).toHaveTextContent(/\+8 \(\+27%\)/);
  });

  it('renders family cards with sessions + total weight, including a previous-period delta', () => {
    render(
      <StatsScreenShell
        summary={buildSummary()}
        periodDays={7}
        onSelectPeriod={jest.fn()}
        onPressSessionsCard={jest.fn()}
        isLoading={false}
        errorMessage={null}
      />
    );

    // Shoulders: current 2 sessions / 900, previous 1 / 600 → +1 (+100%), +300 (+50%).
    const shouldersSessions = screen.getByTestId('stats-family-sessions-shoulders');
    expect(shouldersSessions).toHaveTextContent(/2/);
    expect(shouldersSessions).toHaveTextContent(/\+1 \(\+100%\)/);

    const shouldersWeight = screen.getByTestId('stats-family-weight-shoulders');
    expect(shouldersWeight).toHaveTextContent(/900/);
    expect(shouldersWeight).toHaveTextContent(/\+300 \(\+50%\)/);

    // Nested muscle row also carries its own delta.
    const frontDeltsSessions = screen.getByTestId('stats-muscle-sessions-front_delts');
    expect(frontDeltsSessions).toHaveTextContent(/\+1 \(\+100%\)/);
  });

  it('collapses a family whose only muscle matches the family name', () => {
    render(
      <StatsScreenShell
        summary={buildSummary()}
        periodDays={7}
        onSelectPeriod={jest.fn()}
        onPressSessionsCard={jest.fn()}
        isLoading={false}
        errorMessage={null}
      />
    );

    // Chest contains only one muscle named "Chest" — the nested row must be hidden.
    expect(screen.getByTestId('stats-family-card-chest')).toBeTruthy();
    expect(screen.queryByTestId('stats-muscle-row-chest')).toBeNull();

    // Shoulders has multiple muscles → nested rows still render.
    expect(screen.getByTestId('stats-muscle-row-front_delts')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-row-rear_delts')).toBeTruthy();

    // Untrained family with a single non-matching muscle still expands.
    expect(screen.getByTestId('stats-family-card-legs')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-row-calves')).toHaveTextContent(/Calves/);
  });

  it('invokes onSelectPeriod when switching period chips', () => {
    const onSelectPeriod = jest.fn();
    render(
      <StatsScreenShell
        summary={buildSummary()}
        periodDays={7}
        onSelectPeriod={onSelectPeriod}
        onPressSessionsCard={jest.fn()}
        isLoading={false}
        errorMessage={null}
      />
    );

    fireEvent.press(screen.getByTestId('stats-period-chip-30'));
    expect(onSelectPeriod).toHaveBeenCalledWith(30);
  });

  it('shows an error panel when summary load fails', () => {
    render(
      <StatsScreenShell
        summary={null}
        periodDays={7}
        onSelectPeriod={jest.fn()}
        onPressSessionsCard={jest.fn()}
        isLoading={false}
        errorMessage="Boom"
      />
    );

    expect(screen.getByTestId('stats-error-state')).toHaveTextContent(/Boom/);
  });

  it('invokes onPressSessionsCard when the Sessions card is tapped', () => {
    const onPress = jest.fn();
    render(
      <StatsScreenShell
        summary={buildSummary()}
        periodDays={7}
        onSelectPeriod={jest.fn()}
        onPressSessionsCard={onPress}
        isLoading={false}
        errorMessage={null}
      />
    );

    fireEvent.press(screen.getByTestId('stats-card-sessions'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('StatsRoute', () => {
  it('loads the summary on focus and re-loads when the period changes', async () => {
    mockComputeStatsSummary
      .mockResolvedValueOnce(buildSummary())
      .mockResolvedValueOnce(
        buildSummary({
          current: {
            ...buildSummary().current,
            totals: {
              sessionCount: 12,
              totalSets: 100,
              muscleFamilies: buildSummary().current.totals.muscleFamilies,
            },
          },
        })
      );

    render(<StatsRoute />);

    await act(async () => {
      triggerFocus();
    });

    await waitFor(() => {
      expect(mockComputeStatsSummary).toHaveBeenCalledWith({ periodDays: 7 });
    });
    await waitFor(() => {
      expect(screen.getByTestId('stats-card-sessions')).toHaveTextContent(/4/);
    });

    fireEvent.press(screen.getByTestId('stats-period-chip-30'));

    await waitFor(() => {
      expect(mockComputeStatsSummary).toHaveBeenLastCalledWith({ periodDays: 30 });
    });
    await waitFor(() => {
      expect(screen.getByTestId('stats-card-sessions')).toHaveTextContent(/12/);
    });
  });

  it('navigates to the sessions list when the Sessions card is tapped', async () => {
    mockComputeStatsSummary.mockResolvedValue(buildSummary());

    render(<StatsRoute />);

    await act(async () => {
      triggerFocus();
    });

    await waitFor(() => {
      expect(screen.getByTestId('stats-card-sessions')).toHaveTextContent(/4/);
    });

    fireEvent.press(screen.getByTestId('stats-card-sessions'));
    expect(mockPush).toHaveBeenCalledWith('/sessions');
  });
});
