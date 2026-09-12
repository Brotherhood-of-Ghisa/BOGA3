import { fireEvent, render, screen } from '@testing-library/react-native';

import { SessionMuscleLoad } from '@/components/session-recorder/session-muscle-load';
import type { CurrentSessionMuscleSummary } from '@/src/session-insights';

const mappedSummary: CurrentSessionMuscleSummary = {
  state: 'mapped',
  performedSetCount: 3,
  workingSetCount: 2,
  mappedSetCount: 2,
  unmappedSetCount: 1,
  contributingMuscleCount: 2,
  muscles: [
    {
      id: 'chest',
      displayName: 'Chest',
      familyName: 'Chest',
      sortOrder: 0,
      weightedVolume: 1200,
      relativeVolume: 1,
    },
    {
      id: 'triceps',
      displayName: 'Triceps',
      familyName: 'Arms',
      sortOrder: 1,
      weightedVolume: 375.5,
      relativeVolume: 0.312916,
    },
  ],
};

const unmappedSummary: CurrentSessionMuscleSummary = {
  state: 'unmapped',
  performedSetCount: 1,
  workingSetCount: 0,
  mappedSetCount: 0,
  unmappedSetCount: 1,
  contributingMuscleCount: 0,
  muscles: [],
};

describe('SessionMuscleLoad', () => {
  it('stays absent until performed work exists', () => {
    render(
      <SessionMuscleLoad
        catalogState="ready"
        performedSetCount={0}
        summary={null}
        visible={false}
        workingSetCount={0}
        onRetry={jest.fn()}
      />
    );

    expect(screen.queryByTestId('session-muscle-load-row')).toBeNull();
    expect(screen.queryByTestId('session-muscle-load-sheet')).toBeNull();
  });

  it('shows counts and leading muscles, then exposes exact accessible values in the sheet', () => {
    render(
      <SessionMuscleLoad
        catalogState="ready"
        performedSetCount={3}
        summary={mappedSummary}
        visible
        workingSetCount={2}
        onRetry={jest.fn()}
      />
    );

    expect(screen.getByTestId('session-muscle-load-row-status')).toHaveTextContent(
      '2 muscles · 3 sets (2 working)'
    );
    expect(screen.getByText('Chest · Triceps')).toBeTruthy();

    fireEvent.press(screen.getByTestId('session-muscle-load-row'));

    expect(screen.getByTestId('session-muscle-load-sheet')).toBeTruthy();
    expect(screen.getByText('1,200 weighted kg·reps')).toBeTruthy();
    expect(screen.getByText('375.5 weighted kg·reps')).toBeTruthy();
    expect(
      screen.getByLabelText("Triceps: 375.5 weighted kg reps; 31 percent of this session's maximum.")
    ).toBeTruthy();
    expect(screen.getByTestId('session-muscle-load-partial-note')).toHaveTextContent(
      '1 performed set has no eligible muscle mapping.'
    );

    fireEvent.press(screen.getByLabelText('Close session muscle load'));
    expect(screen.queryByTestId('session-muscle-load-sheet')).toBeNull();
  });

  it('distinguishes confirmed unmapped work from the pre-confirmation state', () => {
    render(
      <SessionMuscleLoad
        catalogState="ready"
        performedSetCount={1}
        summary={unmappedSummary}
        visible
        workingSetCount={0}
        onRetry={jest.fn()}
      />
    );

    expect(screen.getByTestId('session-muscle-load-row-status')).toHaveTextContent(
      'No mapped muscle load · 1 set (0 working)'
    );

    fireEvent.press(screen.getByTestId('session-muscle-load-row'));
    expect(screen.getByText('The performed exercises do not currently contribute to muscle analytics.')).toBeTruthy();
  });

  it('keeps catalog failures retryable from both compact and detail states', () => {
    const retry = jest.fn();
    render(
      <SessionMuscleLoad
        catalogState="error"
        performedSetCount={1}
        summary={null}
        visible
        workingSetCount={1}
        onRetry={retry}
      />
    );

    expect(screen.getByTestId('session-muscle-load-row-status')).toHaveTextContent(
      'Unavailable · 1 set (1 working)'
    );
    fireEvent.press(screen.getByLabelText('Retry session muscle load'));
    expect(retry).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('session-muscle-load-row'));
    expect(screen.getByText('Muscle load unavailable')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Retry session muscle load from details'));
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it('closes and clears an open sheet as soon as the final performed set is reversed', () => {
    const rendered = render(
      <SessionMuscleLoad
        catalogState="ready"
        performedSetCount={3}
        summary={mappedSummary}
        visible
        workingSetCount={2}
        onRetry={jest.fn()}
      />
    );
    fireEvent.press(screen.getByTestId('session-muscle-load-row'));
    expect(screen.getByTestId('session-muscle-load-sheet')).toBeTruthy();

    rendered.rerender(
      <SessionMuscleLoad
        catalogState="ready"
        performedSetCount={0}
        summary={null}
        visible={false}
        workingSetCount={0}
        onRetry={jest.fn()}
      />
    );
    expect(screen.queryByTestId('session-muscle-load-row')).toBeNull();
    expect(screen.queryByTestId('session-muscle-load-sheet')).toBeNull();

    rendered.rerender(
      <SessionMuscleLoad
        catalogState="ready"
        performedSetCount={3}
        summary={mappedSummary}
        visible
        workingSetCount={2}
        onRetry={jest.fn()}
      />
    );
    expect(screen.getByTestId('session-muscle-load-row')).toBeTruthy();
    expect(screen.queryByTestId('session-muscle-load-sheet')).toBeNull();
  });
});
