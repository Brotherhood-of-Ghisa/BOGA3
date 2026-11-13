import rawAnatomy from './muscle-anatomy-meshes.json';
import { MUSCLE_BODY_MESH, type MuscleBodyMaterialId, type MuscleBodyVertex } from './muscle-body-mesh';
import { normaliseBodyAngle, reportedMaterial } from './muscle-body-projection';
import type { MuscleReportAssignment } from '@/src/data/muscle-analytics';

export type AnatomyPart = {
  readonly id: string;
  readonly vertices: readonly MuscleBodyVertex[];
  readonly faces: readonly (readonly number[])[];
};
export type AnatomyInstance = { readonly part: AnatomyPart; readonly side: 1 | -1; readonly group: string };
type Anatomy = { readonly kind: 'atlas' | 'envelope' | 'surface'; readonly parts: readonly AnatomyPart[]; readonly mirror: boolean };
export const MUSCLE_ANATOMY = rawAnatomy.muscles as unknown as Readonly<Record<string, Anatomy>>;
const families = new Map(rawAnatomy.catalog.map(item => [item.id, item.family]));
const aliases: Readonly<Record<string, string>> = { front_delts: 'delts_front', side_delts: 'delts_lateral', rear_delts: 'delts_rear' };

export function selectMuscleMeshes(selectedId: string | null, report?: MuscleReportAssignment, focus = false): readonly AnatomyInstance[] {
  if (!selectedId) return [];
  const id = aliases[selectedId] ?? selectedId;
  const groups = Object.entries(MUSCLE_ANATOMY).filter(([group]) => reportedMaterial(group as MuscleBodyMaterialId, report) === id);
  const singleSide = focus && groups.every(([group]) => ['Arms', 'Legs', 'Lower Legs'].includes(families.get(group) ?? ''));
  return groups.flatMap(([group, mesh]) => mesh.parts.flatMap(part =>
    mesh.mirror && !singleSide ? [{ part, side: 1 as const, group }, { part, side: -1 as const, group }] : [{ part, side: 1 as const, group }]));
}

export type WireframeCamera = {
  readonly cos: number; readonly sin: number; readonly scale: number;
  readonly centreX: number; readonly centreY: number; readonly width: number; readonly height: number;
};

export function wireframeCamera(options: {
  angle: number; width: number; height: number; selected: readonly AnatomyInstance[]; focus: boolean;
}): WireframeCamera {
  const { width, height, selected, focus } = options;
  const radians = normaliseBodyAngle(options.angle) * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  let centreX = 0, centreY = -.003, scale = Math.min((width - 12) / 1.14, (height - 20) / 2.06);
  if (focus && selected.length) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const { part, side } of selected) for (const [x, y, z] of part.vertices) {
      const rx = side * x * cos + z * sin;
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    centreX = (minX + maxX) / 2; centreY = (minY + maxY) / 2;
    scale = Math.min((width - 20) / Math.max(.28, (maxX - minX) * 1.65), (height - 24) / Math.max(.4, (maxY - minY) * 1.45));
  }
  return { cos, sin, centreX, centreY, scale: Math.max(0, scale), width, height };
}

export function projectWireframePoint([x, y, z]: MuscleBodyVertex, camera: WireframeCamera): MuscleBodyVertex {
  return [camera.width / 2 + (x * camera.cos + z * camera.sin - camera.centreX) * camera.scale,
    camera.height / 2 - (y - camera.centreY) * camera.scale, -x * camera.sin + z * camera.cos];
}

/** Interleaved position, outward face normal and triangle barycentrics; lines are only triangle edges. */
export function wireframeVertices(instances: readonly AnatomyInstance[]): Float32Array {
  const count = instances.reduce((n, { part }) => n + part.faces.length * 27, 0);
  const output = new Float32Array(count);
  let offset = 0;
  for (const { part, side } of instances) for (const face of part.faces) {
    const order = side === 1 ? [face[0], face[1], face[2]] : [face[0], face[2], face[1]];
    const points = order.map(i => { const [x, y, z] = part.vertices[i]; return [x * side, y, z]; });
    const a = points[1].map((n, k) => n - points[0][k]), b = points[2].map((n, k) => n - points[0][k]);
    const normal = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const length = Math.hypot(...normal) || 1;
    for (let i = 0; i < 3; i++) {
      output.set([...points[i], ...normal.map(n => n / length), Number(i === 0), Number(i === 1), Number(i === 2)], offset);
      offset += 9;
    }
  }
  return output;
}

export const BODY_WIRE_INSTANCES: readonly AnatomyInstance[] = MUSCLE_BODY_MESH.materials.map((group, material) => ({
  group, side: 1,
  part: { id: group, vertices: MUSCLE_BODY_MESH.vertices, faces: MUSCLE_BODY_MESH.faces.filter(face => face[3] === material) },
}));

function faceRegion(mesh: AnatomyInstance, face: readonly number[]): number {
  const left = face.slice(0, 3).reduce((x, i) => x + mesh.part.vertices[i][0] * mesh.side, 0) < 0;
  return BODY_WIRE_INSTANCES.findIndex(body => body.group === mesh.group) * 2 + (left ? 2 : 1);
}

/** Raw muscle and body side share one label in the GPU mask and CPU picking. */
export function anatomyRegions(instances: readonly AnatomyInstance[]) {
  const regions = new Map<number, AnatomyInstance[]>();
  for (const mesh of instances) {
    const faces = new Map<number, (readonly number[])[]>();
    for (const face of mesh.part.faces) {
      const region = faceRegion(mesh, face);
      if (!faces.has(region)) faces.set(region, []);
      faces.get(region)!.push(face);
    }
    for (const [region, triangles] of faces) {
      if (!regions.has(region)) regions.set(region, []);
      regions.get(region)!.push({ ...mesh, part: { ...mesh.part, faces: triangles } });
    }
  }
  return [...regions].map(([region, meshes]) => ({ region, meshes }));
}

function triangleDepth(point: readonly number[], points: readonly MuscleBodyVertex[]): number | null {
  const [a, b, c] = points;
  const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  // Projection flips y; only outward faces participate in selection.
  if (denominator >= -1e-8) return null;
  const u = ((b[1] - c[1]) * (point[0] - c[0]) + (c[0] - b[0]) * (point[1] - c[1])) / denominator;
  const v = ((c[1] - a[1]) * (point[0] - c[0]) + (a[0] - c[0]) * (point[1] - c[1])) / denominator;
  return u >= 0 && v >= 0 && u + v <= 1 ? u * a[2] + v * b[2] + (1 - u - v) * c[2] : null;
}

function hitInstances(point: readonly number[], camera: WireframeCamera, instances: readonly AnatomyInstance[], region?: number) {
  let depth = -Infinity, hit: { group: string; region: number } | null = null;
  for (const mesh of instances) {
    const { part, side, group } = mesh;
    const points = part.vertices.map(([x, y, z]) => projectWireframePoint([x * side, y, z], camera));
    for (const face of part.faces) {
      const order = side === 1 ? [face[0], face[1], face[2]] : [face[0], face[2], face[1]];
      const value = triangleDepth(point, order.map(i => points[i]));
      if (value === null || value <= depth) continue;
      const candidate = faceRegion(mesh, face);
      if (region !== undefined && candidate !== region) continue;
      depth = value; hit = { group, region: candidate };
    }
  }
  return hit;
}

export function hitWireframe(options: {
  point: readonly [number, number]; camera: WireframeCamera; selected: readonly AnatomyInstance[];
  selectedId: string | null; report?: MuscleReportAssignment;
}): string | null {
  const { point, camera, selected, selectedId, report } = options;
  const body = hitInstances(point, camera, BODY_WIRE_INSTANCES);
  // Match the renderer's visible-region mask before letting internal anatomy receive a tap.
  if (body && selectedId && hitInstances(point, camera, selected, body.region)) return selectedId;
  const reported = body ? reportedMaterial(body.group as MuscleBodyMaterialId, report) : 'neutral';
  return reported === 'neutral' ? null : reported;
}
