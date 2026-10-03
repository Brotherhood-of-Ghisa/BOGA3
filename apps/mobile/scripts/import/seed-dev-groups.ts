#!/usr/bin/env tsx
// Seeds a group for the human dev accounts on the dev Supabase stack, so a
// phone session has a lively Groups tab and Today without manual setup:
//
//   - `Dev crew`, owned by history@dev.local, with b@dev.local as a member;
//   - both memberships start before the recent window, because the share
//     trigger only shares a session that starts inside a membership period
//     (docs/specs/tech/groups-contract.md §2.5);
//   - a few weeks of recent sessions for both, pushed through `sync_push` after
//     that, so the trigger shares them into the group (stream, week board).
//
// a@dev.local is left alone: it stays the near-blank account.
//
// Idempotent: the group, the join and every session are found or keyed by a
// stable id, and a session's `client_updated_at_ms` is fixed, so a re-run is a
// server-side no-op apart from the days that have passed since the last run.

import {
  buildSystemCatalogEntities,
  countByType,
  pushEntities,
  required,
  signIn,
  type WireEntity,
} from './dev-seed-sync';

export const DEV_GROUP_NAME = 'Dev crew';
const DEV_GROUP_DESCRIPTION = 'Seeded for local development (history@ and b@).';
/** Days of recent training seeded before today. */
export const RECENT_WINDOW_DAYS = 28;
// The starter catalog's rows for a member who has none yet. Fixed, so a re-run
// never bumps them past an edit made in the app.
const CATALOG_AT_MS = Date.UTC(2026, 0, 1);
const SESSION_START_HOUR = 18;
const SESSION_DURATION_SEC = 55 * 60;

type PlannedExercise = { id: string; name: string; weightKg: number; reps: number; sets: number; stepKg: number };

export type DevTrainee = {
  key: string;
  email: string;
  password: string;
  username: string;
  /** Local weekdays trained, `Date#getDay()` numbering (0 = Sunday). */
  weekdays: number[];
  /** Workouts in rotation, one per training day. */
  rotation: PlannedExercise[][];
};

const ex = (id: string, name: string, weightKg: number, reps: number, sets = 3, stepKg = 2.5): PlannedExercise => ({
  id,
  name,
  weightKg,
  reps,
  sets,
  stepKg,
});

export const HISTORY_TRAINEE: DevTrainee = {
  key: 'history',
  email: 'history@dev.local',
  password: 'dev123',
  username: 'history',
  weekdays: [1, 3, 5],
  rotation: [
    [
      ex('seed_barbell_bench_press', 'Barbell Bench Press', 80, 6, 4),
      ex('seed_incline_dumbbell_press', 'Incline Dumbbell Press', 28, 10),
      ex('seed_dumbbell_lateral_raise', 'Dumbbell Lateral Raise', 10, 15, 3, 1),
    ],
    [
      ex('seed_conventional_deadlift', 'Conventional Deadlift', 140, 5, 3, 5),
      ex('seed_lat_pulldown', 'Lat Pulldown', 65, 10),
      ex('seed_dumbbell_biceps_curl', 'Dumbbell Biceps Curl', 14, 12, 3, 1),
    ],
    [
      ex('seed_barbell_back_squat', 'Barbell Back Squat', 110, 5, 4, 5),
      ex('seed_romanian_deadlift', 'Romanian Deadlift', 90, 8),
      ex('seed_standing_calf_raise', 'Standing Calf Raise', 60, 12),
    ],
  ],
};

export const B_TRAINEE: DevTrainee = {
  key: 'b',
  email: 'b@dev.local',
  password: 'dev123',
  username: 'dev_b',
  weekdays: [2, 4, 6],
  rotation: [
    [
      ex('seed_barbell_back_squat', 'Barbell Back Squat', 70, 8),
      ex('seed_dumbbell_bench_press', 'Dumbbell Bench Press', 24, 10),
      ex('seed_seated_cable_row', 'Seated Cable Row', 50, 10),
    ],
    [
      ex('seed_leg_press', 'Leg Press', 140, 10, 3, 10),
      ex('seed_standing_barbell_overhead_press', 'Standing Barbell Overhead Press', 35, 8),
      ex('seed_pull_up', 'Pull-Up', 0, 6, 3, 0),
    ],
  ],
};

const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Local midnight, `days` before `now`'s local day. */
const localDayStart = (now: Date, daysBefore: number) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBefore);

/** The first local day of the recent window: memberships must start before it. */
export const recentWindowStart = (now: Date) => localDayStart(now, RECENT_WINDOW_DAYS);

/** The trainee's training days in the window, oldest first; today is never one. */
export const trainingDays = (now: Date, weekdays: number[]): Date[] => {
  const days: Date[] = [];
  for (let daysBefore = RECENT_WINDOW_DAYS; daysBefore >= 1; daysBefore -= 1) {
    const day = localDayStart(now, daysBefore);
    if (weekdays.includes(day.getDay())) days.push(day);
  }
  return days;
};

/**
 * The trainee's recent sessions as wire rows. Ids derive from the trainee and
 * the local date, so each day's session is one stable row across runs; loads
 * climb a step per week through the window.
 */
export const buildRecentSessionEntities = (trainee: DevTrainee, now: Date): WireEntity[] => {
  const windowStart = recentWindowStart(now).getTime();
  const entities: WireEntity[] = [];
  trainingDays(now, trainee.weekdays).forEach((day, index) => {
    const workout = trainee.rotation[index % trainee.rotation.length];
    const week = Math.floor((day.getTime() - windowStart) / (7 * 24 * 60 * 60 * 1000));
    const sessionId = `dev-recent-${trainee.key}-${localDateKey(day)}`;
    const startedAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), SESSION_START_HOUR).getTime();
    const completedAt = startedAt + SESSION_DURATION_SEC * 1000;
    const rowTimes = { created_at: startedAt, updated_at: completedAt, deleted_at: null };
    entities.push({
      type: 'sessions',
      id: sessionId,
      client_updated_at_ms: completedAt,
      fields: {
        gym_id: null,
        status: 'completed',
        started_at: startedAt,
        completed_at: completedAt,
        duration_sec: SESSION_DURATION_SEC,
        ...rowTimes,
      },
    });
    workout.forEach((exercise, orderIndex) => {
      const sessionExerciseId = `${sessionId}-e${orderIndex}`;
      entities.push({
        type: 'session_exercises',
        id: sessionExerciseId,
        client_updated_at_ms: completedAt,
        fields: {
          session_id: sessionId,
          exercise_definition_id: exercise.id,
          order_index: orderIndex,
          name: exercise.name,
          machine_name: null,
          ...rowTimes,
        },
      });
      const weight = exercise.weightKg + week * exercise.stepKg;
      for (let setIndex = 0; setIndex < exercise.sets; setIndex += 1) {
        entities.push({
          type: 'exercise_sets',
          id: `${sessionExerciseId}-s${setIndex}`,
          client_updated_at_ms: completedAt,
          fields: {
            session_exercise_id: sessionExerciseId,
            order_index: setIndex,
            weight_value: String(weight),
            reps_value: String(exercise.reps),
            set_type: setIndex === exercise.sets - 1 ? 'rir_1' : null,
            planned_weight_value: null,
            planned_reps_value: null,
            planned_set_type: null,
            performance_status: null,
            ...rowTimes,
          },
        });
      }
    });
  });
  return entities;
};

type Env = { apiUrl: string; anonKey: string; serviceRoleKey: string };
type SignedIn = DevTrainee & { token: string; userId: string };

const rpc = async (env: Env, token: string, name: string, args: Record<string, unknown>) => {
  const response = await fetch(`${env.apiUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: env.anonKey,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'content-profile': 'app_public',
      'accept-profile': 'app_public',
    },
    body: JSON.stringify(args),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${name} failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  return body;
};

// Service-role REST on `app_public` (bypasses RLS): usernames and membership dates.
const serviceRest = async (env: Env, method: string, path: string, body?: unknown, prefer?: string) => {
  const response = await fetch(`${env.apiUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env.serviceRoleKey,
      authorization: `Bearer ${env.serviceRoleKey}`,
      'content-type': 'application/json',
      'content-profile': 'app_public',
      'accept-profile': 'app_public',
      ...(prefer ? { prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} failed: HTTP ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
};

// Group RPCs need a username; one the account already has is kept.
const ensureUsername = async (env: Env, trainee: SignedIn) => {
  const rows = (await serviceRest(env, 'GET', `user_profiles?select=username&id=eq.${trainee.userId}`)) as {
    username: string | null;
  }[];
  if (rows[0]?.username) return;
  await serviceRest(
    env,
    'POST',
    'user_profiles?on_conflict=id',
    { id: trainee.userId, username: trainee.username },
    'resolution=merge-duplicates,return=minimal'
  );
};

const findGroupId = async (env: Env, trainee: SignedIn): Promise<string | null> => {
  const result = (await rpc(env, trainee.token, 'group_list_mine', {})) as {
    groups: { group_id: string; name: string }[];
  };
  return result.groups.find((group) => group.name === DEV_GROUP_NAME)?.group_id ?? null;
};

// Moves the two members' current periods (and their `joined` stream items) to
// before the window, so the recent sessions fall inside them. A period that
// already starts earlier is left as it is.
const backdateMemberships = async (env: Env, groupId: string, members: SignedIn[], joinedAt: Date) => {
  const iso = joinedAt.toISOString();
  const users = members.map((member) => member.userId).join(',');
  const periods = (await serviceRest(
    env,
    'PATCH',
    `group_memberships?group_id=eq.${groupId}&user_id=in.(${users})&ended_at=is.null&joined_at=gt.${iso}`,
    { joined_at: iso },
    'return=representation'
  )) as { id: string }[];
  if (periods.length === 0) return 0;
  await serviceRest(
    env,
    'PATCH',
    `group_events?kind=eq.joined&membership_id=in.(${periods.map((period) => period.id).join(',')})`,
    { sort_at_ms: joinedAt.getTime(), occurred_at: iso },
    'return=minimal'
  );
  return periods.length;
};

export const runDevGroupsSeedCli = async (now = new Date()) => {
  const env: Env = {
    apiUrl: required(process.env.API_URL ?? process.env.SUPABASE_URL, 'API_URL'),
    anonKey: required(process.env.ANON_KEY ?? process.env.SUPABASE_ANON_KEY, 'ANON_KEY'),
    serviceRoleKey: required(process.env.SERVICE_ROLE_KEY, 'SERVICE_ROLE_KEY'),
  };
  const [owner, member] = await Promise.all(
    [HISTORY_TRAINEE, B_TRAINEE].map(async (trainee): Promise<SignedIn> => ({
      ...trainee,
      ...(await signIn(env.apiUrl, env.anonKey, trainee.email, trainee.password)),
    }))
  );
  await ensureUsername(env, owner);
  await ensureUsername(env, member);

  let groupId = await findGroupId(env, owner);
  const created = !groupId;
  if (!groupId) {
    const result = (await rpc(env, owner.token, 'group_create', {
      p_name: DEV_GROUP_NAME,
      p_description: DEV_GROUP_DESCRIPTION,
    })) as { group_id: string };
    groupId = result.group_id;
  }
  const joined = (await findGroupId(env, member)) !== groupId;
  if (joined) {
    const { code } = (await rpc(env, owner.token, 'group_invite_get', { p_group_id: groupId })) as { code: string };
    await rpc(env, member.token, 'group_join', { p_code: code });
  }
  const backdated = await backdateMemberships(env, groupId, [owner, member], localDayStart(now, RECENT_WINDOW_DAYS + 1));

  // The member's catalog first (the owner's comes with the rich history), then
  // both trainees' sessions: pushed after the backdate, so they are shared.
  const memberEntities = [...buildSystemCatalogEntities(CATALOG_AT_MS), ...buildRecentSessionEntities(member, now)];
  const ownerEntities = buildRecentSessionEntities(owner, now);
  await pushEntities(env.apiUrl, env.anonKey, member.token, memberEntities);
  await pushEntities(env.apiUrl, env.anonKey, owner.token, ownerEntities);

  console.log(
    JSON.stringify(
      {
        seeded: true,
        group: { id: groupId, name: DEV_GROUP_NAME, created, memberJoined: joined, periodsBackdated: backdated },
        pushed: { [owner.email]: countByType(ownerEntities), [member.email]: countByType(memberEntities) },
      },
      null,
      2
    )
  );
  return 0;
};

if (require.main === module) {
  runDevGroupsSeedCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[dev-groups-seed] ${(error as Error).message}`);
      process.exitCode = 1;
    });
}
