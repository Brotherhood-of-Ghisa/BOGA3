import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isModelFibre, MUSCLE_BODY_FASCICLES, type ModelFibreSegment } from '@/components/stats/muscle-body-fibres';
import { MUSCLE_BODY_MESH } from '@/components/stats/muscle-body-mesh';
import { projectMuscleBody } from '@/components/stats/muscle-body-projection';

const { registeredGuides } = require('../scripts/anatomy/apply-guides.cjs');
const source = require('../scripts/anatomy/source.json');
const { validateAsset } = require('../scripts/validate-muscle-body-fascicles.cjs');
const assetPath = path.join(__dirname, '../components/stats/muscle-body-fascicles.json');
const meshBytes = fs.readFileSync(path.join(__dirname, '../components/stats/muscle-body-mesh.json'));
const options = { width: 280, height: 280, angleDeg: 0, scores: new Map() };

it('preserves the body mesh and every approved anatomical endpoint/normal, excluding only zero-length lines', () => {
  expect(createHash('sha256').update(meshBytes).digest('hex')).toBe('ecb9032f3fae6d8e7818ae5a923d906ee47921eb5ff2a2cf6201f44c4521da09');
  const groups = registeredGuides();
  expect(Object.keys(groups)).toHaveLength(14);
  expect(Object.values(source.groups).flat()).toHaveLength(63);
  for (const [id, parts] of Object.entries(groups) as [string, any[]][]) {
    const expected = parts.flatMap(part => part.segments).filter(s => Math.hypot(s[0] - s[3], s[1] - s[4], s[2] - s[5]) > 1e-10);
    expect(JSON.stringify(MUSCLE_BODY_FASCICLES[id].segments.filter(isModelFibre))).toBe(JSON.stringify(expected));
    expect(MUSCLE_BODY_FASCICLES[id].segments.filter(s => !isModelFibre(s)).length > 0).toBe(['chest', 'back_upper'].includes(id));
  }
  expect(source.excluded).toEqual(['multifidus', 'tensor fasciae latae', 'intrinsic hand muscles', 'adductor minimus']);
  expect(Object.values(source.groups).flat()).not.toContain('FJ1404');
  expect(source.sources.models.FJ1543.name).toBe('spinalis (atlas component FJ1543)');
  expect(source.registration.FJ3387.targetDistal).toEqual([.20199614727224702, -.876, -.05126610850908306]);
});

it.each([
  ['NaN model coordinate', (a: any) => { a.muscles.brachialis.segments[0][0] = NaN; }],
  ['wrong normal', (a: any) => { a.muscles.brachialis.segments[0][6] = 10; }],
  ['wrong tuple size', (a: any) => { a.muscles.brachialis.segments[0].pop(); }],
  ['missing source component', (a: any) => { a.muscles.calves.anatomicalParts.pop(); }],
  ['lost source cap', (a: any) => { a.muscles.brachialis.segments = a.muscles.brachialis.segments.map((s: number[]) => s.map((v, i) => i === 1 || i === 4 ? v * .5 : v)); }],
  ['wrong registration', (a: any) => { a.anatomy.registration.FJ3387.targetDistal[0] = .157; }],
  ['missing source attribution', (a: any) => { delete a.anatomy.sources.attribution; }],
  ['old deep duplicate', (a: any) => { a.muscles.chest.segments.unshift({ ...a.muscles.chest.segments[0], layer: 'deep-projection' }); }],
])('rejects %s offline', (_name, mutate) => {
  const asset = JSON.parse(fs.readFileSync(assetPath, 'utf8'));
  mutate(asset);
  expect(() => validateAsset(asset, meshBytes)).toThrow(/Invalid fascicle asset/);
});

it.each([0, 45, 90, 180, 270])('projects independent coordinates with the body camera at %s degrees, culling its own far surface', angleDeg => {
  const segment: ModelFibreSegment = [.2, .1, .05, .3, .2, .05, 1, 0, 0];
  const projected = projectMuscleBody({ ...options, angleDeg, selectedId: 'brachialis', selectedFibres: { segments: [], anatomicalParts: [{ id: 'synthetic', chains: [[segment]] }] } });
  const expectedSides = angleDeg === 90 || angleDeg === 45 ? [-1] : angleDeg === 270 ? [1] : [1, -1];
  const rad = angleDeg * Math.PI / 180;
  const point = (side: number, x: number, y: number) => `${Math.round((140 + (side * x * Math.cos(rad) + .05 * Math.sin(rad)) * 280 / 2.02) * 10) / 10} ${Math.round((140 - y * 280 / 2.02) * 10) / 10}`;
  expect(projected.fibres.anatomicalParts).toEqual([{ id: 'synthetic', d: expectedSides.map(side => `M${point(side, .2, .1)}L${point(side, .3, .2)}`).join('') }]);
  const ordinary = projectMuscleBody({ ...options, angleDeg });
  expect(projected.triangles.map(({ selected, ...triangle }) => triangle)).toEqual(ordinary.triangles.map(({ selected, ...triangle }) => triangle));
  expect(projected.fibres.surface).toBe('');
});

it('reveals independent coordinates outside the original brachialis patch without changing body geometry', () => {
  const selected = projectMuscleBody({ ...options, selectedId: 'brachialis' });
  const plain = projectMuscleBody(options);
  expect(selected.fibres.anatomicalParts!.map(part => part.d).join('').length).toBeGreaterThan(1000);
  expect(plain.fibres).toEqual({ surface: '', deep: '' });
  expect(selected.triangles.map(({ selected, ...triangle }) => triangle)).toEqual(plain.triangles.map(({ selected, ...triangle }) => triangle));
  expect(MUSCLE_BODY_MESH.vertices).toHaveLength(2210);
});
