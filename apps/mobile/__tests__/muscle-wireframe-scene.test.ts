import { BODY_WIRE_INSTANCES, MUSCLE_ANATOMY, hitWireframe, projectWireframePoint,
  selectMuscleMeshes, wireframeCamera, wireframeVertices, type AnatomyInstance } from '@/components/stats/muscle-wireframe-scene';
import type { MuscleReportAssignment } from '@/src/data/muscle-analytics';

const camera = wireframeCamera({ angle: 0, width: 280, height: 420, selected: [], focus: false });
const triangle: AnatomyInstance = { group: 'brachialis', side: 1,
  part: { id: 'test', vertices: [[-.1, -.1, -1], [.1, -.1, -1], [0, .1, -1]], faces: [[0, 1, 2]] } };

it('provides all catalogue meshes, aliases and bilateral anatomy, without inventing custom geometry', () => {
  expect(Object.keys(MUSCLE_ANATOMY)).toHaveLength(25);
  for (const id of Object.keys(MUSCLE_ANATOMY)) expect(selectMuscleMeshes(id).length).toBeGreaterThan(0);
  expect(selectMuscleMeshes('front_delts')).toEqual(selectMuscleMeshes('delts_front'));
  expect(selectMuscleMeshes(null)).toEqual([]);
  expect(selectMuscleMeshes('custom')).toEqual([]);
  expect(selectMuscleMeshes('brachialis').map(mesh => mesh.side)).toEqual([1, -1]);
  expect(selectMuscleMeshes('brachialis', undefined, true).map(mesh => mesh.side)).toEqual([1]);
  expect(selectMuscleMeshes('chest', undefined, true)).toHaveLength(selectMuscleMeshes('chest').length);
});

it('reveals only tracked members of the reported combined muscle', () => {
  const muscle = { id: 'cm_arm', displayName: 'Arms', familyName: 'Arms', sortOrder: 0 };
  const report: MuscleReportAssignment = new Map([
    ['brachialis', { muscle, tracked: true }], ['biceps', { muscle, tracked: true }],
    ['triceps', { muscle, tracked: false }],
  ]);
  expect(new Set(selectMuscleMeshes('cm_arm', report).map(mesh => mesh.group))).toEqual(new Set(['brachialis', 'biceps']));
  expect(selectMuscleMeshes('triceps', report)).toEqual([]);
  expect(selectMuscleMeshes('brachialis', report)).toEqual([]);
});

it('focuses the selected geometry and rotates consistently with projection', () => {
  const selected = selectMuscleMeshes('brachialis', undefined, true);
  const focus = wireframeCamera({ angle: 450, width: 280, height: 420, selected, focus: true });
  expect(focus.sin).toBeCloseTo(1); expect(focus.cos).toBeCloseTo(0);
  expect(focus.scale).toBeGreaterThan(camera.scale);
  const centre = projectWireframePoint([0, focus.centreY, focus.centreX], focus);
  expect(centre[0]).toBeCloseTo(140); expect(centre[1]).toBeCloseTo(210);
  expect(wireframeCamera({ angle: 0, width: 0, height: 0, selected: [], focus: false }).scale).toBe(0);
});

it('uses triangle barycentrics and preserves outward normals when mirroring', () => {
  const vertices = wireframeVertices([triangle, { ...triangle, side: -1 }]);
  expect(vertices).toHaveLength(54);
  expect(Array.from(vertices.slice(3, 9))).toEqual([0, 0, 1, 1, 0, 0]);
  expect(Array.from(vertices.slice(27 + 3, 27 + 9))).toEqual([0, 0, 1, 1, 0, 0]);
  expect(Array.from(vertices).every(Number.isFinite)).toBe(true);
});

it('lets revealed selected geometry win over the covering body and ignores its back faces', () => {
  const point = projectWireframePoint([0, 0, -1], camera).slice(0, 2) as [number, number];
  expect(hitWireframe({ point, camera, selected: [triangle], selectedId: 'brachialis' })).toBe('brachialis');
  const reversed = { ...triangle, part: { ...triangle.part, faces: [[0, 2, 1]] } };
  expect(hitWireframe({ point, camera, selected: [reversed], selectedId: 'custom' })).not.toBe('custom');
  expect(hitWireframe({ point: [-100, -100], camera, selected: [], selectedId: null })).toBeNull();
});

it('selects visible body regions under their report key and ignores untracked regions', () => {
  const chest = BODY_WIRE_INSTANCES.find(mesh => mesh.group === 'chest')!;
  const points = chest.part.faces.map(face => {
    const centre = [0, 1, 2].map(axis => face.slice(0, 3).reduce((n, i) => n + chest.part.vertices[i][axis], 0) / 3);
    return projectWireframePoint(centre as [number, number, number], camera).slice(0, 2) as [number, number];
  });
  const point = points.find(point => hitWireframe({ point, camera, selected: [], selectedId: null }) === 'chest')!;
  expect(point).toBeDefined();
  const muscle = { id: 'cm_chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0 };
  const report = new Map([['chest', { muscle, tracked: true }]]);
  expect(hitWireframe({ point, camera, selected: [], selectedId: null, report })).toBe('cm_chest');
  report.set('chest', { muscle, tracked: false });
  expect(hitWireframe({ point, camera, selected: [], selectedId: null, report })).toBeNull();
});
