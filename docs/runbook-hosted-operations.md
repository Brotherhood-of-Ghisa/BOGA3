# Hosted Supabase operations

Load when you are operating a **hosted** (non-local) Supabase project: resetting
it, deploying functions, rolling out the agent/MCP stack, or running a release
cutover. Local development is `RUNBOOK.md`.

No production host, DNS name, callback URL, or hosted project credential is
committed in this repository. Never print hosted keys, connection strings, or
database passwords in task notes, PR bodies, or logs. Local gate results never
substitute for a hosted check, and implementing a feature does not authorize
deploying it.

Prerequisite for every CLI step: `supabase login` has been run and the project is
linked (`supabase link --project-ref <ref>`).

## Reset the hosted database to a clean slate

Use when the hosted schema is known-bad or has drifted and there is no data worth
preserving. **Destructive — it drops the hosted database.**

1. ```bash
   supabase db reset --linked --yes
   ```
   Drops the database and reapplies every `supabase/migrations/*.sql` in order on
   a fresh one.
2. **Re-expose `app_public` on the Data API.** Easy to miss: the schema exists
   after the reset but PostgREST will not serve it until you toggle it back on.
   Dashboard → Project Settings → API → **Exposed schemas** → add `app_public`
   alongside `public` and `graphql_public`, then Save.
3. `supabase migration list --linked` — every checked-in version applied, no
   extras.
4. Smoke from the app or `curl`: an authenticated request to
   `app_public.<table>` returns rows (or RLS-blocked rows), not a
   "schema not exposed" 404.

## Group evaluator

The evaluator (`docs/specs/tech/groups-contract.md`) needs one deploy and one
setting per hosted project. Locally the shared baseline does this for you
(`supabase/scripts/group-eval-configure.sh`).

1. Apply the migration chain: it enables `pg_net` and `pg_cron`, schedules
   `group-eval-sweep`, and generates the kick secret in Vault.
2. Deploy from the repository root:
   `bash -lc 'source supabase/scripts/_common.sh && run_supabase functions deploy group-eval --no-verify-jwt'`.
   The function loads `apps/mobile/src/groups/set-facts.ts` by relative path, so
   it must be deployed from a full checkout. It holds no secrets of its own — it
   checks the caller's `x-group-eval-secret` against Vault.
3. Point the kick at it in the SQL Editor:
   `select app_public.group_eval_set_url('https://<project-ref>.supabase.co/functions/v1/group-eval');`
   Until this is set nothing drains the queue; changes keep queuing and
   `sync_push` is unaffected.
4. Verify: after a member syncs a session shared into a group, rows appear in
   `app_public.group_set_facts` within seconds and `group_eval_queue` drains to
   empty.

Queue triage once it is live: `RUNBOOK.md`, "Diagnostic rows".

## Agent / MCP hosted rollout checklist

1. Apply the migration chain and deploy `agent-api` from the repository root
   with `--no-verify-jwt`; the function performs stricter live validation.
2. Deploy `apps/agent-auth-web/dist` on HTTPS with `/oauth/consent` SPA
   fallback, using only the project URL and client-safe publishable key.
3. Enable the Supabase OAuth server, configure its consent path, choose dynamic
   registration or exact client registrations, and use asymmetric signing keys.
4. Deploy `services/boga-mcp` on Node 24+ behind HTTPS with only
   `BOGA_MCP_PUBLIC_URL`, `BOGA_AGENT_API_BASE_URL` and `BOGA_OAUTH_ISSUER`
   (plus optional runtime settings). **Never** inject database or service-role
   credentials into this host.
5. Configure ingress/body/rate limits and keep authorization headers, query
   state and payload bodies out of logs.
6. Verify in the hosted environment: protected-resource and
   authorization-server discovery, explicit consent and deny, every tool,
   cross-owner denial, refresh/expiry, revocation, and metadata-only audit.

Hosted smoke must run from the hosting platform or a dedicated operator client
against the deployed URLs, so discovery and TLS are exercised as deployed.
Build and configuration detail: `apps/agent-auth-web/README.md`,
`services/boga-mcp/README.md`, `supabase/README.md`.

## Optional bodyweight-calculation cutover

An accepted operator procedure, not authorization or evidence of a deployment.
Record exact commit SHAs, store build numbers, project ref, migration/function
versions and smoke evidence in the release PR. **Never reset the hosted database
for this cutover.**

1. **Distribute update-required compatibility first.** Build the latest reviewed
   client that still speaks the current server protocol but recognizes
   `UPDATE_REQUIRED` during setup and steady-state sync. Run its required local
   gates and sweep, submit the same EAS profile / bundle ID the installed fleet
   uses, and verify it reaches normal sync before the server cutover. It must
   retain dirty local data and cursors when the guard later activates.

2. **Validate the implementation release locally.** In its leased worktree run
   `./boga test for --diff origin/main...HEAD`, every selected lane, and the full
   sweep (`./boga sweep`). The integrated UI must already have explicit human
   acceptance. Confirm populated migration fixtures preserve sessions, sets,
   readings, contributions, IDs and clocks; convert lb actual/planned/readings to
   kg exactly; default private/group preferences off; and remove every retired
   unit/mode/movement/loading/hydration field.

3. **Review and apply the hosted cutover.** Inspect the linked project and the
   exact migration plan before modifying anything:

   ```bash
   bash -lc 'source supabase/scripts/_common.sh && run_supabase migration list --linked'
   bash -lc 'source supabase/scripts/_common.sh && run_supabase db push --linked --dry-run'
   ```

   Apply only the reviewed clean-schema / protocol-3 migrations, then immediately
   deploy the matching functions. Retain the Vault secret, evaluator URL and
   queued jobs. The protocol guard must activate **before** removed columns
   become inaccessible.

   ```bash
   bash -lc 'source supabase/scripts/_common.sh && run_supabase db push --linked'
   bash -lc 'source supabase/scripts/_common.sh && run_supabase functions deploy group-eval --no-verify-jwt'
   bash -lc 'source supabase/scripts/_common.sh && run_supabase functions deploy agent-api --no-verify-jwt'
   bash -lc 'source supabase/scripts/_common.sh && run_supabase migration list --linked'
   ```

4. **Smoke the cutoff with dedicated hosted accounts.** Missing, malformed and
   protocol-2 push/pull headers must return `UPDATE_REQUIRED` before row access;
   `x-boga-sync-protocol: 3` succeeds. Rejected calls change no rows or cursors.
   Verify the twelve clean entities, the synced private preference, layer-4 kg
   readings, removed fields, and reinstall restore.

   With two group members, exercise private/group off/on independence, preserved
   contributions, reading add/backdate/edit/delete/restore, and
   ordinary/personal/strict-group calculations with coherent publication. A
   missing group reading omits only dependent scores. Inspect every public group
   payload, cache, event, board and certification response for absence of reading
   value/date/id/provenance and the dependency digest. An applicable reading
   correction must end the dependent certification; a rule-only contribution
   change retains the witnessed set and its original audit. Neither behaviour
   claims the witness verified bodyweight. Confirm coaching uses the current
   `metric_revision` (`working_sets_v2`), emits ordinary/no-reading output while
   private mode is off and authorized aware output while on. Re-run hosted
   OAuth/discovery/revocation checks.

5. **Release the protocol-3 client.** Build and submit only the reviewed commit
   whose local gates and sweep produced the evidence above. Upgrade a populated
   device and verify raw workouts/readings survive, lb values are kg-converted,
   settings and contributions restore across sync, disposable group caches clear,
   and no workout surface prompts for bodyweight.

If validation fails, hold the protocol-3 client and repair forward: keep the
guard active and preserve readings, raw workouts, dirty data and queued jobs. Do
not restore retired fields or the old calculation worker.
