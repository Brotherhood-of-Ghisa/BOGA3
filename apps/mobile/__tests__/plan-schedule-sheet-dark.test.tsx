/* eslint-disable import/first */

// A dark launch: `tokens.ts` as `theme-launch.ts` resolves it when Dark is
// chosen. The native picker takes the launch's mode, not a fixed light.
jest.mock('@/components/ui/tokens', () => {
  const actual = jest.requireActual('@/components/ui/tokens');
  const { defaultThemeSeeds, generateRoles } = jest.requireActual('@/components/ui/theme');
  return { ...actual, uiMode: 'dark', uiRoles: generateRoles(defaultThemeSeeds, 'dark') };
});

import { render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { PlanScheduleSheet } from '@/components/session-planner/plan-schedule-sheet';

describe('PlanScheduleSheet in a dark launch', () => {
  const originalPlatform = Platform.OS;

  afterEach(() => {
    Platform.OS = originalPlatform;
  });

  it('draws the iOS picker dark', () => {
    Platform.OS = 'ios';
    render(<PlanScheduleSheet currentSchedule={null} onConfirm={jest.fn()} onDismiss={jest.fn()} visible />);
    expect(screen.getByTestId('plan-schedule-picker-native').props.themeVariant).toBe('dark');
  });
});
