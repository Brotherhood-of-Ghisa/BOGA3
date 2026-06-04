/**
 * Launch outcome — the previous-generation sync SERVER objects are gone, not
 * coexisting with the current design.
 *
 * The old ingest/projection server stack exposed a family of RPC functions
 * (`sync_apply_projection_event`, `sync_events_ingest`) and carried server-side
 * ingest-state tables (`sync_device_ingest_state`, `sync_ingested_events`). The
 * current design drops them wholesale. This suite proves they are absent against
 * the REAL Postgres + PostgREST + RLS endpoint — behaviourally, not by grepping
 * migration text (the old CREATE statements still live in superseded migration
 * files): it calls each retired RPC over PostgREST and queries each retired
 * table, asserting the server reports the function / relation does not exist,
 * then confirms the CURRENT sync RPC still resolves, so the absence check cannot
 * pass vacuously by everything erroring.
 *
 * The endpoint URL and anon key are read from the environment
 * (`SUPABASE_BRANCH_URL` / `SUPABASE_BRANCH_ANON_KEY`); the shared live-branch
 * helper FAILS HARD when either is unset, so this suite never passes without
 * actually exercising the endpoint.
 */

import {
  createAuthedBranchClient,
  readLiveBranchConfig,
  SYNC_RPC_SCHEMA,
  type AuthedBranchClient,
} from './helpers/live-branch';

const config = readLiveBranchConfig();

/** PostgREST's error code for "the requested function was not found in the schema cache". */
const FUNCTION_NOT_FOUND_CODE = 'PGRST202';
/** PostgREST's error code for "the requested table/relation does not exist". */
const RELATION_NOT_FOUND_CODE = 'PGRST205';

/**
 * The retired v1 server RPC functions. Each is called with no args; whatever the
 * old signature was, a function that has been dropped resolves to a "function not
 * found" error, never an arguments-mismatch or a successful call.
 */
const RETIRED_V1_RPCS = ['sync_apply_projection_event', 'sync_events_ingest'] as const;

/** The retired v1 server tables. A dropped relation is unreachable over PostgREST. */
const RETIRED_V1_TABLES = ['sync_device_ingest_state', 'sync_ingested_events'] as const;

type PostgrestError = { code?: string; message?: string } | null;

// The live-branch helper's narrow client type exposes only `.schema().rpc()`;
// the real schema-scoped client also exposes `.from()`. Widen the schema-scoped
// handle here so the table-absence probe can issue a select without loosening
// the shared helper's contract.
type SchemaScopedQuery = {
  from: (table: string) => { select: (columns: string) => Promise<{ error: PostgrestError }> };
};

const callRpc = async (
  client: AuthedBranchClient['client'],
  fn: string,
): Promise<{ error: PostgrestError }> => {
  const result = (await client.schema(SYNC_RPC_SCHEMA).rpc(fn)) as { error: PostgrestError };
  return { error: result.error };
};

/** True when the error says the requested object simply does not exist on the server. */
const isObjectMissing = (error: PostgrestError): boolean => {
  if (!error) {
    return false;
  }
  if (error.code === FUNCTION_NOT_FOUND_CODE || error.code === RELATION_NOT_FOUND_CODE) {
    return true;
  }
  const message = (error.message ?? '').toLowerCase();
  return (
    message.includes('could not find the function') ||
    message.includes('could not find the table') ||
    message.includes('does not exist')
  );
};

describe('the previous-generation sync server objects are gone', () => {
  let authed: AuthedBranchClient;

  beforeAll(async () => {
    authed = await createAuthedBranchClient(config);
  }, 60_000);

  afterAll(async () => {
    await authed?.teardown();
  });

  it.each(RETIRED_V1_RPCS)('the server has no %s RPC', async (fn) => {
    const { error } = await callRpc(authed.client, fn);
    expect(isObjectMissing(error)).toBe(true);
  }, 30_000);

  it.each(RETIRED_V1_TABLES)('the server has no %s table', async (table) => {
    const scoped = authed.client.schema(SYNC_RPC_SCHEMA) as unknown as SchemaScopedQuery;
    const { error } = await scoped.from(table).select('*');
    expect(isObjectMissing(error)).toBe(true);
  }, 30_000);

  it('the current sync push RPC still resolves, so the absence check is not vacuous', async () => {
    // A real, present RPC reached over PostgREST fails (if at all) for a reason
    // OTHER than "function not found" — `sync_push` carries a defaulted
    // `entities` param so a no-arg call resolves the function and runs. If it
    // were also reported missing, the assertions above would pass vacuously
    // because every call errors the same way; so assert it is NOT missing.
    const { error } = await callRpc(authed.client, 'sync_push');
    expect(isObjectMissing(error)).toBe(false);
  }, 30_000);
});
