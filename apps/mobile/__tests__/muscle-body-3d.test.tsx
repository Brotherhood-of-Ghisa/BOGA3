import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Path } from 'react-native-svg';

import { hexToLch } from '@/components/ui/lch';
import { generateRoles } from '@/components/ui/theme';
import { themePresets } from '@/components/ui/theme-presets';
import { uiRoles } from '@/components/ui/tokens';
import { StatsScreenShell } from '../app/(tabs)/stats-history';
import { MuscleBodyCard } from '@/components/stats/muscle-body-card';
import { MUSCLE_BODY_MESH } from '@/components/stats/muscle-body-mesh';
import { MUSCLE_MAP_REFERENCE } from '@/components/stats/muscle-map-reference';
import {
  SHADE_STEPS,
  bodyOrientationForAngle,
  buildThemeShadePalette,
  computeMuscleBuckets,
  hitTestProjectedMuscle,
  normaliseBodyAngle,
  projectMuscleBody,
} from '@/components/stats/muscle-body-projection';
import type { ProgressComparisons, ProgressMuscleComparison } from '@/src/data';

const makeMuscle = (
  muscleGroupId: string,
  displayName: string,
  workingSetCount: number,
  totalVolume: number | null = workingSetCount * 500
): ProgressMuscleComparison => ({
  muscleGroupId,
  displayName,
  familyName: 'Test',
  sortOrder: 1,
  current: {
    workingSetCount,
    totalVolume,
    volumeSetCount: workingSetCount > 0 ? 1 : 0,
  },
  previous: {
    workingSetCount: 0,
    totalVolume: 0,
    volumeSetCount: 0,
  },
  workingSetChange: workingSetCount,
  volumeChange: { kind: 'empty' },
  exercises: [],
});

describe('normaliseBodyAngle & bodyOrientationForAngle', () => {
  it('wraps any angle into [0, 360) and maps front vs back hemisphere', () => {
    expect(normaliseBodyAngle(0)).toBe(0);
    expect(normaliseBodyAngle(360)).toBe(0);
    expect(normaliseBodyAngle(-30)).toBe(330);
    expect(normaliseBodyAngle(540)).toBe(180);
    expect(normaliseBodyAngle(Number.NaN)).toBe(0);

    expect(bodyOrientationForAngle(0)).toBe('front');
    expect(bodyOrientationForAngle(90)).toBe('front');
    expect(bodyOrientationForAngle(91)).toBe('back');
    expect(bodyOrientationForAngle(180)).toBe('back');
    expect(bodyOrientationForAngle(270)).toBe('back');
    expect(bodyOrientationForAngle(271)).toBe('front');
  });
});

describe('computeMuscleBuckets', () => {
  it.each([
    [12, 8, 2], [8, 12, 1], [8, 8, 0], [0, 8, 1], [8, 0, 2], [0, 0, 0],
  ])('compares %s sets with %s previous sets (bucket %s)', (now, previous, expected) => {
    const row = makeMuscle('front_delts', 'Front delts', now);
    row.previous.workingSetCount = previous;
    const buckets = computeMuscleBuckets([row], 'workingSetCount');
    expect(buckets.get('front_delts')).toBe(expected);
    expect(buckets.get('delts_front')).toBe(expected);
  });

  it.each([
    [1200, 1000, 2], [800, 1000, 1], [1000, 1000, 0],
    [0, 1000, 1], [1000, 0, 2], [0, 0, 0],
    [1004, 1000, 0], [996, 1000, 0],
    [null, 1000, 0], [1000, null, 0], [Infinity, 1000, 0],
  ])('uses the displayed Volume direction for %s versus %s (bucket %s)', (now, previous, expected) => {
    const row = makeMuscle('chest', 'Chest', 1, now);
    row.previous.totalVolume = previous;
    expect(computeMuscleBuckets([row], 'totalVolume').get('chest')).toBe(expected);
  });

  it('compares each muscle with itself regardless of another muscle’s absolute total', () => {
    const small = makeMuscle('chest', 'Chest', 2);
    small.previous.workingSetCount = 1;
    const large = makeMuscle('quads', 'Quads', 100);
    large.previous.workingSetCount = 200;
    expect([...computeMuscleBuckets([small, large], 'workingSetCount').values()]).toEqual([2, 1]);
  });
});

describe('buildThemeShadePalette', () => {
  it.each(themePresets)('keeps gain/loss hues and neutral anatomy in the $id theme', preset => {
    const roles = generateRoles(preset.seeds);
    const palette = buildThemeShadePalette(roles);
    expect(palette.neutral).toHaveLength(SHADE_STEPS);
    expect(palette.buckets).toHaveLength(3);
    expect(palette.buckets[0]).toEqual(palette.neutral);
    expect(palette.selectedStroke).toBe(roles.ink);
    for (const [bucket, seed] of [[1, roles.loss], [2, roles.gain]] as const) {
      expect(palette.buckets[bucket]).toHaveLength(SHADE_STEPS);
      expect(hexToLch(palette.buckets[bucket][6]).hue).toBeCloseTo(hexToLch(seed).hue, 0);
    }
  });
});

describe('projectMuscleBody & hitTestProjectedMuscle', () => {
  it('projects gain, loss and neutral fills and preserves them when selected', () => {
    const muscles = [makeMuscle('chest', 'Chest', 8), makeMuscle('quads', 'Quads', 4), makeMuscle('delts_front', 'Front delts', 6)];
    muscles[1].previous.workingSetCount = 8;
    muscles[2].previous.workingSetCount = 6;
    const buckets = computeMuscleBuckets(muscles, 'workingSetCount');
    const palette = buildThemeShadePalette();
    for (const selectedId of [null, 'quads']) {
      const projected = projectMuscleBody({ angleDeg: 0, width: 280, height: 280, buckets, selectedId });
      for (const [id, bucket] of [['chest', 2], ['quads', 1], ['delts_front', 0]] as const) {
        const facets = projected.triangles.filter(triangle => triangle.muscleGroupId === id);
        expect(facets.length).toBeGreaterThan(0);
        expect(facets.every(triangle => palette.buckets[bucket].includes(triangle.fill))).toBe(true);
      }
    }
  });

  it('covers all 25 canonical MUSCLE_MAP_REFERENCE muscles with symmetric, hit-testable 3D regions', () => {
    expect(MUSCLE_BODY_MESH.materials).toHaveLength(26);
    expect(MUSCLE_BODY_MESH.faces.length).toBeGreaterThan(4000);

    const faceCountsByMaterial = new Map<string, number>();
    for (const [, , , matIdx] of MUSCLE_BODY_MESH.faces) {
      const matId = MUSCLE_BODY_MESH.materials[matIdx];
      faceCountsByMaterial.set(matId, (faceCountsByMaterial.get(matId) ?? 0) + 1);
    }
    for (const ref of MUSCLE_MAP_REFERENCE) {
      expect(MUSCLE_BODY_MESH.materials).toContain(ref.id);
      expect(faceCountsByMaterial.get(ref.id) ?? 0).toBeGreaterThan(0);
    }

    const buckets = computeMuscleBuckets(
      MUSCLE_MAP_REFERENCE.map((ref, idx) => makeMuscle(ref.id, ref.label, idx + 1)),
      'workingSetCount'
    );

    const width = 280;
    const height = 280;
    const front = projectMuscleBody({ angleDeg: 0, width, height, buckets });
    expect(front.triangles.length).toBeGreaterThan(1500);
    expect(front.batches.length).toBeGreaterThan(0);

    const leftTris = front.triangles.filter(t => (t.x0 + t.x1 + t.x2) / 3 < width / 2);
    const rightTris = front.triangles.filter(t => (t.x0 + t.x1 + t.x2) / 3 > width / 2);
    expect(leftTris.length).toBe(rightTris.length);

    // Every canonical muscle is projected and hit-testable across canonical viewing angles.
    const angles = [0, 45, 90, 135, 180];
    const projections = angles.map(angleDeg =>
      projectMuscleBody({ angleDeg, width, height, buckets })
    );
    for (const ref of MUSCLE_MAP_REFERENCE) {
      const hitAtSomeAngle = projections.some(proj =>
        proj.triangles
          .filter(t => t.muscleGroupId === ref.id)
          .some(tri => {
            const cx = (tri.x0 + tri.x1 + tri.x2) / 3;
            const cy = (tri.y0 + tri.y1 + tri.y2) / 3;
            return hitTestProjectedMuscle(proj, cx, cy) === ref.id;
          })
      );
      expect(hitAtSomeAngle).toBe(true);
    }

    // Tapping a front chest triangle hits `chest`.
    const chestTri = front.triangles.filter(t => t.muscleGroupId === 'chest').at(-1)!;
    const chestCx = (chestTri.x0 + chestTri.x1 + chestTri.x2) / 3;
    const chestCy = (chestTri.y0 + chestTri.y1 + chestTri.y2) / 3;
    expect(hitTestProjectedMuscle(front, chestCx, chestCy)).toBe('chest');

    // Tapping a neutral head triangle returns null rather than piercing through.
    const headTri = front.triangles
      .filter(t => t.muscleGroupId === 'neutral' && t.y0 < height * 0.16)
      .at(-1)!;
    const headCx = (headTri.x0 + headTri.x1 + headTri.x2) / 3;
    const headCy = (headTri.y0 + headTri.y1 + headTri.y2) / 3;
    expect(hitTestProjectedMuscle(front, headCx, headCy)).toBeNull();
    expect(hitTestProjectedMuscle(front, 1, 1)).toBeNull();

    // At 180° (back view), posterior muscles (`back_lats`, `glutes_max`) are frontmost.
    const back = projectMuscleBody({ angleDeg: 180, width, height, buckets, selectedId: 'back_lats' });
    expect(back.batches.some(b => b.selected && b.stroke === uiRoles.ink)).toBe(true);
    expect(back.contour).not.toBeNull();
    expect(back.contour?.stroke).toBe(uiRoles.ink);
    expect(back.contour?.d.startsWith('M')).toBe(true);
    expect(front.contour).toBeNull();

    // Contours on the opposite side of the body are depth-occluded:
    // Front muscles (chest) produce no contour when looking from the back (180°).
    const chestFromBack = projectMuscleBody({ angleDeg: 180, width, height, buckets, selectedId: 'chest' });
    expect(chestFromBack.contour).toBeNull();
    // Back muscles (glutes) produce no contour when looking from the front (0°).
    const glutesFromFront = projectMuscleBody({ angleDeg: 0, width, height, buckets, selectedId: 'glutes_max' });
    expect(glutesFromFront.contour).toBeNull();
    // Front muscles (chest) produce a valid contour when looking from the front (0°).
    const chestFromFront = projectMuscleBody({ angleDeg: 0, width, height, buckets, selectedId: 'chest' });
    expect(chestFromFront.contour).not.toBeNull();
    expect(chestFromFront.contour?.d.startsWith('M')).toBe(true);

    const latsTri = back.triangles.filter(t => t.muscleGroupId === 'back_lats').at(-1)!;
    const latsCx = (latsTri.x0 + latsTri.x1 + latsTri.x2) / 3;
    const latsCy = (latsTri.y0 + latsTri.y1 + latsTri.y2) / 3;
    expect(hitTestProjectedMuscle(back, latsCx, latsCy)).toBe('back_lats');

    expect(projectMuscleBody({ angleDeg: 0, width: 0, height: 280, buckets })).toEqual({
      triangles: [],
      batches: [],
      contour: null,
    });
  });
});

describe('MuscleBodyCard', () => {
  const muscles = [
    makeMuscle('chest', 'Chest', 8, 3200),
    makeMuscle('back_lats', 'Lats', 6, 2400),
    makeMuscle('quads', 'Quads', 4, 1600),
  ];

  it('shows the direction legend and the selected muscle’s signed comparison', () => {
    render(<MuscleBodyCard metric="workingSetCount" muscles={muscles} selectedId="chest" onSelect={jest.fn()} />);
    expect(screen.getByTestId('stats-muscle-body-legend')).toHaveTextContent('DecreaseUnchangedIncrease');
    expect(screen.queryByText('% of max')).toBeNull();
    expect(screen.queryByText('% of target')).toBeNull();
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('stats-muscle-body-legend')).toBeLessThan(tree.indexOf('stats-muscle-body-viewport'));
    expect(screen.getByTestId('stats-muscle-body-comparison-now')).toHaveTextContent(/^8$/);
    expect(screen.getByTestId('stats-muscle-body-comparison-previous')).toHaveTextContent(/^0$/);
    expect(screen.getByTestId('stats-muscle-body-comparison-change')).toHaveTextContent(/^\+8$/);
    expect(screen.getByTestId('stats-muscle-body-target-chest').props.accessibilityLabel)
      .toBe('Select Chest. Now 8, previous 0, change +8. working sets.');
  });

  it('switches orientation via Front/Back control and accessibility actions, and selects muscles via both touch hit-testing and accessible buttons', () => {
    const onSelect = jest.fn();
    const view = render(
      <MuscleBodyCard
        metric="workingSetCount"
        muscles={muscles}
        onSelect={onSelect}
        selectedId={null}
      />
    );

    const viewport = screen.getByTestId('stats-muscle-body-viewport');
    expect(viewport.props.accessibilityValue).toEqual({ text: 'Front view, 0 degrees' });
    expect(screen.UNSAFE_getAllByType(Path).length).toBeGreaterThan(10);
    expect(screen.queryByTestId('stats-muscle-body-contour')).toBeNull();

    // Rotate via accessibility actions (30° steps).
    fireEvent(viewport, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(viewport.props.accessibilityValue).toEqual({ text: 'Front view, 30 degrees' });
    fireEvent(viewport, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(viewport.props.accessibilityValue).toEqual({ text: 'Front view, 0 degrees' });

    // Switch to Back view (180°) via the segmented control.
    fireEvent.press(screen.getByTestId('stats-muscle-body-angle-back'));
    expect(viewport.props.accessibilityValue).toEqual({ text: 'Back view, 180 degrees' });

    // Switch back to Front view (0°) and tap Chest on the 3D model.
    fireEvent.press(screen.getByTestId('stats-muscle-body-angle-front'));
    expect(viewport.props.accessibilityValue).toEqual({ text: 'Front view, 0 degrees' });

    fireEvent(viewport, 'layout', { nativeEvent: { layout: { width: 280, height: 280 } } });
    const projected = projectMuscleBody({
      angleDeg: 0,
      width: 280,
      height: 280,
      buckets: computeMuscleBuckets(muscles, 'workingSetCount'),
    });
    const chestTri = projected.triangles.filter(t => t.muscleGroupId === 'chest').at(-1)!;
    const tapGesture = viewport.props.gesture.gestures.find((g: any) => g.type === 'tap');
    const panGesture = viewport.props.gesture.gestures.find((g: any) => g.type === 'pan');

    // Pan rotates the model smoothly.
    act(() => {
      panGesture.handlers.onUpdate({ translationX: 50 });
    });
    expect(viewport.props.accessibilityValue.text).toContain('43 degrees');
    act(() => {
      panGesture.handlers.onEnd({ translationX: 50 });
    });
    expect(viewport.props.accessibilityValue.text).toContain('43 degrees');

    // Rotate back to 0° via Front button for hit testing.
    fireEvent.press(screen.getByTestId('stats-muscle-body-angle-front'));

    // Tap selects chest muscle on the 3D model.
    tapGesture.handlers.onEnd({
      x: (chestTri.x0 + chestTri.x1 + chestTri.x2) / 3,
      y: (chestTri.y0 + chestTri.y1 + chestTri.y2) / 3,
    });
    expect(onSelect).toHaveBeenCalledWith('chest');

    // Screen-reader users can select any muscle directly via its accessible button target.
    const latsButton = screen.getByLabelText('Select Lats. Now 6, previous 0, change +6. working sets.');
    expect(latsButton.props.accessibilityState).toEqual({ selected: false, expanded: false });
    fireEvent.press(latsButton);
    expect(onSelect).toHaveBeenCalledWith('back_lats');

    view.rerender(
      <MuscleBodyCard
        metric="workingSetCount"
        muscles={muscles}
        onSelect={onSelect}
        selectedId="chest"
      />
    );
    expect(screen.getByTestId('stats-muscle-body-selected')).toHaveTextContent('Chest');
    expect(screen.getByTestId('stats-muscle-body-contour')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-body-contour').props.strokeWidth).toBe(1.5);
    expect(
      screen.getByLabelText('Select Chest. Now 8, previous 0, change +8. working sets.').props.accessibilityState
    ).toEqual({
      selected: true,
      expanded: true,
    });

    // Next button cycles to back_lats and auto-orients to Back view (180°).
    fireEvent.press(screen.getByTestId('stats-muscle-body-next'));
    expect(onSelect).toHaveBeenCalledWith('back_lats');
    expect(viewport.props.accessibilityValue).toEqual({ text: 'Back view, 180 degrees' });

    // Prev button cycles backwards to quads.
    fireEvent.press(screen.getByTestId('stats-muscle-body-prev'));
    expect(onSelect).toHaveBeenCalledWith('quads');

    // Tapping the picker trigger opens the bottom sheet.
    fireEvent.press(screen.getByTestId('stats-muscle-body-picker-trigger'));
    expect(screen.getByTestId('stats-muscle-picker-sheet')).toBeTruthy();
    // Choosing back_lats in the sheet selects it and auto-orients to back view.
    fireEvent.press(screen.getByTestId('stats-muscle-picker-row-back_lats'));
    expect(onSelect).toHaveBeenCalledWith('back_lats');
    expect(viewport.props.accessibilityValue).toEqual({ text: 'Back view, 180 degrees' });
  });

  it('renders MuscleBodyCard in 3D Muscle layout with top trained muscle selected by default and discloses contributions', () => {
    const chestWithContributors: ProgressMuscleComparison = {
      ...muscles[0],
      exercises: [
        {
          ...muscles[0],
          exerciseDefinitionId: 'bench',
          displayName: 'Barbell Bench Press',
          role: 'primary',
        },
      ],
    };
    const summary: ProgressComparisons = {
      current: {
        period: { days: 7, start: new Date('2026-05-12T00:00:00Z'), end: new Date('2026-05-19T00:00:00Z') },
        totals: { sessionCount: 2, workingSetCount: 8, muscleFamilies: [] },
      },
      previous: {
        period: { days: 7, start: new Date('2026-05-05T00:00:00Z'), end: new Date('2026-05-12T00:00:00Z') },
        totals: { sessionCount: 1, workingSetCount: 4, muscleFamilies: [] },
      },
      muscles: [chestWithContributors, muscles[1], muscles[2]],
    };
    const onOpenMuscleHistory = jest.fn();

    render(
      <StatsScreenShell
        errorMessage={null}
        exerciseListItems={[]}
        exerciseSearchIndex={new Map()}
        exerciseMetric="workingSetCount"
        isLoading={false}
        muscleLayout="3d"
        onOpenExerciseHistory={jest.fn()}
        onOpenMuscleHistory={onOpenMuscleHistory}
        onPressSessionsCard={jest.fn()}
        onSearchQueryChange={jest.fn()}
        onSelectExerciseMetric={jest.fn()}
        onSelectPeriod={jest.fn()}
        onSelectTableMetric={jest.fn()}
        onSelectViewMode={jest.fn()}
        period="this-week"
        searchQuery=""
        summary={summary}
        tableMetric="workingSetCount"
        viewMode="muscle"
      />
    );

    expect(screen.getByTestId('stats-muscle-body-card')).toBeTruthy();
    expect(screen.queryByTestId('stats-muscle-table')).toBeNull();
    // Default selected muscle is top trained (Chest), disclosing contributions immediately.
    expect(screen.getByTestId('stats-muscle-body-selected')).toHaveTextContent('Chest');
    expect(screen.getByTestId('stats-contributions')).toBeTruthy();
    expect(screen.getByTestId('stats-contribution-bench-now')).toHaveTextContent('8');

    fireEvent.press(screen.getByTestId('stats-contributions-view-daily'));
    expect(onOpenMuscleHistory).toHaveBeenCalledWith({ muscleGroupId: 'chest' }, 'daily');

    // Tapping the selected muscle keeps it selected in 3D view.
    const viewport = screen.getByTestId('stats-muscle-body-viewport');
    fireEvent(viewport, 'layout', { nativeEvent: { layout: { width: 280, height: 280 } } });
    const projected = projectMuscleBody({
      angleDeg: 0,
      width: 280,
      height: 280,
      buckets: computeMuscleBuckets(muscles, 'workingSetCount'),
    });
    const chestTri = projected.triangles.filter(t => t.muscleGroupId === 'chest').at(-1)!;
    const tapGesture = viewport.props.gesture.gestures.find((g: any) => g.type === 'tap');
    act(() => {
      tapGesture.handlers.onEnd({
        x: (chestTri.x0 + chestTri.x1 + chestTri.x2) / 3,
        y: (chestTri.y0 + chestTri.y1 + chestTri.y2) / 3,
      });
    });
    expect(screen.getByTestId('stats-muscle-body-selected')).toHaveTextContent('Chest');
    expect(screen.getByTestId('stats-contributions')).toBeTruthy();
  });

  it('shades the 3D body from filtered exercises in Exercise 3D view and scopes the exercise list on muscle tap', () => {
    const summary: ProgressComparisons = {
      current: {
        period: { days: 7, start: new Date('2026-05-12T00:00:00Z'), end: new Date('2026-05-19T00:00:00Z') },
        totals: { sessionCount: 2, workingSetCount: 14, muscleFamilies: [] },
      },
      previous: {
        period: { days: 7, start: new Date('2026-05-05T00:00:00Z'), end: new Date('2026-05-12T00:00:00Z') },
        totals: { sessionCount: 1, workingSetCount: 4, muscleFamilies: [] },
      },
      muscles: [
        makeMuscle('chest', 'Chest', 8, 3200),
        makeMuscle('triceps', 'Triceps', 4, 1600),
        makeMuscle('quads', 'Quads', 6, 2400),
      ],
    };

    render(
      <StatsScreenShell
        errorMessage={null}
        exerciseDataReady
        exerciseSearchIndex={new Map([
          ['bench', 'barbell bench press chest triceps'],
          ['dips', 'parallel bar dips chest triceps'],
          ['squat', 'barbell back squat quads'],
        ])}
        exerciseListItems={[
          {
            id: 'bench',
            name: 'Barbell Bench Press',
            current: { workingSetCount: 6, totalVolume: 2400, volumeSetCount: 6 },
            previous: { workingSetCount: 4, totalVolume: 1600, volumeSetCount: 4 },
            lastCompletedAt: new Date('2026-05-18T12:00:00Z'),
          },
          {
            id: 'dips',
            name: 'Parallel Bar Dips',
            current: { workingSetCount: 4, totalVolume: 1200, volumeSetCount: 4 },
            previous: { workingSetCount: 2, totalVolume: 600, volumeSetCount: 2 },
            lastCompletedAt: new Date('2026-05-17T12:00:00Z'),
          },
          {
            id: 'squat',
            name: 'Barbell Back Squat',
            current: { workingSetCount: 6, totalVolume: 2400, volumeSetCount: 6 },
            previous: { workingSetCount: 6, totalVolume: 2400, volumeSetCount: 6 },
            lastCompletedAt: new Date('2026-05-16T12:00:00Z'),
          },
        ]}
        exerciseMappings={[
          {
            id: 'bench',
            mappings: [
              { id: 'm1', muscleGroupId: 'chest', weight: 1, role: 'primary' },
              { id: 'm2', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
            ],
          },
          {
            id: 'dips',
            mappings: [
              { id: 'm3', muscleGroupId: 'chest', weight: 0.5, role: 'secondary' },
              { id: 'm4', muscleGroupId: 'triceps', weight: 1, role: 'primary' },
            ],
          },
          {
            id: 'squat',
            mappings: [
              { id: 'm5', muscleGroupId: 'quads', weight: 1, role: 'primary' },
            ],
          },
        ]}
        exerciseMetric="workingSetCount"
        isLoading={false}
        muscleLayout="3d"
        onOpenExerciseHistory={jest.fn()}
        onOpenMuscleHistory={jest.fn()}
        onPressSessionsCard={jest.fn()}
        onSearchQueryChange={jest.fn()}
        onSelectExerciseMetric={jest.fn()}
        onSelectPeriod={jest.fn()}
        onSelectTableMetric={jest.fn()}
        onSelectViewMode={jest.fn()}
        period="this-week"
        searchQuery=""
        summary={summary}
        tableMetric="workingSetCount"
        viewMode="exercise"
      />
    );

    // Without a selected muscle, both the 3D body and all 3 exercises are rendered.
    expect(screen.getByTestId('stats-muscle-body-card')).toBeTruthy();
    expect(screen.queryByTestId('stats-exercise-body-detail')).toBeNull();
    expect(screen.getByTestId('stats-exercise-row-bench')).toBeTruthy();
    expect(screen.getByTestId('stats-exercise-row-dips')).toBeTruthy();
    expect(screen.getByTestId('stats-exercise-row-squat')).toBeTruthy();

    // Tap Chest on the 3D body: scopes the exercise list below to Chest (primary Bench + secondary Dips).
    const viewport = screen.getByTestId('stats-muscle-body-viewport');
    fireEvent(viewport, 'layout', { nativeEvent: { layout: { width: 280, height: 280 } } });
    const projected = projectMuscleBody({
      angleDeg: 0,
      width: 280,
      height: 280,
      buckets: computeMuscleBuckets(summary.muscles, 'workingSetCount'),
    });
    const chestTri = projected.triangles.filter(t => t.muscleGroupId === 'chest').at(-1)!;
    const tapGesture = viewport.props.gesture.gestures.find((g: any) => g.type === 'tap');
    act(() => {
      tapGesture.handlers.onEnd({
        x: (chestTri.x0 + chestTri.x1 + chestTri.x2) / 3,
        y: (chestTri.y0 + chestTri.y1 + chestTri.y2) / 3,
      });
    });

    expect(screen.getByTestId('stats-exercise-body-detail')).toBeTruthy();
    expect(screen.getByTestId('stats-exercise-row-bench-now')).toHaveTextContent('6');
    expect(screen.queryByTestId('stats-exercise-target-bench')).toBeNull();
    expect(screen.getByTestId('stats-exercise-row-bench').props.accessibilityLabel).not.toMatch(/target/i);
    expect(screen.queryByText('Total')).toBeNull();
    expect(screen.queryByTestId('stats-exercise-secondary-summary')).toBeNull();
    expect(screen.getByTestId('stats-exercise-row-dips-now')).toHaveTextContent('2');
    expect(screen.queryByTestId('stats-exercise-row-squat')).toBeNull();

    // Tapping Chest again restores the full unfiltered exercise list.
    act(() => {
      tapGesture.handlers.onEnd({
        x: (chestTri.x0 + chestTri.x1 + chestTri.x2) / 3,
        y: (chestTri.y0 + chestTri.y1 + chestTri.y2) / 3,
      });
    });
    expect(screen.queryByTestId('stats-exercise-body-detail')).toBeNull();
    expect(screen.getByTestId('stats-exercise-row-squat')).toBeTruthy();
  });
});
