/**
 * The coach's training status (`GET /v1/agent/training-status`), derived from
 * owner rows: day and week bucketing on the profile's clock, the 4-week
 * series, favourites, 1RM windows, record dates, targets and completeness —
 * and parity with Today's Plan for the same data (one shared calculation).
 * The suite runs in Europe/London (jest.config.js); the status's zone is given.
 */
import {
  buildTrainingStatus, rankFavouriteExercises, resolveStatusTimeZone, statusReadComplete, statusSettings,
  trainingStatusWindow, zonedWallClock,
  type StatusBlockRow, type StatusDefinitionRow, type StatusMappingRow, type StatusMuscleRow,
  type StatusSessionRow, type StatusSetRow, type StatusSettingsRow, type StatusTraining, type TrainingStatusInput,
} from '../../../supabase/functions/agent-api/training-status.ts';
import { createStatsRepository, type StatsAggregationInput } from '@/src/data/stats';
import { buildMuscleReportAssignment } from '@/src/data/muscle-report-presets';
import { deriveMuscleReportPreset } from '@/src/data/muscle-report-setup';
import { estimateOneRepMax } from '@/src/exercise-calculations';
import { effectiveMuscleTargetOverrides } from '@/src/preferences/muscle-targets';
import { createTodayPlanRepository } from '@/src/today-plan/repository';

// Wednesday 28 Oct 2026, 12:00 UTC: the week is Mon 26 Oct – Sun 1 Nov, the recovery days Sun 25 – Tue 27.
const NOW = new Date('2026-10-28T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (iso: string) => new Date(iso).getTime();
const daysAgo = (days: number, hour = 10) => NOW.getTime() - days * DAY + (hour - 12) * 60 * 60 * 1000;

const noReading = { body_weight_kg: null, body_weight_source: null, body_weight_measurement_id: null, body_weight_measured_at: null };

const muscleRow = (id: string, sortOrder: number, extra: Partial<StatusMuscleRow> = {}): StatusMuscleRow => ({
  id, display_name: id[0].toUpperCase() + id.slice(1), family_name: 'F', sort_order: sortOrder,
  report_group: null, tracked: 1, ...extra,
});
const MUSCLES = [muscleRow('chest', 0), muscleRow('triceps', 1), muscleRow('lats', 2, { tracked: 0 })];
const MAPPINGS: StatusMappingRow[] = [
  { exercise_definition_id: 'bench', muscle_group_id: 'chest', role: 'primary' },
  { exercise_definition_id: 'bench', muscle_group_id: 'triceps', role: 'secondary' },
  { exercise_definition_id: 'row', muscle_group_id: 'lats', role: 'primary' },
];

const definition = (id: string, extra: Partial<StatusDefinitionRow> = {}): StatusDefinitionRow => ({
  id, name: id[0].toUpperCase() + id.slice(1), load_input_mode: 'total_load', bodyweight_contribution: 0,
  deleted_at: null, ...extra,
});

type SessionSpec = { id: string; completedAt: number; blocks: Array<{ exercise: string | null; sets: Array<[string, string, string | null]> }> };

/** Rows for sessions, each block's sets as [weight, reps, set type]. */
const training = (sessions: SessionSpec[]): StatusTraining => {
  const out: StatusTraining = { sessions: [], blocks: [], sets: [] };
  for (const session of sessions) {
    out.sessions.push({ id: session.id, completed_at: session.completedAt, ...noReading } satisfies StatusSessionRow);
    session.blocks.forEach((block, blockIndex) => {
      const blockId = `${session.id}-b${blockIndex}`;
      out.blocks.push({ id: blockId, session_id: session.id, exercise_definition_id: block.exercise, order_index: blockIndex } satisfies StatusBlockRow);
      block.sets.forEach(([weight, reps, setType], setIndex) => out.sets.push({
        id: `${blockId}-s${setIndex}`, session_exercise_id: blockId, order_index: setIndex,
        weight_value: weight, reps_value: reps, set_type: setType, performance_status: null,
      } satisfies StatusSetRow));
    });
  }
  return out;
};

const benchSession = (id: string, completedAt: number, working = 2): SessionSpec => ({
  id, completedAt,
  blocks: [{ exercise: 'bench', sets: [['40', '10', 'warm_up'], ...Array.from({ length: working }, () => ['100', '5', null] as [string, string, null])] }],
});

const definitionsOf = (...rows: StatusDefinitionRow[]) => new Map(rows.map((row) => [row.id, row]));

const status = (overrides: Partial<TrainingStatusInput> & { timeZone: string }) => {
  const input: TrainingStatusInput = {
    now: NOW, settings: null, muscleRows: MUSCLES, mappings: MAPPINGS,
    training: { sessions: [], blocks: [], sets: [] }, definitions: definitionsOf(definition('bench'), definition('row')),
    favourites: [], history: { sessions: [], blocks: [], sets: [] }, historyTruncated: new Set(),
    calculationsEnabled: false, complete: true, ...overrides,
  };
  return buildTrainingStatus(input);
};

describe('training status: the profile clock', () => {
  it('reads wall-clock fields in the given zone whatever the runtime zone', () => {
    const clock = zonedWallClock(new Date('2026-10-27T23:30:00.000Z'), 'Europe/Berlin');
    expect([clock.getFullYear(), clock.getMonth() + 1, clock.getDate(), clock.getHours(), clock.getMinutes()])
      .toEqual([2026, 10, 28, 0, 30]);
  });

  it('falls back to UTC for a blank or unknown zone', () => {
    expect(resolveStatusTimeZone(null)).toBe('UTC');
    expect(resolveStatusTimeZone('  ')).toBe('UTC');
    expect(resolveStatusTimeZone('Mars/Olympus')).toBe('UTC');
    expect(resolveStatusTimeZone(' Europe/Berlin ')).toBe('Europe/Berlin');
  });

  it('buckets a late-evening UTC session on the profile day it fell on', () => {
    const late = training([benchSession('late', at('2026-10-27T23:30:00.000Z'))]);
    const berlin = status({ timeZone: 'Europe/Berlin', training: late });
    const utc = status({ timeZone: 'UTC', training: late });
    const chest = (result: typeof utc) => result.muscles.find((muscle) => muscle.id === 'chest')!;

    expect(berlin.today).toBe('2026-10-28');
    expect(chest(berlin).today_sets).toBe(2);
    expect(chest(berlin).recovery_days).toEqual([
      { date: '2026-10-25', sets: null }, { date: '2026-10-26', sets: null }, { date: '2026-10-27', sets: null },
    ]);
    expect(chest(berlin).last_trained_on).toBe('2026-10-28');
    expect(chest(utc).today_sets).toBeNull();
    expect(chest(utc).recovery_days[2]).toEqual({ date: '2026-10-27', sets: 2 });
    expect(chest(utc).last_trained_on).toBe('2026-10-27');
  });

  it('starts the week on the profile Monday, so a Sunday-night UTC session can be this week', () => {
    const sundayNight = training([benchSession('sun', at('2026-10-25T23:30:00.000Z'), 3)]);
    const berlinChest = status({ timeZone: 'Europe/Berlin', training: sundayNight }).muscles.find((muscle) => muscle.id === 'chest');
    const utcChest = status({ timeZone: 'UTC', training: sundayNight }).muscles.find((muscle) => muscle.id === 'chest');
    expect(berlinChest).toMatchObject({ week_sets: 3, recovery_days: expect.arrayContaining([{ date: '2026-10-26', sets: 3 }]) });
    expect(utcChest).toMatchObject({ week_sets: 0, recovery_days: expect.arrayContaining([{ date: '2026-10-25', sets: 3 }]) });
  });
});

describe('training status: muscles', () => {
  it('lists tracked muscles least trained first, with targets, week and the four full weeks before it', () => {
    const result = status({
      timeZone: 'UTC',
      training: training([
        benchSession('this-week', daysAgo(1)),
        benchSession('w-1', at('2026-10-20T10:00:00.000Z'), 3),
        benchSession('w-2', at('2026-10-12T10:00:00.000Z'), 1),
        benchSession('w-4', at('2026-09-28T10:00:00.000Z'), 4),
        // Five weeks back: outside the series, still inside the 56-day read.
        benchSession('w-5', at('2026-09-22T10:00:00.000Z'), 5),
      ]),
    });
    expect(result.week_start).toBe('2026-10-26');
    expect(result.muscles.map((muscle) => muscle.id)).toEqual(['triceps', 'chest']);
    const chest = result.muscles[1];
    expect(chest).toMatchObject({ name: 'Chest', family: 'F', weekly_target: 8, week_sets: 2, today_sets: null, last_trained_on: '2026-10-27' });
    expect(chest.weekly_sets_last_4_weeks).toEqual([
      { week_start: '2026-09-28', sets: 4 },
      { week_start: '2026-10-05', sets: 0 },
      { week_start: '2026-10-12', sets: 1 },
      { week_start: '2026-10-19', sets: 3 },
    ]);
    // New accounts start with direct Sets and independently include secondary Volume.
    expect(result.muscles[0]).toMatchObject({ id: 'triceps', week_sets: 0 });
    expect(result.counts_secondary_sets).toBe(false);
    expect(result.volume_primary_only).toBe(false);
  });

  it.each([true, false])('allocates Machine Dips shares before hiding muscles, secondary %s', (countSecondary) => {
    const result = status({
      timeZone: 'UTC',
      settings: { weekly_working_set_target: 10, muscle_target_mode: 'single', muscle_target_overrides: {},
        count_secondary_muscles: countSecondary, client_updated_at_ms: 7 },
      muscleRows: [...MUSCLES, muscleRow('deltoid', 3)],
      mappings: [
        { exercise_definition_id: 'bench', muscle_group_id: 'chest', role: 'primary' },
        { exercise_definition_id: 'bench', muscle_group_id: 'triceps', role: 'primary' },
        { exercise_definition_id: 'bench', muscle_group_id: 'lats', role: 'secondary' },
        { exercise_definition_id: 'bench', muscle_group_id: 'deltoid', role: 'secondary' },
      ],
      definitions: definitionsOf(definition('bench', { name: 'Machine Dips' })),
      training: training([benchSession('dips', daysAgo(1), 3)]),
    });
    expect(result.metric_revision).toBe('working_sets_v10');
    expect(result.muscles.find((muscle) => muscle.id === 'chest')).toMatchObject({ week_sets: 3, weekly_target: 10,
      recovery_days: [{ sets: null }, { sets: null }, { sets: 3 }] });
    expect(result.muscles.find((muscle) => muscle.id === 'triceps')?.week_sets).toBe(3);
    expect(result.muscles.find((muscle) => muscle.id === 'deltoid')?.week_sets).toBe(countSecondary ? 1.5 : 0);
    expect(result.muscles.map((muscle) => muscle.id)).not.toContain('lats');
  });

  it('sums allocated co-primary shares when the reporting setup merges them', () => {
    const result = status({
      timeZone: 'UTC',
      muscleRows: [muscleRow('chest', 0, { report_group: 'chest' }), muscleRow('serratus_anterior', 1, { report_group: 'chest' })],
      mappings: [
        { exercise_definition_id: 'bench', muscle_group_id: 'chest', role: 'primary' },
        { exercise_definition_id: 'bench', muscle_group_id: 'serratus_anterior', role: 'primary' },
      ],
      training: training([benchSession('dips', daysAgo(1), 3)]),
    });
    expect(result.muscles).toHaveLength(1);
    expect(result.muscles[0]).toMatchObject({ id: 'chest', week_sets: 3,
      recovery_days: [{ sets: null }, { sets: null }, { sets: 3 }] });
  });

  it('reads nothing older than 56 local days', () => {
    const result = status({ timeZone: 'UTC', training: training([benchSession('old', daysAgo(56))]) });
    expect(result.muscles.find((muscle) => muscle.id === 'chest')?.last_trained_on).toBeNull();
    const edge = status({ timeZone: 'UTC', training: training([benchSession('edge', at('2026-09-03T00:30:00.000Z'))]) });
    expect(edge.muscles.find((muscle) => muscle.id === 'chest')?.last_trained_on).toBe('2026-09-03');
  });

  it('drops secondary sets and applies per-muscle targets in the setup scope when the synced settings say so', () => {
    const settings: StatusSettingsRow = {
      weekly_working_set_target: 10, muscle_target_mode: 'per_muscle',
      muscle_target_overrides: { detailed: { chest: 14 }, broad: { chest: 99 } },
      count_secondary_muscles: false, client_updated_at_ms: 1_730_000_000_000,
    };
    const result = status({ timeZone: 'UTC', settings, training: training([benchSession('s', daysAgo(1))]) });
    expect(result.targets).toEqual({ mode: 'per_muscle', default_weekly_sets: 10, uploaded: true, revision: 1_730_000_000_000 });
    expect(result.muscle_setup).toBe('detailed');
    expect(result.counts_secondary_sets).toBe(false);
    expect(result.muscles.find((muscle) => muscle.id === 'chest')).toMatchObject({ weekly_target: 14, week_sets: 2 });
    expect(result.muscles.find((muscle) => muscle.id === 'triceps')).toMatchObject({ weekly_target: 10, week_sets: 0 });
  });
});

describe('training status: targets', () => {
  it('preserves an existing legacy row\'s implicit secondary Sets while a missing account uses new defaults', () => {
    expect(statusSettings(null)).toMatchObject({ countSecondary: false, volumePrimaryOnly: false });
    expect(statusSettings({ weekly_working_set_target: 12, muscle_target_mode: 'single', muscle_target_overrides: {},
      count_secondary_muscles: null, volume_primary_only: null, client_updated_at_ms: 42 }))
      .toMatchObject({ countSecondary: true, volumePrimaryOnly: false, preferences: { weeklyWorkingSetTarget: 12 } });
    expect(statusSettings({ weekly_working_set_target: 12, muscle_target_mode: 'single', muscle_target_overrides: {},
      count_secondary_muscles: false, volume_primary_only: true, client_updated_at_ms: 43 }))
      .toMatchObject({ countSecondary: false, volumePrimaryOnly: true });
  });

  it.each([[true, true], [true, false], [false, true], [false, false]])(
    'keeps secondary Sets %s independent of Volume primary-only %s', (secondarySets, volumePrimaryOnly) => {
      const result = status({ timeZone: 'UTC', training: training([benchSession('s', daysAgo(1))]), settings: {
        weekly_working_set_target: 10, muscle_target_mode: 'single', muscle_target_overrides: {},
        count_secondary_muscles: secondarySets, volume_primary_only: volumePrimaryOnly, client_updated_at_ms: 42,
      } });
      expect(result.counts_secondary_sets).toBe(secondarySets);
      expect(result.volume_primary_only).toBe(volumePrimaryOnly);
      expect(result.muscles.find(muscle => muscle.id === 'chest')?.week_sets).toBe(2);
      expect(result.muscles.find(muscle => muscle.id === 'triceps')?.week_sets).toBe(secondarySets ? 1 : 0);
      expect(result.targets.default_weekly_sets).toBe(10);
    });

  it('shows the app defaults and revision 0 before any device uploads', () => {
    expect(statusSettings(null)).toMatchObject({ countSecondary: false, volumePrimaryOnly: false, uploaded: false, revision: 0,
      preferences: { weeklyWorkingSetTarget: 8, muscleTargetMode: 'single', muscleTargetOverrides: {} } });
    const unset = statusSettings({ weekly_working_set_target: null, muscle_target_mode: null, muscle_target_overrides: null,
      count_secondary_muscles: null, client_updated_at_ms: 42 });
    expect(unset).toMatchObject({ uploaded: false, revision: 42, preferences: { weeklyWorkingSetTarget: 8 } });
  });

  it('reads invalid columns as the default, as the app does', () => {
    const invalid = statusSettings({ weekly_working_set_target: 0, muscle_target_mode: 'sometimes',
      muscle_target_overrides: { detailed: { chest: -1 } }, count_secondary_muscles: null, client_updated_at_ms: 7 });
    expect(invalid.preferences).toEqual({ weeklyWorkingSetTarget: 8, muscleTargetMode: 'single', muscleTargetOverrides: {} });
  });
});

describe('training status: favourites and progression', () => {
  const sessionOf = (id: string, exercise: string, completedAt: number, sets: Array<[string, string, string | null]>) =>
    ({ id, completedAt, blocks: [{ exercise, sets }] });
  const window = trainingStatusWindow(NOW, 'UTC');

  it('ranks by sessions with a working set in 28 days, then latest done, then name, and keeps ten', () => {
    const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo'];
    const specs: SessionSpec[] = [
      ...[1, 2, 3].map((day) => sessionOf(`kilo-${day}`, 'kilo', daysAgo(day), [['50', '5', null]])),
      // Ties on two sessions: the later last done first; equal dates by name.
      ...[2, 4].map((day) => sessionOf(`juliet-${day}`, 'juliet', daysAgo(day), [['50', '5', null]])),
      ...[3, 5].map((day) => sessionOf(`india-${day}`, 'india', daysAgo(day), [['50', '5', null]])),
      ...[3, 6].map((day) => sessionOf(`hotel-${day}`, 'hotel', daysAgo(day), [['50', '5', null]])),
      ...names.slice(0, 6).map((name, index) => sessionOf(`${name}-1`, name, daysAgo(10 + index), [['50', '5', null]])),
      sessionOf('golf-1', 'golf', daysAgo(20), [['50', '5', null]]),
      // Warm-ups only, a deleted exercise, and a session older than 28 days count no session.
      sessionOf('warm', 'warm', daysAgo(1), [['50', '5', 'warm_up']]),
      sessionOf('gone', 'gone', daysAgo(1), [['50', '5', null]]),
      sessionOf('old', 'old', daysAgo(30), [['50', '5', null]]),
    ];
    const definitions = definitionsOf(...[...names, 'warm', 'old'].map((name) => definition(name)), definition('gone', { deleted_at: 1 }));
    const ranked = rankFavouriteExercises(training(specs), definitions, false, window, 'UTC');
    expect(ranked.map((row) => [row.exerciseId, row.sessions])).toEqual([
      ['kilo', 3], ['juliet', 2], ['hotel', 2], ['india', 2], ['alpha', 1], ['bravo', 1], ['charlie', 1], ['delta', 1],
      ['echo', 1], ['foxtrot', 1],
    ]);
  });

  it('counts a session with two blocks of one exercise once', () => {
    const doubled = { id: 'twice', completedAt: daysAgo(2), blocks: [
      { exercise: 'bench', sets: [['100', '5', null] as [string, string, null]] },
      { exercise: 'bench', sets: [['100', '5', null] as [string, string, null]] },
    ] };
    const ranked = rankFavouriteExercises(training([doubled]), definitionsOf(definition('bench')), false, window, 'UTC');
    expect(ranked).toMatchObject([{ exerciseId: 'bench', sessions: 1 }]);
  });

  it('reports the best 1RM in the last 28 days and the 28 before, and the last record date', () => {
    const recent = training([
      sessionOf('now', 'bench', daysAgo(5), [['105', '5', null]]),
      sessionOf('mid', 'bench', daysAgo(20), [['110', '5', null], ['150', '5', 'warm_up']]),
      sessionOf('before', 'bench', daysAgo(40), [['95', '5', null]]),
    ]);
    const history = training([
      sessionOf('first', 'bench', daysAgo(200), [['100', '5', null]]),
      sessionOf('now', 'bench', daysAgo(5), [['105', '5', null]]),
      sessionOf('mid', 'bench', daysAgo(20), [['110', '5', null]]),
      sessionOf('before', 'bench', daysAgo(40), [['95', '5', null]]),
    ]);
    const definitions = definitionsOf(definition('bench'));
    const favourites = rankFavouriteExercises(recent, definitions, false, window, 'UTC');
    const result = status({ timeZone: 'UTC', training: recent, definitions, favourites, history });
    expect(result.favourite_exercises).toEqual([{
      exercise_id: 'bench', name: 'Bench', sessions_28d: 2, last_done_on: '2026-10-23',
      best_e1rm_kg: { last_28d: estimateOneRepMax(110, 5), previous_28d: estimateOneRepMax(95, 5) },
      last_record_on: '2026-10-08', record_history_complete: true,
    }]);
  });

  it('has no record date while the first session is only the baseline', () => {
    const only = training([sessionOf('one', 'bench', daysAgo(3), [['100', '5', null]])]);
    const definitions = definitionsOf(definition('bench'));
    const favourites = rankFavouriteExercises(only, definitions, false, window, 'UTC');
    const result = status({ timeZone: 'UTC', training: only, definitions, favourites, history: only });
    expect(result.favourite_exercises[0]).toMatchObject({ last_record_on: null, best_e1rm_kg: { previous_28d: null } });
  });

  it('flags a favourite whose history hit its cap, with no Volume record, and leaves complete to the 56-day read', () => {
    // Only Volume rises in the later session: with a capped history it is no record.
    const history = training([
      sessionOf('a', 'bench', daysAgo(10), [['100', '5', null]]),
      sessionOf('b', 'bench', daysAgo(3), [['100', '5', null], ['90', '5', null]]),
    ]);
    const definitions = definitionsOf(definition('bench'));
    const favourites = rankFavouriteExercises(history, definitions, false, window, 'UTC');
    const whole = status({ timeZone: 'UTC', training: history, definitions, favourites, history });
    const capped = status({ timeZone: 'UTC', training: history, definitions, favourites, history, historyTruncated: new Set(['bench']) });
    expect(whole).toMatchObject({ complete: true, favourite_exercises: [{ last_record_on: '2026-10-25', record_history_complete: true }] });
    expect(capped).toMatchObject({ complete: true, favourite_exercises: [{ last_record_on: null, record_history_complete: false }] });
    expect(status({ timeZone: 'UTC', complete: false }).complete).toBe(false);
  });

  it('is complete only when no 56-day or muscle read reached its cap', () => {
    const read = { sessionsRead: 200, maxSessions: 200, musclesRead: 499, maxMuscles: 500, truncatedReads: [{ truncated: false }] };
    expect(statusReadComplete(read)).toBe(true);
    expect(statusReadComplete({ ...read, sessionsRead: 201 })).toBe(false);
    expect(statusReadComplete({ ...read, musclesRead: 500 })).toBe(false);
    expect(statusReadComplete({ ...read, truncatedReads: [{ truncated: false }, { truncated: true }] })).toBe(false);
  });
});

type ParityFixture = { rows: StatusMuscleRow[]; mappings: StatusMappingRow[]; training: StatusTraining };

const reportRowsOf = (rows: readonly StatusMuscleRow[]) => rows.map((row) => ({
  id: row.id, displayName: row.display_name, familyName: row.family_name, sortOrder: row.sort_order,
  reportGroup: row.report_group, tracked: row.tracked as number,
}));

/** The app's stats repository over the same rows, as its store holds them. */
const appStatsOf = ({ rows, mappings, training: rowsTraining }: ParityFixture) => {
  const reportRows = reportRowsOf(rows);
  const input: StatsAggregationInput = {
    sessions: rowsTraining.sessions.map((session) => ({ id: session.id, completedAt: new Date(session.completed_at) })),
    sessionExercises: rowsTraining.blocks.map((block) => ({ id: block.id, sessionId: block.session_id, exerciseDefinitionId: block.exercise_definition_id })),
    exerciseSets: rowsTraining.sets.map((set) => ({
      id: set.id, sessionExerciseId: set.session_exercise_id, orderIndex: set.order_index,
      setType: set.set_type, weightValue: set.weight_value, repsValue: set.reps_value, performanceStatus: null,
    })),
    muscleMappings: mappings.map((mapping) => ({
      exerciseDefinitionId: mapping.exercise_definition_id, muscleGroupId: mapping.muscle_group_id,
      role: mapping.role as 'primary' | 'secondary',
    })),
    muscleGroups: reportRows.map(({ id, displayName, familyName, sortOrder }) => ({ id, displayName, familyName, sortOrder })),
    muscleReport: buildMuscleReportAssignment(reportRows),
  };
  return createStatsRepository({
    loadAggregationInput: async ({ start, end }) => ({
      ...input, sessions: input.sessions.filter((session) => session.completedAt >= start && session.completedAt < end),
    }),
    loadMuscleGroupTaxonomy: async () => input.muscleGroups,
  } as Parameters<typeof createStatsRepository>[0]);
};

/** Today's Plan at NOW with what `useTodayPlan` passes: the default, the setup scope's overrides and the switch. */
const todayPlanOf = (fixture: ParityFixture, settings: StatusSettingsRow) => {
  const stats = appStatsOf(fixture);
  const repository = createTodayPlanRepository({
    computeMuscleDailySets: stats.computeMuscleDailySets,
    planQueries: { listUpcomingPlans: async () => [], loadPlanDetail: async () => null },
    loadCatalog: async () => { throw new Error('no plans to describe'); },
  });
  const preferences = {
    weeklyWorkingSetTarget: settings.weekly_working_set_target!,
    muscleTargetMode: settings.muscle_target_mode === 'per_muscle' ? 'per-muscle' as const : 'single' as const,
    muscleTargetOverrides: settings.muscle_target_overrides as Record<string, Record<string, number>>,
  };
  return repository.loadTodayPlan(NOW, {
    weeklyTarget: preferences.weeklyWorkingSetTarget, countSecondary: settings.count_secondary_muscles!,
    overrides: { ...effectiveMuscleTargetOverrides(preferences, deriveMuscleReportPreset(reportRowsOf(fixture.rows))) },
  });
};

const planRowsOf = (result: ReturnType<typeof buildTrainingStatus>) => result.muscles.map((muscle) => ({
  muscleGroupId: muscle.id, name: muscle.name, days: muscle.recovery_days.map((day) => day.sets),
  today: muscle.today_sets, weekSets: muscle.week_sets, target: muscle.weekly_target,
}));

describe('training status: parity with Today\'s Plan', () => {
  // Broad setup: serratus merges into Chest; calves untracked; a custom muscle stays its own.
  const rows: StatusMuscleRow[] = [
    muscleRow('chest', 10, { display_name: 'Chest', report_group: 'chest', family_name: 'Chest' }),
    muscleRow('serratus_anterior', 11, { display_name: 'Serratus', report_group: 'chest', family_name: 'Chest' }),
    muscleRow('triceps', 20, { display_name: 'Triceps', report_group: 'triceps', family_name: 'Arms' }),
    muscleRow('delts_front', 30, { display_name: 'Front Delts', report_group: 'front_delts', family_name: 'Shoulders' }),
    muscleRow('calves', 40, { display_name: 'Calves', report_group: 'calves', family_name: 'Lower Legs', tracked: 0 }),
    muscleRow('custom-grip', 50, { display_name: 'Grip', family_name: 'Custom' }),
  ];
  const mappings: StatusMappingRow[] = [
    { exercise_definition_id: 'bench', muscle_group_id: 'chest', role: 'primary' },
    { exercise_definition_id: 'bench', muscle_group_id: 'serratus_anterior', role: 'secondary' },
    { exercise_definition_id: 'bench', muscle_group_id: 'triceps', role: 'secondary' },
    { exercise_definition_id: 'bench', muscle_group_id: 'delts_front', role: 'secondary' },
    { exercise_definition_id: 'dip', muscle_group_id: 'triceps', role: 'primary' },
    { exercise_definition_id: 'dip', muscle_group_id: 'chest', role: 'secondary' },
    { exercise_definition_id: 'raise', muscle_group_id: 'calves', role: 'primary' },
    { exercise_definition_id: 'hang', muscle_group_id: 'custom-grip', role: 'primary' },
  ];
  const sets = (count: number, setType: string | null = null) =>
    Array.from({ length: count }, () => ['80', '8', setType] as [string, string, string | null]);
  const rowsTraining = training([
    { id: 's1', completedAt: daysAgo(3, 18), blocks: [{ exercise: 'bench', sets: [...sets(1, 'warm_up'), ...sets(3)] }, { exercise: 'raise', sets: sets(4) }] },
    { id: 's2', completedAt: daysAgo(2, 9), blocks: [{ exercise: 'dip', sets: sets(3, 'rir_1') }, { exercise: 'hang', sets: sets(2) }] },
    { id: 's3', completedAt: daysAgo(1, 20), blocks: [{ exercise: 'bench', sets: sets(2) }, { exercise: 'dip', sets: sets(1) }] },
    { id: 's4', completedAt: daysAgo(0, 8), blocks: [{ exercise: 'bench', sets: sets(5) }] },
    { id: 's5', completedAt: daysAgo(9, 12), blocks: [{ exercise: 'dip', sets: sets(6) }] },
  ]);
  const settingsRow = (countSecondary: boolean): StatusSettingsRow => ({
    weekly_working_set_target: 9, muscle_target_mode: 'per_muscle',
    muscle_target_overrides: { broad: { chest: 12, 'custom-grip': 3 }, detailed: { chest: 40 } },
    count_secondary_muscles: countSecondary, client_updated_at_ms: 5,
  });

  it.each([true, false])('gives Today\'s Plan\'s per-muscle figures and order with count-secondary %s', async (countSecondary) => {
    const plan = await todayPlanOf({ rows, mappings, training: rowsTraining }, settingsRow(countSecondary));
    const result = status({
      timeZone: 'Europe/London', settings: settingsRow(countSecondary), muscleRows: rows, mappings, training: rowsTraining,
      definitions: definitionsOf(definition('bench'), definition('dip'), definition('raise'), definition('hang')),
    });
    expect(result.muscle_setup).toBe('broad');
    expect(planRowsOf(result)).toEqual(plan.muscles);
    expect(result.muscles.map((muscle) => muscle.recovery_days.map((day) => day.date)))
      .toEqual(result.muscles.map(() => ['2026-10-25', '2026-10-26', '2026-10-27']));
    // The fixture exercises what parity must cover: a merged muscle, a half set and an override.
    expect(plan.muscles.length).toBeGreaterThan(2);
    expect(plan.muscles.some((row) => !Number.isInteger(row.weekSets))).toBe(countSecondary);
    expect(plan.muscles.find((row) => row.muscleGroupId === 'chest')?.target).toBe(12);
  });
});

describe('training status: parity with the app over seven weeks of training', () => {
  // Detailed setup: every entry its own muscle, calves switched off, one custom muscle.
  const rows: StatusMuscleRow[] = [
    muscleRow('chest', 0, { display_name: 'Pectoralis', family_name: 'Chest' }),
    muscleRow('delts_front', 1, { display_name: 'Front Delts', family_name: 'Shoulders' }),
    muscleRow('delts_lateral', 2, { display_name: 'Lateral Delts', family_name: 'Shoulders' }),
    muscleRow('triceps', 3, { display_name: 'Triceps', family_name: 'Arms' }),
    muscleRow('biceps', 4, { display_name: 'Biceps', family_name: 'Arms' }),
    muscleRow('lats', 5, { display_name: 'Lats', family_name: 'Back' }),
    muscleRow('quads', 6, { display_name: 'Quadriceps', family_name: 'Legs' }),
    muscleRow('hamstrings', 7, { display_name: 'Hamstrings', family_name: 'Legs' }),
    muscleRow('glutes', 8, { display_name: 'Glutes', family_name: 'Legs' }),
    muscleRow('calves', 9, { display_name: 'Calves', family_name: 'Lower Legs', tracked: 0 }),
    muscleRow('custom-forearms', 10, { display_name: 'Forearms', family_name: 'Custom' }),
  ];
  const mapped: Record<string, Array<[string, 'primary' | 'secondary']>> = {
    bench: [['chest', 'primary'], ['delts_front', 'secondary'], ['triceps', 'secondary']],
    ohp: [['delts_front', 'primary'], ['delts_lateral', 'secondary'], ['triceps', 'secondary']],
    pushdown: [['triceps', 'primary']],
    lateral: [['delts_lateral', 'primary']],
    row: [['lats', 'primary'], ['biceps', 'secondary']],
    pulldown: [['lats', 'primary'], ['biceps', 'secondary']],
    curl: [['biceps', 'primary'], ['custom-forearms', 'secondary']],
    squat: [['quads', 'primary'], ['glutes', 'secondary'], ['hamstrings', 'secondary']],
    rdl: [['hamstrings', 'primary'], ['glutes', 'primary']],
    calf: [['calves', 'primary']],
  };
  const mappings: StatusMappingRow[] = Object.entries(mapped).flatMap(([exercise, muscles]) =>
    muscles.map(([muscle, role]) => ({ exercise_definition_id: exercise, muscle_group_id: muscle, role })));

  // Push, Pull, Legs late at night, Upper: a warm-up, then 3 or 4 working sets
  // by week, some with an effort tag; London local times across the clock change
  // of Sun 25 Oct. Week 3 is a two-session deload; this week has Push, Pull and
  // an early session today.
  const DAYS: Array<{ weekday: number; hour: number; minute: number; exercises: string[] }> = [
    { weekday: 0, hour: 18, minute: 30, exercises: ['bench', 'ohp', 'pushdown', 'lateral'] },
    { weekday: 1, hour: 7, minute: 15, exercises: ['row', 'pulldown', 'curl'] },
    { weekday: 3, hour: 23, minute: 40, exercises: ['squat', 'rdl', 'calf'] },
    { weekday: 5, hour: 10, minute: 0, exercises: ['bench', 'row', 'lateral', 'curl'] },
  ];
  const sessions: SessionSpec[] = [];
  for (let week = 0; week < 7; week += 1) {
    const monday = new Date(2026, 8, 14 + week * 7);
    for (const [index, day] of DAYS.entries()) {
      if (week === 3 && index % 2 === 1) continue;
      const completed = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day.weekday, day.hour, day.minute);
      if (completed.getTime() > NOW.getTime()) continue;
      const working = 3 + (week % 2);
      sessions.push({
        id: `w${week}-d${index}`, completedAt: completed.getTime(),
        blocks: day.exercises.map((exercise, order) => ({ exercise, sets: [
          ['40', '10', 'warm_up'],
          ...Array.from({ length: working }, (_, set) => ['80', '8', set === working - 1 ? `rir_${order % 3}` : null] as [string, string, string | null]),
        ] })),
      });
    }
  }
  sessions.push({ id: 'today', completedAt: new Date(2026, 9, 28, 8, 0).getTime(), blocks: [{ exercise: 'curl', sets: [['20', '12', null], ['20', '10', null]] }] });
  const fixture: ParityFixture = { rows, mappings, training: training(sessions) };
  const settingsRow = (countSecondary: boolean): StatusSettingsRow => ({
    weekly_working_set_target: 10, muscle_target_mode: 'per_muscle',
    muscle_target_overrides: { detailed: { chest: 14, 'custom-forearms': 4 }, broad: { chest: 99 } },
    count_secondary_muscles: countSecondary, client_updated_at_ms: 5,
  });
  const definitions = definitionsOf(...Object.keys(mapped).map((exercise) => definition(exercise)));

  it.each([true, false])('gives Today\'s Plan\'s rows and the app\'s weekly sets with count-secondary %s', async (countSecondary) => {
    const result = status({ timeZone: 'Europe/London', settings: settingsRow(countSecondary), muscleRows: rows, mappings, training: fixture.training, definitions });
    expect(result.muscle_setup).toBe('detailed');
    expect(planRowsOf(result)).toEqual((await todayPlanOf(fixture, settingsRow(countSecondary))).muscles);

    // Each of the four weeks before this one, summed from the app's daily sets over that local week.
    const stats = appStatsOf(fixture);
    for (const [index, week] of result.muscles[0].weekly_sets_last_4_weeks.entries()) {
      const [year, month, day] = week.week_start.split('-').map(Number);
      const daily = await stats.computeMuscleDailySets({
        start: new Date(year, month - 1, day), end: new Date(year, month - 1, day + 7), now: NOW, countSecondary,
      });
      for (const muscle of result.muscles) {
        const appSets = Object.values(daily.sets[muscle.id] ?? {}).reduce((total, sets) => total + sets, 0);
        expect({ muscle: muscle.id, week: week.week_start, sets: muscle.weekly_sets_last_4_weeks[index].sets })
          .toEqual({ muscle: muscle.id, week: week.week_start, sets: appSets });
      }
    }

    // The fixture covers what parity must: every tracked muscle trained, none untracked,
    // the deload and clock-change weeks, a late-night session and half sets.
    expect(result.muscles.map((muscle) => muscle.id).sort()).toEqual(rows.filter((row) => row.tracked === 1).map((row) => row.id).sort());
    expect(result.muscles[0].weekly_sets_last_4_weeks.map((week) => week.week_start))
      .toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
    const quads = result.muscles.find((muscle) => muscle.id === 'quads')!;
    expect(quads.weekly_sets_last_4_weeks.map((week) => week.sets)).toEqual([3, 4, 3, 4]);
    expect(quads.last_trained_on).toBe('2026-10-22');
    expect(result.muscles.find((muscle) => muscle.id === 'chest')).toMatchObject({ weekly_target: 14, week_sets: 3 });
    expect(result.muscles.some((muscle) => !Number.isInteger(muscle.week_sets))).toBe(countSecondary);
  });
});
