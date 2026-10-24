import {
  getCalendarHeatmapBucket,
  type CalendarHeatmapBucket,
} from '@/components/heatmaps/heatmap-metric';
import { hexToLch, lchToHex } from '@/components/ui/lch';
import { uiRoles } from '@/components/ui/tokens';
import type { ProgressMuscleComparison } from '@/src/data';
import type { MuscleReportAssignment } from '@/src/data/muscle-analytics';
import type { ProgressMetric } from '@/src/preferences/model';
import {
  MUSCLE_BODY_MESH,
  type MuscleBodyFace,
  type MuscleBodyMaterialId,
  type MuscleBodyMesh,
} from './muscle-body-mesh';

export type BodyOrientation = 'front' | 'back';

export type ThemeShadeRoles = Pick<
  typeof uiRoles,
  'paper' | 'rule' | 'ink' | 'viz0' | 'viz1' | 'viz2' | 'viz3' | 'viz4'
>;

export type ThemeShadePalette = {
  readonly neutral: readonly string[];
  readonly buckets: readonly [
    readonly string[],
    readonly string[],
    readonly string[],
    readonly string[],
    readonly string[],
  ];
  readonly selected: readonly [
    readonly string[],
    readonly string[],
    readonly string[],
    readonly string[],
    readonly string[],
  ];
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
};

export type ProjectedPathBatch = {
  readonly key: string;
  readonly d: string;
  readonly fill: string;
  readonly stroke?: string;
  readonly selected: boolean;
};

export type ProjectedMuscleBody = {
  readonly triangles: readonly ProjectedTriangle[];
  readonly batches: readonly ProjectedPathBatch[];
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

const canonicalMuscleId = (id: string): string => LEGACY_MUSCLE_ALIASES[id] ?? id;

const readMetricValue = (
  row: ProgressMuscleComparison,
  metric: ProgressMetric
): number => {
  const raw = row.current[metric];
  return raw !== null && Number.isFinite(raw) && raw > 0 ? raw : 0;
};

/**
 * Maps each muscle group to its 0..4 sequential intensity bucket relative to
 * the highest-trained muscle in the current period for `metric`.
 */
export function computeMuscleBuckets(
  muscles: readonly ProgressMuscleComparison[],
  metric: ProgressMetric
): ReadonlyMap<string, CalendarHeatmapBucket> {
  let maxValue = 0;
  for (const row of muscles) {
    const val = readMetricValue(row, metric);
    if (val > maxValue) maxValue = val;
  }
  const buckets = new Map<string, CalendarHeatmapBucket>();
  for (const row of muscles) {
    const val = readMetricValue(row, metric);
    const bucket = getCalendarHeatmapBucket(val, 0, maxValue);
    buckets.set(row.muscleGroupId, bucket);
    buckets.set(canonicalMuscleId(row.muscleGroupId), bucket);
  }
  return buckets;
}

const buildShadeRamp = (
  baseHex: string,
  lightnessSpan: number,
  lightnessShift = 0,
  chromaBoost = 1
): readonly string[] => {
  const { lightness: baseL, chroma: baseC, hue: baseH } = hexToLch(baseHex);
  return Array.from({ length: SHADE_STEPS }, (_, step) => {
    const t = step / (SHADE_STEPS - 1);
    const deltaL = (t - 0.55) * lightnessSpan + lightnessShift;
    const lightness = clamp(baseL + deltaL, 14, 96.5);
    const chroma = clamp(baseC * chromaBoost * (0.88 + 0.22 * t), 0, 110);
    return lchToHex({ lightness, chroma, hue: baseH });
  });
};

/**
 * Precomputes LCh-shaded facet ramps from the active theme's sequential `viz0..viz4`
 * and neutral `paper`/`rule` roles so every 3D facet stays faithful to the theme.
 */
export function buildThemeShadePalette(
  roles: ThemeShadeRoles = uiRoles
): ThemeShadePalette {
  const { lightness: paperL, chroma: paperC, hue: paperH } = hexToLch(roles.paper);
  const { lightness: ruleL, chroma: ruleC } = hexToLch(roles.rule);
  const neutralBase = lchToHex({
    lightness: (paperL + ruleL) / 2,
    chroma: (paperC + ruleC) / 2,
    hue: paperH,
  });
  const vizSeeds = [roles.viz0, roles.viz1, roles.viz2, roles.viz3, roles.viz4] as const;

  return {
    neutral: buildShadeRamp(neutralBase, 18),
    buckets: [
      buildShadeRamp(vizSeeds[0], 20),
      buildShadeRamp(vizSeeds[1], 22),
      buildShadeRamp(vizSeeds[2], 22),
      buildShadeRamp(vizSeeds[3], 22),
      buildShadeRamp(vizSeeds[4], 22),
    ],
    selected: [
      buildShadeRamp(vizSeeds[0], 22, -6, 1.15),
      buildShadeRamp(vizSeeds[1], 22, -5, 1.15),
      buildShadeRamp(vizSeeds[2], 22, -5, 1.15),
      buildShadeRamp(vizSeeds[3], 22, -4, 1.15),
      buildShadeRamp(vizSeeds[4], 22, -4, 1.15),
    ],
    selectedStroke: roles.ink,
  };
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
  readonly buckets: ReadonlyMap<string, CalendarHeatmapBucket>;
  readonly selectedCanonicalId: string | null;
  readonly palette: ThemeShadePalette;
};

const resolveFaceFill = (
  materialId: MuscleBodyMaterialId,
  step: number,
  selected: boolean,
  ctx: ProjectionContext
): string => {
  if (materialId === 'neutral') return ctx.palette.neutral[step];
  const bucket = ctx.buckets.get(materialId) ?? 0;
  return selected ? ctx.palette.selected[bucket][step] : ctx.palette.buckets[bucket][step];
};

type RotatedVertices = {
  readonly rx: Float64Array;
  readonly ry: Float64Array;
  readonly rz: Float64Array;
  readonly sx: Float64Array;
  readonly sy: Float64Array;
};

const rotateAndProjectVertices = (
  mesh: MuscleBodyMesh,
  angleDeg: number,
  width: number,
  height: number
): RotatedVertices => {
  const rad = (normaliseBodyAngle(angleDeg) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const scale = Math.min(width / MODEL_WIDTH_SPAN, height / MODEL_HEIGHT_SPAN);
  const halfW = width / 2;
  const halfH = height / 2;
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
  const fill = resolveFaceFill(materialId, step, selected, ctx);

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
  };
};

const roundCoord = (n: number): number => Math.round(n * 10) / 10;

const batchSlabTriangles = (
  slabTriangles: readonly ProjectedTriangle[],
  slabIndex: number,
  selectedStroke: string
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
      stroke: selectedStroke,
      selected: true,
    });
  });
  return batches;
};

export type ProjectMuscleBodyOptions = {
  readonly angleDeg: number;
  readonly width: number;
  readonly height: number;
  readonly buckets: ReadonlyMap<string, CalendarHeatmapBucket>;
  readonly selectedId?: string | null;
  /** The user's muscle setup; unset shows every anatomy entry as its own muscle. */
  readonly report?: MuscleReportAssignment;
  readonly palette?: ThemeShadePalette;
  readonly mesh?: MuscleBodyMesh;
};

/**
 * Projects the 3D muscle body at `angleDeg` into back-to-front sorted triangles
 * and depth-slabbed SVG `<Path>` batches.
 */
export function projectMuscleBody({
  angleDeg,
  width,
  height,
  buckets,
  selectedId = null,
  report,
  palette = getDefaultPalette(),
  mesh = MUSCLE_BODY_MESH,
}: ProjectMuscleBodyOptions): ProjectedMuscleBody {
  if (width <= 0 || height <= 0) {
    return { triangles: [], batches: [] };
  }
  const verts = rotateAndProjectVertices(mesh, angleDeg, width, height);
  const selectedCanonicalId = selectedId ? canonicalMuscleId(selectedId) : null;
  const ctx: ProjectionContext = {
    verts,
    materials: mesh.materials,
    report,
    buckets,
    selectedCanonicalId,
    palette,
  };
  const triangles: ProjectedTriangle[] = [];

  for (const face of mesh.faces) {
    const projected = projectSingleFace(face, ctx);
    if (projected) triangles.push(projected);
  }

  triangles.sort((a, b) => a.depth - b.depth);

  const slabSize = Math.max(1, Math.ceil(triangles.length / DEPTH_SLABS));
  const batches: ProjectedPathBatch[] = [];
  for (let i = 0; i < triangles.length; i += slabSize) {
    const slice = triangles.slice(i, i + slabSize);
    batches.push(...batchSlabTriangles(slice, i / slabSize, palette.selectedStroke));
  }

  return { triangles, batches };
}

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
