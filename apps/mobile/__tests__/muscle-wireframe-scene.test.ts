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

it('does not let hidden anatomy intercept a covering body region or a point outside the body', () => {
  const point = projectWireframePoint([0, 0, -1], camera).slice(0, 2) as [number, number];
  expect(hitWireframe({ point, camera, selected: [triangle], selectedId: 'brachialis' })).toBe('abs_rectus');
  expect(hitWireframe({ point: [-100, -100], camera, selected: [triangle], selectedId: 'brachialis' })).toBeNull();
});

it.each([0, 60, 90, 120, 180, 240, 270, 300])('uses the visible skin at %s degrees even when both sides belong to a combined selection', angle => {
  const view = wireframeCamera({ angle, width: 280, height: 420, selected: [], focus: false });
  const selected = [...selectMuscleMeshes('quads'), ...selectMuscleMeshes('hamstrings')];
  const point = projectWireframePoint([.15, -.25, .03], view).slice(0, 2) as [number, number];
  const visible = hitWireframe({ point, camera: view, selected: [], selectedId: null });
  const quads = hitWireframe({ point, camera: view, selected: selectMuscleMeshes('quads'), selectedId: 'quads' });
  expect(quads).toBe(visible);
  const muscle = { id: 'cm_legs', displayName: 'Legs', familyName: 'Legs', sortOrder: 0 };
  const report: MuscleReportAssignment = new Map([
    ['quads', { muscle, tracked: true }], ['hamstrings', { muscle, tracked: true }],
  ]);
  const combined = hitWireframe({ point, camera: view, selected, selectedId: muscle.id, report });
  expect(combined).toBe(['quads', 'hamstrings'].includes(visible ?? '') ? muscle.id : visible);
});

it('keeps front quads selectable, selects hamstrings through their back view, and rejects back-facing selected triangles', () => {
  const point = projectWireframePoint([.15, -.25, .03], camera).slice(0, 2) as [number, number];
  const selected = selectMuscleMeshes('quads');
  expect(hitWireframe({ point, camera, selected, selectedId: 'quads' })).toBe('quads');
  const back = wireframeCamera({ angle: 180, width: 280, height: 420, selected, focus: false });
  const backPoint = projectWireframePoint([.15, -.25, .03], back).slice(0, 2) as [number, number];
  expect(hitWireframe({ point: backPoint, camera: back, selected, selectedId: 'quads' })).toBe('hamstrings');
  const reversed = { ...triangle, group: 'abs_rectus', part: { ...triangle.part, faces: [[0, 2, 1]] } };
  const centre = projectWireframePoint([0, 0, -1], camera).slice(0, 2) as [number, number];
  expect(hitWireframe({ point: centre, camera, selected: [reversed], selectedId: 'custom' })).toBe('abs_rectus');
});

it.each([90, 270])('does not paint or pick the focused limb through its counterpart at %s degrees', angle => {
  const selected = selectMuscleMeshes('brachialis', undefined, true);
  const camera = wireframeCamera({ angle, width: 280, height: 420, selected, focus: true });
  // A point inside the right brachialis, covered by the left arm at 90 degrees.
  const point = projectWireframePoint([.34368, .330576, .0006803], camera).slice(0, 2) as [number, number];
  expect(hitWireframe({ point, camera, selected: [], selectedId: null })).toBe('brachialis');
  expect(hitWireframe({ point, camera, selected, selectedId: 'focused-limb' })).toBe(angle === 90 ? 'brachialis' : 'focused-limb');
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
