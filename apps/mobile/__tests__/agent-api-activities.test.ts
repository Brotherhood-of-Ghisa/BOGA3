/**
 * Imported health activities as the coach sees them (`GET /v1/agent/activities`
 * and training status `cardio`): the strength-overlap flag, the query range and
 * cursor, and the weekly cardio summary on the profile's calendar. The suite
 * runs in Europe/London (jest.config.js); each case names the status's zone.
 */
import {
  ActivityQueryError, activityCursorFrom, buildCardioSummary, overlapReadSpan, overlappingSessionId,
  parseActivityInstant, parseActivityRange, projectActivity, STRENGTH_ACTIVITY_TYPES,
  type ActivityRow, type OverlapSessionRow,
} from '../../../supabase/functions/agent-api/activities.ts';
import { trainingStatusWindow } from '../../../supabase/functions/agent-api/training-status.ts';

// Wednesday 28 Oct 2026, 12:00 UTC: this week is Mon 26 Oct – Sun 1 Nov.
const NOW = new Date('2026-10-28T12:00:00.000Z');
const at = (iso: string) => new Date(iso).getTime();

const activity = (externalId: string, extra: Partial<ActivityRow> = {}): ActivityRow => ({
  source: 'apple_health',
  external_id: externalId,
  activity_type: 'running',
  started_at: '2026-10-27T07:00:00+00:00',
  ended_at: '2026-10-27T07:30:00+00:00',
  duration_sec: 1800,
  distance_m: 5000,
  active_energy_kcal: 350,
  avg_heart_rate_bpm: 150,
  max_heart_rate_bpm: 172,
  elevation_gain_m: 20,
  source_name: 'Workout',
  device_name: 'Apple Watch',
  ...extra,
});

const session = (id: string, start: string, end: string | null, status = 'completed'): OverlapSessionRow => ({
  id, status, started_at: at(start), completed_at: end === null ? null : at(end),
});

const strength = (externalId: string, start: string, end: string): ActivityRow =>
  activity(externalId, {
    activity_type: 'traditional_strength_training', started_at: start, ended_at: end,
    duration_sec: (at(end) - at(start)) / 1000, distance_m: null,
  });

describe('overlappingSessionId', () => {
  const gym = session('gym', '2026-10-27T17:00:00Z', '2026-10-27T18:00:00Z');

  it('flags a strength activity that shares time with a logged session', () => {
    expect(overlappingSessionId(strength('w', '2026-10-27T17:05:00Z', '2026-10-27T18:10:00Z'), [gym], NOW.getTime()))
      .toBe('gym');
  });

  it('never flags cardio, even during a session: a treadmill run at the gym is still cardio', () => {
    const run = activity('run', { started_at: '2026-10-27T17:00:00Z', ended_at: '2026-10-27T17:20:00Z' });
    expect(overlappingSessionId(run, [gym], NOW.getTime())).toBeNull();
  });

  it('treats spans as half-open, so a workout ending as the session starts does not overlap', () => {
    expect(overlappingSessionId(strength('w', '2026-10-27T16:00:00Z', '2026-10-27T17:00:00Z'), [gym], NOW.getTime()))
      .toBeNull();
    expect(overlappingSessionId(strength('w', '2026-10-27T18:00:00Z', '2026-10-27T18:30:00Z'), [gym], NOW.getTime()))
      .toBeNull();
  });

  it('extends an active session to now', () => {
    const live = session('live', '2026-10-28T11:00:00Z', null, 'active');
    expect(overlappingSessionId(strength('w', '2026-10-28T11:50:00Z', '2026-10-28T12:30:00Z'), [live], NOW.getTime()))
      .toBe('live');
    expect(overlappingSessionId(strength('w', '2026-10-28T12:10:00Z', '2026-10-28T12:30:00Z'), [live], NOW.getTime()))
      .toBeNull();
  });

  it('ignores a completed session with no end and names the earliest of several matches', () => {
    const open = session('open', '2026-10-27T16:00:00Z', null);
    const later = session('b-later', '2026-10-27T17:30:00Z', '2026-10-27T19:00:00Z');
    const tied = session('a-tied', '2026-10-27T17:00:00Z', '2026-10-27T17:45:00Z');
    expect(overlappingSessionId(
      strength('w', '2026-10-27T17:10:00Z', '2026-10-27T18:30:00Z'), [later, open, gym, tied], NOW.getTime(),
    )).toBe('a-tied');
  });

  it('covers every strength type the contract lists', () => {
    for (const type of STRENGTH_ACTIVITY_TYPES) {
      const row = { ...strength('w', '2026-10-27T17:10:00Z', '2026-10-27T17:40:00Z'), activity_type: type };
      expect(overlappingSessionId(row, [gym], NOW.getTime())).toBe('gym');
    }
  });

  it('fails loud on a timestamp it cannot read instead of guessing', () => {
    expect(() => overlappingSessionId(
      { activity_type: 'core_training', started_at: 'yesterday', ended_at: '2026-10-27T17:40:00Z' }, [gym], NOW.getTime(),
    )).toThrow('Unparseable activity timestamp');
  });
});

describe('projectActivity', () => {
  it('returns ISO UTC instants, the summary figures and the overlap flag', () => {
    const row = strength('w', '2026-10-27T18:05:00+01:00', '2026-10-27T18:55:00+01:00');
    expect(projectActivity(row, [session('gym', '2026-10-27T17:00:00Z', '2026-10-27T18:00:00Z')], NOW.getTime()))
      .toEqual({
        source: 'apple_health', external_id: 'w', activity_type: 'traditional_strength_training',
        started_at: '2026-10-27T17:05:00.000Z', ended_at: '2026-10-27T17:55:00.000Z', duration_seconds: 3000,
        distance_m: null, active_energy_kcal: 350, avg_heart_rate_bpm: 150, max_heart_rate_bpm: 172,
        elevation_gain_m: 20, source_name: 'Workout', device_name: 'Apple Watch',
        overlaps_logged_session: true, overlapping_session_id: 'gym',
      });
  });

  it('leaves an unmatched activity unflagged', () => {
    expect(projectActivity(activity('run'), [], NOW.getTime())).toMatchObject({
      overlaps_logged_session: false, overlapping_session_id: null,
    });
  });
});

describe('overlapReadSpan', () => {
  it('spans only the strength activities, and is null without one', () => {
    expect(overlapReadSpan([activity('run')])).toBeNull();
    expect(overlapReadSpan([
      activity('run', { started_at: '2026-10-01T00:00:00Z' }),
      strength('a', '2026-10-20T10:00:00Z', '2026-10-20T11:00:00Z'),
      strength('b', '2026-10-22T10:00:00Z', '2026-10-22T11:30:00Z'),
    ])).toEqual({ fromMs: at('2026-10-20T10:00:00Z'), toMs: at('2026-10-22T11:30:00Z') });
  });
});

describe('activity query parsing', () => {
  it('accepts zoned ISO instants and canonicalises them to UTC', () => {
    expect(parseActivityInstant('2026-11-01T00:00:00+01:00', 'from')).toBe('2026-10-31T23:00:00.000Z');
    expect(parseActivityInstant(null, 'from')).toBeNull();
    expect(parseActivityInstant('', 'from')).toBeNull();
    expect(parseActivityRange('2026-10-01T00:00:00Z', null)).toEqual({ from: '2026-10-01T00:00:00.000Z', to: null });
  });

  it.each(['2026-11-01', '2026-11-01T00:00:00', 'yesterday', '2026-13-45T00:00:00Z'])(
    'rejects %s: an instant needs a date, a time and a zone',
    (raw) => {
      expect(() => parseActivityInstant(raw, 'from')).toThrow(ActivityQueryError);
    },
  );

  it('rejects an empty or reversed range', () => {
    expect(() => parseActivityRange('2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')).toThrow('from must be before to.');
    expect(() => parseActivityRange('2026-11-02T00:00:00Z', '2026-11-01T00:00:00Z')).toThrow(ActivityQueryError);
  });

  it('reads a cursor it wrote and rejects anything else', () => {
    const cursor = { started_at: '2026-10-27T07:00:00+00:00', source: 'apple_health', external_id: 'abc' };
    expect(activityCursorFrom({ kind: 'activity', ...cursor })).toEqual(cursor);
    for (const bad of [
      { ...cursor, started_at: 1 }, { ...cursor, started_at: 'soon' }, { ...cursor, started_at: '2026-13-40T00:00Z' }, { ...cursor, source: '' },
      { ...cursor, external_id: 'x'.repeat(201) }, {},
    ]) {
      expect(() => activityCursorFrom(bad)).toThrow('Cursor is invalid.');
    }
  });
});

describe('buildCardioSummary', () => {
  const summarize = (rows: ActivityRow[], sessions: OverlapSessionRow[] = [], timeZone = 'UTC', complete = true) =>
    buildCardioSummary({
      rows, sessions, window: trainingStatusWindow(NOW, timeZone), timeZone, nowMs: NOW.getTime(), complete,
    });

  it('totals this week and each of the four full weeks before it, oldest first', () => {
    const result = summarize([
      activity('run-1'),
      activity('run-2', { started_at: '2026-10-26T06:00:00Z', ended_at: '2026-10-26T06:40:00Z', duration_sec: 2400, distance_m: 7200.4, active_energy_kcal: 480.6 }),
      activity('ride', { activity_type: 'cycling', started_at: '2026-10-20T06:00:00Z', ended_at: '2026-10-20T07:00:00Z', duration_sec: 3600, distance_m: 25000, active_energy_kcal: null }),
      activity('swim', { activity_type: 'swimming', started_at: '2026-09-28T06:00:00Z', ended_at: '2026-09-28T06:30:00Z', duration_sec: 1800, distance_m: null }),
    ]);
    expect(result.this_week).toEqual({
      week_start: '2026-10-26', activities: 2, duration_seconds: 4200, distance_m: 12200, active_energy_kcal: 831,
      by_type: [{ activity_type: 'running', activities: 2, duration_seconds: 4200, distance_m: 12200, active_energy_kcal: 831 }],
    });
    expect(result.last_4_weeks.map((week) => [week.week_start, week.activities])).toEqual([
      ['2026-09-28', 1], ['2026-10-05', 0], ['2026-10-12', 0], ['2026-10-19', 1],
    ]);
    expect(result.last_4_weeks[3]).toMatchObject({ distance_m: 25000, active_energy_kcal: 0 });
    expect(result.last_4_weeks[0].by_type).toEqual([
      { activity_type: 'swimming', activities: 1, duration_seconds: 1800, distance_m: 0, active_energy_kcal: 350 },
    ]);
    expect(result.last_activity_on).toBe('2026-10-27');
    expect(result.complete).toBe(true);
  });

  it('orders a week\'s types by duration, then name', () => {
    const result = summarize([
      activity('walk', { activity_type: 'walking', duration_sec: 600 }),
      activity('hike', { activity_type: 'hiking', duration_sec: 1800 }),
      activity('run', { duration_sec: 1800 }),
    ]);
    expect(result.this_week.by_type.map((entry) => entry.activity_type)).toEqual(['hiking', 'running', 'walking']);
  });

  it('counts a strength workout that duplicates a logged session as excluded, not as cardio', () => {
    const gym = session('gym', '2026-10-27T17:00:00Z', '2026-10-27T18:00:00Z');
    const result = summarize([
      strength('dup', '2026-10-27T17:02:00Z', '2026-10-27T17:58:00Z'),
      strength('solo', '2026-10-25T17:00:00Z', '2026-10-25T17:45:00Z'),
    ], [gym]);
    expect(result.this_week.activities).toBe(0);
    expect(result.overlapping_excluded).toBe(1);
    // Strength logged only on the watch is still the person's training.
    expect(result.last_4_weeks[3].by_type).toEqual([expect.objectContaining({
      activity_type: 'traditional_strength_training', activities: 1, duration_seconds: 2700,
    })]);
    expect(result.last_activity_on).toBe('2026-10-25');
  });

  it('buckets by the profile\'s calendar, not UTC', () => {
    // Sunday 23:30 in UTC is Monday 08:30 in Tokyo: last week in UTC, this week in Tokyo.
    const late = activity('late', { started_at: '2026-10-25T23:30:00Z', ended_at: '2026-10-26T00:00:00Z' });
    expect(summarize([late], [], 'UTC').this_week.activities).toBe(0);
    expect(summarize([late], [], 'UTC').last_4_weeks[3].activities).toBe(1);
    const tokyo = summarize([late], [], 'Asia/Tokyo');
    expect(tokyo.this_week.activities).toBe(1);
    expect(tokyo.last_activity_on).toBe('2026-10-26');
  });

  it('ignores activities outside the five listed weeks and reports an empty read as null', () => {
    const result = summarize([
      activity('old', { started_at: '2026-09-27T06:00:00Z', ended_at: '2026-09-27T06:30:00Z' }),
      activity('future', { started_at: '2026-11-02T06:00:00Z', ended_at: '2026-11-02T06:30:00Z' }),
    ], [], 'UTC', false);
    expect([result.this_week, ...result.last_4_weeks].every((week) => week.activities === 0)).toBe(true);
    expect(result.last_activity_on).toBeNull();
    expect(result.overlapping_excluded).toBe(0);
    expect(result.complete).toBe(false);
  });
});
