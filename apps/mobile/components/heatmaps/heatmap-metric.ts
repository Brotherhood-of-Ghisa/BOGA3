// heatmap-metric.ts — shared, pure helpers for the Daily/Weekly heatmaps.
// No React / react-native imports, so they unit-test in isolation and are safe to
// reuse from the aggregation adapter (heatmapData.ts) and the components.

import { uiColors } from '@/components/ui/tokens';
import type { CalendarHeatmapMetric } from '@/src/data';

export type { CalendarHeatmapMetric };

export type CalendarHeatmapBucket = 0 | 1 | 2 | 3 | 4;

/** Green volume ramp indexed by bucket level (0 = rest … 4 = max). Theme-driven. */
export const HEAT_RAMP = [
  uiColors.heatmapNeutralBg,
  uiColors.heatmapBucket1,
  uiColors.heatmapBucket2,
  uiColors.heatmapBucket3,
  uiColors.heatmapBucket4,
] as const;

/** Structural subset of an effort row carrying the four selectable metrics. */
export type HeatmapMetricSource = {
  totalVolume: number;
  nearFailureCount: number;
  estimatedRM1: number | null;
  highestWeight: number | null;
};

/**
 * Returns the value for the selected metric, or `null` when there is nothing to
 * show (no volume / no near-failure work / missing 1RM or top weight).
 */
export const getMetricValue = (
  source: HeatmapMetricSource,
  metric: CalendarHeatmapMetric
): number | null => {
  switch (metric) {
    case 'totalVolume':
      return source.totalVolume > 0 ? source.totalVolume : null;
    case 'nearFailureCount':
      return source.nearFailureCount > 0 ? source.nearFailureCount : null;
    case 'estimatedRM1':
      return source.estimatedRM1;
    case 'highestWeight':
      return source.highestWeight;
  }
};

/**
 * Buckets a value into the heat ramp (0 = rest, 1..4 = intensity) by normalizing
 * it across the *observed* range of activity in the window — i.e. against
 * [minPositive, maxPositive] rather than [0, maxPositive].
 *
 * Anchoring at the smallest logged value (instead of zero) spreads the ramp across
 * the athlete's actual spread of effort. This matters most for high-floor metrics
 * like top weight / 1RM, whose values cluster well above zero: a 0-anchored scale
 * pushes nearly everything into the darkest bucket, whereas the range-relative scale
 * makes the lightest session light and the heaviest dark.
 *
 * `minPositive`/`maxPositive` are the min/max over values > 0 in the window. The
 * lowest logged value maps to bucket 1 (light green, never grey); the highest to 4.
 * When every logged value is identical (range collapses), any activity maps to 4.
 */
export const getCalendarHeatmapBucket = (
  value: number,
  minPositive: number,
  maxPositive: number
): CalendarHeatmapBucket => {
  if (value <= 0 || maxPositive <= 0) return 0;
  if (maxPositive <= minPositive) return 4;
  const ratio = (value - minPositive) / (maxPositive - minPositive);
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
