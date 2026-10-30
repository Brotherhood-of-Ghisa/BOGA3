import type { CoWMetric } from './cow-scoring.ts';
import { competitionUnit } from './competition-contract.ts';
import { isCompetitionExerciseWire } from './competition-wire-guards.ts';

import type { CoWCalendarWire, CoWDefinitionWire, CoWWriteWire, CoWListWire, CoWRowWire, CoWRankingWire, CoWResultWire, CoWSummaryWire } from './competition-wire.ts';

export type { CoWCalendarWire, CoWDefinitionWire, CoWWriteWire, CoWListWire, CoWRowWire, CoWRankingWire, CoWResultWire, CoWSummaryWire } from './competition-wire.ts';

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


function isCoWRow(value: unknown, metric: CoWMetric): value is CoWRowWire {
  if (!record(value) || !exact(value, ['rank', 'member', 'former', 'value', 'state']) ||
    !record(value.member) || !exact(value.member, ['user_id', 'username']) || !identity(value.member.user_id) ||
    value.member.username !== null && typeof value.member.username !== 'string' || typeof value.former !== 'boolean') return false;
  if (value.state === 'unranked') return value.rank === null && value.value === null;
  if (value.state === 'unavailable') return (value.rank === null || positiveInteger(value.rank)) && value.value === null;
  return value.state === 'ranked' && positiveInteger(value.rank) && typeof value.value === 'number' &&
    Number.isFinite(value.value) && (metric === 'improvement' || value.value > 0);
}

function isCoWRanking(value: unknown, result: CoWResultWire): value is CoWRankingWire {
  if (!record(value) || !exact(value, ['metric', 'unit', 'entries', 'entry_count', 'next_cursor']) ||
    !result.cow.metrics.includes(value.metric as CoWMetric) || !Array.isArray(value.entries) ||
    !Number.isSafeInteger(value.entry_count) || (value.entry_count as number) < value.entries.length ||
    value.next_cursor !== null && !identity(value.next_cursor)) return false;
  const metric = value.metric as CoWMetric;
  const unit = result.normalized === null ? null : metric === 'improvement' ? 'percent'
    : competitionUnit(metric, result.normalized);
  if (value.unit !== unit || !value.entries.every(row => isCoWRow(row, metric))) return false;
  const rows = value.entries as CoWRowWire[];
  const ranks = rows.flatMap(row => row.rank === null ? [] : [row.rank]);
  return new Set(rows.map(row => row.member.user_id)).size === rows.length &&
    ranks.every((rank, index) => rank <= (value.entry_count as number) && (index === 0 || rank > ranks[index - 1])) &&
    (result.state === 'ready' || rows.length === 0) &&
    !(result.normalized === false && result.exercise?.rules.bodyweight_calculations_enabled &&
      result.exercise.rules.bodyweight_contribution > 0 && rows.some(row => row.value !== null));
}

export function isCoWResultWire(value: unknown): value is CoWResultWire {
  if (!record(value) || !exact(value, ['cow', 'exercise', 'bodyweight_calculations_enabled', 'state', 'normalized', 'publication_id', 'rankings']) ||
    !isCoWDefinitionWire(value.cow) || value.exercise !== null && !isCompetitionExerciseWire(value.exercise) ||
    typeof value.bodyweight_calculations_enabled !== 'boolean' ||
    !['pending', 'ready', 'unavailable'].includes(value.state as string) ||
    value.normalized !== null && typeof value.normalized !== 'boolean' ||
    value.publication_id !== null && !identity(value.publication_id) || !Array.isArray(value.rankings)) return false;
  const result = value as CoWResultWire;
  return (result.exercise === null || result.exercise.group_exercise_id === result.cow.group_exercise_id) &&
    (result.state === 'pending' ? result.publication_id === null : identity(result.publication_id)) &&
    (result.state !== 'ready' || result.normalized !== null) && result.rankings.length > 0 &&
    result.rankings.every(row => isCoWRanking(row, result)) &&
    new Set(result.rankings.map(row => row.metric)).size === result.rankings.length;
}

export function isCoWSummaryWire(value: unknown): value is CoWSummaryWire {
  if (!record(value) || !exact(value, ['group_id', 'week_start', 'calendar_revision', 'observed_at_us', 'valid_until_us', 'selection', 'result']) ||
    !identity(value.group_id) || value.week_start !== null && !dateKey(value.week_start) ||
    !positiveInteger(value.calendar_revision) || !positiveInteger(value.observed_at_us) || !positiveInteger(value.valid_until_us) ||
    value.valid_until_us < value.observed_at_us) return false;
  if (value.selection === 'none') return value.result === null;
  if (!isCoWResultWire(value.result) || value.result.cow.group_id !== value.group_id ||
    value.result.rankings.length !== value.result.cow.metrics.length || value.result.rankings.some(ranking =>
      ranking.entries.length > 3 || ranking.entries.some(row => row.rank === null || row.rank > 3))) return false;
  if (value.selection === 'current') return value.result.cow.starts_at_us <= value.observed_at_us && value.result.cow.ends_at_us > value.observed_at_us;
  return value.selection === 'previous_final' && value.result.cow.state === 'final' && value.result.state === 'ready' &&
    value.result.cow.ends_at_us <= value.observed_at_us;
}

/** The read alias is group-scoped; the stored key also pins the server's selection and publication. */
export function coWSummaryCacheKey(value: CoWSummaryWire): string {
  const result = value.result;
  return `cow-summary:v7:${value.group_id}:${value.week_start ?? 'unset'}:${value.calendar_revision}:` +
    `${result?.cow.cow_id ?? 'none'}:${result?.cow.revision ?? 0}:${result?.publication_id ?? 'pending'}:` +
    `${result?.exercise?.rules.rules_revision ?? 0}:${result?.bodyweight_calculations_enabled ?? 'unset'}`;
}

export function coWSummaryExpiresAt(value: CoWSummaryWire, fetchedAtMs: number): number {
  return Math.min(value.valid_until_us / 1000, fetchedAtMs + (value.valid_until_us - value.observed_at_us) / 1000);
}
