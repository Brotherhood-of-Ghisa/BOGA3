// Publish parity: a rewritten comparison publisher must write exactly what
// the definition it replaces wrote. The read path's parity point runs every
// publication the fixture holds (both steady-state drains and the measured
// workout's cascades) twice from the same state: the old definition,
// installed verbatim in pg_temp with the old helpers it calls, inside a
// savepoint that is then rolled back, and the live one. Each run's return
// value, the group's published rows and queue state, and its row writes per
// table are compared. Old and new run in one transaction, so new rows differ
// only in generated identifiers; those are compared by position.

import type { Rpc } from './group-eval-mirror.ts';
import { jsonDifference, parityInstallStatements, type ParityOutcome } from './parity.ts';

/** A write RPC's parity case: the definition it replaces, the old helpers it calls, and an optional planted change. */
export type PublishParityCase = {
  fn: string;
  migration: string;
  helpers?: Record<string, string>;
  /** One text replacement in the old definition that must change what it writes. */
  plant?: { from: string; to: string };
};

/**
 * The comparison publisher before its source graph was driven from its
 * reach. The outer publisher is verbatim in its migration; the inner one was
 * patched in place, so its live text is saved under parity-definitions.
 */
export const PUBLISH_PARITY_CASE: PublishParityCase = {
  fn: 'group_metric_eval_publish',
  migration: '20261023091259_group_metric_graph_referenced_sets.sql',
  helpers: {
    group_metric_eval_source_graph: '20261023091259_group_metric_graph_referenced_sets.sql',
    group_metric_eval_publish_without_notifications: 'parity-definitions/20261023091259_group_metric_graph_referenced_sets.sql',
  },
  // Every call returns the inner publisher's result; the plant adds a field to it.
  plant: { from: '  return result;', to: "  return result||jsonb_build_object('planted',true);" },
};

/**
 * What a publication writes for the fixture's group, as one JSON value:
 * scores, board entries and state, stream events (ids and sequence numbers
 * replaced by stream position, related events by theirs), certifications,
 * exercises and rule revisions, the comparison queue (without its identity
 * column), notification targets, publications and workouts, and bodyweight
 * bindings. `event_ids` maps each event id to its position, so ids carried
 * inside payloads can be compared by position too (`canonicalSnapshot`).
 */
export const PUBLISH_SNAPSHOT_SQL = `with fx as (select group_id from perf_fx),
  members as (select gm.user_id from app_public.group_memberships gm, fx where gm.group_id=fx.group_id),
  exercises as (select ge.id from app_public.group_exercises ge, fx where ge.group_id=fx.group_id),
  ev as (select e.*, row_number() over (order by e.seq) as position from app_public.group_events e, fx where e.group_id=fx.group_id)
select jsonb_build_object(
  'scores', (select coalesce(jsonb_agg(to_jsonb(s)-'write_token' order by s.group_exercise_id,s.rules_revision,s.member_user_id,s.set_id,s.metric),'[]')
    from app_public.group_metric_set_scores s, fx where s.group_id=fx.group_id),
  'entries', (select coalesce(jsonb_agg(to_jsonb(e) order by e.group_exercise_id,e.rules_revision,e.member_user_id,e.metric,e.certified),'[]')
    from app_public.group_metric_board_entries e, fx where e.group_id=fx.group_id),
  'board_state', (select coalesce(jsonb_agg(to_jsonb(b) order by b.group_exercise_id,b.rules_revision,b.member_user_id),'[]')
    from app_public.group_metric_board_state b, fx where b.group_id=fx.group_id),
  'events', (select coalesce(jsonb_agg((to_jsonb(e)-'id'-'seq'-'related_event_id'-'position')
      || jsonb_build_object('position',e.position,'related',(select r.position from ev r where r.id=e.related_event_id)) order by e.position),'[]')
    from ev e),
  'event_ids', (select coalesce(jsonb_object_agg(e.id,e.position),'{}') from ev e),
  'certifications', (select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]')
    from app_public.group_metric_certifications c, fx where c.group_id=fx.group_id),
  'exercises', (select coalesce(jsonb_agg(to_jsonb(ge) order by ge.id),'[]') from app_public.group_exercises ge join exercises x using (id)),
  'revisions', (select coalesce(jsonb_agg(to_jsonb(r) order by r.group_exercise_id,r.revision),'[]')
    from app_public.group_rule_revisions r join exercises x on x.id=r.group_exercise_id),
  'queue', (select coalesce(jsonb_agg(to_jsonb(q)-'id' order by q.group_exercise_id),'[]')
    from app_public.group_metric_eval_queue q, fx where q.group_id=fx.group_id),
  'targets', (select coalesce(jsonb_agg(to_jsonb(t) order by t.member_user_id,t.session_id,t.group_exercise_id),'[]')
    from app_public.notification_workout_targets t, fx where t.group_id=fx.group_id),
  'publications', (select coalesce(jsonb_agg(to_jsonb(p) order by p.group_exercise_id),'[]')
    from app_public.notification_comparison_publications p join exercises x on x.id=p.group_exercise_id),
  'workouts', (select coalesce(jsonb_agg(to_jsonb(w) order by w.member_user_id,w.session_id),'[]')
    from app_public.notification_workouts w join members m on m.user_id=w.member_user_id),
  'bindings', (select coalesce(jsonb_agg(to_jsonb(b) order by b.member_user_id,b.set_id),'[]')
    from app_public.group_set_body_weight_bindings b join members m on m.user_id=b.member_user_id)
) as snapshot`;

/** Row writes per table so far in this transaction; a run's writes are the difference around it. */
export const TABLE_WRITES_SQL = `select coalesce(jsonb_object_agg(schemaname||'.'||relname,
    jsonb_build_array(n_tup_ins,n_tup_upd,n_tup_del)),'{}') as writes
  from pg_stat_xact_user_tables where schemaname in ('app_public','public')`;

type Writes = Record<string, [number, number, number]>;

/** Each table's inserts, updates and deletes between two readings; tables with none are left out. */
export const writesBetween = (before: Writes, after: Writes): Writes => {
  const out: Writes = {};
  for (const [table, counts] of Object.entries(after)) {
    const prior = before[table] ?? [0, 0, 0];
    const delta = counts.map((value, index) => value - prior[index]) as [number, number, number];
    if (delta.some((value) => value !== 0)) out[table] = delta;
  }
  return out;
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * Arrays the database orders by a value that embeds a generated event id
 * (notification best evidence is ordered by `<event id>:<fingerprint>`): once
 * ids are positions, their order is compared as a set.
 */
const ORDERED_BY_EVENT_ID = new Set(['best_evidence']);

const replaceIds = (value: unknown, ids: Readonly<Record<string, number>>, key = ''): unknown => {
  if (typeof value === 'string') return value.replace(UUID, (id) => (id in ids ? `#event:${ids[id]}` : id));
  if (Array.isArray(value)) {
    const items = value.map((item) => replaceIds(item, ids));
    return ORDERED_BY_EVENT_ID.has(key) ? items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : items;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, item]) => [name, replaceIds(item, ids, name)]));
  }
  return value;
};

/**
 * A snapshot without its id map: every event id anywhere in it, inside
 * strings too, replaced by that event's stream position.
 */
export const canonicalSnapshot = (snapshot: Record<string, unknown>): unknown => {
  const { event_ids: ids, ...rest } = snapshot as { event_ids?: Record<string, number> };
  return replaceIds(rest, ids ?? {});
};

export type PublishRun = { result: unknown; error: string | null; state: unknown; writes: Writes };

/** The first difference between two runs of the same publication, or null. */
export const publishRunDifference = (old: PublishRun, live: PublishRun): string | null => {
  if (old.error !== live.error) return `error: ${old.error ?? 'none'} ≠ ${live.error ?? 'none'}`;
  return jsonDifference(old.result, live.result)?.replace(/^\$/, 'result')
    ?? jsonDifference(old.writes, live.writes)?.replace(/^\$/, 'writes')
    ?? jsonDifference(old.state, live.state)?.replace(/^\$/, 'state')
    ?? null;
};

/** What the wrapper needs from the session: plain statements outside any measurement. */
export type ParitySession = { exec: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]> };

/**
 * Runs every call of the case's RPC through the old definition, the planted
 * one until its difference is seen, then the live one, each from the same
 * state, and records the differences. The live run's result and error are
 * what the caller sees; the others leave nothing behind.
 */
export class PublishParity {
  readonly outcome: ParityOutcome;
  private readonly installed: { legacy: string; planted: string | null; sql: string[] };
  private calls = 0;

  constructor(private readonly session: ParitySession, private readonly item: PublishParityCase = PUBLISH_PARITY_CASE) {
    this.installed = parityInstallStatements({ ...item, argumentSets: () => [] });
    this.outcome = { fn: item.fn, compared: 0, differences: [], plantDetected: item.plant ? false : null, error: null };
  }

  /** The statements that install the old (and planted) definitions in this session's pg_temp. */
  installStatements(): string[] {
    return this.installed.sql;
  }

  private async run(rpc: Rpc, fn: string, args: Record<string, unknown>): Promise<PublishRun & { thrown: unknown }> {
    const [before] = await this.session.exec<{ writes: Writes }>(TABLE_WRITES_SQL);
    let result: unknown = null;
    let error: string | null = null;
    let thrown: unknown = null;
    try {
      result = await rpc(fn, args);
    } catch (failure) {
      thrown = failure;
      // The SQLSTATE and message, without the function name the session prefixes.
      error = `${(failure as { sqlstate?: string }).sqlstate ?? ''} ${(failure as Error).message.replace(/^[^:]*: /, '')}`;
    }
    const [after] = await this.session.exec<{ writes: Writes }>(TABLE_WRITES_SQL);
    const [{ snapshot }] = await this.session.exec<{ snapshot: Record<string, unknown> }>(PUBLISH_SNAPSHOT_SQL);
    return { result, error, thrown, state: canonicalSnapshot(snapshot), writes: writesBetween(before.writes, after.writes) };
  }

  /** `rpc` makes the call the worker makes (measured or not); `unmeasured` runs the old and planted definitions. */
  wrap(rpc: Rpc, unmeasured: Rpc): Rpc {
    return async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
      if (name !== this.item.fn) return rpc<T>(name, args);
      const savepoint = `perf_publish_parity_${(this.calls += 1)}`;
      await this.session.exec(`savepoint ${savepoint}`);
      const old = await this.run(unmeasured, `pg_temp.${this.installed.legacy}`, args);
      await this.session.exec(`rollback to savepoint ${savepoint}`);
      let planted: PublishRun | null = null;
      if (this.installed.planted && !this.outcome.plantDetected) {
        planted = await this.run(unmeasured, `pg_temp.${this.installed.planted}`, args);
        await this.session.exec(`rollback to savepoint ${savepoint}`);
      }
      const live = await this.run(rpc, name, args);
      await this.session.exec(`release savepoint ${savepoint}`);
      this.outcome.compared += 1;
      const found = publishRunDifference(old, live);
      if (found) this.outcome.differences.push(`call #${this.calls} (job ${String(args.p_job_id)}): ${found}`);
      // The plant must change what the old definition writes, whatever the live one does.
      if (planted && publishRunDifference(old, planted) !== null) this.outcome.plantDetected = true;
      if (live.thrown) throw live.thrown;
      return live.result as T;
    };
  }
}
