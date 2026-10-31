import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Path, Use } from 'react-native-svg';

import { hexToLch } from '@/components/ui/lch';
import { generateRoles } from '@/components/ui/theme';
import { seedsFromHue } from '@/components/ui/theme-hue';
import { compareProgressVolume } from '@/src/data/progress-comparisons';
import { themePresets } from '@/components/ui/theme-presets';
import { uiRoles } from '@/components/ui/tokens';
import { StatsScreenShell } from '../app/(tabs)/stats-history';
import { MuscleBodyCard } from '@/components/stats/muscle-body-card';
import { MUSCLE_BODY_MESH } from '@/components/stats/muscle-body-mesh';
import { MOUSTACHE_FILL } from '@/components/stats/muscle-body-moustache';
import { MUSCLE_MAP_REFERENCE } from '@/components/stats/muscle-map-reference';
import {
  SHADE_STEPS,
  bodyOrientationForAngle,
  buildThemeShadePalette,
  buildMuscleShadeRamp,
  computeMuscleScores,
  hitTestProjectedMuscle,
  normaliseBodyAngle,
  projectMuscleBody,
} from '@/components/stats/muscle-body-projection';
import type { ProgressComparisons, ProgressMuscleComparison } from '@/src/data';

beforeEach(() => { jest.useFakeTimers({ now: new Date(2026, 9, 20) }); });
afterEach(() => { jest.useRealTimers(); });

const fibreDefinitionD = (testID: string): string => {
  const href = screen.getByTestId(testID).props.href.replace(/^#/, '');
  const definition = screen.UNSAFE_getAllByType(Path).find(path => path.props.id === href);
  expect(definition).toBeDefined();
  expect(definition!.props.d).toMatch(/^M/);
  return definition!.props.d;
};

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
  volumeChange: compareProgressVolume(totalVolume, 0),
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

const comparedMuscle = (id: string, current: number | null, previous: number | null,
  metric: 'workingSetCount' | 'totalVolume' = 'totalVolume') => {
  const row = makeMuscle(id, id, metric === 'workingSetCount' ? current! : 1);
  if (metric === 'workingSetCount') {
    row.previous.workingSetCount = previous!;
    row.workingSetChange = current! - previous!;
  } else {
    row.current.totalVolume = current;
    row.previous.totalVolume = previous;
    row.volumeChange = compareProgressVolume(current, previous);
  }
  return row;
};

const SET_TARGETS = { weeklyTarget: 8, weeks: 1 };

describe('computeMuscleScores', () => {
  it.each([
    [12, 8, 1], [8, 12, 1], [4, 4, 0], [2, 8, -.5], [.5, 8, -.875],
    [0, 8, null], [8, 0, 1], [0, 0, null], [Number.NaN, 8, null], [8, Infinity, 1],
  ])('grades %s sets against the target independently of %s previous sets (score %s)', (now, previous, expected) => {
    const scores = computeMuscleScores([comparedMuscle('front_delts', now, previous, 'workingSetCount')], 'workingSetCount', SET_TARGETS);
    expect(scores.get('front_delts')).toBe(expected);
    expect(scores.get('delts_front')).toBe(expected);
  });

  it('scales effective per-muscle targets to the selected period and caps attainment', () => {
    const rows = [comparedMuscle('chest', 8, 100, 'workingSetCount'), comparedMuscle('quads', 32, 0, 'workingSetCount')];
    const targets = { ...SET_TARGETS, weeks: 4, weeklyTargets: { chest: 4 } };
    expect([...computeMuscleScores(rows, 'workingSetCount', targets).values()]).toEqual([0, 1]);
    expect([...computeMuscleScores(rows, 'workingSetCount', { ...targets, weeks: 1 }).values()]).toEqual([1, 1]);
  });

  it.each([
    undefined, { weeklyTarget: 0, weeks: 1 }, { weeklyTarget: -1, weeks: 1 },
    { weeklyTarget: Infinity, weeks: 1 }, { weeklyTarget: 8, weeks: 0 },
    { weeklyTarget: 8, weeks: NaN }, { weeklyTarget: 8, weeks: 1, weeklyTargets: { chest: 0 } },
  ])('keeps unavailable target scales neutral (%j)', targets => {
    expect(computeMuscleScores([makeMuscle('chest', 'Chest', 8)], 'workingSetCount', targets).get('chest')).toBeNull();
  });

  it.each([
    [1200, 1000, 1], [800, 1000, -1], [1000, 1000, 0],
    [0, 1000, -1], [1000, 0, 1], [0, 0, null],
    [1004, 1000, 0], [996, 1000, 0],
    [null, 1000, null], [1000, null, null], [Infinity, 1000, null], [1000, NaN, null],
    [Number.MAX_VALUE, Number.MIN_VALUE, 1],
  ])('uses the displayed Volume change for %s versus %s (score %s)', (now, previous, expected) => {
    expect(computeMuscleScores([comparedMuscle('chest', now, previous)], 'totalVolume').get('chest')).toBe(expected);
  });

  it('gives a -100% Volume drop the lightest shade even beside smaller declines', () => {
    const scores = computeMuscleScores([comparedMuscle('chest', 0, 1000),
      comparedMuscle('biceps', 500, 1000), comparedMuscle('quads', 1000, 1000)], 'totalVolume');
    expect([...scores.values()]).toEqual([-1, -.5, 0]);
  });

  it('scales finite gains and losses separately, across front and back, with ties and rounded zero', () => {
    const rows = [comparedMuscle('chest', 101, 100), comparedMuscle('biceps', 125, 100),
      comparedMuscle('back_lats', 150, 100), comparedMuscle('quads', 90, 100),
      comparedMuscle('hamstrings', 60, 100), comparedMuscle('delts_front', 125, 100),
      comparedMuscle('glutes_max', 90, 100), comparedMuscle('calves', 100.4, 100),
      comparedMuscle('triceps', 1, 0), comparedMuscle('abs_rectus', Number.MAX_VALUE, Number.MIN_VALUE)];
    expect([...computeMuscleScores(rows, 'totalVolume').values()]).toEqual([.02, .5, 1, -.25, -1, .5, -.25, 0, 1, 1]);
    const forward = computeMuscleScores(rows, 'totalVolume');
    expect(computeMuscleScores([...rows].reverse(), 'totalVolume')).toEqual(forward);
    const aliases = rows.map(row => row.muscleGroupId === 'delts_front' ? { ...row, muscleGroupId: 'front_delts' } : row);
    const aliased = computeMuscleScores(aliases, 'totalVolume');
    for (const [id, score] of forward) expect(aliased.get(id)).toBe(score);
    expect(aliased.get('front_delts')).toBe(.5);
  });

  it('excludes a custom muscle without a body region from the figure extrema', () => {
    const scores = computeMuscleScores([comparedMuscle('chest', 125, 100), comparedMuscle('custom', 1000, 100)], 'totalVolume');
    expect(scores.get('chest')).toBe(1);
    expect(scores.get('custom')).toBeNull();
  });

  it('prefers a canonical row over a duplicate legacy alias in either input order', () => {
    const canonical = comparedMuscle('delts_front', 125, 100);
    const legacy = comparedMuscle('front_delts', 200, 100);
    const chest = comparedMuscle('chest', 150, 100);
    for (const rows of [[canonical, legacy, chest], [chest, legacy, canonical]]) {
      const scores = computeMuscleScores(rows, 'totalVolume');
      expect(scores.get('delts_front')).toBe(.5);
      expect(scores.get('front_delts')).toBe(.5);
      expect(scores.get('chest')).toBe(1);
    }
  });

  it('retains half sets without rescaling after filtering or another muscle exceeding its target', () => {
    const rows = [.5, 2, 4].map((count, index) => comparedMuscle(['chest', 'biceps', 'quads'][index], count, 10, 'workingSetCount'));
    expect([...computeMuscleScores(rows, 'workingSetCount', SET_TARGETS).values()]).toEqual([-.875, -.5, 0]);
    expect([...computeMuscleScores(rows.slice(0, 2), 'workingSetCount', SET_TARGETS).values()]).toEqual([-.875, -.5]);
    const outlier = comparedMuscle('back_lats', 410, 10, 'workingSetCount');
    expect([...computeMuscleScores([...rows, outlier], 'workingSetCount', SET_TARGETS).values()]).toEqual([-.875, -.5, 0, 1]);
  });

  it('keeps all-loss, unchanged-only and empty figures anchored without inventing gains', () => {
    const losses = [comparedMuscle('chest', 90, 100), comparedMuscle('quads', 60, 100)];
    expect([...computeMuscleScores(losses, 'totalVolume').values()]).toEqual([-.25, -1]);
    expect([...computeMuscleScores([comparedMuscle('chest', 100, 100)], 'totalVolume').values()]).toEqual([0]);
    expect([...computeMuscleScores([], 'totalVolume')]).toEqual([]);
    expect([...computeMuscleScores([comparedMuscle('chest', 0, 0), comparedMuscle('quads', null, 2)], 'totalVolume').values()]).toEqual([null, null]);
  });
});

describe('buildThemeShadePalette', () => {
  const themes = [...themePresets, { id: 'custom', seeds: seedsFromHue(225) }];
  it.each(themes)('interpolates ordered theme shades independently of facet lighting in $id', preset => {
    const roles = generateRoles(preset.seeds);
    const palette = buildThemeShadePalette(roles);
    expect(palette.neutral).toHaveLength(SHADE_STEPS);
    expect(buildMuscleShadeRamp(null, palette)).toEqual(palette.neutral);
    expect(buildMuscleShadeRamp(NaN, palette)).toEqual(palette.neutral);
    for (const [score, seed] of [[-1, roles.viz1], [0, roles.viz2], [1, roles.viz4]] as const) {
      const ramp = buildMuscleShadeRamp(score, palette);
      expect(ramp).toHaveLength(SHADE_STEPS);
      const hueDifference = Math.abs(hexToLch(ramp[6]).hue - hexToLch(seed).hue);
      expect(Math.min(hueDifference, 360 - hueDifference)).toBeLessThan(3);
    }
    for (let step = 0; step < SHADE_STEPS; step += 1) {
      const lightness = [-1, -.5, -.25, 0, .02, .5, 1].map(score => {
        const fill = buildMuscleShadeRamp(score, palette)[step];
        expect(fill).toMatch(/^#[0-9A-F]{6}$/);
        return hexToLch(fill).lightness;
      });
      for (let i = 1; i < lightness.length; i++) expect(lightness[i - 1]).toBeGreaterThan(lightness[i]);
    }
  });
});

describe('projectMuscleBody & hitTestProjectedMuscle', () => {
  it('draws intermediate scores as intermediate fills at identical facet lighting, independent of selection', () => {
    const palette = buildThemeShadePalette();
    const snapshots = [.02, .5, 1].map(score => projectMuscleBody({ angleDeg: 0, width: 280, height: 280,
      scores: new Map([['chest', score]]), palette }).triangles.filter(triangle => triangle.muscleGroupId === 'chest'));
    for (let i = 0; i < snapshots[0].length; i++) {
      expect(hexToLch(snapshots[0][i].fill).lightness).toBeGreaterThan(hexToLch(snapshots[1][i].fill).lightness);
      expect(hexToLch(snapshots[1][i].fill).lightness).toBeGreaterThan(hexToLch(snapshots[2][i].fill).lightness);
    }
    const scores = computeMuscleScores([comparedMuscle('chest', 125, 100), comparedMuscle('back_lats', 150, 100)], 'totalVolume');
    for (const angleDeg of [0, 45, 180]) {
      const options = { angleDeg, width: 280, height: 280, scores, palette };
      const unselected = projectMuscleBody(options);
      const selected = projectMuscleBody({ ...options, selectedId: 'chest' });
      expect(selected.triangles.map(triangle => triangle.fill)).toEqual(unselected.triangles.map(triangle => triangle.fill));
      expect(scores.get('chest')).toBe(.5);
      expect(unselected.triangles.filter(triangle => triangle.muscleGroupId === 'chest')
        .every(triangle => buildMuscleShadeRamp(.5, palette).includes(triangle.fill))).toBe(true);
    }
  });

  it.each(themePresets)('projects the $id theme shades and preserves them when selected', preset => {
    const muscles = [makeMuscle('chest', 'Chest', 8), makeMuscle('quads', 'Quads', 4), makeMuscle('delts_front', 'Front delts', 6), makeMuscle('biceps', 'Biceps', 0)];
    muscles[1] = comparedMuscle('quads', 4, 8, 'workingSetCount');
    muscles[2] = comparedMuscle('delts_front', 6, 6, 'workingSetCount');
    muscles[3] = comparedMuscle('biceps', 0, 8, 'workingSetCount');
    const scores = computeMuscleScores(muscles, 'workingSetCount', SET_TARGETS);
    const palette = buildThemeShadePalette(generateRoles(preset.seeds));
    for (const selectedId of [null, 'quads']) {
      const projected = projectMuscleBody({ angleDeg: 0, width: 280, height: 280, scores, selectedId, palette });
      for (const [id, score] of [['chest', 1], ['quads', 0], ['delts_front', .5], ['biceps', null]] as const) {
        const facets = projected.triangles.filter(triangle => triangle.muscleGroupId === id);
        expect(facets.length).toBeGreaterThan(0);
        expect(facets.every(triangle => buildMuscleShadeRamp(score, palette).includes(triangle.fill))).toBe(true);
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

    const scores = computeMuscleScores(
      MUSCLE_MAP_REFERENCE.map((ref, idx) => makeMuscle(ref.id, ref.label, idx + 1)),
      'workingSetCount'
    );

    const width = 280;
    const height = 280;
    const front = projectMuscleBody({ angleDeg: 0, width, height, scores });
    expect(front.triangles.length).toBeGreaterThan(1500);
    expect(front.batches.length).toBeGreaterThan(0);

    const leftTris = front.triangles.filter(t => (t.x0 + t.x1 + t.x2) / 3 < width / 2);
    const rightTris = front.triangles.filter(t => (t.x0 + t.x1 + t.x2) / 3 > width / 2);
    expect(leftTris.length).toBe(rightTris.length);

    // Every canonical muscle is projected and hit-testable across canonical viewing angles.
    const angles = [0, 45, 90, 135, 180];
    const projections = angles.map(angleDeg =>
      projectMuscleBody({ angleDeg, width, height, scores })
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
    const back = projectMuscleBody({ angleDeg: 180, width, height, scores, selectedId: 'back_lats' });
    expect(back.batches.some(b => b.selected)).toBe(true);
    expect(back.fibres.surface.startsWith('M')).toBe(true);
    expect(front.fibres).toEqual({ surface: '', deep: '' });

    // Selection is surfaced even when the owning anatomy faces away.
    const chestFromBack = projectMuscleBody({ angleDeg: 180, width, height, scores, selectedId: 'chest' });
    expect(chestFromBack.fibres.surface.startsWith('M')).toBe(true);
    expect(chestFromBack.fibres.anatomicalParts?.[0].d.startsWith('M')).toBe(true);

    const latsTri = back.triangles.filter(t => t.muscleGroupId === 'back_lats').at(-1)!;
    const latsCx = (latsTri.x0 + latsTri.x1 + latsTri.x2) / 3;
    const latsCy = (latsTri.y0 + latsTri.y1 + latsTri.y2) / 3;
    expect(hitTestProjectedMuscle(back, latsCx, latsCy)).toBe('back_lats');

    expect(projectMuscleBody({ angleDeg: 0, width: 0, height: 280, scores })).toEqual({
      triangles: [],
      batches: [],
      fibres: { surface: '', deep: '' },
    });
  });
});

describe('November face decoration', () => {
  it.each([0, 45, 90, 135, 180, 225, 315])('preserves anatomy, colours, hit tests and selection at %s degrees', angleDeg => {
    const options = { angleDeg, width: 280, height: 280, selectedId: 'chest',
      scores: computeMuscleScores([makeMuscle('chest', 'Chest', 8)], 'workingSetCount') };
    const ordinary = projectMuscleBody(options);
    const november = projectMuscleBody({ ...options, november: true });
    expect(november.triangles).toEqual(ordinary.triangles);
    expect(november.batches.slice(0, ordinary.batches.length)).toEqual(ordinary.batches);
    expect(november.fibres).toEqual(ordinary.fibres);
    for (const triangle of ordinary.triangles.filter((_, index) => index % 37 === 0)) {
      const x = (triangle.x0 + triangle.x1 + triangle.x2) / 3;
      const y = (triangle.y0 + triangle.y1 + triangle.y2) / 3;
      expect(hitTestProjectedMuscle(november, x, y)).toBe(hitTestProjectedMuscle(ordinary, x, y));
    }
  });

  it('projects the charcoal handlebar with the face and culls it from the back', () => {
    const project = (angleDeg: number, november = true) => projectMuscleBody({ angleDeg, november,
      width: 280, height: 280, scores: new Map() }).batches.filter(batch => batch.fill === MOUSTACHE_FILL);
    expect(project(0, false)).toEqual([]);
    expect(project(0).length).toBeGreaterThan(0);
    expect(project(45).length).toBeGreaterThan(0);
    expect(project(45).map(batch => batch.d)).not.toEqual(project(0).map(batch => batch.d));
    expect(project(0).every(batch => !batch.selected)).toBe(true);
    expect(project(180)).toEqual([]);
    expect(projectMuscleBody({ angleDeg: 0, november: true, width: 0, height: 280, scores: new Map() }).batches).toEqual([]);
  });

  it('uses the device calendar through restoration, while preserving rotation and controls', () => {
    jest.setSystemTime(new Date(2026, 10, 30, 23, 59, 59));
    const onSelect = jest.fn();
    render(<MuscleBodyCard metric="workingSetCount" muscles={[makeMuscle('chest', 'Chest', 8)]}
      selectedId="chest" onSelect={onSelect} />);
    const moustache = () => screen.UNSAFE_getAllByType(Path).filter(path => path.props.fill === MOUSTACHE_FILL);
    const viewport = screen.getByTestId('stats-muscle-body-viewport');
    expect(moustache().length).toBeGreaterThan(0);
    expect(screen.getByTestId('stats-muscle-body-comparison-now')).toHaveTextContent(/^8$/);
    const front = moustache().map(path => path.props.d);
    fireEvent(viewport, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(moustache().map(path => path.props.d)).not.toEqual(front);
    fireEvent.press(screen.getByTestId('stats-muscle-body-angle-back'));
    expect(moustache()).toEqual([]);
    fireEvent.press(screen.getByTestId('stats-muscle-body-angle-front'));
    expect(moustache().length).toBeGreaterThan(0);
    const fibres = fibreDefinitionD('stats-muscle-body-fibres-surface-shade');
    act(() => { jest.advanceTimersByTime(1000); });
    expect(moustache()).toEqual([]);
    expect(fibreDefinitionD('stats-muscle-body-fibres-surface-shade')).toBe(fibres);
    expect(viewport.props.accessibilityValue).toEqual({ text: 'Front view, 0 degrees' });
    expect(screen.getByTestId('stats-muscle-body-comparison-now')).toHaveTextContent(/^8$/);
    fireEvent.press(screen.getByTestId('stats-muscle-body-target-chest'));
    expect(onSelect).toHaveBeenCalledWith('chest');
  });
});

describe('MuscleBodyCard', () => {
  const muscles = [
    makeMuscle('chest', 'Chest', 8, 3200),
    makeMuscle('back_lats', 'Lats', 6, 2400),
    makeMuscle('quads', 'Quads', 4, 1600),
  ];

  it('repaints SVG target shades when targets or periods change and keeps untrained muscles neutral', () => {
    const rows = [comparedMuscle('chest', 2, 8, 'workingSetCount'),
      comparedMuscle('biceps', 0, 8, 'workingSetCount'), comparedMuscle('quads', 8, 0, 'workingSetCount')];
    const props = { muscles: rows, metric: 'workingSetCount' as const, selectedId: null, onSelect: jest.fn() };
    const view = render(<MuscleBodyCard {...props} setTargets={SET_TARGETS} />);
    fireEvent(screen.getByTestId('stats-muscle-body-viewport'), 'layout', { nativeEvent: { layout: { width: 280, height: 280 } } });
    const fills = () => screen.getByTestId('stats-muscle-body-svg').findAllByType(Path)
      .filter(path => path.props.fill).map(path => path.props.fill);
    const expectedFills = (chest: number, biceps: number | null, quads: number) => projectMuscleBody({ angleDeg: 0, width: 280, height: 280,
      scores: new Map([['chest', chest], ['biceps', biceps], ['quads', quads]]) }).batches.map(batch => batch.fill);
    expect(fills()).toEqual(expectedFills(-.5, null, 1));
    view.rerender(<MuscleBodyCard {...props} setTargets={{ ...SET_TARGETS, weeklyTarget: 4 }} />);
    expect(fills()).toEqual(expectedFills(0, null, 1));
    view.rerender(<MuscleBodyCard {...props} setTargets={{ weeklyTarget: 4, weeks: 4 }} />);
    expect(fills()).toEqual(expectedFills(-.75, null, 0));
    const volumeProps = { ...props, metric: 'totalVolume' as const,
      muscles: [comparedMuscle('chest', 0, 1000), comparedMuscle('biceps', 500, 1000), comparedMuscle('quads', 1000, 1000)] };
    view.rerender(<MuscleBodyCard {...volumeProps} setTargets={SET_TARGETS} />);
    expect(fills()).toEqual(expectedFills(-1, -.5, 0));
    const volumeFills = fills();
    view.rerender(<MuscleBodyCard {...volumeProps} setTargets={{ weeklyTarget: 100, weeks: 4 }} />);
    expect(fills()).toEqual(volumeFills);
  });

  it('omits the legend and keeps the selected muscle’s signed comparison', () => {
    render(<MuscleBodyCard metric="workingSetCount" muscles={muscles} selectedId="chest" onSelect={jest.fn()} />);
    expect(screen.queryByTestId('stats-muscle-body-legend')).toBeNull();
    expect(screen.queryByText('Decrease')).toBeNull();
    expect(screen.queryByText('Unchanged')).toBeNull();
    expect(screen.queryByText('Increase')).toBeNull();
    expect(screen.queryByText('% of max')).toBeNull();
    expect(screen.queryByText('% of target')).toBeNull();
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
      scores: computeMuscleScores(muscles, 'workingSetCount'),
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
    expect(screen.queryByTestId('stats-muscle-body-contour')).toBeNull();
    expect(screen.getByTestId('stats-muscle-body-fibres-surface-shade').props.strokeWidth).toBe(0.9);
    expect(screen.getByTestId('stats-muscle-body-fibres-anatomy-FJ1456-shade').props.strokeOpacity).toBe(0.70);
    const highlight = screen.UNSAFE_getAllByType(Use).find(path => path.props.testID === 'stats-muscle-body-fibres-surface-highlight')!;
    expect(highlight.props).toMatchObject({ stroke: uiRoles.surface, strokeWidth: 1.1,
      strokeOpacity: 0.95, translateX: 0.45, translateY: -0.45, strokeLinecap: 'round', strokeLinejoin: 'round' });
    expect(screen.UNSAFE_getAllByType(Use).find(path => path.props.testID === 'stats-muscle-body-fibres-surface-shade')!.props).toMatchObject({
      stroke: uiRoles.inkMuted, strokeOpacity: 0.72, fill: 'transparent', strokeLinecap: 'round', strokeLinejoin: 'round',
    });
    expect(screen.getByTestId('stats-muscle-body-svg').props.pointerEvents).toBe('none');
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

  it('paints each forearm component highlight then shade, preserving fibre separations at overlaps', () => {
    render(<MuscleBodyCard metric="workingSetCount" muscles={[makeMuscle('forearms_grip', 'Forearms', 8)]}
      selectedId="forearms_grip" onSelect={jest.fn()} />);
    const paths = screen.UNSAFE_getAllByType(Use).filter(path => path.props.testID?.startsWith('stats-muscle-body-fibres-anatomy-'));
    const parts = ['FJ1497', 'FJ1498', 'FJ1503', 'FJ1505', 'FJ1484', 'FJ1494', 'FJ1495', 'FJ1493', 'FJ1496', 'FJ1502', 'FJ1475', 'FJ1499', 'FJ1487', 'FJ1490', 'FJ1489', 'FJ1492', 'FJ1491', 'FJ1472', 'FJ1517', 'FJ1474', 'FJ1516', 'FJ1473', 'FJ1518'];
    expect(paths.map(path => path.props.testID)).toEqual(parts.flatMap(id => [
      `stats-muscle-body-fibres-anatomy-${id}-highlight`, `stats-muscle-body-fibres-anatomy-${id}-shade`,
    ]));
    expect(new Set(paths.map(path => path.props.testID)).size).toBe(46);
    expect(paths.every(path => path.props.fill === 'transparent')).toBe(true);
    expect(paths[0].props.href).toBe(paths[1].props.href);
    expect(paths[0].props.href).not.toBe(paths[2].props.href);
    const definitions = screen.UNSAFE_getAllByType(Path).filter(path => path.props.id);
    expect(definitions).toHaveLength(23);
    expect(new Set(paths.map(path => path.props.href)).size).toBe(23);
    for (const path of paths) expect(fibreDefinitionD(path.props.testID)).not.toBe('');
    expect(screen.queryByTestId('stats-muscle-body-fibres-deep-shade')).toBeNull();
  });

  it('explains schematic depth on demand without changing selection or rotation', () => {
    const onSelect = jest.fn();
    render(<MuscleBodyCard metric="workingSetCount" muscles={muscles} selectedId="chest" onSelect={onSelect} />);
    const viewport = screen.getByTestId('stats-muscle-body-viewport');
    fireEvent.press(screen.getByTestId('stats-muscle-body-angle-back'));
    const before = fibreDefinitionD('stats-muscle-body-fibres-surface-shade');
    expect(screen.queryByTestId('stats-muscle-body-help')).toBeNull();
    fireEvent.press(screen.getByLabelText('About the muscle model'));
    expect(screen.getByText(/Fibre directions are schematic, not measured anatomy/)).toBeTruthy();
    expect(screen.getByText(/BodyParts3D.*CC BY 4.0/)).toBeTruthy();
    expect(screen.getByText(/pose alignment, bilateral mirroring and schematic fibre generation/)).toBeTruthy();
    fireEvent(screen.getByTestId('stats-muscle-body-help'), 'accessibilityEscape');
    expect(screen.queryByTestId('stats-muscle-body-help')).toBeNull();
    expect(viewport.props.accessibilityValue.text).toBe('Back view, 180 degrees');
    expect(fibreDefinitionD('stats-muscle-body-fibres-surface-shade')).toBe(before);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('scopes fibre definitions to each mounted card', () => {
    const rows = [makeMuscle('chest', 'Chest', 8)];
    render(<>
      <MuscleBodyCard metric="workingSetCount" muscles={rows} selectedId="chest" onSelect={jest.fn()} />
      <MuscleBodyCard metric="workingSetCount" muscles={rows} selectedId="chest" onSelect={jest.fn()} />
    </>);
    const definitions = screen.UNSAFE_getAllByType(Path).filter(path => path.props.id);
    expect(definitions).toHaveLength(4);
    expect(new Set(definitions.map(path => path.props.id)).size).toBe(4);
    const references = screen.UNSAFE_getAllByType(Use).map(path => path.props.href.replace(/^#/, ''));
    for (const definition of definitions) {
      expect(references.filter(id => id === definition.props.id)).toHaveLength(2);
      expect(definition.props.stroke).toBeUndefined();
      expect(definition.props.fill).toBeUndefined();
    }
  });

  it('replaces referenced fibre definitions when selection changes', () => {
    const rows = [makeMuscle('forearms_grip', 'Forearms', 8), makeMuscle('chest', 'Chest', 8)];
    const view = render(<MuscleBodyCard metric="workingSetCount" muscles={rows}
      selectedId="forearms_grip" onSelect={jest.fn()} />);
    const oldIds = screen.UNSAFE_getAllByType(Path).filter(path => path.props.id).map(path => path.props.id);
    expect(oldIds).toHaveLength(23);
    view.rerender(<MuscleBodyCard metric="workingSetCount" muscles={rows} selectedId="chest" onSelect={jest.fn()} />);
    const definitions = screen.UNSAFE_getAllByType(Path).filter(path => path.props.id);
    expect(definitions).toHaveLength(2);
    expect(definitions.every(path => !oldIds.includes(path.props.id))).toBe(true);
    expect(fibreDefinitionD('stats-muscle-body-fibres-surface-shade')).not.toBe('');
    expect(fibreDefinitionD('stats-muscle-body-fibres-anatomy-FJ1456-shade')).not.toBe('');
    expect(screen.queryByTestId('stats-muscle-body-fibres-anatomy-FJ1497-shade')).toBeNull();
    view.rerender(<MuscleBodyCard metric="workingSetCount" muscles={rows} selectedId={null} onSelect={jest.fn()} />);
    expect(screen.UNSAFE_getAllByType(Path).filter(path => path.props.id)).toEqual([]);
    expect(screen.UNSAFE_queryAllByType(Use)).toEqual([]);
  });

  it('retains figures and controls for geometry-free muscles without fibres', () => {
    render(<MuscleBodyCard metric="workingSetCount" muscles={[makeMuscle('custom', 'Custom', 3)]}
      selectedId="custom" onSelect={jest.fn()} />);
    expect(screen.getByTestId('stats-muscle-body-selected')).toHaveTextContent('Custom');
    expect(screen.getByTestId('stats-muscle-body-comparison-now')).toHaveTextContent('3');
    expect(screen.queryByTestId('stats-muscle-body-fibres-surface-shade')).toBeNull();
    expect(screen.queryByTestId('stats-muscle-body-fibres-deep-shade')).toBeNull();
    expect(screen.getByTestId('stats-muscle-body-picker-trigger')).toBeTruthy();
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
      scores: computeMuscleScores(muscles, 'workingSetCount'),
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

});
