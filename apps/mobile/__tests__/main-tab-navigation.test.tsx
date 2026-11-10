/* eslint-disable import/first */

/**
 * How pages over the tabs reach a tab and the workout in progress: a tab press
 * closes them with no animation (a tab switch, never Back), and the workout
 * opens on Train rather than as another page.
 */

import { renderHook } from '@testing-library/react-native';

const mockRouter = { dismissTo: jest.fn(), push: jest.fn() };
const mockSetOptions = jest.fn();
let mockAccountRevision = 0;
jest.mock('@/src/preferences/account-local', () => ({
  getAccountLocalPreferenceAccountRevision: () => mockAccountRevision,
}));

jest.mock('expo-router', () => ({
  useNavigation: () => ({ setOptions: mockSetOptions }),
  useRouter: () => mockRouter,
}));

import {
  subscribeOpenedWorkout,
  useOpenActiveWorkout,
  useOpenMainTabFromPage,
} from '@/components/navigation/use-open-main-tab';
import { ACTIVE_WORKOUT_HREF } from '@/src/navigation/active-session-entry';

beforeEach(() => {
  jest.clearAllMocks();
  mockAccountRevision += 1;
  subscribeOpenedWorkout(() => undefined)();
});

describe('useOpenMainTabFromPage', () => {
  it('drops the page animation before closing to the tab, so the press reads as a tab switch', () => {
    const frames: FrameRequestCallback[] = [];
    const frameSpy = jest
      .spyOn(global, 'requestAnimationFrame')
      .mockImplementation((callback) => frames.push(callback));
    const { result } = renderHook(() => useOpenMainTabFromPage());

    result.current('today');

    expect(mockSetOptions).toHaveBeenCalledWith({ animation: 'none' });
    // The close waits a frame for the option to reach the native screen.
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();
    frames.forEach((frame) => frame(0));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/today');
    frameSpy.mockRestore();
  });
});

describe('useOpenActiveWorkout', () => {
  it('delivers the latest selection once when Train mounts after the opener', () => {
    const { result } = renderHook(() => useOpenActiveWorkout());
    result.current('older');
    result.current('chosen');
    const shown = jest.fn();
    subscribeOpenedWorkout(shown)();
    subscribeOpenedWorkout(shown)();
    expect(shown.mock.calls).toEqual([['chosen']]);
  });

  it('drops a queued selection when the account changes before Train mounts', () => {
    const { result } = renderHook(() => useOpenActiveWorkout());
    result.current('other-account-workout');
    mockAccountRevision += 1;
    const shown = jest.fn();
    subscribeOpenedWorkout(shown)();
    expect(shown).not.toHaveBeenCalled();
  });

  it('tells Train which workout, then closes the pages on top onto it', () => {
    const order: string[] = [];
    const unsubscribe = subscribeOpenedWorkout((sessionId) => order.push(`shown ${sessionId}`));
    mockRouter.dismissTo.mockImplementation((href: string) => order.push(`closed to ${href}`));
    const { result } = renderHook(() => useOpenActiveWorkout());

    result.current('s1');
    unsubscribe();
    result.current('s2');

    expect(ACTIVE_WORKOUT_HREF).toBe('/train');
    expect(order).toEqual(['shown s1', 'closed to /train', 'closed to /train']);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});
