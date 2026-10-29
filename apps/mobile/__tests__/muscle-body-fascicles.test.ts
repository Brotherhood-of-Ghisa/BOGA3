import fs from 'node:fs';
import path from 'node:path';
import { MUSCLE_MAP_REFERENCE } from '../components/stats/muscle-map-reference';

const { generate, trimRectus } = require('../scripts/generate-muscle-body-fascicles.cjs');
const { validateAsset, validateSegment } = require('../scripts/validate-muscle-body-fascicles.cjs');
const { reconstruct, projectedPath } = require('../scripts/fascicle-geometry.cjs');
const meshBytes = fs.readFileSync(path.join(__dirname, '../components/stats/muscle-body-mesh.json'));
const mesh = JSON.parse(meshBytes.toString());
const committed = fs.readFileSync(path.join(__dirname, '../components/stats/muscle-body-fascicles.json'), 'utf8');
const fresh = () => JSON.parse(committed);

describe('offline fascicle companion asset', () => {
  it('regenerates byte-for-byte, covers the exact catalog bilaterally and declares schematic provenance', () => {
    const asset = generate(meshBytes);
    expect(JSON.stringify(asset) + '\n').toBe(committed);
    expect(Object.keys(asset.muscles).sort()).toEqual(MUSCLE_MAP_REFERENCE.map(m => m.id).sort());
    for (const muscle of Object.values(asset.muscles) as any[]) {
      expect(muscle.segments.some(Array.isArray) || [-1, 1].every(side => muscle.segments.some((s: any) => s.side === side))).toBe(true);
      expect(muscle.quality).toBe('schematic-not-anatomically-validated');
      expect(muscle.limitations.length).toBeGreaterThan(0);
      expect(muscle.sourceIds.every((id: string) => asset.sources[id]?.url.startsWith('https://'))).toBe(true);
    }
    expect(asset).not.toHaveProperty('broad');
    expect(asset.muscles).not.toHaveProperty('pec_minor');
    expect(asset.muscles.chest.extensions[0]).toMatchObject({ catalogEntry: false, measuredVolume: false, representation: 'independent-model-space' });
    asset.anatomy.sources.attribution = 'Incorrect attribution';
    expect(() => validateAsset(asset, meshBytes)).toThrow(/anatomical provenance/);
  });

  it('reconstructs endpoints and interior samples inside their owning triangle and material mask', () => {
    const asset = fresh();
    for (const [id, muscle] of Object.entries(asset.muscles) as [string, any][]) {
      for (const segment of muscle.segments.filter((s: any) => !Array.isArray(s))) {
        const triangle = mesh.faces[segment.face].slice(0, 3).map((i: number) => mesh.vertices[i]);
        for (const t of [0, .25, .5, .75, 1]) {
          const w = segment.a.map((v: number, k: number) => v + (segment.b[k] - v) * t);
          const p = reconstruct(mesh, segment.face, w);
          expect(w.every((n: number) => n >= -1e-8 && n <= 1 + 1e-8)).toBe(true);
          for (let axis = 0; axis < 3; axis++) expect(p[axis]).toBeCloseTo(w.reduce((sum: number, n: number, k: number) => sum + n * triangle[k][axis], 0), 10);
          if (id === 'chest') expect(Math.abs(p[0])).toBeGreaterThanOrEqual(.016 - 1e-8);
          if (id === 'abs_rectus') {
            expect(Math.abs(p[0])).toBeGreaterThanOrEqual(.012 - 1e-8);
            expect([.05, .16, .27].every(y => Math.abs(p[1] - y) >= .007 - 1e-8)).toBe(true);
          }
        }
        if (id !== 'chest') expect(mesh.materials[mesh.faces[segment.face][3]]).toBe(id);
      }
    }
    // Corrected pectoral landmarks intentionally extend beyond the old chest material.
    expect(asset.muscles.chest.segments.some((s: any) => mesh.materials[mesh.faces[s.face][3]] !== 'chest')).toBe(true);
    expect(new Set(asset.muscles.chest.segments.filter((s: any) => !Array.isArray(s)).map((s: any) => s.part))).toEqual(new Set(['clavicular', 'sternocostal']));
  });

  it.each([
    ['schema', (a: any) => { a.schemaVersion = 3; }],
    ['hash', (a: any) => { a.referenceMesh.sha256 = '0'.repeat(64); }],
    ['missing muscle', (a: any) => { delete a.muscles.biceps; }],
    ['extra muscle', (a: any) => { a.muscles.pec_minor = a.muscles.chest; }],
    ['empty region', (a: any) => { a.muscles.calves.segments = []; }],
    ['missing citation', (a: any) => { a.muscles.quads.sourceIds = ['unknown']; }],
    ['missing limitations', (a: any) => { a.muscles.quads.limitations = []; }],
    ['wrong side', (a: any) => { a.muscles.traps_upper.segments[0].side *= -1; }],
    ['wrong face', (a: any) => { a.muscles.biceps.segments[0].face = -1; }],
    ['fractional face', (a: any) => { a.muscles.biceps.segments[0].face = .5; }],
    ['out-of-range face', (a: any) => { a.muscles.biceps.segments[0].face = mesh.faces.length; }],
    ['nonfinite anchor', (a: any) => { a.muscles.biceps.segments[0].a[0] = NaN; }],
    ['infinite anchor', (a: any) => { a.muscles.biceps.segments[0].a[0] = Infinity; }],
    ['invalid sum', (a: any) => { a.muscles.biceps.segments[0].a = [0, 0, 0]; }],
    ['outside triangle', (a: any) => { a.muscles.biceps.segments[0].a = [-.2, .2, 1]; }],
    ['wrong anchor arity', (a: any) => { a.muscles.biceps.segments[0].a = [0, 1]; }],
    ['wrong material', (a: any) => { a.muscles.biceps.segments[0].face = a.muscles.traps_upper.segments[0].face; }],
    ['zero length', (a: any) => { a.muscles.biceps.segments[0].b = a.muscles.biceps.segments[0].a; }],
    ['false minor volume', (a: any) => { a.muscles.chest.extensions[0].measuredVolume = true; }],
    ['missing chest provenance', (a: any) => { delete a.muscles.chest.segments[0].attachment; }],
  ])('rejects %s', (_case, mutate) => {
    const asset = fresh();
    mutate(asset);
    expect(() => validateAsset(asset, meshBytes)).toThrow(/Invalid fascicle asset/);
  });

  it('rejects any changed mesh byte before use', () => {
    expect(() => validateAsset(fresh(), Buffer.concat([meshBytes, Buffer.from('\n')]))).toThrow(/mesh hash mismatch/);
    const invalid = JSON.parse(meshBytes.toString()); invalid.vertices[0][0] = null;
    expect(() => validateAsset(fresh(), Buffer.from(JSON.stringify(invalid)))).toThrow(/reference vertices/);
  });

  it('splits projected paths at actual triangle boundaries on a bent surface', () => {
    const surface = { vertices: [[0, .3, 0], [1, .3, 0], [0, .6, 0], [1, .6, 1]], faces: [[0, 1, 2, 0], [1, 3, 2, 0]] };
    const pieces = projectedPath(surface, [.1, .45], [.9, .45]);
    expect(pieces.map((s: any) => s.face)).toEqual([0, 1]);
    const endFirst = reconstruct(surface, pieces[0].face, pieces[0].b);
    const startSecond = reconstruct(surface, pieces[1].face, pieces[1].a);
    endFirst.forEach((v: number, k: number) => expect(v).toBeCloseTo(startSecond[k], 9));
    expect(endFirst[0]).toBeCloseTo(.5, 9);
    expect(reconstruct(surface, pieces[1].face, pieces[1].b)[2]).toBeCloseTo(.4, 9);
  });

  it('keeps disconnected projection patches separate rather than bridging the hole', () => {
    const surface = { vertices: [[0, .3, 0], [.2, .3, 0], [0, .6, 0], [.8, .3, 1], [1, .3, 1], [1, .6, 1]], faces: [[0, 1, 2, 0], [3, 4, 5, 0]] };
    const pieces = projectedPath(surface, [.01, .4], [.99, .4]);
    expect(pieces.map((s: any) => s.face)).toEqual([0, 1]);
    expect(reconstruct(surface, pieces[0].face, pieces[0].b)[0]).toBeLessThan(.2);
    expect(reconstruct(surface, pieces[1].face, pieces[1].a)[0]).toBeGreaterThan(.8);
  });

  it('chooses the foremost overlapping surface without chord connections', () => {
    const surface = { vertices: [[0, .3, 0], [1, .3, 0], [0, .6, 0], [0, .3, 1], [1, .3, 1], [0, .6, 1]], faces: [[0, 1, 2, 0], [3, 4, 5, 0]] };
    const pieces = projectedPath(surface, [.01, .4], [.5, .4]);
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.every((s: any) => s.face === 1)).toBe(true);
  });

  it('allows spinal-origin guides to end at the midline but rejects a crossing or rectus gap', () => {
    const segment = { face: 0, a: [1, 0, 0], b: [0, 1, 0], path: 'spinal-guide', side: 1, layer: 'surface' };
    const surface = { vertices: [[0, .02, 0], [.04, .12, 0], [.08, .02, 0]], faces: [[0, 1, 2, 0]], materials: ['spinal_erectors'] };
    expect(() => validateSegment(segment, 'spinal_erectors', surface)).not.toThrow();
    surface.vertices[0][0] = -.01;
    expect(() => validateSegment(segment, 'spinal_erectors', surface)).toThrow(/midline/);
    surface.vertices[0][0] = .04; surface.materials[0] = 'abs_rectus';
    expect(() => validateSegment(segment, 'abs_rectus', surface)).toThrow(/tendon interruption/);
    surface.vertices[0][0] = .005;
    expect(() => validateSegment(segment, 'abs_rectus', surface)).toThrow(/rectus midline/);
  });

  it('splits where overlapping triangle depths exchange the foremost surface', () => {
    const surface = { vertices: [[0, .3, 0], [1, .3, 1], [0, .6, 0], [0, .3, 1], [1, .3, 0], [0, .6, 1]], faces: [[0, 1, 2, 0], [3, 4, 5, 0]] };
    const pieces = projectedPath(surface, [.01, .4], [.6, .4]);
    expect(pieces.map((s: any) => s.face)).toEqual([1, 0]);
    const boundary = reconstruct(surface, pieces[0].face, pieces[0].b);
    expect(boundary[0]).toBeCloseTo(.5, 9);
    expect(boundary[2]).toBeCloseTo(.5, 9);
    const next = reconstruct(surface, pieces[1].face, pieces[1].a);
    boundary.forEach((v: number, k: number) => expect(v).toBeCloseTo(next[k], 9));
  });

  it('splits a rectus segment at every tendon gap instead of crossing the bands', () => {
    const pieces = trimRectus([[.04, 0, .1], [.04, .32, .1]]);
    expect(pieces.map((p: number[][]) => p.map(v => v[1]))).toEqual([[0, .043], [.057, .153], [.167, .263], [.277, .32]]);
  });
});
