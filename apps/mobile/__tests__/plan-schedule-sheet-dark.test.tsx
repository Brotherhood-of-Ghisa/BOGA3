import { screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { PlanScheduleSheet } from '@/components/session-planner/plan-schedule-sheet';
import { DEFAULT_APPEARANCE } from '@/components/ui/theme-presets';

import { renderWithTheme, switchTheme } from './helpers/theme';

// The native picker takes the mode the app is drawn in, not a fixed light.
describe('PlanScheduleSheet in a dark theme', () => {
  const originalPlatform = Platform.OS;

  afterEach(async () => {
    Platform.OS = originalPlatform;
    await switchTheme(DEFAULT_APPEARANCE);
  });

  it('draws the iOS picker dark, and light again when the theme goes back', async () => {
    Platform.OS = 'ios';
    await switchTheme({ ...DEFAULT_APPEARANCE, mode: 'dark' });
    renderWithTheme(<PlanScheduleSheet currentSchedule={null} onConfirm={jest.fn()} onDismiss={jest.fn()} visible />);
    expect(screen.getByTestId('plan-schedule-picker-native').props.themeVariant).toBe('dark');

    await switchTheme({ ...DEFAULT_APPEARANCE, mode: 'light' });
    expect(screen.getByTestId('plan-schedule-picker-native').props.themeVariant).toBe('light');
  });
});
