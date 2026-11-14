// Parity cases for the notification RPCs: enqueue, prepare, begin_send and
// confirm_completion, and the two helpers they share (readiness and the
// context digest). The old definitions are the saved live ones, installed in
// pg_temp with their helpers renamed, so old and new run side by side on the
// same fixture. These RPCs write, so each call runs in its own savepoint and
// what it changed (workouts, intents, deliveries, moments) is compared with
// its result, then rolled back. Scenarios then change the fixture one fact
// at a time, so each readiness check is the one that fails in turn.

import type { ParityCase } from './parity.ts';
import type { Caller } from './session.ts';

/** The saved definitions before the single-graph migration. */
const BEFORE = 'parity-definitions/20261114210000_notification_ready_single_graph.sql';
const HELPERS = { notification_workout_ready: BEFORE, notification_context_digest: BEFORE };
const DIGEST_HELPER = { notification_context_digest: BEFORE };

/** What the notification cases call with, read from the fixture once its workouts are confirmed. */
export type NotificationFixture = {
  groupId: string;
  workouts: {
    member: string; session: string; generation: number; eligible: boolean; contributions: unknown;
    /** The auth session the member's app token names. */
    auth: string;
    /** The workout's graph as the app confirms it. */
    manifest: unknown;
  }[];
  /** The newest sessions of the fixture, whether or not a workout row tracks them. */
  sessions: { member: string; session: string }[];
  /** Every delivery, leased under a known claim. */
  deliveries: { id: number; generation: number; claim: string }[];
  /** A set another member logged in the group, and one the viewer logged. */
  peerSet: { member: string; set: string };
  ownSet: { member: string; set: string };
};

export type WithNotification = { notification: NotificationFixture | null };

export const SCENARIOS = [
  'base', 'peer-set-edited', 'own-set-edited', 'link-changed', 'publication-stale', 'final-ranks-stale', 'without-stale', 'unprepared',
  'unenqueued',
] as const;
export type Scenario = (typeof SCENARIOS)[number];

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

const asMember = (member: string, sql: string): string[] => [
  `select set_config('request.jwt.claim.sub',${literal(member)},true),
     set_config('request.jwt.claims',json_build_object('sub',${literal(member)}::text,'role','authenticated')::text,true)`,
  sql,
  `select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','',true)`,
];

const editSet = (target: { member: string; set: string }) => asMember(target.member,
  `update app_public.exercise_sets es set weight_value=(es.weight_value::numeric+5)::text,
     client_updated_at_ms=es.client_updated_at_ms+1,updated_at=es.updated_at+1
     where es.owner_user_id=${literal(target.member)} and es.id=${literal(target.set)}`);

/** The statements that put the fixture in a scenario, run as the table owner inside the scenario's savepoint. */
export const scenarioStatements = (scenario: Scenario, fixture: NotificationFixture): string[] => {
  switch (scenario) {
    case 'base': return [];
    case 'peer-set-edited': return editSet(fixture.peerSet);
    case 'own-set-edited': return editSet(fixture.ownSet);
    case 'link-changed': return asMember(fixture.ownSet.member,
      `update app_public.exercise_group_links set updated_at=updated_at+1,client_updated_at_ms=client_updated_at_ms+1
         where owner_user_id=${literal(fixture.ownSet.member)}`);
    case 'publication-stale': return [`update app_public.notification_comparison_publications set source_digest='stale'`];
    case 'final-ranks-stale': return [`update app_public.notification_workout_targets set final_ranks='[]'::jsonb`];
    case 'without-stale': return [`update app_public.notification_workout_targets set without_workout='[]'::jsonb`];
    case 'unprepared': return [`update app_public.notification_workout_targets set evaluated=false`];
    // Confirmed but not yet enqueued: what the worker's preparation picks up.
    case 'unenqueued': return [`update app_public.notification_workouts set enqueued_generation=0 where eligible`];
  }
};

/** Leases every delivery under a known claim and reads what the cases call with. */
export const NOTIFICATION_FIXTURE_SQL = `select jsonb_build_object(
  'groupId',(select group_id from perf_fx),
  'workouts',(select coalesce(jsonb_agg(jsonb_build_object('member',w.member_user_id,'session',w.session_id,'generation',w.generation,
      'eligible',w.eligible,'contributions',w.contributions,
      'auth',(select s.id from auth.sessions s where s.user_id=w.member_user_id order by s.created_at limit 1),
      'manifest',app_public.notification_source_manifest(w.member_user_id,w.session_id))
      order by w.member_user_id,w.session_id),'[]'::jsonb) from app_public.notification_workouts w),
  'sessions',(select coalesce(jsonb_agg(jsonb_build_object('member',s.owner_user_id,'session',s.id)),'[]'::jsonb)
    from (select owner_user_id,id from app_public.sessions order by started_at desc,owner_user_id,id limit 40) s),
  'deliveries',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'generation',d.generation,'claim',md5(d.id::text)::uuid) order by d.id),'[]'::jsonb)
    from app_public.notification_deliveries d),
  'peerSet',(select jsonb_build_object('member',e.member_user_id,'set',e.set_id)
    from app_public.group_events e join perf_members m on m.uid=e.member_user_id
    where e.group_id=(select group_id from perf_fx) and e.kind='record' and m.idx=4 and e.set_id is not null
    order by e.seq desc limit 1),
  'ownSet',(select jsonb_build_object('member',es.owner_user_id,'set',es.id) from app_public.exercise_sets es
    where es.owner_user_id=(select uid from perf_members where idx=1) and es.id='perf-live-b0-x0')) as fixture`;

export const LEASE_DELIVERIES_SQL = `update app_public.notification_deliveries set state='leased',claim_id=md5(id::text)::uuid,
  lease_until=now()+interval '1 hour',available_at=now()`;

/**
 * What the notification RPCs may change, as one JSON value. Generated ids
 * and clock-timed leases differ between two runs by design, so rows are keyed
 * by what they are about and those columns are left out.
 */
export const NOTIFICATION_STATE_SQL = `select jsonb_build_object(
  'workouts',(select coalesce(jsonb_agg(to_jsonb(w) order by w.member_user_id,w.session_id),'[]'::jsonb) from app_public.notification_workouts w),
  'intents',(select coalesce(jsonb_agg(to_jsonb(i)-'id' order by i.recipient_user_id,i.lifter_user_id,i.session_id,i.kind),'[]'::jsonb)
    from app_public.notification_intents i),
  'deliveries',(select coalesce(jsonb_agg((to_jsonb(d)-array['id','intent_id','lease_until','available_at','receipt_lease_until','receipt_available_at'])
      ||jsonb_build_object('intent',jsonb_build_array(i.recipient_user_id,i.lifter_user_id,i.session_id,i.kind))
      order by i.recipient_user_id,i.lifter_user_id,i.session_id,i.kind,d.installation_id),'[]'::jsonb)
    from app_public.notification_deliveries d join app_public.notification_intents i on i.id=d.intent_id),
  'moments',(select coalesce(jsonb_agg(to_jsonb(m) order by m.member_user_id,m.session_id,m.kind),'[]'::jsonb)
    from app_public.notification_workout_moments m),
  'queue',(select count(*) from app_public.notification_moment_queue)) as state`;

const NEVER = '00000000-0000-4000-8000-0000000000ff';

type Call = { viewer: string; args: Record<string, unknown> };
const fixtureOf = (context: WithNotification): NotificationFixture => {
  if (!context.notification) throw new Error('the notification fixture was not read');
  return context.notification;
};

const readiness = (context: WithNotification): Call[] =>
  fixtureOf(context).workouts.map((w) => ({ viewer: w.member, args: { p_member: w.member, p_session: w.session } }));

const digests = (context: WithNotification): Call[] => {
  const fixture = fixtureOf(context);
  const seen = new Set<string>();
  return [...fixture.workouts.map((w) => ({ member: w.member, session: w.session })), ...fixture.sessions]
    .filter(({ member, session }) => !seen.has(`${member}/${session}`) && seen.add(`${member}/${session}`))
    .map(({ member, session }) => ({ viewer: member, args: { p_member: member, p_session: session } }));
};

const enqueues = (context: WithNotification): Call[] => {
  const fixture = fixtureOf(context);
  const contribution = [{ group_id: fixture.groupId, best_count: 1, rank_count: 2 }];
  return fixture.workouts.filter((w) => w.eligible).flatMap((w) => [
    { p_generation: w.generation, p_contributions: w.contributions },
    { p_generation: w.generation, p_contributions: contribution },
    { p_generation: w.generation + 1, p_contributions: contribution },
    { p_generation: w.generation, p_contributions: [{}] },
  ].map((rest) => ({ viewer: w.member, args: { p_member: w.member, p_session: w.session, ...rest } })));
};

const sends = (context: WithNotification): Call[] => {
  const fixture = fixtureOf(context);
  const viewer = fixture.workouts[0].member;
  return fixture.deliveries.flatMap((d) => [
    { viewer, args: { p_delivery_id: d.id, p_claim_id: d.claim, p_generation: d.generation } },
    { viewer, args: { p_delivery_id: d.id, p_claim_id: NEVER, p_generation: d.generation } },
  ]);
};

const confirmations = (context: WithNotification): Call[] => {
  const fixture = fixtureOf(context);
  return fixture.workouts.filter((w) => w.eligible).flatMap((w) => {
    const entities = w.manifest as unknown[];
    return [
      { p_session_id: w.session, p_entities: entities },
      { p_session_id: w.session, p_entities: entities.slice(1) },
      { p_session_id: `${w.session}-unknown`, p_entities: entities },
    ].map((args) => ({ viewer: w.member, args }));
  });
};

/** A wrapped call's result, or its error text when it failed. */
const settled = (live: unknown): unknown => {
  const call = live as { result?: unknown; error?: string };
  return call.error === undefined ? call.result : `error ${call.error}`;
};

const callerFor = (role: 'postgres' | 'service_role') => (): Caller => ({ role });

/** The notification cases, in the order they run; every one runs in every scenario unless it says otherwise. */
export const notificationParityCases = <Context extends WithNotification>(): ParityCase<Context>[] => [
  { fn: 'notification_workout_ready', migration: BEFORE, helpers: DIGEST_HELPER, calls: readiness, caller: callerFor('postgres'),
    scenarios: [...SCENARIOS], observe: (live) => String(settled(live)), requires: ['true', 'false'] },
  { fn: 'notification_context_digest', migration: BEFORE, calls: digests, caller: callerFor('postgres'),
    scenarios: ['base', 'peer-set-edited', 'own-set-edited', 'link-changed'] },
  { fn: 'notification_workout_enqueue', migration: BEFORE, helpers: HELPERS, calls: enqueues, caller: callerFor('service_role'),
    state: NOTIFICATION_STATE_SQL, scenarios: [...SCENARIOS], observe: (live) => String(settled(live)), requires: ['true', 'false'] },
  { fn: 'notification_workout_prepare', migration: BEFORE, helpers: HELPERS, caller: callerFor('service_role'),
    calls: (context) => [20, 1, 0].map((limit) => ({ viewer: fixtureOf(context).workouts[0].member, args: { p_limit: limit } })),
    state: NOTIFICATION_STATE_SQL, scenarios: [...SCENARIOS],
    observe: (live) => `jobs${((settled(live) as { jobs?: unknown[] } | null)?.jobs?.length ?? 0) > 0 ? '>0' : '=0'}`,
    requires: ['jobs>0', 'jobs=0'] },
  { fn: 'notification_begin_send', migration: BEFORE, helpers: HELPERS, calls: sends, caller: callerFor('service_role'),
    state: NOTIFICATION_STATE_SQL, scenarios: [...SCENARIOS],
    observe: (live) => (settled(live) === null ? 'refused' : 'payload'), requires: ['refused', 'payload'] },
  { fn: 'notification_confirm_completion', migration: BEFORE, helpers: HELPERS, calls: confirmations,
    caller: (viewer, context) => ({
      role: 'authenticated', userId: viewer, sessionId: fixtureOf(context).workouts.find((w) => w.member === viewer)?.auth,
    }),
    state: NOTIFICATION_STATE_SQL, scenarios: [...SCENARIOS],
    observe: (live) => `confirmed=${String((settled(live) as { confirmed?: unknown } | null)?.confirmed)}`,
    requires: ['confirmed=true', 'confirmed=false'] },
];
