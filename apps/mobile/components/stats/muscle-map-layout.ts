import { uiBorder, uiGeometry, uiSpace, uiTypography } from '@/components/ui';
import { MUSCLE_MAP_REFERENCE, type MuscleMapFamily, type MuscleMapId } from './muscle-map-reference';

export type MapRect = { x: number; y: number; width: number; height: number };
type Tree = MuscleMapId | readonly ['x' | 'y', Tree, Tree];
export const MUSCLE_MAP_HEADER = uiTypography.lineHeight.xxs + uiSpace.sm;
export const MUSCLE_MAP_INSET = uiSpace.xs;
// Keep room for full figures wrapping at the narrowest muscle widths.
const MIN_TILE_HEIGHT = uiGeometry.tapTarget * 2 + uiSpace.xl + uiSpace.md;
const REFERENCES = Object.fromEntries(MUSCLE_MAP_REFERENCE.map(row => [row.id, row]));
export const MUSCLE_MAP_FAMILIES = ['Legs', 'Back', 'Chest', 'Shoulders', 'Arms', 'Core', 'Lower Legs'] as const;
export const MUSCLE_MAP_FAMILY_VOLUMES = Object.fromEntries(MUSCLE_MAP_FAMILIES.map(family =>
  [family, MUSCLE_MAP_REFERENCE.filter(row => row.family === family).reduce((sum, row) => sum + row.volume, 0)])) as Record<MuscleMapFamily, number>;
const TOTAL = Object.values(MUSCLE_MAP_FAMILY_VOLUMES).reduce((sum, volume) => sum + volume, 0);
const TREES: Record<MuscleMapFamily, Tree> = {
  Legs: ['y', ['x', 'quads', 'glutes_max'], ['y', 'hamstrings', ['x', 'hip_abductors', ['x', 'adductors', 'hip_flexors']]]],
  Back: ['y', 'back_lats', ['y', 'back_upper', ['y', 'traps_upper', ['y', 'traps_lower', 'spinal_erectors']]]],
  Chest: ['y', 'chest', 'serratus_anterior'],
  Shoulders: ['y', ['x', 'delts_front', 'delts_lateral'], ['x', 'delts_rear', 'rotator_cuff']],
  Arms: ['y', ['x', 'biceps', 'brachialis'], ['x', 'triceps', 'forearms_grip']],
  Core: ['x', 'abs_rectus', 'abs_obliques'],
  'Lower Legs': ['y', 'calves', 'tibialis_anterior'],
};
const rect = (x: number, y: number, width: number, height: number): MapRect => ({ x, y, width, height });

// Shared edges allocate exact outer rectangular areas, including header/padding.
export function muscleMapFamilyRects(width: number, height: number): Record<MuscleMapFamily, MapRect> {
  const v = MUSCLE_MAP_FAMILY_VOLUMES;
  const top = v.Legs + v.Back + v.Chest;
  const bottom = TOTAL - top;
  const topHeight = height * top / TOTAL;
  const bottomHeight = height - topHeight;
  const left = width * v.Legs / top;
  const right = width - left;
  const backHeight = topHeight * v.Back / (v.Back + v.Chest);
  const shoulders = width * (v.Shoulders + v.Core) / bottom;
  const arms = width * v.Arms / bottom;
  const shoulderHeight = bottomHeight * v.Shoulders / (v.Shoulders + v.Core);
  return {
    Legs: rect(0, 0, left, topHeight), Back: rect(left, 0, right, backHeight),
    Chest: rect(left, backHeight, right, topHeight - backHeight),
    Shoulders: rect(0, topHeight, shoulders, shoulderHeight),
    Arms: rect(shoulders, topHeight, arms, bottomHeight),
    Core: rect(0, topHeight + shoulderHeight, shoulders, bottomHeight - shoulderHeight),
    'Lower Legs': rect(shoulders + arms, topHeight, width - shoulders - arms, bottomHeight),
  };
}

function minimum(tree: Tree): { width: number; height: number; volume: number } {
  if (typeof tree === 'string') {
    const reference = REFERENCES[tree];
    const wordLength = Math.max(...reference.label.split(' ').map(word => word.length));
    // Conservative label width; all names use the same embedded body font.
    const labelWidth = wordLength * uiTypography.size.sm / 2 + (uiSpace.xs + uiBorder.width) * 2;
    return { width: Math.max(uiGeometry.tapTarget, labelWidth), height: MIN_TILE_HEIGHT, volume: reference.volume };
  }
  const a = minimum(tree[1]);
  const b = minimum(tree[2]);
  return { width: tree[0] === 'x' ? a.width + b.width : Math.max(a.width, b.width),
    height: tree[0] === 'y' ? a.height + b.height : Math.max(a.height, b.height), volume: a.volume + b.volume };
}

function split(tree: Tree, bounds: MapRect, result: Partial<Record<MuscleMapId, MapRect>>) {
  if (typeof tree === 'string') { result[tree] = bounds; return; }
  const [axis, a, b] = tree;
  const key = axis === 'x' ? 'width' : 'height';
  const am = minimum(a);
  const bm = minimum(b);
  const cut = Math.min(bounds[key] - bm[key], Math.max(am[key], bounds[key] * am.volume / (am.volume + bm.volume)));
  const first = { ...bounds, [key]: cut };
  const second = { ...bounds, [axis]: bounds[axis] + cut, [key]: bounds[key] - cut };
  split(a, first, result);
  split(b, second, result);
}

/** Geometry depends only on width and reference anatomy, never the metric/data. */
export function muscleMapLayout(width: number) {
  const unit = muscleMapFamilyRects(width, 1);
  const trees = { ...TREES };
  // Stack only the internal tiles when a small phone cannot fit a row.
  for (const family of ['Shoulders', 'Arms', 'Core'] as const) {
    if (unit[family].width - MUSCLE_MAP_INSET * 2 >= minimum(trees[family]).width) continue;
    const ids = MUSCLE_MAP_REFERENCE.filter(row => row.family === family).map(row => row.id);
    let tree: Tree = ids[ids.length - 1];
    for (let index = ids.length - 2; index >= 0; index -= 1) tree = ['y', ids[index], tree];
    trees[family] = tree;
  }
  const height = Math.max(...MUSCLE_MAP_FAMILIES.map(family =>
    (minimum(trees[family]).height + MUSCLE_MAP_HEADER + MUSCLE_MAP_INSET) / unit[family].height));
  const families = muscleMapFamilyRects(width, height);
  const muscles: Partial<Record<MuscleMapId, MapRect>> = {};
  for (const family of MUSCLE_MAP_FAMILIES) {
    const outer = families[family];
    split(trees[family], rect(outer.x + MUSCLE_MAP_INSET, outer.y + MUSCLE_MAP_HEADER,
      outer.width - MUSCLE_MAP_INSET * 2, outer.height - MUSCLE_MAP_HEADER - MUSCLE_MAP_INSET), muscles);
  }
  return { width, height, families, muscles: muscles as Record<MuscleMapId, MapRect> };
}

export const muscleMapTileInset = uiBorder.width;
