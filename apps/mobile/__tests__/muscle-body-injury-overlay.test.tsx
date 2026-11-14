import { fireEvent, render, screen } from '@testing-library/react-native';
import type { WireframeFrame } from '@/components/stats/muscle-wireframe-renderer';

import { MuscleBodyCard } from '@/components/stats/muscle-body-card';
import {
  buildThemeShadePalette,
  projectMuscleBody,
  type ActiveInjuryOverlay,
} from '@/components/stats/muscle-body-projection';
import { testPalette, testRoles } from './helpers/muscle-body-palette';
import type { ProgressMuscleComparison } from '@/src/data';
import { compareProgressVolume } from '@/src/data/progress-comparisons';

jest.mock('@/components/stats/muscle-body-canvas', () => ({
  MuscleBodyCanvas: ({ frame }: { frame: WireframeFrame }) =>
    require('react').createElement(require('react-native').View, {
      frame,
      pointerEvents: 'none',
      testID: `stats-muscle-body-${frame.overlay === 'wireframe' ? 'wireframe' : 'patches'}`,
    }),
}));

const makeMuscle = (
  muscleGroupId: string,
  displayName: string,
  workingSetCount: number = 8
): ProgressMuscleComparison => ({
  muscleGroupId,
  displayName,
  familyName: 'Test',
  sortOrder: 1,
  current: {
    workingSetCount,
    totalVolume: workingSetCount * 500,
    volumeSetCount: workingSetCount > 0 ? 1 : 0,
  },
  previous: {
    workingSetCount: 0,
    totalVolume: 0,
    volumeSetCount: 0,
  },
  workingSetChange: workingSetCount,
  volumeChange: compareProgressVolume(workingSetCount * 500, 0),
  exercises: [],
});

describe('Muscle body injury overlay', () => {
  describe('buildThemeShadePalette', () => {
    it('populates injury stroke roles from theme roles', () => {
      const palette = buildThemeShadePalette(testRoles, 'light');
      expect(palette.injuryAcuteStroke).toBe(testRoles.danger);
      expect(palette.injuryManagingStroke).toBe(testRoles.accent);
      expect(palette.injuryMonitoringStroke).toBe(testRoles.rule);
    });

    it('populates injury stroke roles for both light and dark modes', () => {
      const paletteDark = buildThemeShadePalette(testRoles, 'dark');
      expect(paletteDark.injuryAcuteStroke).toBe(testRoles.danger);
      expect(paletteDark.injuryManagingStroke).toBe(testRoles.accent);
      expect(paletteDark.injuryMonitoringStroke).toBe(testRoles.rule);
    });
  });

  describe('projectMuscleBody with activeInjuries', () => {
    const scores = new Map([
      ['quads', 0.8],
      ['chest', 0.9],
      ['back_lats', 0.7],
    ]);

    it('omits injuryContours and injuryBadges when activeInjuries is empty or omitted', () => {
      const projected = projectMuscleBody({
        scores,
        selectedId: null,
        width: 300,
        height: 300,
        angleDeg: 0,
        palette: testPalette,
      });

      expect(projected.injuryContours).toBeUndefined();
      expect(projected.injuryBadges).toBeUndefined();
    });

    it('ignores resolved injuries', () => {
      const resolvedInjury: ActiveInjuryOverlay = {
        id: 'inj-res',
        muscleGroupId: 'quads',
        status: 'resolved',
        side: 'bilateral',
      };

      const projected = projectMuscleBody({
        scores,
        selectedId: null,
        width: 300,
        height: 300,
        angleDeg: 0,
        palette: testPalette,
        activeInjuries: [resolvedInjury],
      });

      expect(projected.injuryContours).toBeUndefined();
      expect(projected.injuryBadges).toBeUndefined();
    });

    it('generates contours and badges with appropriate severity strokes', () => {
      const injuries: ActiveInjuryOverlay[] = [
        { id: 'inj-acute', muscleGroupId: 'quads', status: 'acute', side: 'left' },
        { id: 'inj-managing', muscleGroupId: 'chest', status: 'managing', side: 'right' },
        { id: 'inj-monitoring', muscleGroupId: 'back_lats', status: 'monitoring', side: 'bilateral' },
      ];

      const projected = projectMuscleBody({
        scores,
        selectedId: null,
        width: 300,
        height: 300,
        angleDeg: 0,
        palette: testPalette,
        activeInjuries: injuries,
      });

      expect(projected.injuryBadges).toHaveLength(3);
      expect(projected.injuryContours).toHaveLength(3);

      const acuteContour = projected.injuryContours?.find(c => c.injuryId === 'inj-acute');
      expect(acuteContour?.stroke).toBe(testPalette.injuryAcuteStroke);
      expect(acuteContour?.status).toBe('acute');

      const managingContour = projected.injuryContours?.find(c => c.injuryId === 'inj-managing');
      expect(managingContour?.stroke).toBe(testPalette.injuryManagingStroke);
      expect(managingContour?.status).toBe('managing');

      const monitoringContour = projected.injuryContours?.find(c => c.injuryId === 'inj-monitoring');
      expect(monitoringContour?.stroke).toBe(testPalette.injuryMonitoringStroke);
      expect(monitoringContour?.status).toBe('monitoring');
    });

    it('isolates left vs right vs bilateral side geometry', () => {
      const leftInjury: ActiveInjuryOverlay = {
        id: 'inj-left',
        muscleGroupId: 'quads',
        status: 'acute',
        side: 'left',
      };
      const rightInjury: ActiveInjuryOverlay = {
        id: 'inj-right',
        muscleGroupId: 'quads',
        status: 'acute',
        side: 'right',
      };

      const projLeft = projectMuscleBody({
        scores,
        selectedId: null,
        width: 300,
        height: 300,
        angleDeg: 0,
        palette: testPalette,
        activeInjuries: [leftInjury],
      });

      const projRight = projectMuscleBody({
        scores,
        selectedId: null,
        width: 300,
        height: 300,
        angleDeg: 0,
        palette: testPalette,
        activeInjuries: [rightInjury],
      });

      const leftBadge = projLeft.injuryBadges?.find(b => b.injuryId === 'inj-left');
      const rightBadge = projRight.injuryBadges?.find(b => b.injuryId === 'inj-right');

      expect(leftBadge).toBeDefined();
      expect(rightBadge).toBeDefined();

      // In anatomy mesh, left and right centroids must be distinct horizontally.
      expect(leftBadge!.x).not.toBe(rightBadge!.x);
      expect(projLeft.injuryContours?.[0].d).not.toBe(projRight.injuryContours?.[0].d);
    });

    it('adjusts badge visibility between front and back view angles', () => {
      const frontInjury: ActiveInjuryOverlay = {
        id: 'inj-chest',
        muscleGroupId: 'chest',
        status: 'acute',
        side: 'bilateral',
      };
      const backInjury: ActiveInjuryOverlay = {
        id: 'inj-lats',
        muscleGroupId: 'back_lats',
        status: 'managing',
        side: 'bilateral',
      };

      // Angle 0: Front view
      const projFront = projectMuscleBody({
        scores,
        selectedId: null,
        width: 300,
        height: 300,
        angleDeg: 0,
        palette: testPalette,
        activeInjuries: [frontInjury, backInjury],
      });

      const chestBadgeFront = projFront.injuryBadges?.find(b => b.injuryId === 'inj-chest');
      const latsBadgeFront = projFront.injuryBadges?.find(b => b.injuryId === 'inj-lats');

      expect(chestBadgeFront?.visible).toBe(true);
      expect(latsBadgeFront?.visible).toBe(false);

      // Angle 180: Back view
      const projBack = projectMuscleBody({
        scores,
        selectedId: null,
        width: 300,
        height: 300,
        angleDeg: 180,
        palette: testPalette,
        activeInjuries: [frontInjury, backInjury],
      });

      const chestBadgeBack = projBack.injuryBadges?.find(b => b.injuryId === 'inj-chest');
      const latsBadgeBack = projBack.injuryBadges?.find(b => b.injuryId === 'inj-lats');

      expect(chestBadgeBack?.visible).toBe(false);
      expect(latsBadgeBack?.visible).toBe(true);
    });

    it('resolves alias when muscleGroupId is missing but label contains muscle name', () => {
      const aliasedInjury: ActiveInjuryOverlay = {
        id: 'inj-alias',
        muscleGroupId: null,
        label: 'Right Bicep Strain',
        status: 'acute',
        side: 'right',
      };

      const projected = projectMuscleBody({
        scores: new Map([['biceps', 0.5]]),
        selectedId: null,
        width: 300,
        height: 300,
        angleDeg: 0,
        palette: testPalette,
        activeInjuries: [aliasedInjury],
      });

      const badge = projected.injuryBadges?.find(b => b.injuryId === 'inj-alias');
      expect(badge).toBeDefined();
      expect(badge?.muscleGroupId).toBe('biceps');
    });
  });

  describe('MuscleBodyCard rendering with activeInjuries', () => {
    const muscles: ProgressMuscleComparison[] = [
      makeMuscle('quads', 'Quadriceps', 10),
      makeMuscle('chest', 'Chest', 8),
      makeMuscle('back_lats', 'Lats', 6),
    ];

    it('renders injury contours SVG and interactive badge pills', () => {
      const onSelect = jest.fn();
      const injuries: ActiveInjuryOverlay[] = [
        {
          id: 'inj-quads-1',
          muscleGroupId: 'quads',
          label: 'Quad Tear',
          status: 'acute',
          side: 'left',
        },
      ];

      render(
        <MuscleBodyCard
          activeInjuries={injuries}
          defaultOverlay="contour"
          metric="workingSetCount"
          muscles={muscles}
          onSelect={onSelect}
          selectedId={null}
        />
      );

      // Contours SVG should be present
      expect(screen.getByTestId('stats-muscle-injury-contours')).toBeTruthy();

      // Badge pill should be present and clickable
      const badge = screen.getByTestId('stats-muscle-injury-badge-inj-quads-1');
      expect(badge).toBeTruthy();

      fireEvent.press(badge);
      expect(onSelect).toHaveBeenCalledWith('quads');
    });

    it('announces active injury in screen-reader accessibility target', () => {
      const injuries: ActiveInjuryOverlay[] = [
        {
          id: 'inj-quads-1',
          muscleGroupId: 'quads',
          label: 'Quad Strain',
          status: 'acute',
          side: 'left',
        },
      ];

      render(
        <MuscleBodyCard
          activeInjuries={injuries}
          defaultOverlay="contour"
          metric="workingSetCount"
          muscles={muscles}
          onSelect={jest.fn()}
          selectedId={null}
        />
      );

      const target = screen.getByTestId('stats-muscle-body-target-quads');
      expect(target.props.accessibilityLabel).toContain('Active injury: acute Quad Strain.');
    });
  });
});
