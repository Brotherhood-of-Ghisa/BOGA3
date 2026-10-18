import { uiGeometry } from '@/components/ui';
import type { ExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import type { ProgressMuscleComparison } from '@/src/data/progress-comparisons';
import { exerciseCountedMuscles } from '@/src/exercise-catalog/exercise-muscles';
import { groupedTargetAttainment } from '@/src/preferences/targets';
import type { ProgressMetric } from '@/src/preferences/model';
import type { ComparisonRow } from './comparison-columns';
import { MUSCLE_MAP_FAMILIES, MUSCLE_MAP_HEADER, MUSCLE_MAP_INSET, muscleMapFamilyRects, type MapRect } from './muscle-map-layout';
import type { MuscleMapFamily } from './muscle-map-reference';

export type ExerciseMapItem = ComparisonRow & {
  id: string;
  name: string;
  lastCompletedAt: Date | null;
};
export type ExerciseMapEntry = { item: ExerciseMapItem; targetAttainment: number };
export type ExerciseMapFamily = { name: MuscleMapFamily; exercises: ExerciseMapEntry[] };

type Input = {
  items: readonly ExerciseMapItem[];
  exercises: readonly Pick<ExerciseCatalogExercise, 'id' | 'mappings'>[];
  muscles: readonly ProgressMuscleComparison[];
  workingSetTarget: number;
};

/** Primary mappings choose membership; full exercise figures are never summed from muscle rows. */
export function buildExerciseMapFamilies({ items, exercises, muscles, workingSetTarget }: Input): ExerciseMapFamily[] {
  const definitions = new Map(exercises.map(exercise => [exercise.id, exercise]));
  const muscleById = new Map(muscles.map(muscle => [muscle.muscleGroupId, muscle]));
  const counts = Object.fromEntries(muscles.map(muscle => [muscle.muscleGroupId, muscle.current.workingSetCount]));
  const families = MUSCLE_MAP_FAMILIES.map(name => ({ name, exercises: [] as ExerciseMapEntry[] }));
  for (const item of items) {
    const exercise = definitions.get(item.id);
    if (!exercise) continue;
    const primary = exerciseCountedMuscles(exercise).filter(mapping => mapping.role === 'primary');
    for (const family of families) {
      const ids = primary.filter(mapping => muscleById.get(mapping.muscleGroupId)?.familyName === family.name)
        .map(mapping => mapping.muscleGroupId);
      if (ids.length === 0) continue;
      family.exercises.push({ item, targetAttainment: groupedTargetAttainment(ids, counts, workingSetTarget) });
    }
  }
  return families;
}

export const exerciseMapValue = (item: ExerciseMapItem, metric: ProgressMetric): number => {
  const value = metric === 'workingSetCount' ? item.current.workingSetCount : item.current.totalVolume;
  return value !== null && Number.isFinite(value) && value > 0 ? value : 0;
};

/** The shared family proportions need room for family controls, not the muscle map's 25 labels. */
export function exerciseMapLayout(width: number) {
  const unit = muscleMapFamilyRects(width, 1);
  const minimum = MUSCLE_MAP_HEADER + MUSCLE_MAP_INSET + uiGeometry.tapTarget;
  const height = Math.max(width * 2, ...Object.values(unit).map(bounds => minimum / bounds.height));
  return { height, families: muscleMapFamilyRects(width, height) };
}

/** Binary partition preserves area, including tiny values; readable rows supply the touch targets. */
export function exerciseMapTileRects(entries: readonly ExerciseMapEntry[], bounds: MapRect, metric: ProgressMetric) {
  const positive = entries.filter(entry => exerciseMapValue(entry.item, metric) > 0);
  const max = Math.max(0, ...positive.map(entry => exerciseMapValue(entry.item, metric)));
  const weighted = positive.map(entry => ({ entry, weight: exerciseMapValue(entry.item, metric) / max }))
    .sort((a, b) => b.weight - a.weight || a.entry.item.id.localeCompare(b.entry.item.id));
  const result: { entry: ExerciseMapEntry; bounds: MapRect }[] = [];
  const split = (rows: typeof weighted, rect: MapRect): void => {
    if (rows.length === 0) return;
    if (rows.length === 1) { result.push({ entry: rows[0].entry, bounds: rect }); return; }
    const middle = Math.ceil(rows.length / 2);
    const first = rows.slice(0, middle);
    const second = rows.slice(middle);
    const sum = (items: typeof rows) => items.reduce((total, row) => total + row.weight, 0);
    const firstWeight = sum(first);
    const total = firstWeight + sum(second);
    const axis = rect.width >= rect.height ? 'x' : 'y';
    const dimension = axis === 'x' ? 'width' : 'height';
    const cut = total > 0 ? rect[dimension] * firstWeight / total : 0;
    split(first, { ...rect, [dimension]: cut });
    split(second, { ...rect, [axis]: rect[axis] + cut, [dimension]: rect[dimension] - cut });
  };
  split(weighted, bounds);
  return result;
}
