// Imported health activities for the coach (`GET /v1/agent/activities` and
// training status `cardio`). Pure: the route reads owner-filtered rows and
// this projects them. Contract: docs/specs/tech/health-activities-contract.md.
import { localDateKey } from '../../../apps/mobile/src/utils/calendar-weeks.ts';
import { zonedWallClock, type TrainingStatusWindow } from './training-status.ts';

/** `app_public.health_activities` as PostgREST returns it (timestamptz as text). */
export type ActivityRow = {
  source: string;
  external_id: string;
  activity_type: string;
  started_at: string;
  ended_at: string;
  duration_sec: number;
  distance_m: number | null;
  active_energy_kcal: number | null;
  avg_heart_rate_bpm: number | null;
  max_heart_rate_bpm: number | null;
  elevation_gain_m: number | null;
  source_name: string | null;
  device_name: string | null;
};

export const ACTIVITY_COLUMNS =
  'source,external_id,activity_type,started_at,ended_at,duration_sec,distance_m,active_energy_kcal,' +
  'avg_heart_rate_bpm,max_heart_rate_bpm,elevation_gain_m,source_name,device_name';

/** A caller's bad range or cursor; the route answers it as `400`. */
export class ActivityQueryError extends Error {}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

/** An ISO 8601 instant with an explicit zone, as canonical UTC text; null when absent. */
export const parseActivityInstant = (raw: string | null, label: string): string | null => {
  if (raw === null || raw === '') return null;
  const ms = ISO_INSTANT.test(raw) ? Date.parse(raw) : Number.NaN;
  if (!Number.isFinite(ms)) {
    throw new ActivityQueryError(`${label} must be an ISO 8601 instant with a time zone, e.g. 2026-11-01T00:00:00Z.`);
  }
  return new Date(ms).toISOString();
};

/** The optional half-open `[from, to)` range on an activity's start. */
export const parseActivityRange = (fromRaw: string | null, toRaw: string | null) => {
  const from = parseActivityInstant(fromRaw, 'from');
  const to = parseActivityInstant(toRaw, 'to');
  if (from !== null && to !== null && Date.parse(from) >= Date.parse(to)) {
    throw new ActivityQueryError('from must be before to.');
  }
  return { from, to };
};

/** The keyset position after an activity: newest start first, then source and external id. */
export type ActivityCursor = { started_at: string; source: string; external_id: string };

export const activityCursorFrom = (value: Record<string, unknown>): ActivityCursor => {
  const { started_at: startedAt, source, external_id: externalId } = value;
  if (
    typeof startedAt !== 'string' || !ISO_INSTANT.test(startedAt) || !Number.isFinite(Date.parse(startedAt))
    || typeof source !== 'string' || source.length === 0 || source.length > 40
    || typeof externalId !== 'string' || externalId.length === 0 || externalId.length > 200
  ) {
    throw new ActivityQueryError('Cursor is invalid.');
  }
  return { started_at: startedAt, source, external_id: externalId };
};

/** A BoGa session's span; an active session runs until now. Epoch ms, as synced. */
export type OverlapSessionRow = { id: string; status: string; started_at: number; completed_at: number | null };

/**
 * Activity types that record the lifting a BoGa session already logs. Only
 * these can be flagged as overlapping a session: a run during a gym visit is
 * still cardio.
 */
export const STRENGTH_ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  'traditional_strength_training',
  'functional_strength_training',
  'core_training',
  'cross_training',
]);

const instantMs = (value: string): number => {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`Unparseable activity timestamp: ${value}`);
  return ms;
};

const sessionEndMs = (session: OverlapSessionRow, nowMs: number): number | null =>
  session.status === 'active' ? Math.max(nowMs, session.started_at) : session.completed_at;

/**
 * The first (earliest-starting, then by id) logged session a strength activity
 * shares any time with, else null. Half-open spans: touching ends do not overlap.
 */
export const overlappingSessionId = (
  activity: Pick<ActivityRow, 'activity_type' | 'started_at' | 'ended_at'>,
  sessions: readonly OverlapSessionRow[],
  nowMs: number,
): string | null => {
  if (!STRENGTH_ACTIVITY_TYPES.has(activity.activity_type)) return null;
  const start = instantMs(activity.started_at);
  const end = instantMs(activity.ended_at);
  const matches = sessions.filter((session) => {
    const sessionEnd = sessionEndMs(session, nowMs);
    return sessionEnd !== null && session.started_at < end && start < sessionEnd;
  });
  matches.sort((left, right) => left.started_at - right.started_at || left.id.localeCompare(right.id));
  return matches[0]?.id ?? null;
};

/** One activity as the coach sees it: ISO instants, unit-suffixed figures and the overlap flag. */
export const projectActivity = (row: ActivityRow, sessions: readonly OverlapSessionRow[], nowMs: number) => {
  const overlap = overlappingSessionId(row, sessions, nowMs);
  return {
    source: row.source,
    external_id: row.external_id,
    activity_type: row.activity_type,
    started_at: new Date(instantMs(row.started_at)).toISOString(),
    ended_at: new Date(instantMs(row.ended_at)).toISOString(),
    duration_seconds: row.duration_sec,
    distance_m: row.distance_m,
    active_energy_kcal: row.active_energy_kcal,
    avg_heart_rate_bpm: row.avg_heart_rate_bpm,
    max_heart_rate_bpm: row.max_heart_rate_bpm,
    elevation_gain_m: row.elevation_gain_m,
    source_name: row.source_name,
    device_name: row.device_name,
    overlaps_logged_session: overlap !== null,
    overlapping_session_id: overlap,
  };
};

/** The span of sessions that could overlap these activities, or null when none is a strength type. */
export const overlapReadSpan = (rows: readonly ActivityRow[]): { fromMs: number; toMs: number } | null => {
  const strength = rows.filter((row) => STRENGTH_ACTIVITY_TYPES.has(row.activity_type));
  if (strength.length === 0) return null;
  return {
    fromMs: Math.min(...strength.map((row) => instantMs(row.started_at))),
    toMs: Math.max(...strength.map((row) => instantMs(row.ended_at))),
  };
};

type Totals = { activities: number; duration_seconds: number; distance_m: number; active_energy_kcal: number };
const emptyTotals = (): Totals => ({ activities: 0, duration_seconds: 0, distance_m: 0, active_energy_kcal: 0 });
const addTo = (totals: Totals, row: ActivityRow): void => {
  totals.activities += 1;
  totals.duration_seconds += row.duration_sec;
  totals.distance_m += row.distance_m ?? 0;
  totals.active_energy_kcal += row.active_energy_kcal ?? 0;
};
const rounded = (totals: Totals): Totals => ({
  activities: totals.activities,
  duration_seconds: totals.duration_seconds,
  distance_m: Math.round(totals.distance_m),
  active_energy_kcal: Math.round(totals.active_energy_kcal),
});

const weekTotals = (weekStart: Date, rows: readonly ActivityRow[]) => {
  const all = emptyTotals();
  const byType = new Map<string, Totals>();
  for (const row of rows) {
    addTo(all, row);
    const typeTotals = byType.get(row.activity_type) ?? emptyTotals();
    addTo(typeTotals, row);
    byType.set(row.activity_type, typeTotals);
  }
  return {
    week_start: localDateKey(weekStart),
    ...rounded(all),
    by_type: [...byType.entries()]
      .sort(([leftType, left], [rightType, right]) => right.duration_seconds - left.duration_seconds
        || leftType.localeCompare(rightType))
      .map(([activityType, totals]) => ({ activity_type: activityType, ...rounded(totals) })),
  };
};

/** How far back the status reads activities: the four full weeks before this one. */
export const cardioReadStart = (window: TrainingStatusWindow): Date => window.pastWeeks[0].start;

/**
 * The status's weekly cardio: imported activities this week and in each of the
 * four full weeks before it (oldest first), on the profile's calendar. A
 * strength activity overlapping a logged session is the session, already in
 * the muscle figures, so it is counted in `overlapping_excluded` only.
 */
export const buildCardioSummary = (input: {
  rows: readonly ActivityRow[];
  sessions: readonly OverlapSessionRow[];
  window: TrainingStatusWindow;
  timeZone: string;
  nowMs: number;
  complete: boolean;
}) => {
  const weeks = [...input.window.pastWeeks, input.window.plan.week];
  const perWeek = weeks.map(() => [] as ActivityRow[]);
  let excluded = 0;
  let latest: Date | null = null;
  for (const row of input.rows) {
    const local = zonedWallClock(new Date(instantMs(row.started_at)), input.timeZone);
    const index = weeks.findIndex((week) => local >= week.start && local < week.end);
    if (index < 0) continue;
    if (overlappingSessionId(row, input.sessions, input.nowMs) !== null) {
      excluded += 1;
      continue;
    }
    perWeek[index].push(row);
    if (latest === null || local > latest) latest = local;
  }
  const summaries = weeks.map((week, index) => weekTotals(week.start, perWeek[index]));
  return {
    this_week: summaries[summaries.length - 1],
    last_4_weeks: summaries.slice(0, -1),
    last_activity_on: latest === null ? null : localDateKey(latest),
    overlapping_excluded: excluded,
    complete: input.complete,
  };
};
