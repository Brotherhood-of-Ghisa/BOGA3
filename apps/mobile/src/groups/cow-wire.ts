import type { CoWMetric } from './cow-scoring';

export type CoWCalendarWire = { time_zone: string | null; revision: number; next_week_start: string | null };
export type CoWDefinitionWire = {
  cow_id: string; group_id: string; group_exercise_id: string;
  week_start: string; time_zone: string; starts_at_us: number; ends_at_us: number;
  metrics: CoWMetric[]; revision: number;
  state: 'scheduled' | 'active' | 'finalizing' | 'final' | 'unavailable' | 'cancelled';
};
export type CoWWriteWire = { cow: CoWDefinitionWire };
export type CoWListWire = { cows: CoWDefinitionWire[]; next_cursor: string | null };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const dateKey = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function timeZone(value: unknown): value is string {
  if (typeof value !== 'string' || (value !== 'UTC' && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(value))) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}

export function isCoWCalendarWire(value: unknown): value is CoWCalendarWire {
  return record(value) && exact(value, ['time_zone', 'revision', 'next_week_start']) && positiveInteger(value.revision) &&
    (value.time_zone === null ? value.next_week_start === null : timeZone(value.time_zone) && dateKey(value.next_week_start));
}

export function isCoWDefinitionWire(value: unknown): value is CoWDefinitionWire {
  if (!record(value) || !exact(value, ['cow_id', 'group_id', 'group_exercise_id', 'week_start', 'time_zone',
    'starts_at_us', 'ends_at_us', 'metrics', 'revision', 'state'])) return false;
  return identity(value.cow_id) && identity(value.group_id) && identity(value.group_exercise_id) &&
    dateKey(value.week_start) && timeZone(value.time_zone) && positiveInteger(value.starts_at_us) &&
    positiveInteger(value.ends_at_us) && value.ends_at_us > value.starts_at_us && positiveInteger(value.revision) &&
    Array.isArray(value.metrics) && value.metrics.length >= 1 && value.metrics.length <= 3 &&
    new Set(value.metrics).size === value.metrics.length && value.metrics.every(metric => ['e1rm', 'volume', 'improvement'].includes(metric)) &&
    typeof value.state === 'string' && ['scheduled', 'active', 'finalizing', 'final', 'unavailable', 'cancelled'].includes(value.state);
}

export const isCoWWriteWire = (value: unknown): value is CoWWriteWire =>
  record(value) && exact(value, ['cow']) && isCoWDefinitionWire(value.cow);
export const isCoWListWire = (value: unknown): value is CoWListWire =>
  record(value) && exact(value, ['cows', 'next_cursor']) && Array.isArray(value.cows) && value.cows.every(isCoWDefinitionWire) &&
  (value.next_cursor === null || identity(value.next_cursor));
