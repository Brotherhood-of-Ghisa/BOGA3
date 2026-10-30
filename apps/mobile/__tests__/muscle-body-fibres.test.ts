import { isModelFibre, MUSCLE_BODY_FASCICLES, type MuscleBodyFibreSelection, type TriangleFibreSegment } from '@/components/stats/muscle-body-fibres';
import { MUSCLE_BODY_MESH, type MuscleBodyMesh } from '@/components/stats/muscle-body-mesh';
import { MUSCLE_MAP_REFERENCE } from '@/components/stats/muscle-map-reference';
import { hitTestProjectedMuscle, projectMuscleBody, selectMuscleFibres } from '@/components/stats/muscle-body-projection';
import { buildMuscleReportAssignment } from '@/src/data/muscle-report-presets';
import { broadMuscleRows } from './helpers/broad-muscle-report';

const options = { angleDeg: 0, width: 280, height: 280, scores: new Map<string, number | null>() };
const segmentCount = (d: string) => (d.match(/M/g) ?? []).length;
const empty = { segments: [], anatomicalParts: [] };
const combine = (selections: MuscleBodyFibreSelection[]) => ({
  segments: selections.flatMap(s => s.segments), anatomicalParts: selections.flatMap(s => s.anatomicalParts),
});
const modelKey = (s: readonly number[]) => [s.slice(0, 3).join(','), s.slice(3, 6).join(',')].sort().join('|') + `|${s.slice(6).join(',')}`;

describe('reported muscle fibre selection', () => {
  it.each(MUSCLE_MAP_REFERENCE)('selects every independent segment on both sides of $id, at front/rear/oblique angles', ({ id }) => {
    const selected = selectMuscleFibres(id);
    expect(selected.segments).toEqual(MUSCLE_BODY_FASCICLES[id].segments.filter(s => !isModelFibre(s)));
    expect(selected.anatomicalParts.flatMap(part => part.chains.flat()).map(modelKey).sort())
      .toEqual(MUSCLE_BODY_FASCICLES[id].segments.filter(isModelFibre).map(modelKey).sort());
    for (const angleDeg of [0, 45, 180]) {
      const { fibres } = projectMuscleBody({ ...options, angleDeg, selectedId: id, selectedFibres: selected });
      const original = selected.segments;
      expect(segmentCount(fibres.surface)).toBe(original.filter(s => s.layer === 'surface').length);
      const modelCount = selected.anatomicalParts.flatMap(part => part.chains.flat()).length;
      const oldDeep = original.filter(s => s.layer === 'deep-projection').length;
      expect(segmentCount(fibres.deep)).toBe(oldDeep);
      expect(fibres.anatomicalParts?.length ?? 0).toBe(selected.anatomicalParts.length);
      expect(segmentCount(fibres.anatomicalParts?.map(part => part.d).join('') ?? '')).toBeLessThanOrEqual(modelCount * 2);
      const paths = fibres.surface + fibres.deep + (fibres.anatomicalParts?.map(part => part.d).join('') ?? '');
      expect(paths).not.toMatch(/NaN|Infinity/);
      expect(paths.match(/L/g)!.length).toBeGreaterThan(0);
      const xCoords = [...paths.matchAll(/M(-?[\d.]+)/g)].map(m => Number(m[1]));
      if (angleDeg !== 45) {
        expect(xCoords.some(x => x < options.width / 2)).toBe(true);
        expect(xCoords.some(x => x > options.width / 2)).toBe(true);
      }
    }
  });

  it('merges tracked anatomy through Broad and Custom, and honours disabled members and aliases', () => {
    const report = buildMuscleReportAssignment(broadMuscleRows([], ['serratus_anterior']));
    expect(selectMuscleFibres('chest', report)).toEqual(selectMuscleFibres('chest'));
    const backIds = ['back_lats', 'back_upper', 'traps_upper', 'traps_lower'];
    expect(selectMuscleFibres('back_lats', report)).toEqual(
      combine(backIds.map(id => selectMuscleFibres(id))));
    expect(selectMuscleFibres('serratus_anterior', report)).toEqual(empty);
    for (const [legacy, canonical] of [['front_delts', 'delts_front'], ['side_delts', 'delts_lateral'], ['rear_delts', 'delts_rear']]) {
      expect(selectMuscleFibres(legacy)).toEqual(selectMuscleFibres(canonical));
    }
    const rows = broadMuscleRows().map(row => ({ ...row,
      reportGroup: ['biceps', 'brachialis'].includes(row.id) ? 'biceps' : null,
    }));
    const custom = buildMuscleReportAssignment(rows);
    const id = custom.get('biceps')!.muscle.id;
    expect(selectMuscleFibres(id, custom)).toEqual(combine(['biceps', 'brachialis'].map(member => selectMuscleFibres(member))));
    const disabled = buildMuscleReportAssignment(broadMuscleRows(['chest']));
    expect(selectMuscleFibres('chest', disabled)).toEqual(empty);
  });

  it('returns no invented fibres for no selection, unknown/custom IDs or missing assets', () => {
    expect(selectMuscleFibres(null)).toEqual(empty);
    expect(selectMuscleFibres('custom')).toEqual(empty);
    expect(selectMuscleFibres('chest', undefined, {})).toEqual(empty);
    expect(projectMuscleBody({ ...options, mesh: { vertices: [], faces: [], materials: [] }, selectedId: 'chest' }))
      .toEqual({ triangles: [], batches: [], fibres: { surface: '', deep: '' } });
    for (const width of [0, -1, NaN, Infinity]) {
      expect(projectMuscleBody({ ...options, width, selectedId: 'chest' }))
        .toEqual({ triangles: [], batches: [], fibres: { surface: '', deep: '' } });
    }
  });
});

const mesh: MuscleBodyMesh = {
  materials: ['neutral', 'chest', 'back_lats'],
  vertices: [[-.2, 0, .1], [.2, 0, .1], [0, .4, .1], [-.6, -.2, .3], [.6, -.2, .3], [0, .8, .3]],
  // The anchored face is back-facing and covered by a nearer unrelated triangle.
  faces: [[0, 2, 1, 1], [3, 4, 5, 2]],
};
const segments: readonly TriangleFibreSegment[] = [
  { face: 0, a: [1, 0, 0], b: [0, 1, 0], layer: 'surface' },
  { face: 0, a: [.25, .5, .25], b: [0, 0, 1], layer: 'deep-projection' },
];

it.each([0, 45, 90, 180])('reconstructs barycentric anchors with the body camera at %s degrees, without joining gaps', angleDeg => {
  const projected = projectMuscleBody({ ...options, mesh, angleDeg, selectedId: 'chest', selectedFibres: { segments, anatomicalParts: [] } });
  const point = ([x, y, z]: readonly number[]) => {
    const rad = angleDeg * Math.PI / 180;
    const scale = options.height / 2.02;
    return `${Math.round((140 + (x * Math.cos(rad) + z * Math.sin(rad)) * scale) * 10) / 10} ${Math.round((140 - y * scale) * 10) / 10}`;
  };
  expect(projected.fibres).toEqual({
    surface: `M${point([-.2, 0, .1])}L${point([0, .4, .1])}`,
    deep: `M${point([0, .2, .1])}L${point([.2, 0, .1])}`,
  });
  const unselected = projectMuscleBody({ ...options, mesh, angleDeg });
  expect(projected.triangles.map(t => t.fill)).toEqual(unselected.triangles.map(t => t.fill));
  for (const triangle of unselected.triangles) {
    const x = (triangle.x0 + triangle.x1 + triangle.x2) / 3;
    const y = (triangle.y0 + triangle.y1 + triangle.y2) / 3;
    expect(hitTestProjectedMuscle(projected, x, y)).toBe(hitTestProjectedMuscle(unselected, x, y));
  }
  if (angleDeg === 0) {
    expect(projected.triangles.some(t => t.muscleGroupId === 'chest')).toBe(false);
    expect(hitTestProjectedMuscle(projected, 140, 120)).toBe('back_lats');
  }
});

it('keeps Chest at 180 degrees surfaced while hit testing still sees the back', () => {
  const back = projectMuscleBody({ ...options, angleDeg: 180, selectedId: 'chest' });
  // A few edge-on chest facets survive the body's culling tolerance; most are hidden.
  const front = projectMuscleBody({ ...options, selectedId: 'chest' });
  expect(back.triangles.filter(t => t.muscleGroupId === 'chest').length)
    .toBeLessThan(front.triangles.filter(t => t.muscleGroupId === 'chest').length / 4);
  expect(segmentCount(back.fibres.surface)).toBe(MUSCLE_BODY_FASCICLES.chest.segments.filter(s => !isModelFibre(s)).length);
  expect(segmentCount(back.fibres.anatomicalParts?.map(part => part.d).join('') ?? '')).toBeGreaterThan(0);
  const plainBack = projectMuscleBody({ ...options, angleDeg: 180 });
  expect(back.triangles.map(({ selected, ...triangle }) => triangle))
    .toEqual(plainBack.triangles.map(({ selected, ...triangle }) => triangle));
  expect(MUSCLE_BODY_MESH.faces.length).toBe(4416);
});
