/** Safe display projections, never private calculation inputs. Null means unavailable. */
export type AddedOneRepMaxDisplay = { added_e1rm_percent_bw?: number | null };

/** Only a normalized 1RM may carry this negotiated, nonnegative display projection. */
export function isAddedOneRepMaxDisplay(value: Record<string, unknown>, applicable: boolean): boolean {
  if (!Object.hasOwn(value, 'added_e1rm_percent_bw')) return true;
  const added = value.added_e1rm_percent_bw;
  return applicable && (added === null || typeof added === 'number' && Number.isFinite(added) && added >= 0);
}

export type NormalizedSetMetrics = AddedOneRepMaxDisplay & {
  added_load_percent_bw: number | null;
  e1rm_percent_bw: number | null;
  volume_percent_bw_reps: number | null;
};

export function isNormalizedSetMetrics(value: unknown): value is NormalizedSetMetrics | null {
  if (value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const fields = ['added_load_percent_bw', 'e1rm_percent_bw', 'volume_percent_bw_reps',
    ...(Object.hasOwn(record, 'added_e1rm_percent_bw') ? ['added_e1rm_percent_bw'] : [])];
  return Object.keys(record).length === fields.length && fields.every(field => Object.hasOwn(record, field) &&
    (record[field] === null || typeof record[field] === 'number' && Number.isFinite(record[field]) && record[field] >= 0));
}
