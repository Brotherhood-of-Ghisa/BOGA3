import { fireEvent, render, screen } from '@testing-library/react-native';

import { InjuryBadge } from '@/components/injuries/injury-badge';
import { InjurySubstitutionSheet } from '@/components/injuries/injury-substitution-sheet';
import { InjuryWarningBanner } from '@/components/injuries/injury-warning-banner';
import { SkipExerciseDialog } from '@/components/injuries/skip-exercise-dialog';
import { SessionExerciseCard } from '@/components/session-view/session-exercise-card';
import type { InjuryView } from '@/src/data/injuries';
import type { InjuryWarning } from '@/src/injuries/injury-warning-engine';
import {
  clearSessionInjuryDismissals,
  useSessionInjuryWarnings,
} from '@/src/injuries/use-session-injury-warnings';
import type { SessionViewExerciseCard } from '@/src/session-recorder/session-view-model';
import { renderWithTheme } from './helpers/theme';

const mockCatalogExercises = [
  {
    id: 'seed_leg_press',
    name: 'Leg Press',
    bodyweightContribution: 0,
    splitByGym: false,
    restTimerSec: null,
    deletedAt: null,
    mappings: [{ id: 'm1', muscleGroupId: 'quads', weight: 1, role: 'primary' as const }],
  },
  {
    id: 'seed_dumbbell_goblet_squats',
    name: 'Dumbbell Goblet Squats',
    bodyweightContribution: 0,
    splitByGym: false,
    restTimerSec: null,
    deletedAt: null,
    mappings: [{ id: 'm2', muscleGroupId: 'quads', weight: 1, role: 'primary' as const }],
  },
  {
    id: 'seed_machine_hack_squats',
    name: 'Machine Hack Squats',
    bodyweightContribution: 0,
    splitByGym: false,
    restTimerSec: null,
    deletedAt: null,
    mappings: [{ id: 'm3', muscleGroupId: 'quads', weight: 1, role: 'primary' as const }],
  },
  {
    id: 'seed_leg_extensions',
    name: 'Leg Extensions',
    bodyweightContribution: 0,
    splitByGym: false,
    restTimerSec: null,
    deletedAt: null,
    mappings: [{ id: 'm4', muscleGroupId: 'quads', weight: 1, role: 'primary' as const }],
  },
];

jest.mock('@/src/exercise-catalog/cache', () => ({
  ...jest.requireActual('@/src/exercise-catalog/cache'),
  useExerciseCatalog: () => ({
    status: 'ready',
    exercises: mockCatalogExercises,
    muscleGroups: [],
  }),
}));

const mockInjury: InjuryView = {
  id: 'inj-acute-1',
  muscleGroupId: 'quads',
  muscleGroupName: 'Quadriceps',
  side: 'left',
  status: 'acute',
  painScore: 7,
  label: 'Left Quad Strain',
  notes: 'Sharp pull on third set',
  contraindications: 'Avoid deep knee flexion beyond 90 degrees',
  startedAt: new Date(2026, 10, 10),
  resolvedAt: null,
  createdAt: new Date(2026, 10, 10),
  updatedAt: new Date(2026, 10, 10),
};

const mockWarning: InjuryWarning = {
  severity: 'acute',
  injury: mockInjury,
  matchingMuscles: ['quads'],
  daysSinceOnset: 3,
  onsetText: '3 days ago',
  contraindicationsText: mockInjury.contraindications,
  isDismissed: false,
};

describe('injury workout UI components', () => {
  beforeEach(() => {
    clearSessionInjuryDismissals();
  });

  describe('InjuryWarningBanner', () => {
    it('renders injury label, onset, pain score, and contraindications', () => {
      const onSwap = jest.fn();
      const onDismiss = jest.fn();

      renderWithTheme(
        <InjuryWarningBanner
          onDismiss={onDismiss}
          onSwap={onSwap}
          testID="test-warning-banner"
          warning={mockWarning}
        />
      );

      expect(screen.getByText('Left Quad Strain')).toBeTruthy();
      expect(screen.getByText(/3 days ago/)).toBeTruthy();
      expect(screen.getByText(/Pain 7\/10/)).toBeTruthy();
      expect(screen.getByText('Avoid deep knee flexion beyond 90 degrees')).toBeTruthy();
    });

    it('triggers onSwap when Swap exercise is pressed', () => {
      const onSwap = jest.fn();
      const onDismiss = jest.fn();

      renderWithTheme(
        <InjuryWarningBanner
          onDismiss={onDismiss}
          onSwap={onSwap}
          warning={mockWarning}
        />
      );

      fireEvent.press(screen.getByTestId('injury-warning-swap'));
      expect(onSwap).toHaveBeenCalledTimes(1);
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it('triggers onDismiss when Dismiss for this session is pressed', () => {
      const onSwap = jest.fn();
      const onDismiss = jest.fn();

      renderWithTheme(
        <InjuryWarningBanner
          onDismiss={onDismiss}
          onSwap={onSwap}
          warning={mockWarning}
        />
      );

      fireEvent.press(screen.getByTestId('injury-warning-dismiss'));
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(onSwap).not.toHaveBeenCalled();
    });
  });

  describe('InjuryBadge', () => {
    it('renders managing status badge', () => {
      renderWithTheme(<InjuryBadge severity="managing" testID="test-badge-managing" />);
      expect(screen.getByText('Managing')).toBeTruthy();
    });

    it('renders monitoring status badge', () => {
      renderWithTheme(<InjuryBadge severity="monitoring" testID="test-badge-monitoring" />);
      expect(screen.getByText('Monitoring')).toBeTruthy();
    });

    it('renders acute badge and handles press', () => {
      const onPress = jest.fn();
      renderWithTheme(
        <InjuryBadge
          label="Left Hamstring"
          onPress={onPress}
          severity="acute"
          testID="test-badge-acute"
        />
      );
      expect(screen.getByText('Left Hamstring')).toBeTruthy();
      fireEvent.press(screen.getByTestId('test-badge-acute'));
      expect(onPress).toHaveBeenCalledTimes(1);
    });
  });

  describe('InjurySubstitutionSheet', () => {
    it('renders curated joint-friendly substitutions and handles selection', async () => {
      const onSelect = jest.fn();
      const onDismiss = jest.fn();
      const onBrowse = jest.fn();

      renderWithTheme(
        <InjurySubstitutionSheet
          currentExercise={{
            id: 'seed_back_squat',
            name: 'Barbell Back Squat',
            mappings: [{ muscleGroupId: 'quads', role: 'primary' }],
          }}
          onDismiss={onDismiss}
          onOpenFullCatalogue={onBrowse}
          onSelect={onSelect}
          visible
        />
      );

      // Verify curated header and options
      expect(await screen.findByText('Recommended Joint-Friendly Alternatives')).toBeTruthy();
      expect(screen.getByText('Leg Press')).toBeTruthy();
      expect(screen.getByText('Removes axial spine load while training quads and glutes')).toBeTruthy();

      // Selecting curated alternative
      fireEvent.press(screen.getByTestId('substitute-curated-seed_leg_press'));
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Leg Press' })
      );

      // Browse all button
      fireEvent.press(screen.getByTestId('substitute-browse-all'));
      expect(onBrowse).toHaveBeenCalledTimes(1);
    });
  });

  describe('SkipExerciseDialog', () => {
    it('offers Discomfort reason and triggers check-in sheet launch', () => {
      const onDismiss = jest.fn();
      const onConfirmSkip = jest.fn();
      const onReportDiscomfort = jest.fn();

      renderWithTheme(
        <SkipExerciseDialog
          exerciseName="Barbell Back Squat"
          onConfirmSkip={onConfirmSkip}
          onDismiss={onDismiss}
          onReportDiscomfort={onReportDiscomfort}
          visible
        />
      );

      expect(screen.getByText('Why are you skipping Barbell Back Squat?')).toBeTruthy();
      expect(screen.getByText('Discomfort / Injury flare-up')).toBeTruthy();

      fireEvent.press(screen.getByTestId('skip-reason-discomfort'));
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(onConfirmSkip).toHaveBeenCalledWith('discomfort');
      expect(onReportDiscomfort).toHaveBeenCalledTimes(1);
    });

    it('handles non-discomfort skip reason without reporting', () => {
      const onDismiss = jest.fn();
      const onConfirmSkip = jest.fn();
      const onReportDiscomfort = jest.fn();

      renderWithTheme(
        <SkipExerciseDialog
          exerciseName="Barbell Bench Press"
          onConfirmSkip={onConfirmSkip}
          onDismiss={onDismiss}
          onReportDiscomfort={onReportDiscomfort}
          visible
        />
      );

      fireEvent.press(screen.getByTestId('skip-reason-equipment'));
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(onConfirmSkip).toHaveBeenCalledWith('equipment');
      expect(onReportDiscomfort).not.toHaveBeenCalled();
    });
  });

  describe('SessionExerciseCard injury warning indicator', () => {
    const baseCard: SessionViewExerciseCard = {
      id: 'se-1',
      name: 'Barbell Back Squat',
      doneCount: 2,
      totalCount: 3,
      rows: [],
      record: [],
      injuryWarning: null,
    };

    it('renders subtle injury badge when card has injuryWarning', () => {
      const cardWithWarning: SessionViewExerciseCard = {
        ...baseCard,
        injuryWarning: 'managing',
      };

      renderWithTheme(<SessionExerciseCard card={cardWithWarning} onPress={jest.fn()} />);
      expect(screen.getByTestId('session-view-exercise-se-1-injury-badge')).toBeTruthy();
      expect(screen.getByText('Managing')).toBeTruthy();
    });

    it('does not render injury badge when card has no injuryWarning', () => {
      renderWithTheme(<SessionExerciseCard card={baseCard} onPress={jest.fn()} />);
      expect(screen.queryByTestId('session-view-exercise-se-1-injury-badge')).toBeNull();
    });
  });
});
