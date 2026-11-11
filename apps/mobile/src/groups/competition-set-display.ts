/** Safe display projections, never private calculation inputs. Null means unavailable. */
export type NormalizedSetMetrics = {
  added_load_percent_bw: number | null;
  e1rm_percent_bw: number | null;
  e1rm_added_load_percent_bw?: number | null;
  volume_percent_bw_reps: number | null;
};

export function isNormalizedSetMetrics(value: unknown): value is NormalizedSetMetrics | null {
  if (value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const fields = ['added_load_percent_bw', 'e1rm_percent_bw', 'volume_percent_bw_reps',
    ...(Object.hasOwn(record, 'e1rm_added_load_percent_bw') ? ['e1rm_added_load_percent_bw'] : [])];
  return Object.keys(record).length === fields.length && fields.every(field => Object.hasOwn(record, field) &&
    (record[field] === null || typeof record[field] === 'number' && Number.isFinite(record[field]) && record[field] >= 0));
}

/** An added-load projection is optional for old servers, nullable when unavailable. */
export function hasValidAddedOneRepMax(value: Record<string, unknown>, metric: unknown, unit: unknown): boolean {
  return !Object.hasOwn(value, 'display_value') || metric === 'e1rm' && unit === 'percent_bw' &&
    (value.display_value === null || typeof value.display_value === 'number' && Number.isFinite(value.display_value) &&
      value.display_value >= 0 && typeof value.value === 'number' && value.display_value <= value.value);
}

export function competitionDisplayValue(score: { metric: string; unit: string | null; value: number | null; display_value?: number | null }): number | null {
  return score.metric === 'e1rm' && score.unit === 'percent_bw' ? score.display_value ?? null : score.value;
}
