import { hexToLch, lchToHex, type Lch } from '@/components/ui/lch';
import { uiRoles } from '@/components/ui/tokens';
import type { ProgressMuscleComparison } from '@/src/data';
import type { MuscleReportAssignment } from '@/src/data/muscle-analytics';
import type { ProgressMetric } from '@/src/preferences/model';
import { isModelFibre, MUSCLE_BODY_FASCICLES, type ModelFibreSegment, type MuscleBodyFascicles, type MuscleBodyFibreSegment, type MuscleBodyFibreSelection, type TriangleFibreSegment } from './muscle-body-fibres';
import {
  MUSCLE_BODY_MESH,
  type MuscleBodyFace,
  type MuscleBodyMaterialId,
  type MuscleBodyMesh,
} from './muscle-body-mesh';
import { MOUSTACHE_FILL, NOVEMBER_MOUSTACHE_MESH } from './muscle-body-moustache';
import { reduceFibreRun, type FibrePoint } from './projected-fibre-contour';

export type BodyOrientation = 'front' | 'back';

export type ThemeShadeRoles = Pick<
  typeof uiRoles,
  'paper' | 'rule' | 'viz1' | 'viz2' | 'viz4' | 'ink'
>;

export type ThemeShadePalette = {
  readonly neutral: readonly string[];
  readonly anchors: readonly [Lch, Lch, Lch];
  readonly selectedStroke: string;
};

export type ProjectedTriangle = {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly depth: number;
  readonly muscleGroupId: MuscleBodyMaterialId;
  readonly fill: string;
  readonly selected: boolean;
  readonly v0: number;
  readonly v1: number;
  readonly v2: number;
};

export type ProjectedPathBatch = {
  readonly key: string;
  readonly d: string;
  readonly fill: string;
  readonly selected: boolean;
};

export type ProjectedMuscleContour = {
  readonly d: string;
  readonly stroke: string;
};

export type MuscleOverlayStyle = 'fibres' | 'contour';

export type ProjectedMuscleBody = {
  readonly triangles: readonly ProjectedTriangle[];
  readonly batches: readonly ProjectedPathBatch[];
  readonly fibres: { readonly surface: string; readonly deep: string; readonly anatomicalParts?: readonly { readonly id: string; readonly d: string }[] };
  readonly contour?: ProjectedMuscleContour | null;
};

export const SHADE_STEPS = 12;
const DEPTH_SLABS = 10;
const BACKFACE_CULL_NZ = -0.03;
const MODEL_WIDTH_SPAN = 1.12;
const MODEL_HEIGHT_SPAN = 2.02;

const LEGACY_MUSCLE_ALIASES: Readonly<Record<string, string>> = {
  front_delts: 'delts_front',
  side_delts: 'delts_lateral',
  rear_delts: 'delts_rear',
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Wraps any angle in degrees into [0, 360), rounded to whole degrees. */
export function normaliseBodyAngle(angleDeg: number): number {
  if (!Number.isFinite(angleDeg)) return 0;
  const wrapped = ((Math.round(angleDeg) % 360) + 360) % 360;
  return wrapped === 360 ? 0 : wrapped;
}

/** Which canonical side of the body faces the viewer at `angleDeg`. */
export function bodyOrientationForAngle(angleDeg: number): BodyOrientation {
  const angle = normaliseBodyAngle(angleDeg);
  return angle > 90 && angle <= 270 ? 'back' : 'front';
}

const POSTERIOR_MUSCLES = new Set<string>([
  'delts_rear',
  'rotator_cuff',
  'back_lats',
  'back_upper',
  'traps_upper',
  'traps_lower',
  'spinal_erectors',
  'triceps',
  'hamstrings',
  'glutes_max',
  'hip_abductors',
  'calves',
]);

/** Which canonical side of the body best showcases the given muscle group. */
export function canonicalOrientationForMuscle(muscleId: string): BodyOrientation {
  return POSTERIOR_MUSCLES.has(canonicalMuscleId(muscleId)) ? 'back' : 'front';
}

const canonicalMuscleId = (id: string): string => LEGACY_MUSCLE_ALIASES[id] ?? id;
const BODY_MUSCLE_IDS = new Set<string>(MUSCLE_BODY_MESH.materials);

const muscleChange = (row: ProgressMuscleComparison, metric: ProgressMetric): number | null => {
  const current = row.current[metric];
  const previous = row.previous[metric];
  if (current === null || previous === null || !Number.isFinite(current)
    || !Number.isFinite(previous) || (current === 0 && previous === 0)) return null;
  if (metric === 'workingSetCount') return Number.isFinite(row.workingSetChange) ? row.workingSetChange : null;
  const change = row.volumeChange;
  // New/overflow gains use the dark anchor without entering the finite extrema.
  if (change.kind === 'new' || change.kind === 'increased') return Infinity;
  return change.kind === 'percent' && Number.isFinite(change.percent) ? change.percent : null;
};

/** Follows [[comparison.colour-scale]] and the displayed change's rounding. */
export function computeMuscleScores(
  muscles: readonly ProgressMuscleComparison[],
  metric: ProgressMetric,
): ReadonlyMap<string, number | null> {
  const changes = new Map<string, number | null>();
  const ids = new Set(muscles.map(row => row.muscleGroupId));
  let largestGain = 0;
  let largestLoss = 0;
  for (const row of muscles) {
    const id = canonicalMuscleId(row.muscleGroupId);
    if (!BODY_MUSCLE_IDS.has(id) || (id !== row.muscleGroupId && ids.has(id))) continue;
    const change = muscleChange(row, metric);
    changes.set(id, change);
    if (change !== null && Number.isFinite(change)) {
      largestGain = Math.max(largestGain, change);
      largestLoss = Math.max(largestLoss, -change);
    }
  }
  const scores = new Map<string, number | null>();
  for (const row of muscles) {
    const id = canonicalMuscleId(row.muscleGroupId);
    const change = changes.get(id) ?? null;
    const score = change === Infinity ? 1 : change === null ? null
      : change > 0 ? change / largestGain : change < 0 ? change / largestLoss : 0;
    scores.set(id, score);
    scores.set(row.muscleGroupId, score);
  }
  return scores;
}

const buildShadeRamp = (
  base: Lch,
  lightnessSpan: number,
  lightnessShift = 0,
  chromaBoost = 1
): readonly string[] => {
  const { lightness: baseL, chroma: baseC, hue: baseH } = base;
  return Array.from({ length: SHADE_STEPS }, (_, step) => {
    const t = step / (SHADE_STEPS - 1);
    const deltaL = (t - 0.55) * lightnessSpan + lightnessShift;
    const lightness = clamp(baseL + deltaL, 14, 96.5);
    const chroma = clamp(baseC * chromaBoost * (0.88 + 0.22 * t), 0, 110);
    return lchToHex({ lightness, chroma, hue: baseH });
  });
};

/**
 * Keeps anatomical lighting within the theme's shades ([[comparison.colour-scale]]).
 */
export function buildThemeShadePalette(
  roles: ThemeShadeRoles = uiRoles
): ThemeShadePalette {
  const { lightness: paperL, chroma: paperC, hue: paperH } = hexToLch(roles.paper);
  const { lightness: ruleL, chroma: ruleC } = hexToLch(roles.rule);
  const neutralBase = hexToLch(lchToHex({
    lightness: (paperL + ruleL) / 2,
    chroma: (paperC + ruleC) / 2,
    hue: paperH,
  }));
  const neutral = buildShadeRamp(neutralBase, 18);

  return {
    neutral,
    anchors: [hexToLch(roles.viz1), hexToLch(roles.viz2), hexToLch(roles.viz4)],
    selectedStroke: roles.ink,
  };
}

/** Interpolate the data shade first; facet lighting remains a separate ramp. */
export function buildMuscleShadeRamp(score: number | null, palette: ThemeShadePalette): readonly string[] {
  if (score === null || !Number.isFinite(score)) return palette.neutral;
  const middle = palette.anchors[1];
  const end = palette.anchors[score < 0 ? 0 : 2];
  const t = clamp(Math.abs(score), 0, 1);
  const hueDelta = ((end.hue - middle.hue + 540) % 360) - 180;
  return buildShadeRamp({
    lightness: middle.lightness + (end.lightness - middle.lightness) * t,
    chroma: middle.chroma + (end.chroma - middle.chroma) * t,
    hue: middle.hue + hueDelta * t,
  }, 22);
}

let cachedDefaultPalette: { roles: ThemeShadeRoles; palette: ThemeShadePalette } | null = null;

const getDefaultPalette = (): ThemeShadePalette => {
  if (cachedDefaultPalette && cachedDefaultPalette.roles === uiRoles) {
    return cachedDefaultPalette.palette;
  }
  const palette = buildThemeShadePalette(uiRoles);
  cachedDefaultPalette = { roles: uiRoles, palette };
  return palette;
};

const computeLightStep = (nx: number, ny: number, nz: number): number => {
  const key = Math.max(0, nx * 0.34 + ny * 0.52 + nz * 0.78);
  const fill = Math.max(0, -nx * 0.48 - ny * 0.28 + nz * 0.42);
  const rim = Math.pow(1 - Math.min(1, Math.abs(nz)), 1.7);
  const intensity = clamp(0.22 + 0.58 * key + 0.14 * fill + 0.08 * rim, 0, 1);
  return Math.round(intensity * (SHADE_STEPS - 1));
};

/**
 * The muscle a mesh facet belongs to under the user's setup
 * ([[muscle.report-groups]]). Meshes stay keyed by anatomy entry: a merged
 * entry takes its muscle's id (so it shades and selects with it) and an
 * untracked one is neutral anatomy, neither shaded nor tappable.
 */
const reportedMaterial = (
  entry: MuscleBodyMaterialId, report: MuscleReportAssignment | undefined
): MuscleBodyMaterialId => {
  const assigned = entry === 'neutral' ? undefined : report?.get(entry);
  if (!assigned) return entry;
  return assigned.tracked ? assigned.muscle.id as MuscleBodyMaterialId : 'neutral';
};

type ProjectionContext = {
  readonly verts: RotatedVertices;
  readonly materials: readonly MuscleBodyMaterialId[];
  readonly report?: MuscleReportAssignment;
  readonly shades: ReadonlyMap<string, readonly string[]>;
  readonly selectedCanonicalId: string | null;
  readonly palette: ThemeShadePalette;
};

const resolveFaceFill = (
  materialId: MuscleBodyMaterialId,
  step: number,
  ctx: ProjectionContext
): string => {
  if (materialId === 'neutral') return ctx.palette.neutral[step];
  return (ctx.shades.get(materialId) ?? ctx.palette.neutral)[step];
};

type RotatedVertices = {
  readonly rx: Float64Array;
  readonly ry: Float64Array;
  readonly rz: Float64Array;
  readonly sx: Float64Array;
  readonly sy: Float64Array;
};

const projectionFrame = (
  angleDeg: number,
  width: number,
  height: number
) => {
  const rad = (normaliseBodyAngle(angleDeg) * Math.PI) / 180;
  return { cos: Math.cos(rad), sin: Math.sin(rad),
    scale: Math.min(width / MODEL_WIDTH_SPAN, height / MODEL_HEIGHT_SPAN), halfW: width / 2, halfH: height / 2 };
};

const rotateAndProjectVertices = (
  mesh: MuscleBodyMesh,
  angleDeg: number,
  width: number,
  height: number
): RotatedVertices => {
  const { cos, sin, scale, halfW, halfH } = projectionFrame(angleDeg, width, height);
  const count = mesh.vertices.length;

  const rx = new Float64Array(count);
  const ry = new Float64Array(count);
  const rz = new Float64Array(count);
  const sx = new Float64Array(count);
  const sy = new Float64Array(count);

  for (let i = 0; i < count; i += 1) {
    const [x, y, z] = mesh.vertices[i];
    const rotX = x * cos + z * sin;
    const rotZ = -x * sin + z * cos;
    rx[i] = rotX;
    ry[i] = y;
    rz[i] = rotZ;
    sx[i] = halfW + rotX * scale;
    sy[i] = halfH - y * scale;
  }
  return { rx, ry, rz, sx, sy };
};

const projectSingleFace = (
  face: MuscleBodyFace,
  ctx: ProjectionContext
): ProjectedTriangle | null => {
  const { verts } = ctx;
  const [i0, i1, i2, matIdx] = face;
  const ux = verts.rx[i1] - verts.rx[i0];
  const uy = verts.ry[i1] - verts.ry[i0];
  const uz = verts.rz[i1] - verts.rz[i0];
  const vx = verts.rx[i2] - verts.rx[i0];
  const vy = verts.ry[i2] - verts.ry[i0];
  const vz = verts.rz[i2] - verts.rz[i0];

  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len <= 1e-9) return null;

  const unitNz = nz / len;
  if (unitNz < BACKFACE_CULL_NZ) return null;

  const materialId = reportedMaterial(ctx.materials[matIdx] ?? 'neutral', ctx.report);
  const selected = materialId !== 'neutral' && materialId === ctx.selectedCanonicalId;
  const step = computeLightStep(nx / len, ny / len, unitNz);
  const fill = resolveFaceFill(materialId, step, ctx);

  return {
    x0: verts.sx[i0],
    y0: verts.sy[i0],
    x1: verts.sx[i1],
    y1: verts.sy[i1],
    x2: verts.sx[i2],
    y2: verts.sy[i2],
    depth: (verts.rz[i0] + verts.rz[i1] + verts.rz[i2]) / 3,
    muscleGroupId: materialId,
    fill,
    selected,
    v0: i0,
    v1: i1,
    v2: i2,
  };
};

const roundCoord = (n: number): number => Math.round(n * 10) / 10;

const pointInTriangle = (
  px: number,
  py: number,
  tri: ProjectedTriangle
): boolean => {
  const d1 = (px - tri.x1) * (tri.y0 - tri.y1) - (tri.x0 - tri.x1) * (py - tri.y1);
  const d2 = (px - tri.x2) * (tri.y1 - tri.y2) - (tri.x1 - tri.x2) * (py - tri.y2);
  const d3 = (px - tri.x0) * (tri.y2 - tri.y0) - (tri.x2 - tri.x0) * (py - tri.y0);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
};

const OCCLUSION_DEPTH_BIAS = 0.005;

const isEdgeOccluded = (
  v0: number,
  v1: number,
  verts: RotatedVertices,
  sortedTriangles: readonly ProjectedTriangle[]
): boolean => {
  const mx = (verts.sx[v0] + verts.sx[v1]) * 0.5;
  const my = (verts.sy[v0] + verts.sy[v1]) * 0.5;
  const mz = (verts.rz[v0] + verts.rz[v1]) * 0.5;
  const minDepth = mz + OCCLUSION_DEPTH_BIAS;

  for (let i = sortedTriangles.length - 1; i >= 0; i -= 1) {
    const tri = sortedTriangles[i];
    if (tri.depth <= minDepth) break;
    if (
      tri.v0 === v0 ||
      tri.v0 === v1 ||
      tri.v1 === v0 ||
      tri.v1 === v1 ||
      tri.v2 === v0 ||
      tri.v2 === v1
    ) {
      continue;
    }
    const minX = Math.min(tri.x0, tri.x1, tri.x2);
    if (mx < minX) continue;
    const maxX = Math.max(tri.x0, tri.x1, tri.x2);
    if (mx > maxX) continue;
    const minY = Math.min(tri.y0, tri.y1, tri.y2);
    if (my < minY) continue;
    const maxY = Math.max(tri.y0, tri.y1, tri.y2);
    if (my > maxY) continue;

    if (pointInTriangle(mx, my, tri)) {
      return true;
    }
  }
  return false;
};

const recordFaceEdges = (
  i0: number,
  i1: number,
  i2: number,
  counts: Map<number, number>
) => {
  const addEdge = (a: number, b: number) => {
    const min = a < b ? a : b;
    const max = a < b ? b : a;
    const key = (min << 16) | max;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  addEdge(i0, i1);
  addEdge(i1, i2);
  addEdge(i2, i0);
};

const buildBoundaryContour = (
  edgeCounts: ReadonlyMap<number, number>,
  verts: RotatedVertices,
  stroke: string,
  sortedTriangles: readonly ProjectedTriangle[]
): ProjectedMuscleContour | null => {
  const segments: string[] = [];
  edgeCounts.forEach((count, key) => {
    if (count === 1) {
      const a = key >>> 16;
      const b = key & 0xffff;
      if (!isEdgeOccluded(a, b, verts, sortedTriangles)) {
        segments.push(
          `M${roundCoord(verts.sx[a])} ${roundCoord(verts.sy[a])}L${roundCoord(verts.sx[b])} ${roundCoord(verts.sy[b])}`
        );
      }
    }
  });
  if (segments.length === 0) return null;
  return { d: segments.join(''), stroke };
};

const prepareModelContour = (
  segments: readonly MuscleBodyFibreSegment[],
  offset: number,
  indices: readonly number[],
): readonly ModelFibreSegment[] => indices.map(index => {
  const s = segments[offset + (index >= 0 ? index : -index - 1)] as ModelFibreSegment;
  return index >= 0 ? s : [s[3], s[4], s[5], s[0], s[1], s[2], s[6], s[7], s[8]];
});

/** Select and orient topology-checked contours once per setup/selection. */
export function selectMuscleFibres(
  selectedId: string | null,
  report?: MuscleReportAssignment,
  fascicles: MuscleBodyFascicles = MUSCLE_BODY_FASCICLES,
): MuscleBodyFibreSelection {
  if (!selectedId) return { segments: [], anatomicalParts: [] };
  const selected = canonicalMuscleId(selectedId);
  const entries = Object.entries(fascicles)
    .filter(([entry]) => reportedMaterial(entry as MuscleBodyMaterialId, report) === selected)
    .map(([, muscle]) => muscle);
  return {
    segments: entries.flatMap(muscle => muscle.segments.filter((segment): segment is TriangleFibreSegment => !isModelFibre(segment))),
    anatomicalParts: entries.flatMap(muscle => (muscle.anatomicalParts ?? []).map(part => ({ id: part.id,
      chains: part.chains.map(indices => prepareModelContour(muscle.segments, part.start, indices)) }))),
  };
}

const projectFibreSegments = (
  selection: MuscleBodyFibreSelection,
  mesh: MuscleBodyMesh,
  verts: RotatedVertices,
  frame: ReturnType<typeof projectionFrame>,
): ProjectedMuscleBody['fibres'] => {
  const surface: string[] = [];
  const deep: string[] = [];
  const endpoint = (face: MuscleBodyFace, weights: readonly number[]): string => {
    const x = weights[0] * verts.sx[face[0]] + weights[1] * verts.sx[face[1]] + weights[2] * verts.sx[face[2]];
    const y = weights[0] * verts.sy[face[0]] + weights[1] * verts.sy[face[1]] + weights[2] * verts.sy[face[2]];
    return `${roundCoord(x)} ${roundCoord(y)}`;
  };
  for (const segment of selection.segments) {
    const face = mesh.faces[segment.face];
    if (!face) continue;
    // Selection deliberately surfaces every independent segment, including hidden/deep guides.
    const target = segment.layer === 'surface' ? surface : deep;
    target.push(`M${endpoint(face, segment.a)}L${endpoint(face, segment.b)}`);
  }
  const fibres: ProjectedMuscleBody['fibres'] = { surface: surface.join(''), deep: deep.join('') };
  if (!selection.anatomicalParts.length) return fibres;
  // Keep each component's highlight/shade together; flattening them fills fibre gaps at overlaps.
  return { ...fibres, anatomicalParts: selection.anatomicalParts.map(part => {
    const paths: string[] = [];
    for (const chain of part.chains) projectModelContour(chain, frame, paths);
    return { id: part.id, d: paths.join('') };
  }) };
};

const modelEndpoint = (
  segment: ModelFibreSegment,
  offset: 0 | 3,
  side: number,
  frame: ReturnType<typeof projectionFrame>,
): FibrePoint => {
  const { cos, sin, scale, halfW, halfH } = frame;
  const x = halfW + (side * segment[offset] * cos + segment[offset + 2] * sin) * scale;
  return [Math.round(x * 10), Math.round((halfH - segment[offset + 1] * scale) * 10)];
};

const appendModelRun = (points: readonly FibrePoint[], paths: string[]): void => {
  if (!points.length) return;
  const reduced = reduceFibreRun(points);
  paths.push(reduced.map((point, i) => `${i === 0 ? 'M' : 'L'}${point[0] / 10} ${point[1] / 10}`).join(''));
  // SVG needs a zero-length edge to paint the isolated round cap.
  if (reduced.length === 1) paths.push(`L${reduced[0][0] / 10} ${reduced[0][1] / 10}`);
};

const projectModelContour = (
  chain: readonly ModelFibreSegment[],
  frame: ReturnType<typeof projectionFrame>,
  paths: string[],
): void => {
  const { cos, sin } = frame;
  for (const side of [1, -1]) {
    let points: FibrePoint[] = [];
    for (const segment of chain) {
      if (-side * segment[6] * sin + segment[8] * cos < BACKFACE_CULL_NZ) {
        appendModelRun(points, paths);
        points = [];
        continue;
      }
      if (!points.length) points.push(modelEndpoint(segment, 0, side, frame));
      const end = modelEndpoint(segment, 3, side, frame);
      const last = points[points.length - 1];
      if (end[0] !== last[0] || end[1] !== last[1]) points.push(end);
    }
    appendModelRun(points, paths);
  }
};

const batchSlabTriangles = (
  slabTriangles: readonly ProjectedTriangle[],
  slabIndex: number
): ProjectedPathBatch[] => {
  const unselectedByFill = new Map<string, string[]>();
  const selectedByFill = new Map<string, string[]>();

  for (const tri of slabTriangles) {
    const segment = `M${roundCoord(tri.x0)} ${roundCoord(tri.y0)}L${roundCoord(tri.x1)} ${roundCoord(tri.y1)}L${roundCoord(tri.x2)} ${roundCoord(tri.y2)}Z`;
    const target = tri.selected ? selectedByFill : unselectedByFill;
    const list = target.get(tri.fill);
    if (list) list.push(segment);
    else target.set(tri.fill, [segment]);
  }

  const batches: ProjectedPathBatch[] = [];
  unselectedByFill.forEach((segments, fill) => {
    batches.push({
      key: `s${slabIndex}-${fill}`,
      d: segments.join(''),
      fill,
      selected: false,
    });
  });
  selectedByFill.forEach((segments, fill) => {
    batches.push({
      key: `s${slabIndex}-sel-${fill}`,
      d: segments.join(''),
      fill,
      selected: true,
    });
  });
  return batches;
};

const depthAtPoint = (triangle: ProjectedTriangle, x: number, y: number, verts: RotatedVertices): number => {
  const { x0, y0, x1, y1, x2, y2, v0, v1, v2 } = triangle;
  const denominator = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (Math.abs(denominator) < 1e-9) return -Infinity;
  const a = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / denominator;
  const b = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / denominator;
  return a * verts.rz[v0] + b * verts.rz[v1] + (1 - a - b) * verts.rz[v2];
};

const projectMoustache = (
  angleDeg: number, width: number, height: number,
  ctx: ProjectionContext, body: readonly ProjectedTriangle[],
): ProjectedTriangle[] => {
  const mesh = NOVEMBER_MOUSTACHE_MESH;
  const verts = rotateAndProjectVertices(mesh, angleDeg, width, height);
  return mesh.faces.flatMap(face => {
    const triangle = projectSingleFace(face, { ...ctx, verts, materials: mesh.materials, report: undefined });
    if (!triangle) return [];
    const x = (triangle.x0 + triangle.x1 + triangle.x2) / 3;
    const y = (triangle.y0 + triangle.y1 + triangle.y2) / 3;
    const occluded = body.some(facet => pointInTriangle(x, y, facet)
      && depthAtPoint(facet, x, y, ctx.verts) > triangle.depth + .001);
    return occluded ? [] : [{ ...triangle, fill: MOUSTACHE_FILL, selected: false }];
  });
};

export type ProjectMuscleBodyOptions = {
  readonly angleDeg: number;
  readonly width: number;
  readonly height: number;
  readonly scores: ReadonlyMap<string, number | null>;
  readonly selectedId?: string | null;
  /** The user's muscle setup; unset shows every anatomy entry as its own muscle. */
  readonly report?: MuscleReportAssignment;
  readonly palette?: ThemeShadePalette;
  readonly mesh?: MuscleBodyMesh;
  /** Prepared for this selection/report; omit to resolve directly from the source asset. */
  readonly selectedFibres?: MuscleBodyFibreSelection;
  readonly november?: boolean;
  readonly overlay?: MuscleOverlayStyle;
};

/**
 * Projects the 3D muscle body at `angleDeg` into back-to-front sorted triangles
 * and depth-slabbed SVG `<Path>` batches.
 */
export function projectMuscleBody({
  angleDeg,
  width,
  height,
  scores,
  selectedId = null,
  report,
  palette = getDefaultPalette(),
  mesh = MUSCLE_BODY_MESH,
  selectedFibres = selectMuscleFibres(selectedId, report),
  november = false,
  overlay = 'fibres',
}: ProjectMuscleBodyOptions): ProjectedMuscleBody {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !mesh.vertices.length || !mesh.faces.length) {
    return { triangles: [], batches: [], fibres: { surface: '', deep: '' } };
  }
  const verts = rotateAndProjectVertices(mesh, angleDeg, width, height);
  const selectedCanonicalId = selectedId ? canonicalMuscleId(selectedId) : null;
  const ctx: ProjectionContext = {
    verts,
    materials: mesh.materials,
    report,
    shades: new Map([...scores].map(([id, score]) => [id, buildMuscleShadeRamp(score, palette)])),
    selectedCanonicalId,
    palette,
  };
  const triangles: ProjectedTriangle[] = [];
  const edgeCounts = overlay === 'contour' && selectedCanonicalId ? new Map<number, number>() : null;

  for (const face of mesh.faces) {
    const projected = projectSingleFace(face, ctx);
    if (projected) {
      triangles.push(projected);
      if (edgeCounts && projected.selected) {
        recordFaceEdges(face[0], face[1], face[2], edgeCounts);
      }
    }
  }

  triangles.sort((a, b) => a.depth - b.depth);

  const slabSize = Math.max(1, Math.ceil(triangles.length / DEPTH_SLABS));
  const batches: ProjectedPathBatch[] = [];
  for (let i = 0; i < triangles.length; i += slabSize) {
    const slice = triangles.slice(i, i + slabSize);
    batches.push(...batchSlabTriangles(slice, i / slabSize));
  }

  // Draw only surface-visible decoration, leaving anatomy batches and hit targets unchanged.
  if (november) {
    batches.push(...batchSlabTriangles(projectMoustache(angleDeg, width, height, ctx, triangles), DEPTH_SLABS));
  }

  const contour = edgeCounts
    ? buildBoundaryContour(edgeCounts, verts, palette.selectedStroke, triangles)
    : null;

  const fibres = overlay === 'contour'
    ? { surface: '', deep: '' }
    : projectFibreSegments(selectedFibres, mesh, verts, projectionFrame(angleDeg, width, height));

  return {
    triangles,
    batches,
    fibres,
    ...(contour ? { contour } : {}),
  };
}

/**
 * Hit-tests the frontmost visible triangle at `(x, y)` in SVG viewport coordinates.
 * Returns the canonical `muscleGroupId` if a muscle facet was hit, or `null` when
 * hitting neutral anatomy (head, hands, feet) or empty background.
 */
export function hitTestProjectedMuscle(
  projected: ProjectedMuscleBody,
  x: number,
  y: number
): Exclude<MuscleBodyMaterialId, 'neutral'> | null {
  for (let i = projected.triangles.length - 1; i >= 0; i -= 1) {
    const tri = projected.triangles[i];
    if (pointInTriangle(x, y, tri)) {
      return tri.muscleGroupId === 'neutral' ? null : tri.muscleGroupId;
    }
  }
  return null;
}
