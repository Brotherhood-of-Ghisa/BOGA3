/**
 * The coach's training status (`GET /v1/agent/training-status`), derived from
 * owner rows: day and week bucketing on the profile's clock, the 4-week
 * series, favourites, 1RM windows, record dates, targets and completeness —
 * and parity with Today's Plan for the same data (one shared calculation).
 * The suite runs in Europe/London (jest.config.js); the status's zone is given.
 */
import {
  buildTrainingStatus, rankFavouriteExercises, resolveStatusTimeZone, statusSettings, trainingStatusWindow,
  zonedWallClock,
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
    favourites: [], history: { sessions: [], blocks: [], sets: [] }, historyComplete: true,
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
    // Secondary sets count half by default.
    expect(result.muscles[0]).toMatchObject({ id: 'triceps', week_sets: 1 });
    expect(result.counts_secondary_sets).toBe(true);
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
  it('shows the app defaults and revision 0 before any device uploads', () => {
    expect(statusSettings(null)).toMatchObject({ countSecondary: true, uploaded: false, revision: 0,
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
      last_record_on: '2026-10-08',
    }]);
  });

  it('has no record date while the first session is only the baseline', () => {
    const only = training([sessionOf('one', 'bench', daysAgo(3), [['100', '5', null]])]);
    const definitions = definitionsOf(definition('bench'));
    const favourites = rankFavouriteExercises(only, definitions, false, window, 'UTC');
    const result = status({ timeZone: 'UTC', training: only, definitions, favourites, history: only });
    expect(result.favourite_exercises[0]).toMatchObject({ last_record_on: null, best_e1rm_kg: { previous_28d: null } });
  });

  it('is incomplete, with no Volume record, when the favourites history hit its cap', () => {
    // Only Volume rises in the later session: with a truncated history it is no record.
    const history = training([
      sessionOf('a', 'bench', daysAgo(10), [['100', '5', null]]),
      sessionOf('b', 'bench', daysAgo(3), [['100', '5', null], ['90', '5', null]]),
    ]);
    const definitions = definitionsOf(definition('bench'));
    const favourites = rankFavouriteExercises(history, definitions, false, window, 'UTC');
    const complete = status({ timeZone: 'UTC', training: history, definitions, favourites, history });
    const capped = status({ timeZone: 'UTC', training: history, definitions, favourites, history, historyComplete: false });
    expect(complete).toMatchObject({ complete: true, favourite_exercises: [{ last_record_on: '2026-10-25' }] });
    expect(capped).toMatchObject({ complete: false, favourite_exercises: [{ last_record_on: null }] });
    expect(status({ timeZone: 'UTC', complete: false }).complete).toBe(false);
  });
});

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

  /** The same rows as the app's stats store holds them. */
  const appInput = (): StatsAggregationInput => {
    const reportRows = rows.map((row) => ({
      id: row.id, displayName: row.display_name, familyName: row.family_name, sortOrder: row.sort_order,
      reportGroup: row.report_group, tracked: row.tracked as number,
    }));
    return {
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
  };

  const todayPlan = (countSecondary: boolean) => {
    const input = appInput();
    const stats = createStatsRepository({
      loadAggregationInput: async ({ start, end }) => ({
        ...input, sessions: input.sessions.filter((session) => session.completedAt >= start && session.completedAt < end),
      }),
      loadMuscleGroupTaxonomy: async () => input.muscleGroups,
    } as Parameters<typeof createStatsRepository>[0]);
    const repository = createTodayPlanRepository({
      computeMuscleDailySets: stats.computeMuscleDailySets,
      planQueries: { listUpcomingPlans: async () => [], loadPlanDetail: async () => null },
      loadCatalog: async () => { throw new Error('no plans to describe'); },
    });
    const reportRows = rows.map((row) => ({ id: row.id, displayName: row.display_name, familyName: row.family_name,
      sortOrder: row.sort_order, reportGroup: row.report_group, tracked: row.tracked }));
    // What `useTodayPlan` passes: the default, the setup scope's overrides and the switch.
    const preferences = { weeklyWorkingSetTarget: 9, muscleTargetMode: 'per-muscle' as const,
      muscleTargetOverrides: { broad: { chest: 12, 'custom-grip': 3 }, detailed: { chest: 40 } } };
    return repository.loadTodayPlan(NOW, {
      weeklyTarget: 9, countSecondary,
      overrides: { ...effectiveMuscleTargetOverrides(preferences, deriveMuscleReportPreset(reportRows)) },
    });
  };

  it.each([true, false])('gives Today\'s Plan\'s per-muscle figures and order with count-secondary %s', async (countSecondary) => {
    const plan = await todayPlan(countSecondary);
    const result = status({
      timeZone: 'Europe/London', settings: settingsRow(countSecondary), muscleRows: rows, mappings, training: rowsTraining,
      definitions: definitionsOf(definition('bench'), definition('dip'), definition('raise'), definition('hang')),
    });
    expect(result.muscle_setup).toBe('broad');
    expect(result.muscles.map((muscle) => ({
      muscleGroupId: muscle.id, name: muscle.name, days: muscle.recovery_days.map((day) => day.sets),
      today: muscle.today_sets, weekSets: muscle.week_sets, target: muscle.weekly_target,
    }))).toEqual(plan.muscles);
    expect(result.muscles.map((muscle) => muscle.recovery_days.map((day) => day.date)))
      .toEqual(result.muscles.map(() => ['2026-10-25', '2026-10-26', '2026-10-27']));
    // The fixture exercises what parity must cover: a merged muscle, a half set and an override.
    expect(plan.muscles.length).toBeGreaterThan(2);
    expect(plan.muscles.some((row) => !Number.isInteger(row.weekSets))).toBe(countSecondary);
    expect(plan.muscles.find((row) => row.muscleGroupId === 'chest')?.target).toBe(12);
  });
});
