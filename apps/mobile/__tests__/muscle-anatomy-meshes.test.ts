import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import asset from '@/components/stats/muscle-anatomy-meshes.json';
import manifest from '../scripts/anatomy/mesh-source.json';
import { MUSCLE_BODY_MESH } from '@/components/stats/muscle-body-mesh';
import { MUSCLE_ANATOMY, type AnatomyPart } from '@/components/stats/muscle-wireframe-scene';

it('pins the body, all 25 catalogue groups and official source hashes', () => {
  const hash = createHash('sha256').update(readFileSync(resolve(__dirname, '../components/stats/muscle-body-mesh.json'))).digest('hex');
  expect(hash).toBe(asset.bodyMeshSha256); expect(hash).toBe(manifest.bodyMeshSha256);
  expect(Object.keys(MUSCLE_ANATOMY).sort()).toEqual(asset.catalog.map(row => row.id).sort());
  expect(asset.catalog).toHaveLength(25);
  expect(manifest.sources.models.FJ1486.sha256).toBe('be5f40b153fd6ce0c8c274eb4c26be8d1a29b4bbe75dd0e4a0dfe5c4d251fa03');
  expect(createHash('sha256').update(JSON.stringify(MUSCLE_ANATOMY.brachialis.parts)).digest('hex'))
    .toBe('0c9dd4c17c0102113511f6d476df0cd455a652d0109620d7b6a9adc6d5bbfea1');
  expect(MUSCLE_ANATOMY.brachialis.parts[0].faces).toHaveLength(1746);
});

function validatePart(part: AnatomyPart) {
  const edges = new Map<string, number>();
  let volume = 0, collapsed = 0;
  for (const point of part.vertices) if (point.length !== 3 || !point.every(Number.isFinite)) throw new Error(`${part.id}: invalid vertex`);
  for (const face of part.faces) {
    if (face.length !== 3 || face.some(i => !Number.isInteger(i) || i < 0 || i >= part.vertices.length)) throw new Error(`${part.id}: invalid face`);
    const [a, b, c] = face.map(i => part.vertices[i]);
    const u = b.map((n, k) => n - a[k]), v = c.map((n, k) => n - a[k]);
    const cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    if (Math.hypot(...cross) < 1e-15) collapsed++;
    volume += a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]);
    for (const [x, y] of [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]]) {
      const key = [x, y].sort((a,b) => a-b).join(','); edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return { volume, collapsed, exceptionalEdges: [...edges.values()].filter(count => count !== 2) };
}

it('keeps finite outward triangle surfaces with no new holes or nonmanifold edges', () => {
  for (const mesh of Object.values(MUSCLE_ANATOMY)) for (const part of mesh.parts) {
    const result = validatePart(part);
    expect(result.volume).toBeGreaterThan(0);
    expect(result.collapsed).toBe(part.id === 'FJ1521' ? 5 : 0);
    // These five collapsed triangles and ten shared edges are present in the pinned trapezius source, retained without destructive welding.
    expect(result.exceptionalEdges).toEqual(part.id === 'FJ1521' ? Array(10).fill(4) : []);
  }
});

it('uses three separate closed spinal columns per side, and marks surface approximations explicitly', () => {
  const spine = MUSCLE_ANATOMY.spinal_erectors;
  expect(spine.kind).toBe('envelope'); expect(spine.mirror).toBe(true);
  expect(spine.parts.map(part => part.id)).toEqual(['erector-iliocostalis', 'erector-longissimus', 'erector-spinalis']);
  for (const part of spine.parts) {
    expect(part.vertices.every(point => point[0] > 0)).toBe(true);
    expect(validatePart(part).exceptionalEdges).toEqual([]);
  }
  expect(Object.entries(MUSCLE_ANATOMY).filter(([,mesh]) => mesh.kind === 'surface').map(([id]) => id).sort()).toEqual(['abs_rectus', 'back_lats']);
});

const insideTriangle = (x: number, y: number, points: readonly (readonly number[])[]) => {
  const [a,b,c] = points;
  const d = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
  if (Math.abs(d) < 1e-14) return false;
  const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/d;
  const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/d;
  return u >= -.0001 && v >= -.0001 && u+v <= 1.0001;
};

it('fits the forearm tendons into the one existing hand silhouette through a full rotation', () => {
  const { targetProximal: origin, targetDistal: wrist } = manifest.registration.FJ3349;
  const axis = wrist.map((n,k) => n-origin[k]); const length = Math.hypot(...axis);
  const hand = MUSCLE_ANATOMY.forearms_grip.parts.flatMap(part => part.vertices)
    .filter(point => point.reduce((n,v,k) => n+(v-origin[k])*axis[k]/length,0) > length);
  expect(hand.length).toBeGreaterThan(400);
  for (const angle of [0,45,90,135,180,225,270,315]) {
    const radians = angle*Math.PI/180;
    const project = (point: readonly number[]) => [point[0]*Math.cos(radians)+point[2]*Math.sin(radians), point[1]];
    const triangles = MUSCLE_BODY_MESH.faces.map(face => face.slice(0,3).map(i => project(MUSCLE_BODY_MESH.vertices[i])));
    const outside = hand.filter(point => {
      const [x,y] = project(point);
      return !triangles.some(points => y >= Math.min(...points.map(p => p[1]))-.00001 && y <= Math.max(...points.map(p => p[1]))+.00001 && insideTriangle(x,y,points));
    });
    expect({ angle, outside: outside.length }).toEqual({ angle, outside: 0 });
  }
});
