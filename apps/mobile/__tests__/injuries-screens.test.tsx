/* eslint-disable import/first */

import * as mockReact from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./helpers/local-data').localDataBootstrapModule()
);

let mockSearchParams: Record<string, string> = {};
const mockScreenOptions: { title?: string }[] = [];

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
  useLocalSearchParams: () => mockSearchParams,
  useNavigation: () => ({ setOptions: jest.fn() }),
  useRouter: () => ({ dismissTo: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  Stack: {
    Screen: ({ options }: { options: { title?: string } }) => {
      mockScreenOptions.push(options);
      return null;
    },
  },
}));

import InjuriesRoute from '../app/injuries';
import { InjuriesSettingsRow } from '@/components/injuries/settings-row';
import { InjuryEditorSheet } from '@/components/injuries/injury-editor-sheet';
import * as injuriesData from '@/src/data/injuries';
import { saveInjury, listInjuries } from '@/src/data/injuries';
import { muscleGroups } from '@/src/data/schema';
import { bootLocalApp, closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';
import { renderWithTheme } from './helpers/theme';

const seedMuscleGroups = async () => {
  await bootLocalApp();
};

const renderInjuries = async (params: Record<string, string> = {}) => {
  mockSearchParams = params;
  renderWithTheme(<InjuriesRoute />);
  await screen.findByTestId('injuries-screen');
};

beforeEach(() => {
  resetLocalData();
  mockSearchParams = {};
  mockScreenOptions.length = 0;
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  closeLocalData();
});

describe('Injuries Screen (app/injuries.tsx)', () => {
  it('shows empty state when no active injuries exist', async () => {
    await seedMuscleGroups();
    await renderInjuries();

    expect(await screen.findByTestId('injuries-empty-active')).toBeTruthy();
    expect(screen.getByText('No active injuries. Stay healthy!')).toBeTruthy();
  });

  it('renders active injuries grouped by severity', async () => {
    await seedMuscleGroups();
    const t0 = new Date(1730000000000);
    const t1 = new Date(1730000010000);

    const acute = await saveInjury({
      label: 'Patellar tendon flare-up',
      muscleGroupId: 'quads',
      side: 'right',
      status: 'acute',
      painScore: 7,
      startedAt: t0,
    });

    const managing = await saveInjury({
      label: 'Shoulder impingement',
      muscleGroupId: 'rotator_cuff',
      side: 'left',
      status: 'managing',
      painScore: 4,
      startedAt: t1,
    });

    await renderInjuries();

    expect(await screen.findByText('Patellar tendon flare-up')).toBeTruthy();
    expect(screen.getByText('Shoulder impingement')).toBeTruthy();
    expect(screen.getByText('Right Quads')).toBeTruthy();
    expect(screen.getByText('Left Rotator Cuff')).toBeTruthy();
    expect(screen.getByText('7/10 Severe / Cannot load')).toBeTruthy();
    expect(screen.getByText('4/10 Moderate / Impairs movement')).toBeTruthy();

    expect(screen.getByTestId(`injuries-active-row-${acute.id}`)).toBeTruthy();
    expect(screen.getByTestId(`injuries-active-row-${managing.id}`)).toBeTruthy();
  });

  it('logs a new injury with alias matching and saves it to the list', async () => {
    await seedMuscleGroups();
    await renderInjuries();

    // Tap + Log injury
    fireEvent.press(screen.getByTestId('injuries-log-button'));

    // The editor sheet should be visible
    expect(await screen.findByTestId('injuries-screen-editor')).toBeTruthy();

    // Type "patellar tendon" -> should auto-match "Quadriceps"
    fireEvent.changeText(screen.getByTestId('injury-form-label'), 'patellar tendon irritation');

    // Select Side: Right
    fireEvent.press(screen.getByText('Right'));

    // Save
    fireEvent.press(screen.getByTestId('injury-form-save-button'));

    // Verify row appeared in active injuries
    expect(await screen.findByText('patellar tendon irritation')).toBeTruthy();
    expect(screen.getByText('Right Quads')).toBeTruthy();

    const stored = await listInjuries({ status: 'active' });
    expect(stored.length).toBe(1);
    expect(stored[0].label).toBe('patellar tendon irritation');
    expect(stored[0].muscleGroupId).toBe('quads');
    expect(stored[0].side).toBe('right');
  });

  it('edits an existing injury and marks it as resolved', async () => {
    await seedMuscleGroups();
    const created = await saveInjury({
      label: 'Left rotator cuff pain',
      muscleGroupId: 'rotator_cuff',
      side: 'left',
      status: 'acute',
      painScore: 6,
    });

    await renderInjuries();

    // Tap the injury row to open editor
    fireEvent.press(await screen.findByTestId(`injuries-active-row-${created.id}`));

    // Tap "Mark as resolved"
    expect(await screen.findByTestId('injury-form-resolve-button')).toBeTruthy();
    fireEvent.press(screen.getByTestId('injury-form-resolve-button'));

    // Row moves to resolved history section
    expect(await screen.findByText('Resolved history (1)')).toBeTruthy();
    expect(screen.getByTestId(`injuries-resolved-row-${created.id}`)).toBeTruthy();
    expect(screen.getByTestId('injuries-empty-active')).toBeTruthy();
  });

  it('shows error panel on load failure and retries successfully', async () => {
    await seedMuscleGroups();
    jest
      .spyOn(injuriesData, 'listInjuries')
      .mockRejectedValueOnce(new Error('disk failure'));

    await renderInjuries();

    expect(await screen.findByTestId('injuries-error-panel')).toBeTruthy();

    // Retry
    fireEvent.press(screen.getByText('Retry'));
    expect(await screen.findByTestId('injuries-empty-active')).toBeTruthy();
  });
});

describe('InjuriesSettingsRow in Settings', () => {
  it('displays None active when no injuries exist', async () => {
    await seedMuscleGroups();
    renderWithTheme(<InjuriesSettingsRow />);
    expect(await screen.findByText('None active')).toBeTruthy();
  });

  it('displays count when active injuries exist', async () => {
    await seedMuscleGroups();
    await saveInjury({ label: 'Sprained ankle', status: 'acute' });
    renderWithTheme(<InjuriesSettingsRow />);
    expect(await screen.findByText('1 active')).toBeTruthy();
  });
});

describe('Reusable InjuryEditorSheet pre-filled context', () => {
  it('pre-fills muscle and label when triggered with context', async () => {
    await seedMuscleGroups();
    const onDismiss = jest.fn();
    const onSaved = jest.fn();

    renderWithTheme(
      <InjuryEditorSheet
        initialLabel="Squat"
        initialMuscleGroupId="quads"
        initialSide="left"
        onDismiss={onDismiss}
        onSaved={onSaved}
        visible
      />
    );

    expect(screen.getByDisplayValue('Squat')).toBeTruthy();
    expect(screen.getByText('Quads')).toBeTruthy();
  });
});
