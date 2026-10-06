# Hosted Supabase operations

Load when you are operating a **hosted** (non-local) Supabase project: resetting
it, deploying functions, rolling out the agent/MCP stack, or running a release
cutover. Local development is `RUNBOOK.md`.

Public deployment addresses are recorded below so operators can find the
current services. Hosted credentials and unconfirmed callback URLs are not
recorded here. Never print hosted keys, connection strings, or
database passwords in task notes, PR bodies, or logs. Local gate results never
substitute for a hosted check, and implementing a feature does not authorize
deploying it.

Prerequisite for every CLI step: `supabase login` has been run and the project is
linked (`supabase link --project-ref <ref>`).

## Production mobile release

Every production release plan includes hosted database migrations and verification.
An EAS upload alone does not complete the release. This applies even when there
are no pending migrations: record the verified no-op.

1. Pull `main`, pin the release commit, and run its required full sweep. Keep
   the application, migrations and any function deployments on that same commit;
   do not deploy later migrations while finishing an older IPA's release.
2. Privately compare the linked project's identity with the Supabase target in
   the EAS `production` environment used by the `prod` build profile. Stop on a
   mismatch or unavailable hosted access.
3. From the repository root, inspect migration history and preview pending SQL
   with the repository's pinned CLI:
   ```bash
   source supabase/scripts/_common.sh
   run_supabase migration list --linked
   run_supabase db push --linked --include-all --dry-run
   ```
   Review pending migrations, remote-only history, data preservation, older
   client compatibility and required function updates before applying anything.
4. Apply reviewed compatible migrations before building/submitting production:
   `run_supabase db push --linked --include-all`. Deploy affected functions from
   the same checkout using their sections below. A normal release never resets
   the hosted database or includes development seeds.
   For a breaking sync projection change, load
   `docs/specs/tech/session-planning-contract.md`, section 3.2, and
   `docs/specs/tech/sync-v2-server-contract.md`, "Migration-in-flight contract";
   coordinate compatible-client availability and the server cutover in their
   required order. If group publication changes, load
   `docs/specs/tech/group-competition-contract.md`, "Activation order and evidence".
   Record any staged migration as outstanding until its cutover and hosted
   verification finish.
5. Recheck hosted migration history against the pinned commit, then verify the
   deployed schema, auth/RLS and the release client's sync push/pull. Exercise
   affected hosted functions and group flows. Record results alongside the IPA
   commit and build number; local tests do not prove these hosted checks.
6. Build locally with EAS `prod`, verify the production bundle/build number, and
   submit that exact IPA with the `prod` submit profile. Follow any coordinated
   cutover from step 4; report both Apple submission and backend verification.
   Missing migrations or failed hosted checks leave the release incomplete.

## Current BoGa MCP deployment

Recorded from the owner's Render dashboard and environment settings on
2026-10-06. These are configured destinations, not proof of current hosted health.

| Component / Render variable | Configured address |
| --- | --- |
| MCP origin: `BOGA_MCP_PUBLIC_URL` | https://boga3.onrender.com |
| MCP connector endpoint (origin plus `/mcp`) | https://boga3.onrender.com/mcp |
| Backend: `BOGA_AGENT_API_BASE_URL` | https://onluhhnvvmknqzdxgntl.supabase.co/functions/v1/agent-api |
| OAuth issuer: `BOGA_OAUTH_ISSUER` | https://onluhhnvvmknqzdxgntl.supabase.co/auth/v1 |

The public MCP adapter is configured on **Render**, service **boga3**, in the
owner's personal **My Workspace**. The dashboard showed a Node Free service,
repository **Brotherhood-of-Ghisa/BOGA3**, branch **main**, and a Live deployment.
Supabase project **onluhhnvvmknqzdxgntl** hosts the **agent-api** Edge Function
and authentication/token issuance. An OAuth redirect to Supabase does not move
the MCP server there. The consent site's deployed address has not been recorded;
inspect Supabase's OAuth consent configuration before changing it.

Railway is not the identified MCP host. The previously observed ambient CLI
link was an unrelated **Sophia OS Demo**; never deploy based on that link.

### Configuration, credentials and collaborator access

- Render dashboard → **boga3 → Environment** holds the three public URL values
  above and any service-specific runtime settings; check linked environment
  groups too. These URLs are configuration, not credentials.
- Supabase dashboard → project **onluhhnvvmknqzdxgntl** holds OAuth settings
  and Edge Function secret management. Keep privileged backend credentials
  there; never copy service-role keys or database credentials into MCP.
- The co-developer already has GitHub repository access. That does not grant
  Render dashboard, logs or environment access.
- A GitHub PAT does not grant Render access. Render's **Add Credential**
  screen requesting `read:packages` is for pulling private container images
  from GitHub Packages, not for collaborator deployment access.
- For code deployments, confirm Render's current auto-deploy policy for
  **main** before merging. The supplied dashboard showed **Auto-Deploy**,
  but this is a snapshot, not a permanent guarantee.
- For a redeploy without a code change, the Render owner can use **Manual
  Deploy**, or obtain the service's **Deploy Hook** in Settings and share it
  privately with the operator. Possession of the hook URL permits deployments;
  never commit it. It grants no dashboard/log/environment access.
- Dashboard changes require an authorized Render user; while using the personal
  account, have the owner handle them or arrange supported workspace access.
  Do not share the owner's password or commit Render API keys, Supabase keys,
  OAuth client secrets, bearer tokens or deploy-hook URLs.

### Redeploy and verify

For MCP adapter changes, deploy Render's **boga3** service. Confirm its root,
build/start commands and Node version against the production instructions in
`services/boga-mcp/README.md`; these settings were not supplied in the dashboard
evidence. Changes to **agent-api** require a separate Supabase Edge Function
deployment; a Render redeploy does not update that function.

Render's Free tier can sleep after inactivity; its dashboard warns that waking
can delay requests by **50 seconds or more**. A connected BoGa tool probe timed
out during this investigation; a cold start is a possible explanation, not a
confirmed diagnosis. A Live badge or a successful `/health` request alone does
not establish OAuth or tool health.

After deployment, run the hosted rollout checklist below against these deployed
URLs. Verify both discovery endpoints, explicit consent and deny, all four tools
(`get_training_profile`, `search_exercises`, `get_exercise_context`,
`get_recent_workouts`), grant revocation and the audit trail, plus the other
hosted security checks in that checklist. Record the deployed revision, time,
URLs and results without tokens or payloads. **Local green is not hosted evidence.**

Update this section when hosts, ownership, branch or public settings change.
Read actual platform configuration before deploying; do not treat this snapshot
as a substitute for it.

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
