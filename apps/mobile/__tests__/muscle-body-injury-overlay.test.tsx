import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Path } from 'react-native-svg';
import type { WireframeFrame } from '@/components/stats/muscle-wireframe-renderer';

import { MuscleBodyCard } from '@/components/stats/muscle-body-card';
import {
  buildThemeShadePalette,
  projectMuscleBody,
  resolveFocusedInjurySide,
  type ActiveInjuryOverlay,
} from '@/components/stats/muscle-body-projection';
import { selectMuscleMeshes, wireframeCamera } from '@/components/stats/muscle-wireframe-scene';
import { testPalette, testRoles } from './helpers/muscle-body-palette';
import type { ProgressMuscleComparison } from '@/src/data';
import type { MuscleReportAssignment } from '@/src/data/muscle-analytics';
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

      // Facing the viewer at 0° (front view), anatomical left is on the viewer's right (x > width/2)
      // and anatomical right is on the viewer's left (x < width/2).
      expect(leftBadge!.x).toBeGreaterThan(150);
      expect(rightBadge!.x).toBeLessThan(150);
      expect(leftBadge!.x).toBeGreaterThan(rightBadge!.x);
      expect(projLeft.injuryContours?.[0].d).not.toBe(projRight.injuryContours?.[0].d);

      // Viewed from behind at 180° (back view), anatomical left is on the viewer's left (x < width/2)
      // and anatomical right is on the viewer's right (x > width/2).
      const projLeftBack = projectMuscleBody({
        scores,
        selectedId: null,
        width: 300,
        height: 300,
        angleDeg: 180,
        palette: testPalette,
        activeInjuries: [{ id: 'inj-lats-left', muscleGroupId: 'back_lats', status: 'acute', side: 'left' }],
      });
      const projRightBack = projectMuscleBody({
        scores,
        selectedId: null,
        width: 300,
        height: 300,
        angleDeg: 180,
        palette: testPalette,
        activeInjuries: [{ id: 'inj-lats-right', muscleGroupId: 'back_lats', status: 'acute', side: 'right' }],
      });
      const leftBackBadge = projLeftBack.injuryBadges?.find(b => b.injuryId === 'inj-lats-left');
      const rightBackBadge = projRightBack.injuryBadges?.find(b => b.injuryId === 'inj-lats-right');
      expect(leftBackBadge!.x).toBeLessThan(150);
      expect(rightBackBadge!.x).toBeGreaterThan(150);
    });

    it('projects injury contours and badges using the focused 3D camera and hides off-screen badges', () => {
      const chestInjury: ActiveInjuryOverlay = {
        id: 'inj-chest-left',
        muscleGroupId: 'chest',
        status: 'acute',
        side: 'left',
      };
      const quadsInjury: ActiveInjuryOverlay = {
        id: 'inj-quads-right',
        muscleGroupId: 'quads',
        status: 'managing',
        side: 'right',
      };

      const wholeBodyCamera = wireframeCamera({
        angle: 0,
        width: 300,
        height: 280,
        selected: selectMuscleMeshes('chest', undefined, false),
        focus: false,
      });
      const focusedCamera = wireframeCamera({
        angle: 0,
        width: 300,
        height: 280,
        selected: selectMuscleMeshes('chest', undefined, true),
        focus: true,
      });

      const wholeBody = projectMuscleBody({
        scores,
        selectedId: 'chest',
        width: 300,
        height: 280,
        camera: wholeBodyCamera,
        angleDeg: 0,
        palette: testPalette,
        activeInjuries: [chestInjury, quadsInjury],
      });
      const focused = projectMuscleBody({
        scores,
        selectedId: 'chest',
        width: 300,
        height: 280,
        camera: focusedCamera,
        angleDeg: 0,
        palette: testPalette,
        activeInjuries: [chestInjury, quadsInjury],
      });

      const wholeChestContour = wholeBody.injuryContours?.find(c => c.injuryId === 'inj-chest-left');
      const focusedChestContour = focused.injuryContours?.find(c => c.injuryId === 'inj-chest-left');
      expect(focusedChestContour?.d).toBeTruthy();
      expect(focusedChestContour?.d).not.toBe(wholeChestContour?.d);

      const wholeChestBadge = wholeBody.injuryBadges?.find(b => b.injuryId === 'inj-chest-left');
      const focusedChestBadge = focused.injuryBadges?.find(b => b.injuryId === 'inj-chest-left');
      expect(focusedChestBadge?.visible).toBe(true);
      expect(focusedChestBadge?.x).not.toBe(wholeChestBadge?.x);
      expect(focusedChestBadge?.y).not.toBe(wholeChestBadge?.y);

      // Quads are zoomed off-screen when focused on chest, so their badge is hidden.
      const wholeQuadsBadge = wholeBody.injuryBadges?.find(b => b.injuryId === 'inj-quads-right');
      const focusedQuadsBadge = focused.injuryBadges?.find(b => b.injuryId === 'inj-quads-right');
      expect(wholeQuadsBadge?.visible).toBe(true);
      expect(focusedQuadsBadge?.visible).toBe(false);
    });

    it('keeps injury badge visible and anchored in-viewport when triangles only partially intersect the viewport', () => {
      // Concrete real-mesh partial-visibility case: 300×280 Front (0°), Brachialis focused
      // with an acute left abs_rectus injury whose triangles cross the viewport edge even
      // though their unclipped centres lie outside the viewport.
      const brachialisCamera = wireframeCamera({
        angle: 0,
        width: 300,
        height: 280,
        selected: selectMuscleMeshes('brachialis', undefined, true),
        focus: true,
      });
      const projected = projectMuscleBody({
        scores,
        selectedId: 'brachialis',
        width: 300,
        height: 280,
        camera: brachialisCamera,
        angleDeg: 0,
        palette: testPalette,
        activeInjuries: [{ id: 'inj-abs-left', muscleGroupId: 'abs_rectus', status: 'acute', side: 'left' }],
      });

      const absBadge = projected.injuryBadges?.find(b => b.injuryId === 'inj-abs-left');
      expect(absBadge).toBeDefined();
      expect(absBadge?.visible).toBe(true);
      expect(absBadge!.x).toBeGreaterThanOrEqual(0);
      expect(absBadge!.x).toBeLessThanOrEqual(300);
      expect(absBadge!.y).toBeGreaterThanOrEqual(0);
      expect(absBadge!.y).toBeLessThanOrEqual(280);
    });

    it('keeps bilateral arm injury badges visible on the focused limb in single-limb focus mode', () => {
      const bicepsCamera = wireframeCamera({
        angle: 0,
        width: 300,
        height: 280,
        selected: selectMuscleMeshes('biceps', undefined, true),
        focus: true,
      });
      const projectedBiceps = projectMuscleBody({
        scores,
        selectedId: 'biceps',
        width: 300,
        height: 280,
        camera: bicepsCamera,
        angleDeg: 0,
        palette: testPalette,
        activeInjuries: [{ id: 'inj-biceps-bi', muscleGroupId: 'biceps', status: 'acute', side: 'bilateral' }],
      });
      const bicepsBadge = projectedBiceps.injuryBadges?.find(b => b.injuryId === 'inj-biceps-bi');
      expect(bicepsBadge?.visible).toBe(true);
      expect(bicepsBadge!.x).toBeGreaterThan(0);
      expect(bicepsBadge!.x).toBeLessThan(300);

      const tricepsCamera = wireframeCamera({
        angle: 180,
        width: 300,
        height: 280,
        selected: selectMuscleMeshes('triceps', undefined, true),
        focus: true,
      });
      const projectedTriceps = projectMuscleBody({
        scores,
        selectedId: 'triceps',
        width: 300,
        height: 280,
        camera: tricepsCamera,
        angleDeg: 180,
        palette: testPalette,
        activeInjuries: [{ id: 'inj-triceps-bi', muscleGroupId: 'triceps', status: 'managing', side: 'bilateral' }],
      });
      const tricepsBadge = projectedTriceps.injuryBadges?.find(b => b.injuryId === 'inj-triceps-bi');
      expect(tricepsBadge?.visible).toBe(true);
      expect(tricepsBadge!.x).toBeGreaterThan(0);
      expect(tricepsBadge!.x).toBeLessThan(300);
    });

    it('resolves the highest-priority unilateral injury side for limb focus', () => {
      const injuries: ActiveInjuryOverlay[] = [
        { id: 'inj-res-left', muscleGroupId: 'quads', status: 'resolved', side: 'left', painScore: 9 },
        { id: 'inj-mon-left', muscleGroupId: 'quads', status: 'monitoring', side: 'left', painScore: 2 },
        { id: 'inj-acute-right', muscleGroupId: 'quads', status: 'acute', side: 'right', painScore: 7 },
        { id: 'inj-acute-left-low', muscleGroupId: 'quads', status: 'acute', side: 'left', painScore: 4 },
        { id: 'inj-biceps-bi', muscleGroupId: 'biceps', status: 'acute', side: 'bilateral', painScore: 6 },
      ];
      expect(resolveFocusedInjurySide('quads', injuries)).toBe('right');
      expect(resolveFocusedInjurySide('biceps', injuries)).toBeNull();
      expect(resolveFocusedInjurySide('chest', injuries)).toBeNull();

      const combinedReport: MuscleReportAssignment = new Map([
        [
          'quads',
          {
            muscle: { id: 'cm_legs', displayName: 'Legs', familyName: 'Legs', sortOrder: 1 },
            tracked: true,
          },
        ],
      ]);
      expect(resolveFocusedInjurySide('cm_legs', injuries, combinedReport)).toBe('right');

      const focusedRight = selectMuscleMeshes('quads', undefined, true, 'right');
      expect(focusedRight.length).toBeGreaterThan(0);
      expect(focusedRight.every(inst => inst.side === -1)).toBe(true);
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

    it('prioritizes acute over monitoring on the same structure regardless of array order', () => {
      const acuteInjury: ActiveInjuryOverlay = {
        id: 'inj-acute',
        muscleGroupId: 'quads',
        status: 'acute',
        side: 'left',
      };
      const monitoringInjury: ActiveInjuryOverlay = {
        id: 'inj-monitoring',
        muscleGroupId: 'quads',
        status: 'monitoring',
        side: 'left',
      };

      // Order 1: [monitoring, acute]
      const proj1 = projectMuscleBody({
        scores,
        selectedId: null,
        width: 300,
        height: 300,
        angleDeg: 0,
        palette: testPalette,
        activeInjuries: [monitoringInjury, acuteInjury],
      });

      // Order 2: [acute, monitoring]
      const proj2 = projectMuscleBody({
        scores,
        selectedId: null,
        width: 300,
        height: 300,
        angleDeg: 0,
        palette: testPalette,
        activeInjuries: [acuteInjury, monitoringInjury],
      });

      for (const proj of [proj1, proj2]) {
        expect(proj.injuryContours).toHaveLength(1);
        expect(proj.injuryContours![0].status).toBe('acute');
        expect(proj.injuryContours![0].stroke).toBe(testPalette.injuryAcuteStroke);
        expect(proj.injuryContours![0].injuryId).toBe('inj-acute');

        expect(proj.injuryBadges).toHaveLength(1);
        expect(proj.injuryBadges![0].status).toBe('acute');
        expect(proj.injuryBadges![0].visible).toBe(true);
        expect(proj.injuryBadges![0].injuryId).toBe('inj-acute');
      }
    });

    it('prioritizes managing over monitoring when no acute injury exists', () => {
      const managingInjury: ActiveInjuryOverlay = {
        id: 'inj-managing',
        muscleGroupId: 'quads',
        status: 'managing',
        side: 'left',
      };
      const monitoringInjury: ActiveInjuryOverlay = {
        id: 'inj-monitoring',
        muscleGroupId: 'quads',
        status: 'monitoring',
        side: 'left',
      };

      const proj = projectMuscleBody({
        scores,
        selectedId: null,
        width: 300,
        height: 300,
        angleDeg: 0,
        palette: testPalette,
        activeInjuries: [monitoringInjury, managingInjury],
      });

      expect(proj.injuryContours).toHaveLength(1);
      expect(proj.injuryContours![0].status).toBe('managing');
      expect(proj.injuryContours![0].stroke).toBe(testPalette.injuryManagingStroke);
      expect(proj.injuryBadges![0].status).toBe('managing');
    });

    it('renders independent contours for distinct structures of the same muscle group', () => {
      const leftAcute: ActiveInjuryOverlay = {
        id: 'inj-left-acute',
        muscleGroupId: 'quads',
        status: 'acute',
        side: 'left',
      };
      const rightMonitoring: ActiveInjuryOverlay = {
        id: 'inj-right-mon',
        muscleGroupId: 'quads',
        status: 'monitoring',
        side: 'right',
      };

      const proj = projectMuscleBody({
        scores,
        selectedId: null,
        width: 300,
        height: 300,
        angleDeg: 0,
        palette: testPalette,
        activeInjuries: [rightMonitoring, leftAcute],
      });

      expect(proj.injuryContours).toHaveLength(2);
      const leftContour = proj.injuryContours?.find(c => c.side === 'left');
      const rightContour = proj.injuryContours?.find(c => c.side === 'right');

      expect(leftContour?.status).toBe('acute');
      expect(leftContour?.stroke).toBe(testPalette.injuryAcuteStroke);
      expect(rightContour?.status).toBe('monitoring');
      expect(rightContour?.stroke).toBe(testPalette.injuryMonitoringStroke);
    });

    it('projects contours and visible badges when report maps muscle to a combined group', () => {
      const combinedReport: MuscleReportAssignment = new Map([
        [
          'quads',
          {
            muscle: {
              id: 'cm_legs',
              displayName: 'Legs',
              familyName: 'Legs',
              sortOrder: 1,
            },
            tracked: true,
          },
        ],
      ]);

      const quadsInjury: ActiveInjuryOverlay = {
        id: 'inj-quads-comb',
        muscleGroupId: 'quads',
        status: 'acute',
        side: 'left',
      };

      const proj = projectMuscleBody({
        scores,
        selectedId: null,
        width: 300,
        height: 300,
        angleDeg: 0,
        palette: testPalette,
        report: combinedReport,
        activeInjuries: [quadsInjury],
      });

      expect(proj.injuryContours).toBeDefined();
      expect(proj.injuryContours).toHaveLength(1);
      expect(proj.injuryContours![0].muscleGroupId).toBe('quads');
      expect(proj.injuryContours![0].status).toBe('acute');
      expect(proj.injuryContours![0].stroke).toBe(testPalette.injuryAcuteStroke);

      expect(proj.injuryBadges).toBeDefined();
      expect(proj.injuryBadges).toHaveLength(1);
      const badge = proj.injuryBadges![0];
      expect(badge.visible).toBe(true);
      expect(badge.muscleGroupId).toBe('quads');
      expect(badge.status).toBe('acute');
      expect(badge.x).toBeGreaterThan(0);
      expect(badge.y).toBeGreaterThan(0);
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

    it('renders acute danger stroke (2.5px) over monitoring (1.6px) regardless of input order', () => {
      const acuteInjury: ActiveInjuryOverlay = {
        id: 'inj-acute',
        muscleGroupId: 'quads',
        label: 'Acute Quad Tear',
        status: 'acute',
        side: 'left',
      };
      const monitoringInjury: ActiveInjuryOverlay = {
        id: 'inj-monitoring',
        muscleGroupId: 'quads',
        label: 'Quad Monitoring',
        status: 'monitoring',
        side: 'left',
      };

      // Test order 1: [monitoring, acute]
      const { unmount } = render(
        <MuscleBodyCard
          activeInjuries={[monitoringInjury, acuteInjury]}
          defaultOverlay="contour"
          metric="workingSetCount"
          muscles={muscles}
          onSelect={jest.fn()}
          selectedId={null}
        />
      );

      const contoursSvg1 = screen.getByTestId('stats-muscle-injury-contours');
      const paths1 = within(contoursSvg1).UNSAFE_getAllByType(Path);
      expect(paths1).toHaveLength(1);
      expect(paths1[0].props.stroke).toBe(testRoles.danger);
      expect(paths1[0].props.strokeWidth).toBe(2.5);
      expect(screen.getByTestId('stats-muscle-injury-badge-inj-acute')).toBeTruthy();
      expect(screen.queryByTestId('stats-muscle-injury-badge-inj-monitoring')).toBeNull();

      unmount();

      // Test order 2: [acute, monitoring]
      render(
        <MuscleBodyCard
          activeInjuries={[acuteInjury, monitoringInjury]}
          defaultOverlay="contour"
          metric="workingSetCount"
          muscles={muscles}
          onSelect={jest.fn()}
          selectedId={null}
        />
      );

      const contoursSvg2 = screen.getByTestId('stats-muscle-injury-contours');
      const paths2 = within(contoursSvg2).UNSAFE_getAllByType(Path);
      expect(paths2).toHaveLength(1);
      expect(paths2[0].props.stroke).toBe(testRoles.danger);
      expect(paths2[0].props.strokeWidth).toBe(2.5);
      expect(screen.getByTestId('stats-muscle-injury-badge-inj-acute')).toBeTruthy();
      expect(screen.queryByTestId('stats-muscle-injury-badge-inj-monitoring')).toBeNull();
    });

    it('renders contours and badge when report maps muscle to a combined group', () => {
      const combinedReport: MuscleReportAssignment = new Map([
        [
          'quads',
          {
            muscle: {
              id: 'cm_legs',
              displayName: 'Legs',
              familyName: 'Legs',
              sortOrder: 1,
            },
            tracked: true,
          },
        ],
      ]);

      const onSelect = jest.fn();
      render(
        <MuscleBodyCard
          activeInjuries={[
            {
              id: 'inj-quads-comb',
              muscleGroupId: 'quads',
              label: 'Quad Strain',
              status: 'acute',
              side: 'left',
            },
          ]}
          defaultOverlay="contour"
          metric="workingSetCount"
          muscles={muscles}
          onSelect={onSelect}
          report={combinedReport}
          selectedId={null}
        />
      );

      const contoursSvg = screen.getByTestId('stats-muscle-injury-contours');
      const paths = within(contoursSvg).UNSAFE_getAllByType(Path);
      expect(paths).toHaveLength(1);
      expect(paths[0].props.stroke).toBe(testRoles.danger);
      expect(paths[0].props.strokeWidth).toBe(2.5);

      const badge = screen.getByTestId('stats-muscle-injury-badge-inj-quads-comb');
      expect(badge).toBeTruthy();

      fireEvent.press(badge);
      expect(onSelect).toHaveBeenCalledWith('quads');
    });

    it('updates injury overlay projection in focus mode and targets the injured limb side', () => {
      const rightQuadInjury: ActiveInjuryOverlay = {
        id: 'inj-quads-right',
        muscleGroupId: 'quads',
        label: 'Right Quad Strain',
        status: 'acute',
        side: 'right',
      };
      const chestInjury: ActiveInjuryOverlay = {
        id: 'inj-chest-left',
        muscleGroupId: 'chest',
        label: 'Left Pec Strain',
        status: 'managing',
        side: 'left',
      };

      render(
        <MuscleBodyCard
          activeInjuries={[rightQuadInjury, chestInjury]}
          defaultOverlay="wireframe"
          metric="workingSetCount"
          muscles={muscles}
          onSelect={jest.fn()}
          selectedId="quads"
        />
      );

      const contourBefore = within(screen.getByTestId('stats-muscle-injury-contours'))
        .UNSAFE_getAllByType(Path)
        .map(p => p.props.d);
      expect(screen.getByTestId('stats-muscle-injury-badge-inj-quads-right')).toBeTruthy();
      expect(screen.getByTestId('stats-muscle-injury-badge-inj-chest-left')).toBeTruthy();

      // Enable Focus mode on quads — should zoom onto the injured right quad and hide off-screen chest badge.
      fireEvent.press(screen.getByTestId('stats-muscle-body-focus'));

      const canvas = screen.getByTestId('stats-muscle-body-wireframe');
      expect(canvas.props.frame.selected.every((inst: { side: number }) => inst.side === -1)).toBe(true);

      const contourAfter = within(screen.getByTestId('stats-muscle-injury-contours'))
        .UNSAFE_getAllByType(Path)
        .map(p => p.props.d);
      expect(contourAfter).not.toEqual(contourBefore);

      // Right quad badge stays visible in the focused viewport; chest is off-screen and hidden.
      expect(screen.getByTestId('stats-muscle-injury-badge-inj-quads-right')).toBeTruthy();
      expect(screen.queryByTestId('stats-muscle-injury-badge-inj-chest-left')).toBeNull();
    });
  });
});
