import { act, screen } from '@testing-library/react-native';

import { EXERCISE_PAGE_LOADING_DELAY_MS, ExercisePageLoading } from '@/components/exercise-page/exercise-page-loading';

import { renderWithTheme } from './helpers/theme';

describe('exercise page loading state', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('stays blank for a quick load, so an in-place exercise switch never flashes a spinner', () => {
    renderWithTheme(<ExercisePageLoading />);

    expect(screen.getByTestId('exercise-page-state')).toBeOnTheScreen();
    expect(screen.queryByText('Loading…')).toBeNull();
    act(() => jest.advanceTimersByTime(EXERCISE_PAGE_LOADING_DELAY_MS - 1));
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('shows the spinner once a load has taken noticeably long', () => {
    renderWithTheme(<ExercisePageLoading />);

    act(() => jest.advanceTimersByTime(EXERCISE_PAGE_LOADING_DELAY_MS));

    expect(screen.getByText('Loading…')).toBeOnTheScreen();
    expect(screen.getByTestId('exercise-page-state')).toBeOnTheScreen();
  });
});
