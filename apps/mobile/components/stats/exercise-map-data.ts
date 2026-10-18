import { uiGeometry } from '@/components/ui';
import type { ExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import type { ProgressMuscleComparison } from '@/src/data/progress-comparisons';
import { exerciseCountedMuscles } from '@/src/exercise-catalog/exercise-muscles';
import { addFiniteVolume } from '@/src/exercise-calculations/analytics';
import { groupedTargetAttainment } from '@/src/preferences/targets';
import type { ProgressMetric } from '@/src/preferences/model';
import { hasComparisonMetric, type ComparisonPeriodFigures, type ComparisonRow } from './comparison-columns';
import { MUSCLE_MAP_FAMILIES, MUSCLE_MAP_HEADER, MUSCLE_MAP_INSET, muscleMapFamilyRects, type MapRect } from './muscle-map-layout';
import type { MuscleMapFamily } from './muscle-map-reference';

export type ExerciseMapItem = ComparisonRow & {
  id: string;
  name: string;
  lastCompletedAt: Date | null;
};
export type ExerciseMapEntry = { item: ExerciseMapItem; targetAttainment: number };
export type ExerciseMapSecondary = ComparisonRow & { exercises: ExerciseMapEntry[]; targetAttainment: number };
export type ExerciseMapTile = ExerciseMapEntry | ExerciseMapSecondary;
export type ExerciseMapFamily = { name: MuscleMapFamily; exercises: ExerciseMapEntry[]; secondary: ExerciseMapSecondary | null };

type Input = {
  items: readonly ExerciseMapItem[];
  exercises: readonly Pick<ExerciseCatalogExercise, 'id' | 'mappings'>[];
  muscles: readonly ProgressMuscleComparison[];
  workingSetTarget: number;
};

type FamilyMuscles = { primary: string[]; secondary: string[] };
const familyMuscles = (exercise: Input['exercises'][number], family: MuscleMapFamily, muscles: ReadonlyMap<string, ProgressMuscleComparison>): FamilyMuscles => {
  const mappings = exerciseCountedMuscles(exercise).filter(mapping => muscles.get(mapping.muscleGroupId)?.familyName === family);
  return { primary: mappings.filter(mapping => mapping.role === 'primary').map(mapping => mapping.muscleGroupId),
    secondary: mappings.filter(mapping => mapping.role === 'secondary').map(mapping => mapping.muscleGroupId) };
};

/** Full exercise units, once per family: named primary work and half-weight secondary-only work. */
export function buildExerciseMapFamilies({ items, exercises, muscles, workingSetTarget }: Input): ExerciseMapFamily[] {
  const definitions = new Map(exercises.map(exercise => [exercise.id, exercise]));
  const muscleById = new Map(muscles.map(muscle => [muscle.muscleGroupId, muscle]));
  const counts = Object.fromEntries(muscles.map(muscle => [muscle.muscleGroupId, muscle.current.workingSetCount]));
  return MUSCLE_MAP_FAMILIES.map(name => {
    const family: ExerciseMapFamily = { name, exercises: [], secondary: null };
    const secondaryItems: ExerciseMapEntry[] = [];
    for (const item of items) {
      const exercise = definitions.get(item.id);
      if (!exercise) continue;
      const ids = familyMuscles(exercise, name, muscleById);
      if (ids.primary.length > 0) family.exercises.push({ item,
        targetAttainment: groupedTargetAttainment(ids.primary, counts, workingSetTarget) });
      else if (ids.secondary.length > 0) secondaryItems.push({ item: { ...item,
        current: halfPeriod(item.current), previous: halfPeriod(item.previous) }, targetAttainment: 0 });
    }
    if (secondaryItems.length > 0) {
      // Target membership comes from either period before search/gym filtering, never displayed rows.
      const represented = muscles.filter(muscle => muscle.familyName === name && muscle.exercises.some(contributor => {
        const exercise = definitions.get(contributor.exerciseDefinitionId);
        if (!exercise || !hasComparisonMetric(contributor, 'workingSetCount')) return false;
        const ids = familyMuscles(exercise, name, muscleById);
        return ids.primary.length === 0 && ids.secondary.includes(muscle.muscleGroupId);
      })).map(muscle => muscle.muscleGroupId);
      family.secondary = { exercises: secondaryItems,
        targetAttainment: groupedTargetAttainment(represented, counts, workingSetTarget),
        current: sumPeriods(secondaryItems.map(entry => entry.item.current)),
        previous: sumPeriods(secondaryItems.map(entry => entry.item.previous)) };
    }
    return family;
  });
}

const halfPeriod = (period: ComparisonPeriodFigures): ComparisonPeriodFigures => ({
  workingSetCount: period.workingSetCount * .5,
  totalVolume: period.totalVolume === null || !Number.isFinite(period.totalVolume) ? null : period.totalVolume * .5,
  volumeSetCount: period.volumeSetCount,
});
const sumPeriods = (periods: ComparisonPeriodFigures[]): ComparisonPeriodFigures => periods.reduce((sum, period) => ({
  workingSetCount: sum.workingSetCount + period.workingSetCount,
  totalVolume: addFiniteVolume(sum.totalVolume, period.totalVolume),
  volumeSetCount: (sum.volumeSetCount ?? 0) + (period.volumeSetCount ?? 0),
}), { workingSetCount: 0, totalVolume: 0, volumeSetCount: 0 });

export const exerciseMapTileRow = (entry: ExerciseMapTile): ComparisonRow => 'item' in entry ? entry.item : entry;
export const exerciseMapTileKey = (entry: ExerciseMapTile): string => 'item' in entry ? `exercise:${entry.item.id}` : 'secondary';
export const exerciseMapValue = (item: ComparisonRow, metric: ProgressMetric): number => {
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
export function exerciseMapTileRects<T extends ExerciseMapTile>(entries: readonly T[], bounds: MapRect, metric: ProgressMetric) {
  const value = (entry: T) => exerciseMapValue(exerciseMapTileRow(entry), metric);
  const positive = entries.filter(entry => value(entry) > 0);
  const max = Math.max(0, ...positive.map(value));
  const weighted = positive.map(entry => ({ entry, weight: value(entry) / max }))
    .sort((a, b) => b.weight - a.weight || exerciseMapTileKey(a.entry).localeCompare(exerciseMapTileKey(b.entry)));
  const result: { entry: T; bounds: MapRect }[] = [];
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
