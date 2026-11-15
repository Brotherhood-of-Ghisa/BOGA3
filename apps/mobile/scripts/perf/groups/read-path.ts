// The read-path scenario set (lane groups-perf): what one call of each group
// read, evaluator write and notification RPC in READ_PATH_RPCS costs (only
// those; the workers' other RPCs carry no budget), on a fixture of
// READ_PATH_MEMBERS members at each of READ_PATH_DAYS days of history. Unlike
// the sweeps it is strict: a call over its budget, a budgeted scoped RPC that
// grows faster than SLOPE_LIMIT per doubling of history, a failed parity case
// or a missing planted case fails the lane, whatever GROUPS_PERF_STRICT says.
//
// Each point builds the Tier 1 fixture inside one rolled-back transaction,
// plants the cases the reads must handle (a bodyweight-redacted member
// exercise, a voided record, a live and a finished CoW, notification
// installations), drains to steady state, then measures: every read once as
// a member calls it, then the cascades of one workout's start, logged set
// and confirmation, which is where the write RPCs run.

import { Client } from 'pg';

import { scans, type Counters } from './counters.ts';
import { fixtureStatements, FIXTURE_COUNTS_SQL } from './fixture.ts';
import {
  LEASE_DELIVERIES_SQL, NOTIFICATION_FIXTURE_SQL, SCENARIOS, notificationParityCases, scenarioStatements,
  type NotificationFixture,
} from './notification-parity.ts';
import {
  compareParity, helperParityStatements, missingOutcomes, parityInstallStatements, parityPassed, streamWalk,
  type HelperParityCase, type ParityCase, type ParityOutcome,
} from './parity.ts';
import { PublishParity } from './publish-parity.ts';
import {
  checkBudgets, readPathMarkdown, type BudgetCheck, type BudgetEntry, type PointCost,
} from './read-path-budgets.ts';
import { Tier1Session, type CallRecord } from './session.ts';
import type { RpcFailure } from './group-eval-mirror.ts';
import {
  analyzeAppTables, configureHosted, pushEntities, steadyState, Tier1Run, vacuum, type StepResult, type Tier1Options,
} from './tier1.ts';

export const READ_PATH_MEMBERS = 5;
export const READ_PATH_DAYS = [90, 180] as const;
/** The point parity runs on: the smaller fixture holds every planted case at half the cost. */
export const PARITY_DAYS = READ_PATH_DAYS[0];

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
/** The At a glance read: the period in view and the five before it. */
const PERIOD_WINDOWS = 6;

/** What the measured calls are about, read from the fixture after steady state. */
export type ReadPathContext = {
  groupId: string;
  /** The owner, who views every read. */
  viewer: string;
  /** The owner's auth session: the app's JWT names it, and notification RPCs require it. */
  viewerSession: string;
  /** Every member, owner first: the viewers parity compares for. */
  members: string[];
  bench: string;
  /** Every group exercise, in the fixture's order. */
  exercises: string[];
  /** Shared, completed sessions parity opens: each member's two newest and their newest with the bodyweight-aware exercise. */
  sessions: { member: string; sessionId: string }[];
  /** Another member's newest shared session that set a record: the one a stream card opens. */
  session: { member: string; sessionId: string };
  /** The group's CoWs and their metrics: the ones the CoW result readers page. */
  cows: { id: string; metrics: string[] }[];
  /** The workout the viewer finishes and its synced graph, as the app confirms it; set once it is finished. */
  completion: { sessionId: string; entities: unknown } | null;
  /** What the notification parity cases call with; set when parity runs. */
  notification: NotificationFixture | null;
  /**
   * Rolling 7-day windows ending at the fixture's clock, oldest first. The
   * app sends Monday-aligned local weeks; rolling ones hold the same number of
   * sessions whatever day the lane runs, so the cost does not move with it.
   */
  weeks: { start_ms: number; end_ms: number }[];
};

/**
 * One measured RPC. `member`: the viewer calls it as the app does. `cascade`:
 * it runs inside one logged set's evaluator and notification cascade, as the
 * Edge workers call it with the service role; the costliest call counts.
 */
export type ReadPathRpc = {
  fn: string;
  via: 'member' | 'cascade';
  args?: (context: ReadPathContext) => Record<string, unknown>;
  budget: BudgetEntry;
};

const stream = (fn: string, budget: BudgetEntry): ReadPathRpc => ({
  fn, via: 'member', args: (c) => ({ p_group_id: c.groupId, p_before: null, p_limit: 20 }), budget,
});

/**
 * The stream's first page. v5 is the set's first read on its connection, so
 * its one call also loads the catalog entries and compiled functions every
 * stream builder needs, once per backend: about 2,200 pages of its cost. A
 * repeat call on the same connection (as PostgREST's pooled connections make
 * it) costs 3.0k pages at H=90 and 3.3k at H=180; v4, measured next on the
 * same builders, 2.9k-3.2k.
 */
const STREAM_V5_JUSTIFICATION = 'first read on a fresh connection: ~2.2k of its pages are one-time catalog and function '
  + 'loading; a warm call costs 3.0k-3.3k pages, under the ceiling';

/**
 * Every RPC the set measures, with its budget beside it. A budget is the
 * costliest call measured at either point plus ~25% (`suggestBudget`);
 * `baseline` entries record today's cost, `budgeted` ones hold an RPC to the
 * ceiling. Re-measure and update an entry in the change that moves its cost.
 */
export const READ_PATH_RPCS: readonly ReadPathRpc[] = [
  stream('group_competition_stream_v5', { kind: 'budgeted', pages: 6_600, scoped: true, justification: STREAM_V5_JUSTIFICATION }),
  stream('group_competition_stream_v4', { kind: 'budgeted', pages: 4_100, scoped: true }),
  stream('group_competition_stream_v3', { kind: 'budgeted', pages: 3_800, scoped: true }),
  stream('group_competition_stream_v2', { kind: 'budgeted', pages: 2_300, scoped: true }),
  { fn: 'group_competition_period_totals', via: 'member', args: (c) => ({ p_group_id: c.groupId, p_windows: c.weeks }),
    budget: { kind: 'budgeted', pages: 3_800, scoped: true } },
  { fn: 'group_competition_week_summary', via: 'member',
    args: (c) => ({ p_group_id: c.groupId, p_window_start_ms: c.weeks.at(-1)!.start_ms, p_window_end_ms: c.weeks.at(-1)!.end_ms }),
    budget: { kind: 'budgeted', pages: 1_100, scoped: true } },
  { fn: 'group_competition_podiums', via: 'member', args: (c) => ({ p_group_id: c.groupId, p_certified: false }),
    budget: { kind: 'budgeted', pages: 3_100, scoped: true } },
  { fn: 'group_competition_board', via: 'member',
    args: (c) => ({ p_group_id: c.groupId, p_group_exercise_id: c.bench, p_metric: 'e1rm', p_certified: false, p_limit: 50, p_cursor: null }),
    budget: { kind: 'budgeted', pages: 1_500, scoped: true } },
  { fn: 'group_competition_records_history', via: 'member',
    args: (c) => ({ p_group_id: c.groupId, p_group_exercise_id: c.bench, p_metric: 'e1rm', p_certified: false, p_before: null, p_limit: 50 }),
    budget: { kind: 'budgeted', pages: 2_300, scoped: true } },
  { fn: 'group_competition_session_detail', via: 'member',
    args: (c) => ({ p_group_id: c.groupId, p_member_user_id: c.session.member, p_session_id: c.session.sessionId }),
    budget: { kind: 'budgeted', pages: 1_150, scoped: true } },
  { fn: 'group_competition_session_records', via: 'member',
    args: (c) => ({ p_group_id: c.groupId, p_member_user_id: c.session.member, p_session_id: c.session.sessionId }),
    budget: { kind: 'budgeted', pages: 350, scoped: true } },
  { fn: 'group_cow_summary', via: 'member', args: (c) => ({ p_group_id: c.groupId }),
    budget: { kind: 'budgeted', pages: 2_200, scoped: true } },
  // Still `baseline`: under the ceiling, but its cost grows 1.36-1.38x per doubling of history.
  { fn: 'group_cow_previous_summary', via: 'member', args: (c) => ({ p_group_id: c.groupId }),
    budget: { kind: 'baseline', pages: 2_500, scoped: true } },
  { fn: 'group_cow_calendar_get', via: 'member', args: (c) => ({ p_group_id: c.groupId }),
    budget: { kind: 'budgeted', pages: 20, scoped: true } },
  { fn: 'group_list_mine', via: 'member', args: () => ({}), budget: { kind: 'budgeted', pages: 20, scoped: true } },
  { fn: 'group_get', via: 'member', args: (c) => ({ p_group_id: c.groupId }), budget: { kind: 'budgeted', pages: 40, scoped: true } },
  { fn: 'group_competition_exercise_list', via: 'member', args: (c) => ({ p_group_id: c.groupId }),
    budget: { kind: 'budgeted', pages: 20, scoped: true } },
  { fn: 'group_eval_complete', via: 'cascade', budget: { kind: 'budgeted', pages: 400, scoped: true } },
  { fn: 'group_metric_eval_prepare', via: 'cascade', budget: { kind: 'budgeted', pages: 4_200, scoped: false } },
  { fn: 'group_metric_eval_publish', via: 'cascade', budget: { kind: 'budgeted', pages: 110_000, scoped: false,
    justification: 'A background evaluator job, never a screen read. Most of its pages are the notification capture it runs '
      + 'before and after publishing: every source session\'s boards with and without its workout. Its source graph, score '
      + 'writes and board apply are a small share of the cost.' } },
  // Each of these three proves the captured comparison still holds, which
  // reads the group's shared history once (the source graph) and ranks the
  // exercise twice: its cost grows with that history until the graph build
  // and the per-entry redaction answers get cheaper.
  { fn: 'notification_workout_prepare', via: 'cascade', budget: { kind: 'baseline', pages: 48_000, scoped: true } },
  { fn: 'notification_workout_enqueue', via: 'cascade', budget: { kind: 'baseline', pages: 48_000, scoped: true } },
  { fn: 'notification_begin_send', via: 'cascade', budget: { kind: 'baseline', pages: 48_000, scoped: true } },
  { fn: 'notification_confirm_completion', via: 'member',
    args: (c) => ({ p_session_id: c.completion!.sessionId, p_entities: c.completion!.entities }),
    budget: { kind: 'budgeted', pages: 280, scoped: true } },
];

/**
 * Live read definitions saved before the board, history, session detail and
 * stream rewrites (each patched in place by a later migration, so in no one
 * migration).
 */
const READ_DEFINITIONS = 'parity-definitions/20261114220000_group_read_helpers.sql';
const PUBLICATION = '20261004233855_group_competition_publication.sql';
const COW_READERS = '20261030064514_group_cow_readers.sql';
const COW_STREAM = '20261030203502_group_cow_stream_events.sql';

/**
 * The old item builders every stream and CoW reader case installs, callees
 * first: an old SQL body must find the old helpers it calls already there.
 */
const COW_RESULT_HELPERS = {
  group_cow_result_rows: READ_DEFINITIONS,
  group_cow_public_result: COW_READERS,
};
const STREAM_ITEM_HELPERS = {
  ...COW_RESULT_HELPERS,
  group_cow_stream_item: COW_STREAM,
  group_competition_session_exercises: READ_DEFINITIONS,
  group_competition_session_json: READ_DEFINITIONS,
  group_competition_session_card: PUBLICATION,
  group_competition_event_json: READ_DEFINITIONS,
  group_competition_stream_event: PUBLICATION,
  group_competition_stream_record: READ_DEFINITIONS,
};
const V3_HELPERS = {
  ...STREAM_ITEM_HELPERS,
  group_competition_stream_page_v3: READ_DEFINITIONS,
};

const streamArgs = (context: ReadPathContext, limit: number) => [{ p_group_id: context.groupId, p_before: null, p_limit: limit }];
/** The All stream: every group the viewer belongs to (the server-only scope). */
const allStreamArgs = (limit: number) => [{ p_group_id: null, p_before: null, p_limit: limit }];

/** The next page of a CoW's results: its one ranking's `next_cursor` as `p_before`. */
export const cowResultsWalk = (args: Record<string, unknown>, result: unknown): Record<string, unknown> | null => {
  const cursor = (result as { rankings?: { next_cursor?: unknown }[] } | null)?.rankings?.[0]?.next_cursor;
  return typeof cursor === 'string' ? { ...args, p_before: cursor } : null;
};

/**
 * Every stream version against its old definition chain, each walking every
 * page by its own cursor: v2-v5 at the largest page (50) for every viewer,
 * v5 also at the app's page (20) for every viewer and one item per page for
 * the owner, so every item boundary, ties included, is a page boundary once.
 */
const streamParityCases = (): ParityCase<ReadPathContext>[] => [
  { fn: 'group_competition_stream_v5', migration: '20261112190000_group_stream_withdrawn_records.sql',
    helpers: { ...V3_HELPERS, group_competition_stream_v3: COW_STREAM,
      group_competition_stream_v4: '20261111160000_group_stream_group_record_metrics.sql',
      group_competition_stream_withdrawn: '20261112190000_group_stream_withdrawn_records.sql' },
    argumentSets: (context) => [...streamArgs(context, 20), ...streamArgs(context, 50), ...allStreamArgs(50)], walk: streamWalk },
  { fn: 'group_competition_stream_v5', migration: '20261112190000_group_stream_withdrawn_records.sql',
    helpers: { ...V3_HELPERS, group_competition_stream_v3: COW_STREAM,
      group_competition_stream_v4: '20261111160000_group_stream_group_record_metrics.sql',
      group_competition_stream_withdrawn: '20261112190000_group_stream_withdrawn_records.sql' },
    calls: (context) => streamArgs(context, 1).map((args) => ({ viewer: context.viewer, args })), walk: streamWalk },
  // v4 also at 20 and 5 a page: its records keep their group records when nothing retracts them.
  { fn: 'group_competition_stream_v4', migration: '20261111160000_group_stream_group_record_metrics.sql',
    helpers: { ...V3_HELPERS, group_competition_stream_v3: COW_STREAM },
    argumentSets: (context) => [50, 20, 5].flatMap((limit) => streamArgs(context, limit)), walk: streamWalk },
  { fn: 'group_competition_stream_v3', migration: COW_STREAM, helpers: V3_HELPERS,
    argumentSets: (context) => streamArgs(context, 50), walk: streamWalk },
  { fn: 'group_competition_stream_v2', migration: '20261008160000_group_competition_set_certification.sql',
    helpers: { ...STREAM_ITEM_HELPERS, group_competition_stream_page: READ_DEFINITIONS, group_competition_stream: READ_DEFINITIONS },
    argumentSets: (context) => [...streamArgs(context, 50), ...allStreamArgs(50)], walk: streamWalk },
  { fn: 'group_competition_stream', migration: READ_DEFINITIONS,
    helpers: { ...STREAM_ITEM_HELPERS, group_competition_stream_page: READ_DEFINITIONS },
    argumentSets: (context) => streamArgs(context, 50), walk: streamWalk },
];

/**
 * The CoW result readers, whose rows are now built once: the summaries
 * (`observed_at_us` is the clock at each call, so it is not compared), and
 * each CoW's results per metric.
 */
const cowParityCases = (): ParityCase<ReadPathContext>[] => [
  { fn: 'group_cow_summary', migration: COW_READERS, helpers: COW_RESULT_HELPERS, ignoreKeys: ['observed_at_us'],
    argumentSets: (context) => [{ p_group_id: context.groupId }] },
  { fn: 'group_cow_previous_summary', migration: '20261030210545_group_cow_previous_summary.sql', helpers: COW_RESULT_HELPERS, ignoreKeys: ['observed_at_us'],
    argumentSets: (context) => [{ p_group_id: context.groupId }] },
  { fn: 'group_cow_results', migration: COW_READERS, helpers: COW_RESULT_HELPERS,
    argumentSets: (context) => context.cows.flatMap((cow) => cow.metrics.flatMap((metric) => [1, 20].map((limit) =>
      ({ p_group_id: context.groupId, p_cow_id: cow.id, p_metric: metric, p_before: null, p_limit: limit })))),
    walk: cowResultsWalk },
];

/**
 * The parity cases the set runs on its PARITY_DAYS fixture (see parity.ts). A
 * change that rewrites an RPC adds a case naming the migration whose
 * definition it replaces, with argument sets that cover the fixture; the case
 * proves the rewrite returns the same JSON for every member as viewer, the
 * redacted member exercise and the voided record included. A definition a
 * later migration patched in place (pg_get_functiondef + replace) has no
 * verbatim copy in any one migration: copy the live text into a migration-
 * named file before the rewrite instead.
 */
const boardArguments = (context: ReadPathContext): Record<string, unknown>[] =>
  context.exercises.flatMap((exercise) => (['e1rm', 'volume'] as const).flatMap((metric) =>
    [true, false].flatMap((certified) => [50, 2].map((limit) => ({
      p_group_id: context.groupId, p_group_exercise_id: exercise, p_metric: metric, p_certified: certified, p_limit: limit, p_cursor: null,
    })))));

const sessionArguments = (context: ReadPathContext): Record<string, unknown>[] =>
  context.sessions.map((item) => ({ p_group_id: context.groupId, p_member_user_id: item.member, p_session_id: item.sessionId }));

export const PARITY_CASES: readonly ParityCase<ReadPathContext>[] = [
  // Every rolling week of the At a glance read, for every viewer, against the
  // definition before the keyset latest session and the session-first counts.
  // It is also the helper's own proof: the plant shifts one field of each
  // member's row (its rank), which the comparison must catch.
  {
    fn: 'group_competition_week_summary',
    migration: '20261008120000_group_competition_v4_only.sql',
    helpers: { group_week_session_counts: '20261003180000_group_board_raw_weight.sql' },
    argumentSets: (context) => context.weeks.map((week) =>
      ({ p_group_id: context.groupId, p_window_start_ms: week.start_ms, p_window_end_ms: week.end_ms })),
    plant: { from: `'rank', r.rank,`, to: `'rank', r.rank + 1,` },
  },
  // The At a glance periods before the materialized session totals: the six
  // rolling weeks together, each alone, and 30-day months back over the
  // whole history.
  {
    fn: 'group_competition_period_totals',
    migration: '20261011120000_group_competition_period_totals.sql',
    helpers: { group_week_session_counts: '20261003180000_group_board_raw_weight.sql' },
    argumentSets: (context) => {
      const end = context.weeks.at(-1)!.end_ms;
      const months = Array.from({ length: Math.ceil(PARITY_DAYS / 30) + 1 }, (_, index) =>
        ({ start_ms: end - (index + 1) * MONTH_MS, end_ms: end - index * MONTH_MS }));
      return [context.weeks, ...context.weeks.map((week) => [week]), months]
        .map((windows) => ({ p_group_id: context.groupId, p_windows: windows }));
    },
  },
  // The board and the podiums before the single ranked set: every exercise,
  // both metrics, both scopes, a full page and a short one (a next cursor).
  {
    fn: 'group_competition_board',
    migration: READ_DEFINITIONS,
    argumentSets: (context) => boardArguments(context),
    plant: { from: `'entry_count',_count`, to: `'entry_count',_count+1` },
  },
  {
    fn: 'group_competition_podiums',
    migration: READ_DEFINITIONS,
    helpers: { group_competition_board: READ_DEFINITIONS },
    argumentSets: (context) => [true, false].map((certified) => ({ p_group_id: context.groupId, p_certified: certified })),
  },
  // The history before the per-page redaction map: every exercise, both
  // metrics and scopes, a full page and a short one. The old cascade of
  // helpers is installed too, so the old body calls the old helpers.
  {
    fn: 'group_competition_records_history',
    migration: READ_DEFINITIONS,
    helpers: {
      group_competition_event_json: READ_DEFINITIONS,
      group_competition_stream_record: READ_DEFINITIONS,
      group_competition_records_history_item: READ_DEFINITIONS,
    },
    argumentSets: (context) => context.exercises.flatMap((exercise) => (['e1rm', 'volume'] as const).flatMap((metric) =>
      [true, false].flatMap((certified) => [50, 3].map((limit) => ({
        p_group_id: context.groupId, p_group_exercise_id: exercise, p_metric: metric, p_certified: certified, p_before: null, p_limit: limit,
      }))))),
    plant: { from: `'items',_rows`, to: `'items',_rows||_rows` },
  },
  // A session's detail before the once-per-definition redaction.
  {
    fn: 'group_competition_session_detail',
    migration: READ_DEFINITIONS,
    helpers: { group_competition_session_exercises: READ_DEFINITIONS, group_competition_session_json: READ_DEFINITIONS },
    argumentSets: (context) => sessionArguments(context),
  },
  // A session's records, over the event renderer the history rewrite touched.
  {
    fn: 'group_competition_session_records',
    migration: READ_DEFINITIONS,
    helpers: { group_competition_event_json: READ_DEFINITIONS },
    argumentSets: (context) => sessionArguments(context),
  },
  // The notification RPCs and the readiness and context-digest helpers they share (notification-parity.ts).
  ...notificationParityCases<ReadPathContext>(),
  ...streamParityCases(),
  ...cowParityCases(),
];

/** Every session card the fixture's stream shows: (member, session, its groups). */
const SESSION_CARDS_SQL = `select e.member_user_id as a1, e.session_id as a2,
  jsonb_build_array(jsonb_build_object('group_id',g.id,'name',g.name)) as a3
  from app_public.group_events e join app_public.groups g on g.id=e.group_id
  where e.group_id=(select group_id from perf_fx) and e.kind='session'`;

/** A redaction cache for every fixture member, as a `cache(cache)` CTE. */
const WITH_CACHE = `with cache as materialized (select app_public.group_competition_redaction_cache((select group_id from perf_fx),
  array(select uid from perf_members)) as cache)`;

/** Every (group, member, definition) the redaction helpers are compared on: every definition a member logged or a CoW retained, none, and one never logged. */
const REDACTION_PAIRS_SQL = `select f.group_id as a1, m.uid as a2, d.definition as a3
  from perf_fx f cross join perf_members m cross join (
    select se.exercise_definition_id as definition from app_public.session_exercises se join perf_members p on p.uid=se.owner_user_id
    union select r.definition_id from app_public.group_cow_source_refs r join perf_members p on p.uid=r.member_user_id
    union select null union select 'perf-def-unlogged') d`;

/**
 * The internal helpers the readers share, compared old against new as the
 * table owner on the PARITY_DAYS fixture, after PARITY_PLANT_STATEMENTS (see
 * parity.ts, `HelperParityCase`). The redaction cache is checked against the
 * live function it caches, asked once for every pair in one statement.
 */
export const HELPER_PARITY_CASES: readonly HelperParityCase[] = [
  {
    // Patched in place by 20261030064514 (the CoW disclosure); its old CoW branch too.
    name: 'group_competition_redacts_exercise', fn: 'group_competition_redacts_exercise',
    migration: 'parity-definitions/20261030064514_group_cow_readers.sql',
    helpers: { group_cow_redacts_exercise: '20261030064514_group_cow_readers.sql' },
    argumentsSql: REDACTION_PAIRS_SQL, call: '{fn}(array[a1],a2,a3)', minAnswers: 2,
  },
  {
    name: 'group_cow_redacts_exercise', fn: 'group_cow_redacts_exercise', migration: '20261030064514_group_cow_readers.sql',
    argumentsSql: REDACTION_PAIRS_SQL, call: '{fn}(array[a1],a2,a3)', minAnswers: 2,
  },
  {
    name: 'group_competition_redactions',
    argumentsSql: `with pairs as materialized (${REDACTION_PAIRS_SQL}),
      cache as materialized (select * from app_public.group_competition_redactions((select group_id from perf_fx),
        array(select a2 from pairs),array(select a3 from pairs)))
      select p.*,(select c.redacted from cache c where c.member_user_id=p.a2 and c.definition_id is not distinct from p.a3) as a4
      from pairs p`,
    expected: 'app_public.group_competition_redacts_exercise(array[a1],a2,a3)', actual: 'a4', minAnswers: 2,
  },
  {
    // The per-member cache mirrors the live helper's branches: every pair, a
    // null, '' and a never-logged definition included, against the live answer.
    name: 'group_competition_redaction_lookup (cache)',
    argumentsSql: `${WITH_CACHE} select p.*, c.cache as a4 from (${REDACTION_PAIRS_SQL}) p, cache c
      union all select p.a1, p.a2, '' as a3, c.cache from (${REDACTION_PAIRS_SQL}) p, cache c where p.a3 is null`,
    expected: 'app_public.group_competition_redacts_exercise(array[a1],a2,a3)',
    actual: 'app_public.group_competition_redaction_lookup(a4,array[a1],a2,a3)', minAnswers: 2,
  },
  // The readers' item builders against their definitions before the per-call
  // caches (no cache), for every fixture event, record and session; then
  // each with a cache for every fixture member against itself without one:
  // every event, record, withdrawal, session card, CoW item and CoW row set.
  {
    name: 'group_competition_event_json', fn: 'group_competition_event_json', migration: READ_DEFINITIONS,
    argumentsSql: `select e as a1 from app_public.group_events e where e.group_id=(select group_id from perf_fx)`,
    call: '{fn}(a1)', minAnswers: 2,
  },
  {
    name: 'group_competition_stream_record', fn: 'group_competition_stream_record', migration: READ_DEFINITIONS,
    helpers: { group_competition_event_json: READ_DEFINITIONS },
    argumentsSql: `select e as a1 from app_public.group_events e where e.group_id=(select group_id from perf_fx) and e.kind='record'`,
    call: '{fn}(a1)', minAnswers: 2,
  },
  {
    name: 'group_competition_session_card', fn: 'group_competition_session_card', migration: PUBLICATION,
    helpers: { group_competition_session_exercises: READ_DEFINITIONS, group_competition_session_json: READ_DEFINITIONS },
    argumentsSql: SESSION_CARDS_SQL, call: '{fn}(a1,a2,a3)', minAnswers: 2,
  },
  {
    name: 'group_competition_event_json (cache)',
    argumentsSql: `${WITH_CACHE} select e as a1, c.cache as a2 from app_public.group_events e, cache c
      where e.group_id=(select group_id from perf_fx)`,
    expected: 'app_public.group_competition_event_json(a1)', actual: 'app_public.group_competition_event_json(a1,a2)', minAnswers: 2,
  },
  {
    name: 'group_competition_stream_record (cache)',
    argumentsSql: `${WITH_CACHE} select e as a1, c.cache as a2 from app_public.group_events e, cache c
      where e.group_id=(select group_id from perf_fx) and e.kind='record'`,
    expected: 'app_public.group_competition_stream_record(a1)', actual: 'app_public.group_competition_stream_record(a1,a2)', minAnswers: 2,
  },
  {
    name: 'group_competition_stream_withdrawn (cache)',
    argumentsSql: `${WITH_CACHE} select e as a1, c.cache as a2 from app_public.group_events e, cache c
      where e.group_id=(select group_id from perf_fx) and e.kind='record_voided'`,
    expected: 'app_public.group_competition_stream_withdrawn(a1)', actual: 'app_public.group_competition_stream_withdrawn(a1,a2)',
  },
  {
    name: 'group_competition_session_card (cache)',
    argumentsSql: `${WITH_CACHE} select x.*, c.cache as a4 from (${SESSION_CARDS_SQL}) x, cache c`,
    expected: 'app_public.group_competition_session_card(a1,a2,a3)', actual: 'app_public.group_competition_session_card(a1,a2,a3,a4)',
    minAnswers: 2,
  },
  {
    name: 'group_cow_stream_item (cache)',
    argumentsSql: `${WITH_CACHE} select e.id as a1, e.sort_at_ms as a2, c.cache as a3 from app_public.group_events e, cache c
      where e.group_id=(select group_id from perf_fx) and e.kind='cow'`,
    expected: 'app_public.group_cow_stream_item(a1,a2)', actual: 'app_public.group_cow_stream_item(a1,a2,a3)', minAnswers: 2,
  },
  {
    name: 'group_cow_result_rows (cache)',
    argumentsSql: `${WITH_CACHE} select x as a1, m as a2, c.cache as a3 from app_public.group_cows x cross join unnest(x.metrics) m, cache c
      where x.group_id=(select group_id from perf_fx)`,
    expected: `(select coalesce(jsonb_agg(jsonb_build_array(r.ordinal,r.member_id,r.row_json) order by r.member_id),'[]')
      from app_public.group_cow_result_rows(a1,a2) r)`,
    actual: `(select coalesce(jsonb_agg(jsonb_build_array(r.ordinal,r.member_id,r.row_json) order by r.member_id),'[]')
      from app_public.group_cow_result_rows(a1,a2,a3) r)`,
    minAnswers: 2,
  },
  {
    name: 'group_week_session_counts', fn: 'group_week_session_counts', migration: '20261003180000_group_board_raw_weight.sql',
    argumentsSql: `select s.owner_user_id as a1, s.id as a2 from app_public.sessions s join perf_members m on m.uid=s.owner_user_id`,
    call: '(select row(c.*)::text from {fn}(a1,a2) c)',
  },
];

const asMember = (idx: number) => `select set_config('request.jwt.claim.sub',uid::text,true),
  set_config('request.jwt.claims',json_build_object('sub',uid,'role','authenticated')::text,true) from perf_members where idx=${idx}`;

/** One plant's edit, as the last CTE: the statement says whether it edited exactly one row. */
const edited = (update: string) => `, edited as (${update} returning 1)
   select count(*)=1 as planted from edited`;

/** False when a plant statement reports it edited no row, or more than one. */
export const plantedAll = (rows: readonly Record<string, unknown>[]): boolean => rows.every((row) => row.planted !== false);

/**
 * Planted before parity, after every measured call. A cancelled CoW on the
 * bodyweight-aware Pull-up, two weeks back (cancelled, so no worker or
 * reader takes it up), whose retained refs make the CoW
 * disclosure redact through each branch: member 3's ref has an unknown
 * definition (''), member 4's names Bench press while its set is now logged
 * under another definition. The group's latest completed shared session (the
 * viewer's finished workout) is no longer shared, so the week summary's
 * latest completed session must skip it for an older one. Then facts the
 * evaluator has not caught up with, which the counts must still read
 * through: member 4's newest working set is deleted, member 5's newest
 * session loses an exercise, and one of member 4's sets moves to an older
 * session. Last, member 2's newest session with a group record is moved
 * back to start exactly when one of member 3's did: its records now sort at
 * a start their events do not hold, tied with another member's card. Each
 * sync edit runs under its owner's claims, as sync would run it; each plant
 * must edit exactly one row.
 */
export const PARITY_PLANT_STATEMENTS = (): string[] => [
  `with cow as (
     insert into app_public.group_cows(id,group_id,group_exercise_id,week_start,time_zone,starts_at,ends_at,metrics,create_key,
       created_by,available_at,definition_xid,cancelled_at)
     select gen_random_uuid(),f.group_id,ge.id,w.week,'UTC',lower(w.bounds),upper(w.bounds),array['e1rm'],'perf-cow-parity',
       (select uid from perf_members where idx=1),clock_timestamp(),0,clock_timestamp()
     from perf_fx f, perf_group_exercises ge,
       lateral (select app_public.group_cow_week('UTC',now())-14 as week) w0,
       lateral (select w0.week,app_public.group_cow_bounds('UTC',w0.week) as bounds) w
     where ge.ex=5 returning id),
   refs as (
     select m.uid,e.set_id,case m.idx when 3 then '' else 'perf-def-0' end as definition
     from perf_members m cross join lateral (
       select es.id as set_id from app_public.exercise_sets es
         join app_public.session_exercises se on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
        where es.owner_user_id=m.uid and se.exercise_definition_id=case m.idx when 3 then 'perf-def-0' else 'perf-def-1' end
        order by es.id limit 1) e
     where m.idx in (3,4))
   ${edited(`insert into app_public.group_cow_source_refs(cow_id,member_user_id,metric,set_id,definition_id)
     select cow.id,r.uid,'e1rm',r.set_id,r.definition from cow,refs r`).replace('count(*)=1', 'count(*)=2')}`,
  `with target as (
     select sh.group_id,sh.member_user_id,sh.session_id from app_public.group_session_shares sh
       join app_public.group_memberships gm on gm.group_id=sh.group_id and gm.user_id=sh.member_user_id and gm.ended_at is null
       join app_public.sessions s on s.owner_user_id=sh.member_user_id and s.id=sh.session_id
      where sh.group_id=(select group_id from perf_fx) and s.status='completed' and s.deleted_at is null
      order by s.completed_at desc nulls last,s.started_at desc,s.owner_user_id,s.id limit 1)
   ${edited(`delete from app_public.group_session_shares sh using target t
     where sh.group_id=t.group_id and sh.member_user_id=t.member_user_id and sh.session_id=t.session_id`)}`,
  asMember(4),
  `with target as (
     select f.member_user_id,f.set_id from app_public.group_set_facts f join perf_members m on m.uid=f.member_user_id
       join app_public.sessions s on s.owner_user_id=f.member_user_id and s.id=f.session_id
      where m.idx=4 and s.status='completed' and f.performed and f.live and f.working is not false
      order by s.started_at desc,f.set_id limit 1)
   ${edited(`update app_public.exercise_sets es set deleted_at=es.updated_at+1,updated_at=es.updated_at+1,
       client_updated_at_ms=es.client_updated_at_ms+1
     from target t where es.owner_user_id=t.member_user_id and es.id=t.set_id`)}`,
  asMember(5),
  `with target as (
     select se.owner_user_id,se.id from app_public.session_exercises se join perf_members m on m.uid=se.owner_user_id
       join app_public.sessions s on s.owner_user_id=se.owner_user_id and s.id=se.session_id
      where m.idx=5 and s.status='completed' and se.deleted_at is null order by s.started_at desc,se.order_index limit 1)
   ${edited(`update app_public.session_exercises se set deleted_at=se.updated_at+1,updated_at=se.updated_at+1,
       client_updated_at_ms=se.client_updated_at_ms+1
     from target t where se.owner_user_id=t.owner_user_id and se.id=t.id`)}`,
  asMember(4),
  `with ranked as (
     select s.owner_user_id,s.id,row_number() over(order by s.started_at desc) as n from app_public.sessions s
       join perf_members m on m.uid=s.owner_user_id where m.idx=4 and s.status='completed'),
   moved as (
     select f.member_user_id,f.set_id from app_public.group_set_facts f join ranked r on r.owner_user_id=f.member_user_id and r.id=f.session_id
      where r.n=2 and f.performed and f.live and f.working is not false order by f.set_id limit 1),
   into_exercise as (
     select se.id from app_public.session_exercises se join ranked r on r.owner_user_id=se.owner_user_id and r.id=se.session_id
      where r.n=3 and se.deleted_at is null order by se.order_index limit 1)
   ${edited(`update app_public.exercise_sets es set session_exercise_id=(select id from into_exercise),updated_at=es.updated_at+1,
       client_updated_at_ms=es.client_updated_at_ms+1
     from moved t where es.owner_user_id=t.member_user_id and es.id=t.set_id`)}`,
  asMember(2),
  `with target as (
     select s.owner_user_id,s.id,s.started_at from app_public.sessions s join perf_members m on m.uid=s.owner_user_id
      where m.idx=2 and s.status='completed' and exists(select 1 from app_public.group_events e
        where e.group_id=(select group_id from perf_fx) and e.kind='record' and e.member_user_id=s.owner_user_id and e.session_id=s.id)
      order by s.started_at desc limit 1),
   tie as (
     select s.started_at from app_public.sessions s join perf_members m on m.uid=s.owner_user_id, target t
      where m.idx=3 and s.status='completed' and s.started_at<t.started_at order by s.started_at desc limit 1)
   ${edited(`update app_public.sessions s set started_at=(select started_at from tie),updated_at=s.updated_at+1,
       client_updated_at_ms=s.client_updated_at_ms+1
     from target t where s.owner_user_id=t.owner_user_id and s.id=t.id`)}`,
  `select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','',true)`,
];

export const readPathBudgets = (rpcs: readonly ReadPathRpc[] = READ_PATH_RPCS): Record<string, BudgetEntry> =>
  Object.fromEntries(rpcs.map((rpc) => [rpc.fn, rpc.budget]));

const NOTIFICATION_PROJECT = '00000000-0000-4000-8000-00000000b06a';

/**
 * Planted before steady state: local notification delivery for every member
 * (config, an auth session and an opted-in installation each, so the
 * cascade sends and `notification_begin_send` runs), the group calendar, and
 * the bodyweight-redacted member exercise: member 2 also links Biceps curl
 * to the bodyweight-aware Pull-up, so that member's curls are redacted where
 * no other member's are.
 */
export const plantStatements = (): string[] => [
  `delete from app_public.notification_config`,
  `insert into app_public.notification_config(environment,project_id,bundle_id,sending_enabled,provider)
     values('local','${NOTIFICATION_PROJECT}','perf.groups',true,'local')`,
  `insert into auth.sessions(id,user_id,created_at,updated_at) select gen_random_uuid(),uid,now(),now() from perf_members`,
  `insert into app_public.notification_preferences(user_id) select uid from perf_members on conflict do nothing`,
  `insert into app_public.notification_installations(id,capability_hash,user_id,auth_session_id,encryption_key,token,
     environment,project_id,bundle_id,permission,opted_in)
     select gen_random_uuid(),extensions.digest(m.uid::text,'sha256'),m.uid,s.id,encode(extensions.gen_random_bytes(32),'base64'),
       'LocalPushToken[perf'||f.tag||m.idx||']','local','${NOTIFICATION_PROJECT}','perf.groups',true,true
     from perf_members m join auth.sessions s on s.user_id=m.uid, perf_fx f`,
  `update app_public.groups set cow_time_zone='UTC' where id=(select group_id from perf_fx)`,
  `insert into app_public.exercise_group_links(owner_user_id,id,exercise_definition_id,group_id,group_exercise_id,
     created_at,updated_at,client_updated_at_ms)
     select m.uid,f.group_id::text||':perf-def-6','perf-def-6',f.group_id::text,ge.id::text,t.at,t.at,t.at
     from perf_members m, perf_fx f, perf_group_exercises ge, lateral (select f.now_ms-(f.days+30)::bigint*86400000 as at) t
     where m.idx=2 and ge.ex=5`,
];

const OWN_COWS = `select id from app_public.group_cows where group_id=(select group_id from perf_fx)`;

/**
 * Planted after the first steady state (a CoW's start context needs the
 * evaluator's rules version): last week's CoW and this week's on Bench
 * press, as if scheduled a week ahead. Their sources, contexts and
 * admissions are captured now, so they are backdated to when each set was
 * logged (an hour after its session started) and given an earlier
 * transaction id: later captures in this one transaction then treat them as
 * committed history, as production does, instead of rewriting them.
 * The last statement voids a record: member 3's best Bench press set is
 * edited down, so the next apply voids its record.
 */
export const postSteadyPlantStatements = (): string[] => [
  `insert into app_public.group_cows(id,group_id,group_exercise_id,week_start,time_zone,starts_at,ends_at,metrics,create_key,
     created_by,available_at,definition_xid)
     select gen_random_uuid(),f.group_id,ge.id,w.week,'UTC',lower(w.bounds),upper(w.bounds),array['e1rm','improvement','volume'],
       'perf-cow-'||k,(select uid from perf_members where idx=1),clock_timestamp(),0
     from perf_fx f, perf_group_exercises ge, generate_series(0,1) k,
       lateral (select app_public.group_cow_week('UTC',now())-7*k as week) w0,
       lateral (select w0.week,app_public.group_cow_bounds('UTC',w0.week) as bounds) w
     where ge.ex=0`,
  `select pg_temp.perf_flush()`,
  `update app_public.group_cow_sources x set source_xid=1,
     received_at=least(x.received_at,to_timestamp((x.input->>'session_started_at_ms')::bigint/1000.0)+interval '1 hour')
     where x.cow_id in (${OWN_COWS})`,
  `update app_public.group_cow_contexts x set source_xid=1,received_at=c.starts_at-interval '1 day'
     from app_public.group_cows c where c.id=x.cow_id and c.id in (${OWN_COWS})`,
  `update app_public.group_cow_admissions a set joined_xid=1,joined_at=c.starts_at-interval '1 day'
     from app_public.group_cows c where c.id=a.cow_id and c.id in (${OWN_COWS})`,
  // The owner's edit, under the owner's claims as sync would run it.
  `select set_config('request.jwt.claim.sub',uid::text,true),
     set_config('request.jwt.claims',json_build_object('sub',uid,'role','authenticated')::text,true)
     from perf_members where idx=3`,
  `update app_public.exercise_sets es set weight_value=(es.weight_value::numeric-10)::text,
     client_updated_at_ms=es.client_updated_at_ms+1,updated_at=es.updated_at+1
     from (select e.set_id,e.member_user_id from app_public.group_events e join perf_members m on m.uid=e.member_user_id
       join perf_group_exercises ge on ge.id=e.group_exercise_id
       where e.group_id=(select group_id from perf_fx) and e.kind='record' and m.idx=3 and ge.ex=0
       order by e.seq desc limit 1) r
     where es.owner_user_id=r.member_user_id and es.id=r.set_id`,
  `select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','',true)`,
];

/** The start of the rolling weeks parity compares, in the fixture's ms clock. */
const PARITY_WEEKS_START = `f.now_ms-${PERIOD_WINDOWS}::bigint*${WEEK_MS}`;

/**
 * Each planted case, true when the fixture holds it after steady state; the
 * voided record and the redacted exercise fall inside the weeks parity
 * compares, so parity exercises both.
 */
export const PLANT_CHECKS_SQL = `select
  app_public.group_competition_redacts_exercise(array[f.group_id],(select uid from perf_members where idx=2),'perf-def-6')
    and not app_public.group_competition_redacts_exercise(array[f.group_id],(select uid from perf_members where idx=3),'perf-def-6')
    as redacted_member_exercise,
  exists(select 1 from app_public.group_events e
    join app_public.exercise_sets es on es.owner_user_id=e.member_user_id and es.id=e.set_id
    join app_public.session_exercises se on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
    join app_public.sessions s on s.owner_user_id=se.owner_user_id and s.id=se.session_id
    where e.group_id=f.group_id and e.kind='record_voided' and s.started_at>=${PARITY_WEEKS_START}) as voided_record,
  exists(select 1 from app_public.sessions s join app_public.session_exercises se on se.owner_user_id=s.owner_user_id and se.session_id=s.id
    where s.owner_user_id=(select uid from perf_members where idx=2) and se.exercise_definition_id='perf-def-6'
      and s.started_at>=${PARITY_WEEKS_START}) as redacted_in_parity_weeks,
  exists(select 1 from app_public.group_cows c where c.group_id=f.group_id and c.finalized_at is not null and c.final_outcome='ready')
    as finished_cow,
  exists(select 1 from app_public.group_cows c where c.group_id=f.group_id and c.finalized_at is null
    and c.starts_at<=clock_timestamp() and c.published_generation is not null) as live_cow,
  (select count(*) from app_public.notification_installations i join perf_members m on m.uid=i.user_id)=(select count(*) from perf_members)
    as installations
  from perf_fx f`;

export type PlantChecks = Record<string, boolean>;

const CONTEXT_SQL = `select f.group_id, f.now_ms,
  (select array_agg(uid order by idx) from perf_members) as members,
  (select id from perf_group_exercises where ex=0) as bench,
  (select array_agg(id order by ex) from perf_group_exercises) as exercises,
  (with pick as (
      select sh.member_user_id as m, sh.session_id as sid,
        row_number() over (partition by sh.member_user_id order by s.started_at desc) as rn,
        exists(select 1 from app_public.session_exercises se where se.owner_user_id=s.owner_user_id and se.session_id=s.id
          and se.exercise_definition_id='perf-def-6') as pull
      from app_public.group_session_shares sh
        join app_public.sessions s on s.owner_user_id=sh.member_user_id and s.id=sh.session_id and s.deleted_at is null
      where sh.group_id=f.group_id and s.status='completed' and s.id<>'perf-live'),
    chosen as (select * from pick where rn<=2 or (pull and rn=(select min(p2.rn) from pick p2 where p2.m=pick.m and p2.pull)))
    select jsonb_agg(jsonb_build_object('member',m,'sessionId',sid)) from chosen) as sessions,
  (select row(e.member_user_id,e.session_id)::text from app_public.group_events e join perf_members m on m.uid=e.member_user_id
     where e.group_id=f.group_id and e.kind='record' and m.idx=2 and e.session_id is not null
     order by e.seq desc limit 1) as session,
  (select uid from perf_members where idx=1) as viewer,
  (select s.id from auth.sessions s join perf_members m on m.uid=s.user_id where m.idx=1) as viewer_session,
  (select coalesce(json_agg(json_build_object('id',c.id,'metrics',c.metrics) order by c.created_at,c.id),'[]')
     from app_public.group_cows c where c.group_id=f.group_id) as cows
  from perf_fx f`;

const readContext = async (session: Tier1Session): Promise<ReadPathContext> => {
  const [row] = await session.exec<{
    group_id: string; now_ms: string; members: string[]; bench: string; exercises: string[];
    sessions: ReadPathContext['sessions'] | null; session: string; viewer: string; viewer_session: string;
    cows: { id: string; metrics: string[] }[];
  }>(CONTEXT_SQL);
  const [member, sessionId] = row.session.replace(/^\(|\)$/g, '').split(',');
  const now = Number(row.now_ms);
  return {
    groupId: row.group_id, viewer: row.viewer, viewerSession: row.viewer_session, members: row.members, bench: row.bench,
    exercises: row.exercises, sessions: row.sessions ?? [],
    session: { member, sessionId },
    cows: row.cows,
    completion: null,
    notification: null,
    weeks: Array.from({ length: PERIOD_WINDOWS }, (_, index) => {
      const end = now - (PERIOD_WINDOWS - 1 - index) * WEEK_MS;
      return { start_ms: end - WEEK_MS, end_ms: end };
    }),
  };
};

export type ReadPathPoint = {
  name: string;
  members: number;
  historyDays: number;
  fixture: { members: number; sessions: number; sets: number };
  plants: PlantChecks;
  /** Every measured call, by RPC. */
  calls: Record<string, CallRecord[]>;
  /** The message of each measured call that failed, by RPC. */
  errors: Record<string, string>;
  /** What the workout's cascades ran: Edge runs and notification outcomes. */
  cascade: { edgeRuns: { groupEval: number; notificationWorker: number }; notificationOutcomes: Record<string, number> } | null;
  /** WAL bytes of one logged set and every Edge run it starts (headline a). */
  walPerLoggedSet: number | null;
  parity: ParityOutcome[];
  incomplete: string | null;
  setupMs: number;
};

const costOf = (counters: Counters) => ({ pages: counters.pages, tempBytes: counters.tempBytes, seqScans: scans(counters).seq });

/** One RPC's cost at one point: its costliest call, or why it has none. */
export const pointCost = (historyDays: number, records: readonly CallRecord[] | undefined): PointCost => {
  const calls = records ?? [];
  const failed = calls.find((call) => call.error !== null);
  if (failed) return { historyDays, calls: calls.length, pages: 0, tempBytes: 0, seqScans: 0, error: failed.error };
  if (calls.length === 0) return { historyDays, calls: 0, pages: 0, tempBytes: 0, seqScans: 0, error: 'not called' };
  const costs = calls.map((call) => costOf(call.counters));
  const worst = costs.reduce((a, b) => (b.pages > a.pages ? b : a));
  return { historyDays, calls: calls.length, ...worst, error: null };
};

const groupByFn = (records: readonly CallRecord[]): Record<string, CallRecord[]> => {
  const out: Record<string, CallRecord[]> = {};
  for (const record of records) (out[record.fn] ??= []).push(record);
  return out;
};

/** One helper case, in a savepoint: a failed case cannot abort the ones after it. */
const runHelperParity = async (session: Tier1Session, item: HelperParityCase): Promise<ParityOutcome> => {
  await session.exec('savepoint helper_parity');
  try {
    const { sql, compare } = helperParityStatements(item);
    for (const statement of sql) await session.exec(statement);
    const [row] = await session.exec<{ compared: number; answers: number; differences: string[] }>(compare);
    await session.exec('release savepoint helper_parity');
    const varied = row.answers >= (item.minAnswers ?? 1)
      ? null : `${row.answers} distinct answers, fewer than the ${item.minAnswers} the case needs`;
    return { fn: item.name, compared: row.compared, differences: row.differences, plantDetected: null, error: varied };
  } catch (error) {
    await session.exec('rollback to savepoint helper_parity');
    return { fn: item.name, compared: 0, differences: [], plantDetected: null, error: (error as Error).message };
  }
};

/** One parity call: the RPC as its caller runs it, and for an RPC that writes, what it changed. */
const callParity = async (
  session: Tier1Session, item: ParityCase<ReadPathContext>, context: ReadPathContext, viewer: string, fn: string, args: Record<string, unknown>,
): Promise<unknown> => {
  const caller = item.caller?.(viewer, context) ?? { role: 'authenticated' as const, userId: viewer };
  if (!item.caller && !item.state) return session.call(caller, fn, args, false);
  // A failure is a result too: old and new must refuse the same calls the same way.
  const settle = () => session.call(caller, fn, args, false).then(
    (result) => ({ result }),
    (error: RpcFailure) => ({ error: `${error.sqlstate ?? ''} ${error.message.replace(/^\S+: /, '')}` }),
  );
  if (!item.state) return settle();
  await session.exec('savepoint parity_call');
  try {
    const outcome = await settle();
    const [row] = await session.exec<{ state: unknown }>(item.state);
    return { ...outcome, state: row.state };
  } finally {
    await session.exec('rollback to savepoint parity_call');
    await session.exec('release savepoint parity_call');
  }
};

/**
 * The notification cases call with confirmed workouts and leased deliveries:
 * every eligible workout is confirmed as its owner, as the app does after a
 * quiet sync, then the fixture is read for the cases' arguments.
 */
const prepareNotificationParity = async (session: Tier1Session): Promise<NotificationFixture> => {
  const workouts = await session.exec<{ member: string; session: string; auth: string; manifest: unknown }>(
    `select w.member_user_id as member,w.session_id as session,
       (select s.id from auth.sessions s where s.user_id=w.member_user_id order by s.created_at limit 1) as auth,
       app_public.notification_source_manifest(w.member_user_id,w.session_id) as manifest
     from app_public.notification_workouts w where w.eligible order by w.member_user_id,w.session_id`);
  for (const workout of workouts) {
    await session.call({ role: 'authenticated', userId: workout.member, sessionId: workout.auth }, 'notification_confirm_completion',
      { p_session_id: workout.session, p_entities: workout.manifest }, false).catch(() => undefined);
  }
  await session.exec(LEASE_DELIVERIES_SQL);
  const [row] = await session.exec<{ fixture: NotificationFixture }>(NOTIFICATION_FIXTURE_SQL);
  return row.fixture;
};

/** A helper several cases share is installed once, whichever way each case spells its `create`. */
const replacing = (sql: string): string => sql.replace(/^create function pg_temp\./, 'create or replace function pg_temp.');

const runCaseParity = async (
  session: Tier1Session, context: ReadPathContext, cases: readonly ParityCase<ReadPathContext>[],
): Promise<ParityOutcome[]> => {
  const outcomes = new Map<string, ParityOutcome>();
  const installedSql = new Set<string>();
  const installs = new Map<ParityCase<ReadPathContext>, ReturnType<typeof parityInstallStatements>>();
  const fail = (item: ParityCase<ReadPathContext>, error: unknown) => {
    outcomes.set(item.fn, { fn: item.fn, compared: 0, differences: [], plantDetected: null, error: (error as Error).message });
  };
  for (const item of cases) {
    try {
      const installed = parityInstallStatements(item);
      // A helper several cases share is installed once.
      for (const statement of installed.sql.map(replacing).filter((sql) => !installedSql.has(sql))) {
        await session.exec('savepoint parity_install');
        try {
          await session.exec(statement);
        } catch (error) {
          await session.exec('rollback to savepoint parity_install');
          throw error;
        } finally {
          await session.exec('release savepoint parity_install').catch(() => undefined);
        }
        installedSql.add(statement);
      }
      installs.set(item, installed);
    } catch (error) {
      fail(item, error);
    }
  }
  try {
    context.notification = await prepareNotificationParity(session);
  } catch (error) {
    for (const item of cases.filter((candidate) => candidate.scenarios)) fail(item, error);
  }
  for (const scenario of SCENARIOS) {
    await session.exec('savepoint parity_scenario');
    try {
      if (scenario !== 'base' && context.notification) {
        for (const statement of scenarioStatements(scenario, context.notification)) await session.exec(statement);
      }
      for (const item of cases.filter((candidate) => (candidate.scenarios ?? ['base']).includes(scenario))) {
        const installed = installs.get(item);
        if (!installed || outcomes.get(item.fn)?.error) continue;
        try {
          const outcome = await compareParity(item, context, context.members,
            (viewer, fn, args) => callParity(session, item, context, viewer, fn, args), installed);
          const merged = outcomes.get(item.fn) ?? { ...outcome, compared: 0, differences: [], observed: undefined };
          merged.compared += outcome.compared;
          merged.differences.push(...outcome.differences.map((difference) => `[${scenario}] ${difference}`));
          merged.plantDetected = outcome.plantDetected === null ? merged.plantDetected : outcome.plantDetected;
          for (const [label, count] of Object.entries(outcome.observed ?? {})) {
            merged.observed = { ...merged.observed, [label]: (merged.observed?.[label] ?? 0) + count };
          }
          merged.missing = missingOutcomes(item.requires, merged.observed);
          outcomes.set(item.fn, merged);
        } catch (error) {
          fail(item, error);
        }
      }
    } finally {
      await session.exec('rollback to savepoint parity_scenario');
      await session.exec('release savepoint parity_scenario');
    }
  }
  return cases.map((item) => outcomes.get(item.fn)).filter((outcome): outcome is ParityOutcome => outcome !== undefined);
};

const runParityCases = async (session: Tier1Session, context: ReadPathContext): Promise<ParityOutcome[]> => {
  // The notification cases first: the stale-fact plants below edit sessions their proofs read.
  const outcomes: ParityOutcome[] = await runCaseParity(session, context, PARITY_CASES.filter((item) => item.scenarios));
  try {
    for (const statement of PARITY_PLANT_STATEMENTS()) {
      if (!plantedAll(await session.exec(statement))) throw new Error(`a stale-fact plant edited no row: ${statement.slice(0, 80)}`);
    }
  } catch (error) {
    return [{ fn: 'parity plants', compared: 0, differences: [], plantDetected: null, error: (error as Error).message }];
  }
  for (const item of HELPER_PARITY_CASES) outcomes.push(await runHelperParity(session, item));
  outcomes.push(...await runCaseParity(session, context, PARITY_CASES.filter((item) => !item.scenarios)));
  return outcomes;
};

const drain = async (run: Tier1Run, session: Tier1Session, label: string): Promise<string | null> => {
  const steady = await steadyState(run, session);
  if (steady.failures.length > 0 || steady.leftoverJobs > 0) {
    return `${label}: ${steady.failures.length} failed jobs, ${steady.leftoverJobs} left${steady.failures[0] ? ` (${steady.failures[0]})` : ''}`;
  }
  return null;
};

type Viewer = { role: 'authenticated'; userId: string; sessionId: string };
type RecordFailure = (fn: string) => (error: Error) => void;

/**
 * The fixture, its planted cases and steady state; the context to measure, or
 * null when the point is incomplete. With `publishParity`, every publication
 * from here on runs the old and new definitions side by side.
 */
const buildPoint = async (
  session: Tier1Session, run: Tier1Run, point: ReadPathPoint, publishParity: PublishParity | null,
): Promise<ReadPathContext | null> => {
  await session.begin();
  await configureHosted(session);
  if (publishParity) {
    for (const statement of publishParity.installStatements()) await session.exec(statement);
    run.serviceWrapper = (rpc, unmeasured) => publishParity.wrap(rpc, unmeasured);
  }
  const spec = { members: READ_PATH_MEMBERS, historyDays: point.historyDays, tag: `r${point.historyDays}` };
  for (const statement of [...fixtureStatements(spec), ...plantStatements()]) await session.exec(statement);
  // The fixture's deferred constraint checks fire here, planned on fresh
  // statistics and outside any call's budget: left to the first call, they
  // ran on the plans of an emptied database and could outrun it.
  await analyzeAppTables(session);
  await session.exec('select pg_temp.perf_flush()');
  [point.fixture] = await session.exec<ReadPathPoint['fixture']>(FIXTURE_COUNTS_SQL);
  point.incomplete = await drain(run, session, 'steady state');
  if (point.incomplete) return null;
  for (const statement of postSteadyPlantStatements()) await session.exec(statement);
  point.incomplete = await drain(run, session, 'steady state after the planted cases');
  if (point.incomplete) return null;
  [point.plants] = await session.exec<PlantChecks>(PLANT_CHECKS_SQL);
  const missing = Object.entries(point.plants).filter(([, held]) => !held).map(([plant]) => plant);
  if (missing.length > 0) {
    point.incomplete = `planted cases missing: ${missing.join(', ')}`;
    return null;
  }
  await analyzeAppTables(session);
  return readContext(session);
};

const sumCascades = (steps: readonly StepResult[]): NonNullable<ReadPathPoint['cascade']> => ({
  edgeRuns: {
    groupEval: steps.reduce((sum, step) => sum + step.edgeRuns.groupEval, 0),
    notificationWorker: steps.reduce((sum, step) => sum + step.edgeRuns.notificationWorker, 0),
  },
  notificationOutcomes: steps.reduce<Record<string, number>>((sum, step) => {
    for (const [outcome, count] of Object.entries(step.notificationOutcomes)) sum[outcome] = (sum[outcome] ?? 0) + count;
    return sum;
  }, {}),
});

/**
 * The viewer's workout as the app syncs it: its start, a logged set, its
 * finish and the confirmation of its graph, each with every Edge run its
 * kicks start and every kick those start. The write RPCs are measured inside
 * these cascades (the finish push itself is not); a workout's start and its
 * confirmation are what run the notification worker.
 */
const measureWorkout = async (
  session: Tier1Session, run: Tier1Run, context: ReadPathContext, viewer: Viewer, recordFailure: RecordFailure,
): Promise<StepResult[]> => {
  await run.markKicks();
  let clock = Number((await session.exec<{ now_ms: string }>('select now_ms from perf_fx'))[0].now_ms);
  const lifter = run.rpc(viewer, true);
  // Started ten minutes ago; the finish push repeats that start.
  const startedAt = clock - 600000;
  const live = (status: 'active' | 'completed') => {
    const entity = pushEntities.session('perf-live', startedAt, (clock += 1));
    return status === 'active' ? entity : { ...entity, fields: { ...entity.fields, status, completed_at: clock, duration_sec: 600 } };
  };
  const started = await run.step('workout_start', true, () => lifter('sync_push', { entities: [
    live('active'),
    pushEntities.block('perf-live-b0', 'perf-live', 0, 0, 'Bench press', (clock += 1)),
    pushEntities.set('perf-live-b0-x0', 'perf-live-b0', 0, '50', '8', (clock += 1)),
  ] }));
  const logged = await run.step('logged_set', true, () => lifter(
    'sync_push', { entities: [pushEntities.set('perf-live-b0-x1', 'perf-live-b0', 1, '82.5', '5', (clock += 1))] }));
  await run.step('workout_finish', false, () => lifter('sync_push', { entities: [live('completed')] }));
  // After a quiet sync the app confirms the finished workout's graph, exactly as the server holds it.
  const [graph] = await session.exec<{ entities: unknown }>(
    `select app_public.notification_source_manifest($1,'perf-live') as entities`, [context.viewer]);
  context.completion = { sessionId: 'perf-live', entities: graph.entities };
  const confirm = READ_PATH_RPCS.find((item) => item.fn === 'notification_confirm_completion')!;
  const confirmed = await run.step('workout_confirmed', true,
    () => lifter(confirm.fn, confirm.args!(context)).catch(recordFailure(confirm.fn)));
  return [started, logged, confirmed];
};

/** A point's connection and run, opened after a full vacuum, and its empty record. */
const openPoint = async (historyDays: number, options: Tier1Options) => {
  // Compact first: strict per-call budgets need the same pages run after run.
  await vacuum(options.adminDbUrl, true);
  const client = new Client({ connectionString: options.dbUrl });
  await client.connect();
  const session = new Tier1Session(client, options.callBudgetMs);
  const point: ReadPathPoint = {
    name: `read-m${READ_PATH_MEMBERS}-h${historyDays}d`, members: READ_PATH_MEMBERS, historyDays,
    fixture: { members: 0, sessions: 0, sets: 0 }, plants: {}, calls: {},
    errors: {}, cascade: null, walPerLoggedSet: null, parity: [], incomplete: null, setupMs: 0,
  };
  return { client, session, run: new Tier1Run(session), point };
};

export const runReadPathPoint = async (historyDays: number, options: Tier1Options & { parity: boolean }): Promise<ReadPathPoint> => {
  const startedAt = Date.now();
  const { client, session, run, point } = await openPoint(historyDays, options);
  const { name } = point;
  const recordFailure: RecordFailure = (fn) => (error) => {
    point.errors[fn] = error.message;
  };
  try {
    const context = await buildPoint(session, run, point, null);
    if (!context) return point;
    options.log(`[${name}] steady state after ${Math.round((Date.now() - startedAt) / 1000)} s: ${point.fixture.sets} sets`);
    // Reads first, against the steady state the planted cases left.
    const viewer: Viewer = { role: 'authenticated', userId: context.viewer, sessionId: context.viewerSession };
    for (const rpc of READ_PATH_RPCS.filter((item) => item.via === 'member' && item.fn !== 'notification_confirm_completion')) {
      await session.call(viewer, rpc.fn, rpc.args!(context), true).catch(recordFailure(rpc.fn));
    }
    const reads = session.take();
    const steps = await measureWorkout(session, run, context, viewer, recordFailure);
    // Parity last, so its many unmeasured calls cannot touch a measured one.
    if (options.parity) point.parity = await runParityCases(session, context);
    point.walPerLoggedSet = steps[1].total.walBytes;
    point.cascade = sumCascades(steps);
    const measuredFns = new Set(READ_PATH_RPCS.map((rpc) => rpc.fn));
    point.calls = Object.fromEntries(Object.entries(groupByFn([...reads, ...steps.flatMap((step) => step.calls)]))
      .filter(([fn]) => measuredFns.has(fn)));
    const failures = steps.flatMap((step) => step.failures.map((failure) => `${step.label}: ${failure}`));
    if (failures.length > 0) point.incomplete = failures.join('; ');
    return point;
  } finally {
    point.setupMs = Date.now() - startedAt;
    await session.rollback().catch(() => undefined);
    await client.end();
  }
};

/**
 * Publish parity, on a build of the point of its own that nothing measures:
 * every publication of its steady state and of the owner's workout runs the
 * old and new definitions side by side. The old runs are rolled back, but
 * the rows they wrote stay behind as dead rows the transaction cannot vacuum,
 * so a measured call on the same build would pay for them.
 */
export const runPublishParity = async (historyDays: number, options: Tier1Options): Promise<ParityOutcome> => {
  const startedAt = Date.now();
  const { client, session, run, point } = await openPoint(historyDays, options);
  const parity = new PublishParity(session);
  try {
    const context = await buildPoint(session, run, point, parity);
    if (context) {
      const viewer: Viewer = { role: 'authenticated', userId: context.viewer, sessionId: context.viewerSession };
      const steps = await measureWorkout(session, run, context, viewer, () => () => undefined);
      const failures = steps.flatMap((step) => step.failures.map((failure) => `${step.label}: ${failure}`));
      if (failures.length > 0) point.incomplete = failures.join('; ');
    }
    if (point.incomplete) parity.outcome.error ??= `publish parity point incomplete: ${point.incomplete}`;
    options.log(`[${point.name} publish parity] ${parity.outcome.compared} publications compared in ${Math.round((Date.now() - startedAt) / 1000)} s`);
    return parity.outcome;
  } catch (failure) {
    parity.outcome.error ??= (failure as Error).message;
    return parity.outcome;
  } finally {
    await session.rollback().catch(() => undefined);
    await client.end();
  }
};

export type ReadPathResult = {
  points: ReadPathPoint[];
  costs: Record<string, PointCost[]>;
  checks: BudgetCheck[];
  failures: string[];
  markdown: string;
};

/** The verdict over every point: budget checks, parity, planted cases and completeness. */
export const summarizeReadPath = (points: readonly ReadPathPoint[], rpcs: readonly ReadPathRpc[] = READ_PATH_RPCS): ReadPathResult => {
  const costs: Record<string, PointCost[]> = Object.fromEntries(rpcs.map((rpc) => [rpc.fn,
    points.map((point) => (point.incomplete ? { ...pointCost(point.historyDays, []), error: `incomplete: ${point.incomplete}` }
      : pointCost(point.historyDays, point.calls[rpc.fn])))]));
  const checks = checkBudgets(readPathBudgets(rpcs), costs);
  const parity = points.flatMap((point) => point.parity);
  const failures = [
    ...points.filter((point) => point.incomplete).map((point) => `${point.name}: ${point.incomplete}`),
    ...checks.filter((check) => check.level === 'fail').map((check) => `${check.fn}: ${check.message}`),
    ...parity.filter((outcome) => !parityPassed(outcome)).map((outcome) => `parity ${outcome.fn}: ${outcome.error
      ?? (outcome.compared === 0 ? 'nothing compared' : outcome.differences[0]
      ?? (outcome.missing?.length ? `no call returned ${outcome.missing.join(', ')}` : 'the planted difference was not detected'))}`),
  ];
  if (!points.some((point) => point.parity.length > 0)) failures.push('parity: no case ran');
  const parityLines = parity.map((outcome) => `- ${parityPassed(outcome) ? 'PASS' : 'FAIL'} parity ${outcome.fn}: ${outcome.compared} calls compared, `
    + `${outcome.differences.length} differences, ${outcome.plantDetected === null ? 'no plant' : `planted difference ${outcome.plantDetected ? 'detected' : 'NOT detected'}`}`
    + `${outcome.observed ? `, outcomes ${JSON.stringify(outcome.observed)}` : ''}`);
  const wal = points.map((point) => `H=${point.historyDays}: ${point.walPerLoggedSet ?? '—'} B`).join(', ');
  const cascades = points.map((point) => `- H=${point.historyDays} workout cascades: ${point.cascade?.edgeRuns.groupEval ?? 0} group-eval runs, `
    + `${point.cascade?.edgeRuns.notificationWorker ?? 0} notification-worker runs, outcomes ${JSON.stringify(point.cascade?.notificationOutcomes ?? {})}`
    + `${Object.keys(point.errors).length > 0 ? `; failed calls: ${Object.entries(point.errors).map(([fn, message]) => `${fn}: ${message}`).join('; ')}` : ''}`);
  const markdown = `${readPathMarkdown(readPathBudgets(rpcs), costs, points.map((point) => point.historyDays), checks)}\n`
    + `WAL per logged set (headline a, M=${READ_PATH_MEMBERS}): ${wal}.\n\n${cascades.join('\n')}\n\n${parityLines.join('\n')}\n`;
  return { points: [...points], costs, checks, failures, markdown };
};

export const runReadPath = async (options: Tier1Options): Promise<ReadPathResult> => {
  const points: ReadPathPoint[] = [];
  for (const days of READ_PATH_DAYS) points.push(await runReadPathPoint(days, { ...options, parity: days === PARITY_DAYS }));
  // Last, so its leftovers are vacuumed before anything is measured again.
  const parityPoint = points.find((point) => point.historyDays === PARITY_DAYS && !point.incomplete);
  if (parityPoint) parityPoint.parity.push(await runPublishParity(PARITY_DAYS, options));
  return summarizeReadPath(points);
};
