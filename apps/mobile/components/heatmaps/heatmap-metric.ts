// heatmap-metric.ts — shared, pure helpers for the Daily/Weekly heatmaps.
// No React / react-native imports, so they unit-test in isolation and are safe to
// reuse from the aggregation adapter (heatmapData.ts) and the components.

import { uiRoles } from '@/components/ui/tokens';
import type { CalendarHeatmapMetric } from '@/src/data';

export type { CalendarHeatmapMetric };

export type CalendarHeatmapBucket = 0 | 1 | 2 | 3 | 4;

/**
 * The data-viz ramp indexed by bucket level (0 = rest … 4 = max): the `viz`
 * roles of `design-language.md` §2.
 */
export const HEAT_RAMP = [
  uiRoles.viz0,
  uiRoles.viz1,
  uiRoles.viz2,
  uiRoles.viz3,
  uiRoles.viz4,
] as const;

/** Structural subset of an effort row carrying the four selectable metrics. */
export type HeatmapMetricSource = {
  totalVolume: number | null;
  workingSetCount: number;
  estimatedRM1: number | null;
  highestWeight: number | null;
};

/**
 * Returns the value for the selected metric, or `null` when there is nothing to
 * show (no volume / no working sets / missing 1RM or top weight).
 */
export const getMetricValue = (
  source: HeatmapMetricSource,
  metric: CalendarHeatmapMetric
): number | null => {
  switch (metric) {
    case 'totalVolume':
      return source.totalVolume;
    case 'workingSetCount':
      return source.workingSetCount;
    case 'estimatedRM1':
      return source.estimatedRM1;
    case 'highestWeight':
      return source.highestWeight;
  }
};

/** Zero-based share of the History maximum; no known positive scale stays neutral. */
export const getCalendarHeatmapBucket = (
  value: number,
  maxPositive: number
): CalendarHeatmapBucket => {
  if (!Number.isFinite(value) || !Number.isFinite(maxPositive) || value <= 0 || maxPositive <= 0) return 0;
  const ratio = value / maxPositive;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
};

/** Local calendar date as `YYYY-MM-DD` (matches the effort `dateKey` format). */
export const getCurrentLocalDateKey = (): string => {
  const now = new Date();
  const year = now.getFullYear().toString().padStart(4, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};
