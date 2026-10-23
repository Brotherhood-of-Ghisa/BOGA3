/** Safe display projections, never private calculation inputs. Null means unavailable. */
export type NormalizedSetMetrics = {
  added_load_percent_bw: number | null;
  e1rm_percent_bw: number | null;
  volume_percent_bw_reps: number | null;
};

export function isNormalizedSetMetrics(value: unknown): value is NormalizedSetMetrics | null {
  if (value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = ['added_load_percent_bw', 'e1rm_percent_bw', 'volume_percent_bw_reps'];
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === fields.length && fields.every(field => Object.hasOwn(record, field) &&
    (record[field] === null || typeof record[field] === 'number' && Number.isFinite(record[field]) && record[field] >= 0));
}
