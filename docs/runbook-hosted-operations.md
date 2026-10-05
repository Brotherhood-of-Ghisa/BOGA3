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
