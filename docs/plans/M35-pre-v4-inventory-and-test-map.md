# M35 — Pre-V4 inventory, hosted evidence and test map

Facts for M35-T02 and M35-T03, gathered 2026-10-07 at `origin/main` `538baa4a`.
This file is ephemeral: it is deleted with the milestone. Function bodies were
read from `pg_get_functiondef` on a V4-active local stack (253 `app_public`
functions); line numbers refer to the committed files at `538baa4a`.

Contents: 1. Hosted evidence · 2. Measured baseline · 3. Operator decisions ·
4. Object inventory · 5–8. Test map (per file).

## 1. Hosted evidence (BOGA_DEV `onluhhnvvmknqzdxgntl`, the production project)

BOGA_DEV is the only hosted project (Supabase MCP `list_projects`); PR #524 ran
the production rollout there. Read-only SQL and API-log queries only.

| Check | Result |
| --- | --- |
| Activation flag | `group_competition_activation.activated_at = 2026-10-05 08:31:55.600172+00` |
| `group_metric_eval_queue` | 0 rows (0 claimed, 0 enqueued before activation) |
| `group_eval_queue` (M25 session queue) | 0 rows |
| Current rule revisions (10 active exercises, 1 live group) | all `representation_version` 4; 0 rev-3 revisions created after activation |
| Stored history (D3) | `group_rule_revisions`: 34 × rev 3, 12 × rev 4; 7 M25 `group_certifications`; 7 witness aliases in `group_metric_certifications` |
| M25 board engine | 0 exercises where `group_metric_is_legacy`; 0 `group_board_entries` updated after activation |
| Cron | `group-eval-sweep` `*/5` → `group_eval_sweep()` |
| Latest applied migration | `20261006220000`. **`20261007120000_group_eval_rules_drain.sql` (#594) is merged but not applied on hosted.** T05 must account for it. |

API logs (`edge_logs`, `/rest/v1/rpc/*group*`, three windows covering
2026-10-05 08:31:55Z → 2026-10-07 15:55Z):

- Pre-V4 RPC calls since activation: **8, all HTTP 400** (`UPDATE_REQUIRED`), all from
  `Boga3/23` (pre-V4 build): `group_week_summary` ×6 and `group_session_detail` ×2 between
  2026-10-05 08:43 and 10:45Z. **None after 2026-10-05 10:45Z.** The same client's
  `group_list_mine` ×8 got 400 (missing contract header).
- Every other group call is V4 (`group_competition_*`), membership/settings
  (`group_list_mine`, `group_get`), or the worker: `group_eval_*` (M25 session
  queue: check_secret, claim, complete, session_rows, requeue_rules) and
  `group_metric_eval_*` (claim, prepare, publish, fail). Both worker families
  are live and stay (inventory §7).
- `group_metric_eval_publish` returned 500 twice on 2026-10-05; not investigated here.

## 2. Measured baseline (slot 3, direct runs, not in the timing store)

Activation cost after a reset: `./boga db reset` 27.6–27.8 s, baseline preflight
4.9–7.6 s, `group-competitions-activate.sh` **1.0–1.1 s**.

Each default `slow-backend` lane, run directly on an active stack
(`run-suite.sh --no-baseline`; the three self-baselining wrappers had their
preflight call skipped, since the preflight resets an active stack):

| Lane | Active stack, as committed | Note |
| --- | --- | --- |
| auth-authz | PASS 2.1 s | |
| groups-contract | **FAIL** 3.0 s | first group RPC: `UPDATE_REQUIRED` (no contract header) |
| groups-leaderboards (5 bodies) | **FAIL** each 2.1–3.2 s | same |
| groups-api-live | PASS 4.3 s | Jest uses the app client, which sends the header |
| agent-api | PASS 8.6 s | |
| sync-v2-schema | PASS 6.2 s | |
| sync-push-contract | PASS 4.4 s | |
| sync-pull-contract | PASS 2.7 s | |
| dev-wipe-my-data | PASS 1.4 s | |
| sync-drift | PASS 30.1 s | resets the DB itself (`reset-local.sh`) → leaves the stack pending |
| sync-v2-e2e | PASS 21.2 s | re-run on a fresh active stack (first run followed sync-drift's reset) |
| sync-infra | PASS 15.0 s | same |
| mcp-smoke | PASS 4.9 s | same |

With `x-boga-group-contract: 4` added to `rpc()` (local edit, reverted), each
groups body on its own fresh active stack still fails at its first pre-V4 RPC:
groups-contract after 18 `ok`s at the viewer stream (`group_stream`); leaderboards,
boards, certification, week-summary at `group_exercise_create`; bodyweight at
its first comparison create (`group_exercise_create_v2`). All `UPDATE_REQUIRED:
Use the current group competition endpoint.` So the header is necessary but
not sufficient: every groups shell body needs the ports below before it can run active.

For T02: `sync-drift` resets the stack itself, so an active baseline must be
restored after it (or activation must live in `reset-local.sh`).

## 3. Operator decisions (2026-10-07)

Approved by the operator in the T01 session:

- **O1. Every delete in §5–§8 is approved**, all four classes: (a) duplicates
  of a V4 assertion that moves to a default lane; (b) the retired Weight
  metric; (c) pending-only legacy fixtures; (d) M25-only rules or columns with
  no V4 counterpart. The 56 `cutover-only` rows in groups-competitions.sh are
  deleted when groups-protocol4 retires. A delete whose cited V4 line is
  itself reworked must keep an equivalent V4 assertion somewhere.
- **O2. History stays proven by an SQL-seeded fixture.** A default-lane
  chapter inserts protocol-3-era rows directly: rev-3 revisions, an M25
  certification with its witness alias, frozen former/archived entries. It
  reads them through the V4 board, history, certification_get and stream,
  replacing the cutover-only proof in groups-competitions.sh:266-280 and
  552-569. It must not depend on any pre-V4 RPC, so it survives server removal.
- **O3. The M25 board engine is dropped with the server removal** (§4.6c, 14
  functions incl. `group_metric_is_legacy`). Hosted: 0 legacy exercises, 0
  `group_board_entries` writes since activation. Load-factor vector parity stays
  TS-only (`apps/mobile/src/groups/load-factor-vectors.json`).
- **O4. Test porting splits into two PRs.** Part 1 covers groups-contract,
  groups-leaderboards, groups-week-summary, the V4 chapters of
  groups-competitions.sh, the history fixture and the header. Part 2 covers
  groups-boards, groups-certification, groups-bodyweight and the flip of the
  baseline to active.


## 4. Object inventory

Source of truth: the final function definitions (final `pg_get_functiondef` of all 253 `app_public` functions on the active stack; no overloads, no dynamic `execute` in any body), the grant catalog (grants), the trigger list, migrations at origin/main 538baa4a. Call graph built by scanning every function body for `<known fn>(`; reachability computed from live roots (granted RPCs, trigger functions, `group_eval_sweep` cron, functions used by CHECK constraints / scripts). On the live stack no RLS policy, column default or view references any `group_*` function (pg_policies / pg_attrdef / pg_views checked), so function bodies, triggers, cron, CHECKs and external callers are the complete caller set.

Abbreviations: **pub** = `supabase/migrations/20261004233855_group_competition_publication.sql`; **m25_*/m27/observations/simplified_bodyweight** = the matching `supabase/migrations/2026…` file; **index.ts** = `supabase/functions/group-eval/index.ts`. Tests columns give `file×references` (supabase/tests/*.sh, apps/mobile/__tests__/*, apps/mobile/.maestro/**). "app" = apps/mobile/{src,app,components}. † = caller that is itself dropped by this inventory.

**App callers of every old RPC: none.** `apps/mobile/src/groups/api.ts:96-123` (`GroupRpcName`) lists only the 12 membership RPCs + 15 `group_competition_*`. The "app" hits in table 1 are stale comments/JSON `_comment`s only: `components/groups/group-leaderboards-page.tsx:20`, `src/groups/exercise-view-model.ts:81`, `src/groups/week-summary-view-model.ts:1`, `components/today/use-today-group.ts:45`, `src/exercise-core/exercise-core-vectors.json:2` (says groups-contract.sh runs the vectors against `group_exercise_create`). Same for `__tests__/groups-screens.test.tsx:437` (error-message string), `__tests__/groups-week-summary-view-model.test.ts:2`, `__tests__/exercise-core.test.ts:3` (comments).

### 4.1 Old public RPCs (27) — M25 + protocol-3 + `*_v2`

All 27 are the generated wrapper (pub:285-324): `group_require_app_user()`; if `group_competition_active()` raise `UPDATE_REQUIRED: Use the current group competition endpoint.`; else `return <name>_pre_competition(...)`. All granted **anon, authenticated, service_role** (pub:320). Callers below are of the wrapper name.

| object(args) | defined / last redefined | grants | app | V4 callers | other SQL callers († = also dropped) | worker | scripts | tests (file×refs) | verdict |
|---|---|---|---|---|---|---|---|---|---|
| `group_board(uuid,uuid,text,boolean,jsonb,integer)` | wrapper pub:309 (loop pub:285-324); old body last `20260927073000_m27_group_metrics:2029` | anon,authenticated,service_role | — | — | — | — | — | groups-boards.sh×7, groups-certification.sh×3 | **drop** (D2) |
| `group_board_podiums(uuid,text,boolean)` | wrapper pub:309 (loop pub:285-324); old body last `20260927073000_m27_group_metrics:1986` | anon,authenticated,service_role | components/groups/group-leaderboards-page.tsx×1 | — | group_metric_podiums_pre_competition† | — | — | groups-boards.sh×8, groups-certification.sh×2 | **drop** (D2) |
| `group_board_history(uuid,uuid,text,boolean,jsonb,integer)` | wrapper pub:309 (loop pub:285-324); old body last `20260927073000_m27_group_metrics:2111` | anon,authenticated,service_role | — | — | — | — | — | groups-boards.sh×6, groups-certification.sh×2 | **drop** (D2) |
| `group_certify(uuid,uuid,uuid,text)` | wrapper pub:309 (loop pub:285-324); old body last `20260929120000_simplified_bodyweight:1231` | anon,authenticated,service_role | — | — | — | — | — | groups-boards.sh×3, groups-bodyweight.sh×2, groups-certification.sh×5, groups-competitions.sh×1 | **drop** (D2) |
| `group_certification_withdraw(uuid,uuid)` | wrapper pub:309 (loop pub:285-324); old body last `20260916120000_m25_group_certification:1041` | anon,authenticated,service_role | — | — | group_metric_certification_end_pre_competition† | — | — | groups-certification.sh×4 | **drop** (D2) |
| `group_certification_cancel(uuid,uuid)` | wrapper pub:309 (loop pub:285-324); old body last `20260916120000_m25_group_certification:1062` | anon,authenticated,service_role | — | — | group_metric_certification_end_pre_competition† | — | — | groups-certification.sh×4 | **drop** (D2) |
| `group_exercise_list(uuid)` | wrapper pub:309 (loop pub:285-324); old body last `20260927073000_m27_group_metrics:1961` | anon,authenticated,service_role | src/groups/exercise-view-model.ts×1 | — | — | — | — | groups-contract.sh×10 | **drop** (D2) |
| `group_exercise_create(uuid,text,text,text)` | wrapper pub:309 (loop pub:285-324); old body last `20260913160000_m25_group_exercises:238` | anon,authenticated,service_role | src/exercise-core/exercise-core-vectors.json×1 | — | — | — | — | exercise-core.test.ts×1, groups-boards.sh×3, groups-bodyweight.sh×2, groups-certification.sh×2, groups-competitions.sh×1, groups-contract.sh×13, groups-leaderboards.sh×2, groups-week-summary.sh×2 | **drop** (D2) |
| `group_exercise_update(uuid,uuid,text,text)` | wrapper pub:309 (loop pub:285-324); old body last `20260927073000_m27_group_metrics:2472` | anon,authenticated,service_role | — | — | — | — | — | groups-contract.sh×15 | **drop** (D2) |
| `group_exercise_archive(uuid,uuid)` | wrapper pub:309 (loop pub:285-324); old body last `20260927073000_m27_group_metrics:2533` | anon,authenticated,service_role | — | — | — | — | — | groups-boards.sh×1, groups-certification.sh×1, groups-competitions.sh×1, groups-contract.sh×7, groups-leaderboards.sh×1 | **drop** (D2) |
| `group_exercise_unarchive(uuid,uuid)` | wrapper pub:309 (loop pub:285-324); old body last `20260927073000_m27_group_metrics:2586` | anon,authenticated,service_role | — | — | — | — | — | groups-boards.sh×1, groups-contract.sh×7, groups-leaderboards.sh×1 | **drop** (D2) |
| `group_exercise_list_v2(uuid)` | wrapper pub:309 (loop pub:285-324); old body last `20260927073000_m27_group_metrics:119` | anon,authenticated,service_role | — | — | — | — | — | — | **drop** (D2) |
| `group_exercise_create_v2(uuid,text,text,text,double precision,text)` | wrapper pub:309 (loop pub:285-324); old body last `20260929120000_simplified_bodyweight:798` | anon,authenticated,service_role | — | — | — | — | — | groups-bodyweight.sh×1, groups-competitions.sh×1, groups-week-summary.sh×2 | **drop** (D2) |
| `group_exercise_update_v2(uuid,uuid,bigint,text,text,double precision,text)` | wrapper pub:309 (loop pub:285-324); old body last `20260929120000_simplified_bodyweight:829` | anon,authenticated,service_role | — | — | — | — | — | groups-bodyweight.sh×1 | **drop** (D2) |
| `group_exercise_archive_v2(uuid,uuid)` | wrapper pub:309 (loop pub:285-324); old body last `20260927073000_m27_group_metrics:2509` | anon,authenticated,service_role | — | — | — | — | — | — | **drop** (D2) |
| `group_exercise_unarchive_v2(uuid,uuid)` | wrapper pub:309 (loop pub:285-324); old body last `20260927073000_m27_group_metrics:2556` | anon,authenticated,service_role | — | — | — | — | — | — | **drop** (D2) |
| `group_metric_board(uuid,uuid,text,boolean,bigint,text,integer)` | wrapper pub:309 (loop pub:285-324); old body last `20260929120000_simplified_bodyweight:1031(patch)` | anon,authenticated,service_role | — | — | group_metric_podiums_pre_competition† | — | — | groups-bodyweight.sh×4, groups-competitions.sh×1 | **drop** (D2) |
| `group_metric_podiums(uuid,boolean)` | wrapper pub:309 (loop pub:285-324); old body last `20260929120000_simplified_bodyweight:1047(patch)` | anon,authenticated,service_role | — | — | — | — | — | — | **drop** (D2) |
| `group_metric_history(uuid,uuid,text,boolean,bigint,text,integer)` | wrapper pub:309 (loop pub:285-324); old body last `20260929120000_simplified_bodyweight:1039(patch)` | anon,authenticated,service_role | — | — | — | — | — | groups-bodyweight.sh×2 | **drop** (D2) |
| `group_metric_revisions(uuid,uuid)` | wrapper pub:309 (loop pub:285-324); old body last `20260927073000_m27_group_metrics:2752` | anon,authenticated,service_role | — | — | — | — | — | — | **drop** (D2) |
| `group_metric_certify(uuid,uuid,uuid,text,text,bigint,text)` | wrapper pub:309 (loop pub:285-324); old body last `pub:213(patch)` | anon,authenticated,service_role | — | — | — | — | — | groups-bodyweight.sh×3, groups-competitions.sh×1 | **drop** (D2) |
| `group_metric_certification_get(uuid,uuid,text)` | wrapper pub:309 (loop pub:285-324); old body last `20261004204709_group_certification_observations:418` | anon,authenticated,service_role | — | — | — | — | — | groups-bodyweight.sh×1 | **drop** (D2) |
| `group_metric_certification_end(uuid,uuid,text)` | wrapper pub:309 (loop pub:285-324); old body last `20261004204709_group_certification_observations:329(patch)` | anon,authenticated,service_role | — | — | — | — | — | groups-bodyweight.sh×2 | **drop** (D2) |
| `group_stream(uuid,jsonb,integer)` | wrapper pub:309 (loop pub:285-324); old body last `20260927073000_m27_group_metrics:2302` | anon,authenticated,service_role | — | — | — | — | — | groups-screens.test.tsx×1, groups-boards.sh×6, groups-certification.sh×2, groups-contract.sh×6 | **drop** (D2) |
| `group_stream_v2(uuid,jsonb,integer)` | wrapper pub:309 (loop pub:285-324); old body last `20260927073000_m27_group_metrics:2950` | anon,authenticated,service_role | — | — | — | — | — | groups-bodyweight.sh×5 | **drop** (D2) |
| `group_session_detail(uuid,text)` | wrapper pub:309 (loop pub:285-324); old body last `20260929120000_simplified_bodyweight:698` | anon,authenticated,service_role | — | — | — | — | — | groups-contract.sh×4 | **drop** (D2) |
| `group_week_summary(uuid,bigint,bigint)` | wrapper pub:309 (loop pub:285-324); old body last `20261002120000_group_week_summary:211` | anon,authenticated,service_role | components/today/use-today-group.ts×1, src/groups/week-summary-view-model.ts×1 | — | — | — | — | groups-week-summary-view-model.test.ts×1, groups-week-summary.sh×6 | **drop** (D2) |

Note: `group_board_podiums`, `group_metric_board`, `group_certification_withdraw/cancel` have SQL callers because two dead `_pre_competition` bodies call the **wrapper names** (not the private siblings): `group_metric_podiums_pre_competition` → `group_board_podiums(...)`, `group_metric_board(...)`; `group_metric_certification_end_pre_competition` → `group_certification_withdraw/cancel(...)`. Both callers are dropped with them.

### 4.2 `*_pre_competition` implementations (27) + `group_metric_eval_source_graph_v3`

All created by the rename at pub:304, `revoke all` (no grants) at pub:306. 8 are internally reused by V4 RPCs ⇒ **fold**; 19 have only their wrapper as caller ⇒ **drop**. No test, script, worker or app references any `*_pre_competition` name.

| object(args) | defined / last redefined | grants | app | V4 callers | other SQL callers († = also dropped) | worker | scripts | tests (file×refs) | verdict |
|---|---|---|---|---|---|---|---|---|---|
| `group_board_pre_competition(uuid,uuid,text,boolean,jsonb,integer)` | renamed pub:304 from `group_board` (body `20260927073000_m27_group_metrics:2029`) | - | — | — | group_board† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_board_podiums_pre_competition(uuid,text,boolean)` | renamed pub:304 from `group_board_podiums` (body `20260927073000_m27_group_metrics:1986`) | - | — | — | group_board_podiums† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_board_history_pre_competition(uuid,uuid,text,boolean,jsonb,integer)` | renamed pub:304 from `group_board_history` (body `20260927073000_m27_group_metrics:2111`) | - | — | — | group_board_history† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_certify_pre_competition(uuid,uuid,uuid,text)` | renamed pub:304 from `group_certify` (body `20260929120000_simplified_bodyweight:1231`) | - | — | — | group_certify† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_certification_withdraw_pre_competition(uuid,uuid)` | renamed pub:304 from `group_certification_withdraw` (body `20260916120000_m25_group_certification:1041`) | - | — | group_competition_certification_end | group_certification_withdraw† | — | — | — | **fold into V4** → `group_competition_certification_end` |
| `group_certification_cancel_pre_competition(uuid,uuid)` | renamed pub:304 from `group_certification_cancel` (body `20260916120000_m25_group_certification:1062`) | - | — | group_competition_certification_end | group_certification_cancel† | — | — | — | **fold into V4** → `group_competition_certification_end` |
| `group_exercise_list_pre_competition(uuid)` | renamed pub:304 from `group_exercise_list` (body `20260927073000_m27_group_metrics:1961`) | - | — | — | group_exercise_list† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_exercise_create_pre_competition(uuid,text,text,text)` | renamed pub:304 from `group_exercise_create` (body `20260913160000_m25_group_exercises:238`) | - | — | — | group_exercise_create† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_exercise_update_pre_competition(uuid,uuid,text,text)` | renamed pub:304 from `group_exercise_update` (body `20260927073000_m27_group_metrics:2472`) | - | — | — | group_exercise_update† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_exercise_archive_pre_competition(uuid,uuid)` | renamed pub:304 from `group_exercise_archive` (body `20260927073000_m27_group_metrics:2533`) | - | — | — | group_exercise_archive† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_exercise_unarchive_pre_competition(uuid,uuid)` | renamed pub:304 from `group_exercise_unarchive` (body `20260927073000_m27_group_metrics:2586`) | - | — | — | group_exercise_unarchive† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_exercise_list_v2_pre_competition(uuid)` | renamed pub:304 from `group_exercise_list_v2` (body `20260927073000_m27_group_metrics:119`) | - | — | — | group_exercise_list_v2† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_exercise_create_v2_pre_competition(uuid,text,text,text,double precision,text)` | renamed pub:304 from `group_exercise_create_v2` (body `20260929120000_simplified_bodyweight:798`) | - | — | group_competition_exercise_create | group_exercise_create_v2† | — | — | — | **fold into V4** → `group_competition_exercise_create` |
| `group_exercise_update_v2_pre_competition(uuid,uuid,bigint,text,text,double precision,text)` | renamed pub:304 from `group_exercise_update_v2` (body `20260929120000_simplified_bodyweight:829`) | - | — | group_competition_exercise_update | group_exercise_update_v2† | — | — | — | **fold into V4** → `group_competition_exercise_update` |
| `group_exercise_archive_v2_pre_competition(uuid,uuid)` | renamed pub:304 from `group_exercise_archive_v2` (body `20260927073000_m27_group_metrics:2509`) | - | — | group_competition_exercise_archive | group_exercise_archive_v2† | — | — | — | **fold into V4** → `group_competition_exercise_archive` |
| `group_exercise_unarchive_v2_pre_competition(uuid,uuid)` | renamed pub:304 from `group_exercise_unarchive_v2` (body `20260927073000_m27_group_metrics:2556`) | - | — | group_competition_exercise_archive | group_exercise_unarchive_v2† | — | — | — | **fold into V4** → `group_competition_exercise_archive` |
| `group_metric_board_pre_competition(uuid,uuid,text,boolean,bigint,text,integer)` | renamed pub:304 from `group_metric_board` (body `20260929120000_simplified_bodyweight:1031(patch)`) | - | — | — | group_metric_board† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_metric_podiums_pre_competition(uuid,boolean)` | renamed pub:304 from `group_metric_podiums` (body `20260929120000_simplified_bodyweight:1047(patch)`) | - | — | — | group_metric_podiums† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_metric_history_pre_competition(uuid,uuid,text,boolean,bigint,text,integer)` | renamed pub:304 from `group_metric_history` (body `20260929120000_simplified_bodyweight:1039(patch)`) | - | — | — | group_metric_history† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_metric_revisions_pre_competition(uuid,uuid)` | renamed pub:304 from `group_metric_revisions` (body `20260927073000_m27_group_metrics:2752`) | - | — | — | group_metric_revisions† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_metric_certify_pre_competition(uuid,uuid,uuid,text,text,bigint,text)` | renamed pub:304 from `group_metric_certify` (body `pub:213(patch)`) | - | — | group_competition_certify | group_metric_certify† | — | — | — | **fold into V4** → `group_competition_certify` |
| `group_metric_certification_get_pre_competition(uuid,uuid,text)` | renamed pub:304 from `group_metric_certification_get` (body `20261004204709_group_certification_observations:418`) | - | — | — | group_metric_certification_get† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_metric_certification_end_pre_competition(uuid,uuid,text)` | renamed pub:304 from `group_metric_certification_end` (body `20261004204709_group_certification_observations:329(patch)`) | - | — | — | group_metric_certification_end† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_stream_pre_competition(uuid,jsonb,integer)` | renamed pub:304 from `group_stream` (body `20260927073000_m27_group_metrics:2302`) | - | — | — | group_stream† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_stream_v2_pre_competition(uuid,jsonb,integer)` | renamed pub:304 from `group_stream_v2` (body `20260927073000_m27_group_metrics:2950`) | - | — | — | group_stream_v2† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_session_detail_pre_competition(uuid,text)` | renamed pub:304 from `group_session_detail` (body `20260929120000_simplified_bodyweight:698`) | - | — | — | group_session_detail† | — | — | — | **drop** (only caller is its dropped wrapper) |
| `group_week_summary_pre_competition(uuid,bigint,bigint)` | renamed pub:304; redefined 20261005120000_group_week_records_per_board:17; SECURITY INVOKER pub:328 | - | — | group_competition_week_summary | group_week_summary† | — | — | — | **fold into V4** → `group_competition_week_summary` |
| `group_metric_eval_source_graph_v3(uuid,uuid)` | renamed pub:82 from `group_metric_eval_source_graph` (body last 20261004204709:191 patch), re-patched pub:86-95 | - | — | — | group_metric_eval_source_graph | — | — | — | **fold into V4** → `group_metric_eval_source_graph` (always contract 4) |

Fold notes (what the V4 function must absorb):
- `group_exercise_{create,update,archive,unarchive}_v2_pre_competition`: validation (`group_exercise_validate_*`, `group_exercise_validate_rules` → `group_metric_names`), manager check, 25005 lock, `group_retire_current_revision` + `group_metric_eval_enqueue` (update), `group_metric_is_legacy` → `group_board_enqueue_links` legacy catch-up (unarchive; always false once active ⇒ drop that leg). Their `contract_version 3` / `group_exercise_json_v2` return is discarded by the V4 wrapper.
- `group_certification_{withdraw,cancel}_pre_competition`: still needed by `group_competition_certification_end` for legacy (M25 `group_certifications`) rows (pub:668-680) ⇒ D3 history path; they call `group_certification_require`, `group_certification_end` (→ `group_certification_json`, `group_certification_enqueue`).
- `group_metric_certify_pre_competition`: all certification validation + insert; V4 uses only `result->'created'` (pub:611,615). Calls `group_metric_eval_source_graph`, `group_metric_enqueue_isolated`, `group_metric_certification_json` (return only).
- `group_week_summary_pre_competition` is **SECURITY INVOKER** (pub:328), relies on `group_competition_week_summary`'s definer context; redefined after publication in 20261005120000:17, and V4 caller re-projects `group_records` (20261005120000:154-182).
- `group_metric_eval_source_graph_v3`: the whole source/as-of resolver; `group_metric_eval_source_graph` (pub:96) wraps it and, when active, adds Volume fingerprints, `contract_version:4`, re-hashes `source_token`. Callers of the wrapper: `group_metric_eval_prepare`, `group_metric_eval_publish`, `group_metric_certify_pre_competition`; tests groups-bodyweight.sh:318,505, groups-competitions.sh:488,579.
- No runtime dependency on `group_stream_v2_pre_competition`: `group_competition_stream_page` was **textually cloned** from it at migration time (pub:929-949, then 20261005090000:13) ⇒ safe to drop.

### 4.3 `group_competition_active()` branch sites

Textual occurrences in migrations: **15, all in pub** (0 in every other file, incl. 20261004225853, 20261005*, 20261006*, 20261007*). 15 = definition (pub:11) + revoke (pub:15) + **13 branch sites** below. In final definitions they expand to **38 ACTIVE-BRANCH functions** (catalog) = 27 template wrappers + 11 others, with 39 call occurrences (`group_metric_import_legacy_certifications` has 2); `grep -c` on the final function definitions = 41 (39 + the function's own header/CREATE line).

| # | pub line | function (final def) | pending side does | active side | verdict |
|---|---|---|---|---|---|
| 1 | :77 | `group_metric_names()` | metrics `['weight','e1rm']` (protocol 3) | `['volume','e1rm']` | **fold** to constant; callers `group_exercise_validate_rules`, `group_metric_apply_member`, `group_metric_eval_publish` (+2 dropped) |
| 2 | :101 | `group_metric_eval_source_graph(uuid,uuid)` | returns the v3 graph unchanged (no `contract_version`, no Volume fingerprint) ⇒ worker runs protocol-3 `evaluateGroupMetricGraph` | adds Volume fingerprints, `contract_version 4`, new `source_token` | **fold** v3 body in; drop `_v3` |
| 3 | :168 (+ implicit :174-189) | `group_metric_eval_publish(...)` | skips `group_metric_import_legacy_certifications`; implicit `contract_version≠'4'` legs: unit must equal `group_metric_unit()` ('kg'), value via `group_metric_rank_value()` rounding + null filter | imports legacy certs; units via `group_competition_unit`; raw numeric values | **fold** (keep RPC; drop pending legs, `group_metric_unit`, `group_metric_rank_value`, the 25006 shared lock at pub:164) |
| 4 | :210 | `group_metric_compute(uuid,bigint,uuid,uuid[])` | best-set tie-break omits `set_created_at_ms` | includes it | **fold** (keep; private, caller `group_metric_apply_member`) |
| 5-6 | :219, :224 | `group_metric_import_legacy_certifications(group_exercises)` | voids/imports **every** open M25 certification | only for live exercise + active member (archived/departed left to activation's frozen import / later rejoin) | **fold** to active predicate; keep (callers `group_metric_eval_publish`, `group_retire_current_revision` ← `group_update`, update_v2 fold) |
| 7 | :251 | `group_competition_require_active()` | raises `UPDATE_REQUIRED: Group competitions are not available yet.` | = `group_competition_require_capability()` | **fold** into `group_competition_require_capability` (15 V4 callers incl. `group_competition_stream_page`) |
| 8 | :277 | `group_require_app_user()` | header `x-boga-group-contract: 4` **not** required; takes `pg_advisory_xact_lock_shared(25006,0)` (activation fence) | requires header via `group_competition_require_capability` | **fold**: always require header, drop 25006 lock. Callers: 16 V4 RPCs/helpers, 12 membership RPCs (`group_create/get/list_mine/invite_get/invite_preview/invite_regenerate/join/leave/remove_member/set_role/transfer_ownership/update`), 8 folded `_pre_competition`, + 46 dropped (27 wrappers + 19 `_pre_competition`); 82 callers total |
| 9 | :313 (template ×27) | the 27 wrappers of §1 | delegate to `_pre_competition` | raise UPDATE_REQUIRED | **drop** |
| 10 | :522 | `group_competition_revision_version()` (BEFORE INSERT trigger on `group_rule_revisions`) | writes `representation_version=3` | 4 | **fold**: drop trigger+fn and set column default 4 (column default is 3, pub:24), or make it constant |
| 11 | :534 | `group_metric_initial_revision()` (AFTER INSERT trigger on `group_exercises`) | initial revision `legacy=true` ⇒ exercise runs the M25 board engine (`group_eval_apply_legacy`) | `legacy=false` | **fold** to `legacy=false`; keep trigger |
| 12 | :1002 | `group_competition_contract(uuid)` | `activation_state:'pending'` | `'active'` | **fold** to constant `'active'` (D4 keeps the field; client guard `competition-wire-guards.ts:22` accepts both) |
| 13 | :1135 | `group_competition_activate(integer)` | performs cutover | early return `activated:false` | **drop** (§4) |

Other activation-only coupling, not keyed on `group_competition_active()`:
- **Advisory lock 25006** (activation fence): exclusive in `group_competition_activate` (pub:1133); shared in `group_require_app_user` (pub:276), `group_metric_eval_enqueue` (pub:156), `group_eval_complete` (pub:160), `group_metric_eval_publish` (pub:164). All shared locks exist only to fence activation ⇒ drop with it.
- `group_competition_import_witnesses` guard `p_graph->>'contract_version'='4'` (pub:123): no-op for v3 graphs ⇒ always true after fold (keep fn, caller `group_metric_apply_member`).
- `group_metric_is_legacy` legs (always false on an active DB, since activation bumped every exercise to a non-legacy revision and new initial revisions are non-legacy): `group_eval_apply` (→ `group_eval_apply_legacy`), `group_metric_on_unarchive`, `group_metric_eval_source_graph_v3` target filter (legacy ⇒ null ⇒ "frozen"), `group_exercise_unarchive_v2_pre_competition`. See §6c.

### 4.4 Activation objects

| object | defined | grants | callers | verdict |
|---|---|---|---|---|
| table `group_competition_activation(singleton, activated_at)` | pub:3-9 (row inserted pub:7, RLS on, all revoked) | none | SQL: `group_competition_active()`, `group_competition_activate` (row lock). Nothing else (no script/test touches the table directly) | **drop** (D6: removal migration should first assert `activated_at is not null` or no group data) |
| `group_competition_active()` | pub:11 (SECURITY DEFINER, volatile) | none | SQL: 38 functions (§3); scripts: `supabase/scripts/group-competitions-activate.sh:24`, `with-local-group-competitions.sh:11`, `ensure-local-runtime-baseline.sh:239` (`stack_reset_reason`); tests: `scripts/tests/baseline-stamp.test.sh:65` (fake psql keyed on the query text), `groups-competitions.sh:240` | **drop** |
| `group_competition_activate(integer)` | pub:1128 | **service_role** (pub:1160) | scripts: `group-competitions-activate.sh:33` (REST POST), `with-local-group-competitions.sh:18`; tests: `groups-competitions.sh:227,235,241,242` (app-token refusal, lock-timeout failure, activation, idempotence) | **drop** |
| `group_competition_import_frozen_legacy(group_exercises)` | pub:1013 | none | only `group_competition_activate` | **drop** |
| `group_competition_preserve_frozen(group_exercises,bigint)` | pub:1059 | none | only `group_competition_activate` | **drop** |
| `group_retire_current_revision(group_exercises)` | 20260929120000 → patched observations:181 | none | `group_competition_activate`†, `group_update` (live), `group_exercise_update_v2_pre_competition` (fold) | **keep** (V4/membership dependency); its `r.legacy` snapshot leg is dead on an active DB |
| column `group_rule_revisions.representation_version` default 3 | pub:24 | — | trigger #10; read by `group_competition_event_json`, `group_competition_revision_json` (D3) | **keep column** (D3 history); change default/trigger per #10 |

### 4.5 Triggers

Group-table triggers (the trigger list):

| trigger (table) → function | function def | pending / protocol-3 behaviour | verdict |
|---|---|---|---|
| `group_rule_revisions_competition_version` (group_rule_revisions, BEFORE INSERT, pub:527) → `group_competition_revision_version` | pub:519 | branch #10: writes representation_version 3 | **fold** (drop trigger+fn, default 4) |
| `group_exercises_metric_initial_revision` (group_exercises AFTER INSERT, m27:1648) → `group_metric_initial_revision` | pub:530 | branch #11: legacy=true initial revision | **keep, fold** branch |
| `group_exercises_metric_unarchive` (m27:1688) → `group_metric_on_unarchive` | m27:1677 | `if not group_metric_is_legacy` guard (always true once active) | **keep** (worker path: re-enqueue + kick); optional fold of guard |
| `group_exercises_metric_presentation` (m27:1733) → `group_metric_on_presentation` | m27:1725 | none | **keep** |
| `group_certifications_metric_end_sync` (group_certifications) + `group_metric_certifications_legacy_end_sync` (observations:168,171) → `group_metric_legacy_end_sync` | observations:151 | none (syncs M25 cert ↔ imported metric cert) | **keep** (D3; V4 `certification_end` on legacy-backed rows relies on it) |
| `group_metric_certifications_witness_end_sync` (pub:144) → `group_competition_witness_ended` | pub:135 | none (V4 Volume alias end) | **keep** (V4) |
| `group_memberships_board_catch_up` (m25_group_boards:903) → `group_board_on_membership` → `group_board_enqueue_links` | m25_group_boards:890 / m27:1778 | none (M25 target jobs → `group_eval_complete` → `group_eval_apply` → metric enqueue) | **keep** (live worker) |
| `group_memberships_stream_event` (m25_group_events:186) → `group_event_membership` | m25_group_events:154 | none | **keep** |

Non-group-table triggers calling group functions (none has a pending branch; all **keep**, live M25 worker / share): `sessions_group_share_session`→`group_share_session` (m22_group_record:93), `sessions_group_stream_event`→`group_event_session` (m25_group_events:145), `sessions_group_z_eval_enqueue`/`session_exercises_group_eval_enqueue`/`exercise_sets_group_eval_enqueue`/`exercise_group_links_group_eval_enqueue` (m25_group_eval:543-559), `exercise_definitions_group_eval_enqueue` (simplified_bodyweight:1178), `body_weight_readings_group_eval_{insert,update}` (dated_bodyweight_groups:1240, simplified_bodyweight:154).

### 4.6 Private helpers

#### 6a. Reachable only from dropped objects (drop with them)

Computed: functions unreachable from live roots once the 27 wrappers, 19 `_pre_competition`, and `group_competition_activate` go (70 unreachable total = 27 + 19 + activate + 20 below + 3 unrelated to V4: `group_eval_set_url` (keep — scripts/group-eval-configure.sh:27 + 6 lanes), `group_events_backfill` (keep — one-off, groups-contract.sh:1774), `group_exercise_valid_description` (pre-existing orphan: its m27:27-29 CHECKs no longer exist on the active stack — verified via pg_constraint; out of scope)). Verified on the live stack: no CHECK/DEFAULT uses `group_metric_unit`, `group_metric_names` or `group_metric_rank_value` (the m27:453/483/518 `unit = group_metric_unit(metric)` CHECKs were dropped at pub:38-54); `group_exercise_trim` *is* used by `group_exercises` CHECKs (keep).

| object(args) | defined / last redefined | grants | app | V4 callers | other SQL callers († = also dropped) | worker | scripts | tests | verdict |
|---|---|---|---|---|---|---|---|---|---|
| `group_board_holder_with_member(jsonb)` | m25_group_boards:975 | - | — | — | group_board_history_pre_competition†, group_metric_history_pre_competition†, group_stream_event_json† | — | — | — | **drop** |
| `group_board_link_exercises_json(uuid,jsonb)` | m25_group_boards:987 | - | — | — | group_board_related_json†, group_stream_event_json† | — | — | — | **drop** |
| `group_board_related_json(uuid)` | m25_group_boards:1002 | - | — | — | group_board_history_pre_competition† | — | — | — | **drop** |
| `group_board_validate(text,boolean)` | m25_group_boards:939 | - | — | — | group_board_history_pre_competition†, group_board_podiums_pre_competition†, group_board_pre_competition† | — | — | — | **drop** |
| `group_board_ranked(uuid,uuid,text,boolean)` | m25_group_certification:1091 | - | — | — | group_board_podiums_pre_competition†, group_board_pre_competition† | — | — | — | **drop** |
| `group_certification_ref_json(app_public.group_certifications)` | m25_group_certification:163 | - | — | — | group_board_ranked†, group_stream_event_json† | — | — | — | **drop** |
| `group_certification_related_json(uuid)` | m25_group_certification:210 | - | — | — | group_board_history_pre_competition† | — | — | — | **drop** |
| `group_stream_event_json(uuid,bigint)` | m25_group_certification:1267 | - | — | — | group_metric_stream_event_json†, group_stream_pre_competition† | — | — | groups-boards.sh×1 | **drop** |
| `group_session_card_json(uuid,text,jsonb)` | simplified_bodyweight:686 | - | — | — | group_stream_pre_competition†, group_stream_v2_pre_competition† | — | — | groups-contract.sh×3 | **drop** (V4 twin: group_competition_session_card) |
| `group_session_exercises_json(uuid,text)` | simplified_bodyweight:666 | - | — | — | group_session_card_json†, group_session_detail_pre_competition† | — | — | groups-contract.sh×1 | **drop** (V4 twin: group_competition_session_exercises) |
| `group_metric_board_ranked(uuid,uuid,bigint,text,boolean)` | observations:224(patch) | - | — | — | group_metric_board_pre_competition†, group_metric_podiums_pre_competition† | — | — | — | **drop** (V4 reads group_competition_board_rows) |
| `group_metric_public_holder(jsonb,uuid)` | observations:347(patch) | - | — | — | group_metric_event_json† | — | — | — | **drop** |
| `group_metric_event_json(app_public.group_events)` | zero_contribution_group_toggle:74 | - | — | — | group_metric_history_pre_competition†, group_metric_stream_event_json† | — | — | — | **drop** (V4 twin: group_competition_event_json) |
| `group_metric_stream_event_json(uuid,bigint)` | m27:2933 | - | — | — | group_stream_v2_pre_competition† | — | — | — | **drop** (V4 twin: group_competition_stream_event) |
| `group_metric_stream_record_context(app_public.group_events)` | observations:379(patch) | - | — | — | group_metric_stream_event_json† | — | — | — | **drop** (V4 twin: group_competition_record_context) |
| `group_metric_revision_json(app_public.group_rule_revisions)` | m27:2618 | - | — | — | group_metric_history_pre_competition†, group_metric_revisions_pre_competition† | — | — | — | **drop** (V4 twin: group_competition_revision_json) |
| `group_metric_exercise_revision_json(app_public.group_exercises,app_public.group_rule_revisions)` | m27:2628 | - | — | — | group_metric_board_pre_competition†, group_metric_history_pre_competition† | — | — | — | **drop** |
| `group_metric_require_legacy(uuid,uuid)` | m27:1704 | - | — | — | group_board_history_pre_competition†, group_board_pre_competition†, group_certify_pre_competition†, group_exercise_archive_pre_competition†, group_exercise_unarchive_pre_competition†, group_exercise_update_pre_competition† | — | — | — | **drop** |
| `group_competition_import_frozen_legacy(app_public.group_exercises)` | pub:1013 | - | — | — | group_competition_activate† | — | — | — | **drop** (activation-only) |
| `group_competition_preserve_frozen(app_public.group_exercises,bigint)` | pub:1059 | - | — | — | group_competition_activate† | — | — | — | **drop** (activation-only) |

#### 6b. Kept functions that lose their last live caller once the folds land

| object(args) | defined / last redefined | grants | app | V4 callers | other SQL callers († = also dropped) | worker | scripts | tests | verdict |
|---|---|---|---|---|---|---|---|---|---|
| `group_exercise_json_v2(app_public.group_exercises)` | simplified_bodyweight:747 | - | — | — | group_exercise_archive_v2_pre_competition, group_exercise_create_v2_pre_competition, group_exercise_list_v2_pre_competition†, group_exercise_unarchive_v2_pre_competition, group_exercise_update_v2_pre_competition, group_metric_exercise_revision_json†, group_metric_podiums_pre_competition†, group_metric_revisions_pre_competition†, group_metric_stream_record_context† | — | — | — | **drop after fold** — survivors are the 4 folded v2 bodies, whose v3 envelope the V4 wrappers discard (they re-read the row and return group_competition_exercise_json) |
| `group_exercise_json(app_public.group_exercises)` | m25_group_exercises:185 | - | — | — | group_board_podiums_pre_competition†, group_board_pre_competition†, group_exercise_archive_pre_competition†, group_exercise_create_pre_competition†, group_exercise_json_v2, group_exercise_list_pre_competition†, group_exercise_unarchive_pre_competition†, group_exercise_update_pre_competition† | — | — | groups-contract.sh×2 | **drop after fold** (only reached via group_exercise_json_v2) |
| `group_metric_certification_json(app_public.group_metric_certifications)` | observations:185(patch) | - | — | — | group_metric_certification_end_pre_competition†, group_metric_certification_get_pre_competition†, group_metric_certify_pre_competition, group_metric_stream_record_context† | — | — | — | **drop after fold** — group_competition_certify uses only result->'created' |
| `group_metric_unit(text)` | simplified_bodyweight:108 | - | — | — | group_metric_eval_publish | — | — | — | **drop after fold** (publish pending unit check only) |
| `group_metric_rank_value(double precision)` | m27:550 | - | — | — | group_metric_eval_publish | — | — | — | **drop after fold** (publish pending value rounding/filter only) |
| `group_metric_names()` | pub:75 | - | — | — | group_exercise_validate_rules, group_metric_apply_member, group_metric_board_pre_competition†, group_metric_eval_publish, group_metric_history_pre_competition† | — | — | — | **fold** → constant array['volume','e1rm'] (inline in validate_rules / apply_member / eval_publish, then drop) |
| `group_competition_require_active()` | pub:247 | - | — | group_competition_board, group_competition_certification_end, group_competition_certification_get, group_competition_certify, group_competition_exercise_archive, group_competition_exercise_create, group_competition_exercise_list, group_competition_exercise_update, group_competition_history, group_competition_podiums, group_competition_revisions, group_competition_session_detail, group_competition_stream, group_competition_stream_page, group_competition_week_summary | — | — | — | — | **fold** → = group_competition_require_capability (15 V4 callers incl. stream_page) |
| `group_metric_is_legacy(uuid)` | m27:560 | - | — | — | group_board_podiums_pre_competition†, group_eval_apply, group_exercise_list_pre_competition†, group_exercise_unarchive_v2_pre_competition, group_metric_eval_source_graph_v3, group_metric_on_unarchive, group_metric_podiums_pre_competition†, group_metric_require_legacy†, group_stream_pre_competition† | — | — | groups-competitions.sh×1 | **keep or fold to false** — always false once active (every current revision non-legacy); tests: groups-competitions.sh |

#### 6c. M25 board engine behind `group_metric_is_legacy` (dead on an active DB; operator call)

Not an `active()` branch, but the brief's "pre-V4" scope covers it: `group_eval_apply` (m27:1652, called by the live `group_eval_complete`) sends legacy exercises to `group_eval_apply_legacy` (the M25 `group_board_entries` engine) and everything else to `group_metric_eval_enqueue`. Activation gave every exercise a non-legacy current revision (pub:1145-1149), and after branch #11 is folded new ones are non-legacy too, so this chain can't be reached on a V4-only DB. If it's dropped, `group_eval_apply` reduces to the enqueue loop. The M25 **session** path of the worker (`group_eval_session_rows` / `group_eval_complete` → `group_set_facts`) is unaffected. Removing these 13 functions touches no D3 table (they only *write* `group_board_entries`; V4 readers never call them).

| object(args) | defined / last redefined | grants | app | V4 callers | other SQL callers († = also dropped) | worker | scripts | tests | verdict |
|---|---|---|---|---|---|---|---|---|---|
| `group_eval_apply_legacy(uuid,uuid,uuid,text[])` | m27:1651 rename of group_eval_apply (body m25_group_certification:267; patched 20261003120000:119-146, 20261003180000:139) | - | — | — | group_eval_apply | — | — | groups-boards.sh×2 | **drop (candidate)** — only reached when group_metric_is_legacy |
| `group_board_compute(uuid,uuid,uuid,uuid[])` | m25_group_certification:93 | - | — | — | group_eval_apply_legacy | — | — | groups-certification.sh×1 | **drop (candidate)** |
| `group_board_counting(uuid,uuid,uuid)` | 20261003180000_group_board_raw_weight:78 | - | — | — | group_board_compute, group_board_weight_rule_moved, group_eval_apply_legacy | — | — | groups-week-summary.sh×2 | **drop (candidate)** |
| `group_board_certified_leader(uuid,uuid,text,uuid)` | m25_group_certification:236 | - | — | — | group_eval_apply_legacy | — | — | — | **drop (candidate)** |
| `group_board_holder_json(app_public.group_board_entries)` | m25_group_boards:273 | - | — | — | group_eval_apply_legacy | — | — | — | **drop (candidate)** |
| `group_board_kg(double precision,numeric)` | m25_group_boards:167 | - | — | — | group_board_counting, group_board_weight_as_raw, group_eval_apply_legacy | — | — | — | **drop (candidate)** |
| `group_board_leader(uuid,text,boolean)` | m25_group_boards:292 | - | — | — | group_eval_apply_legacy | — | — | — | **drop (candidate)** |
| `group_board_load_factor(text,text)` | m25_group_boards:153 | - | src/groups/load-factor-vectors.json×1 | — | group_board_counting, group_eval_apply_legacy | — | — | groups-metric-contract.test.ts×1, groups-bodyweight.sh×2 | **drop (candidate)** — but shared-vector parity target (load-factor-vectors.json)⇒ port vector check first |
| `group_board_rank(uuid,text,boolean,uuid)` | m25_group_boards:331 | - | — | — | group_eval_apply_legacy | — | — | — | **drop (candidate)** |
| `group_board_weight_as_raw(numeric,double precision,numeric)` | 20261003180000:31 | - | — | — | group_board_weight_rule_moved, group_eval_apply_legacy | — | — | — | **drop (candidate)** |
| `group_board_weight_rule_moved(uuid,uuid,uuid,jsonb)` | 20261003180000:46 | - | — | — | group_eval_apply_legacy | — | — | — | **drop (candidate)** |
| `group_board_would_lead(uuid,text,uuid,numeric,bigint)` | m25_group_boards:308 | - | — | — | group_eval_apply_legacy | — | — | — | **drop (candidate)** |
| `group_certification_matching(uuid,uuid,text,text)` | m25_group_certification:145 | - | — | — | group_board_certified_leader, group_board_ranked†, group_eval_apply_legacy, group_stream_event_json† | — | — | — | **drop (candidate)** |

#### 6d. Helpers a naive sweep would flag but that must stay

| helper | why it stays |
|---|---|
| `group_board_require_exercise` | V4: `group_competition_board/certify/history/revisions` |
| `group_metric_cursor_decode/encode` | V4 board/history/stream cursors |
| `group_metric_entries`, `group_metric_certification_matching`, `group_metric_leader/rank/would_lead/certified_leader/holder_json`, `group_metric_compute`, `group_metric_apply_member`, `group_competition_import_witnesses` | V4 board rows / live publisher (`group_metric_eval_publish`) |
| `group_metric_observed_set_pin`, `group_metric_performance_pin`, `group_metric_graph_fingerprint` | source graph (v3 body after the fold) + apply_member |
| `group_metric_enqueue_isolated`, `group_metric_eval_enqueue`, `group_eval_kick_once`, `group_eval_log_failure` | V4 certification_end/certify, `group_update`, triggers |
| `group_certification_end`, `group_certification_json`, `group_certification_require`, `group_certification_enqueue` | V4 `certification_end` on M25 certifications (D3) via the folded withdraw/cancel bodies |
| `group_competition_legacy_certification_json` | V4 `certification_get/end` presenting M25 `group_certifications` rows (pub:621-673) — **keep (D3)** |
| `group_exercise_require`, `group_exercise_require_manager`, `group_exercise_validate_{name,load_input_mode,source_id,rules}`, `group_exercise_trim`, `group_exercise_rules_json` | folded exercise bodies; `group_exercise_rules_json` also source graph, `group_update`, `group_metric_initial_revision`; `group_exercise_trim` also `group_exercises_name_trimmed_non_empty`/`source_exercise_id_trimmed_bounds` CHECKs |
| `group_week_gym_name`, `group_week_session_counts`, `group_week_session_records` | folded week summary |
| `group_retire_current_revision`, `group_metric_import_legacy_certifications` | `group_update` (live membership RPC) + exercise update fold + publisher |
| `group_legacy_set_fingerprint`, `group_set_fingerprint` | live worker `group_eval_session_rows` (M25 set facts) and import of M25 certifications |
| `group_board_enqueue_links`, `group_board_on_membership` | live trigger → M25 target queue |
| `group_competition_redacts_exercise`, `group_competition_event_json`, `group_competition_history_value`, `group_competition_revision_json` | V4 readers of D3 history (`legacy_entries`, contract_version 1 events, representation_version) |

D3 tables/columns that stay (read by V4 or the live worker): `group_board_entries`, `group_certifications`, `group_rule_revisions.{legacy,legacy_entries,representation_version}`, `group_events` contract_version 1 rows, `group_metric_certifications.legacy_certification_id`.

### 4.7 Worker side (group-eval Edge Function RPCs)

| RPC | def | grants | index.ts | other callers | tests | protocol-3 / pending path? | verdict |
|---|---|---|---|---|---|---|---|
| `group_eval_check_secret(text)` | m25_group_eval:648 | service_role | :166 | — | groups-leaderboards.sh×1 | none | **keep** |
| `group_eval_requeue_rules(integer,integer)` | 20261007120000:54 | service_role | :173 | — | groups-boards×1, groups-certification×1, groups-leaderboards×2 | none | **keep** |
| `group_eval_claim(integer)` | m25_group_eval:663 | service_role | :180 | — | groups-leaderboards×7 | none | **keep** |
| `group_eval_session_rows(uuid,text)` | 20261002120000:21 | service_role | :96 | — | groups-leaderboards×1 | none (uses M25 `group_legacy_set_fingerprint`, not protocol 3) | **keep** |
| `group_eval_complete(bigint,bigint,jsonb)` | m25_group_eval, patched pub:158 | service_role | :102 | — | groups-leaderboards×2 | 25006 shared fence (pub:160); → `group_eval_apply` → legacy leg `group_eval_apply_legacy` (§6c) | **keep, fold** (drop lock; optional §6c) |
| `group_eval_fail(bigint,text)` | 20261004180000:51 | service_role | :111 | — | groups-leaderboards×1 | none | **keep** |
| `group_metric_eval_claim(integer)` | m27:303 | service_role | :194 | — | groups-competitions×1, groups-leaderboards×1 | none | **keep** |
| `group_metric_eval_prepare(bigint,bigint,uuid)` | m27:643 | service_role | :137 | — | — | indirect: returns the v3 graph while pending (via `group_metric_eval_source_graph`); `frozen` when the target is legacy/archived/deleted | **keep** (changes only through the source-graph fold) |
| `group_metric_eval_publish(bigint,bigint,uuid,jsonb)` | m27:1370 → patched pub:162-189 | service_role | :141 | — | groups-competitions×1 | **yes**: branch #3 + `contract_version≠'4'` legs + 25006 fence | **keep, fold** |
| `group_metric_eval_fail(bigint,bigint,uuid,text)` | 20261004180000:88 | service_role | :148 | — | groups-leaderboards×1 | none | **keep** |
| `group_metric_eval_enqueue(uuid,uuid,text)` (internal) | m27, patched pub:154 | none | — | `group_eval_apply`, `group_eval_on_body_weight_reading`, `group_metric_enqueue_isolated`, `group_metric_on_unarchive`, `group_update`, update_v2 fold, `group_competition_activate`† | groups-competitions×1, groups-leaderboards×1 | 25006 shared fence only (pub:156) | **keep, fold** (drop lock) |
| `group_eval_apply(uuid,uuid,uuid,text[])` (internal) | m27:1652 | none | — | `group_eval_complete` | groups-boards×2, groups-certification×1 | `group_metric_is_legacy` leg | **keep** (optional §6c fold) |
| `group_eval_sweep/kick/kick_once/retry_parked/rules_stale` (internal, cron) | m25_group_eval / 20261004180000 / 20261007120000 | none | — | cron `group-eval-sweep` (20261004200000:12) | groups-leaderboards | none | **keep** |

### 4.8 group-eval protocol-3 dispatch and its TS modules

- `supabase/functions/group-eval/index.ts:22` type-imports `GroupMetricEvaluationGraph` from `apps/mobile/src/groups/metric-evaluation.ts`; `:23` imports `evaluateGroupComparisonGraph`, `CompetitionEvaluationGraph` from `competition-evaluation.ts`; `:136` types the prepared graph as `GroupMetricEvaluationGraph | CompetitionEvaluationGraph`; `:139-140` handles `frozen` (null graph) and calls `evaluateGroupComparisonGraph`.
- The dispatch itself is `apps/mobile/src/groups/competition-evaluation.ts:80-85`: a graph without `contract_version` → `evaluateGroupMetricGraph` (protocol 3, `metric-evaluation.ts:66-119`); `contract_version 4` → `evaluateCompetitionGraph` (:47-79). Doc comment :80 says "Pending installations continue to evaluate their existing protocol-3 graph."
- Importers: `metric-evaluation.ts` ← `index.ts` (type) and `competition-evaluation.ts` (fn + `GroupMetricSourceSet`/`EvaluatedGroupMetricSet`/`GroupMetricEvaluationGraph` types it extends, :8-19). `competition-evaluation.ts` ← `index.ts` only. **The app does not import either module** (no importer in `apps/mobile/{src,app,components}` other than each other). Tests: `__tests__/groups-metric-evaluation.test.ts` (14 refs), `__tests__/groups-competition-evaluation.test.ts` (12 refs).
- `performance-score.ts` `scoreGroupPerformance` is called only by `metric-evaluation.ts`; `competition-score.ts:7` imports only the `GroupPerformanceInput` type. So after the fold the function is protocol-3-only and the type stays.
- `set-facts.ts` (M25 session normalizer, `index.ts:15-20`) is live and also exported via `src/groups/index.ts`. **Keep.**

### 4.9 Protocol-3-only client TS in `apps/mobile/src/groups` (input for the client-cleanup task)

| file / export | serves | importers (prod) | note |
|---|---|---|---|
| `metric-evaluation.ts` (whole) | protocol-3 worker scoring | `competition-evaluation.ts`, group-eval `index.ts` | Move the reused types into `competition-evaluation.ts`; drop `evaluateGroupMetricGraph` and the dispatch at `competition-evaluation.ts:80-85` |
| `performance-score.ts` `scoreGroupPerformance` | protocol-3 scoring | `metric-evaluation.ts` | Keep the `GroupPerformanceInput` type |
| `metric-contract.ts` `GROUP_METRICS=['weight','e1rm']`, `GroupMetricUnit='kg'`, `validateGroupExerciseRules` | protocol-3 metric set | `competition-contract.ts` (type), `competition-score.ts`/`link-view-model.ts` (`checkGroupLinkCompatibility`), `metric-wire*.ts`, `metric-evaluation.ts`, `performance-score.ts` | Mixed: the link-compatibility rules are shared and stay |
| `metric-wire.ts`, `metric-wire-guards.ts` (`isGroupMetricExerciseWire`), `metric-view-model.ts` (`describeGroupRules`) | protocol-3 exercise wire | `exercise-view-model.ts:12-13`, `link-view-model.ts:14` | Check whether these still guard the old `group_exercise_list` shape (comment `exercise-view-model.ts:81`) |
| `types.ts` `GroupBoardMetric='weight'\|'e1rm'`, `GroupWeekBoardRow`, `GroupExercise` | M25 wire shapes | `board-view-model.ts`, `week-summary-view-model.ts`, `competition-view-model.ts`, … | Mixed |
| `competition-wire.ts:7` `activation_state:'pending'\|'active'`, `competition-wire-guards.ts:22` | V4 contract wire (D4 frozen) | `api.ts` | Keep accepting both (server will send `'active'` only) |
| stale comments | — | `api.ts:288`, plus the comment sites listed in the header | — |

### 4.10 Scripts, baseline steps, lanes tied to activation

| item | what it does | callers | verdict |
|---|---|---|---|
| `supabase/scripts/group-competitions-activate.sh` (whole) | `select group_competition_active()`; POSTs `rpc/group_competition_activate` | `supabase/scripts/ensure-dev-baseline.sh:150-152` (+ slot note :154-156 "groups gates expect it pending — ./boga db reset") | **drop** script + baseline step |
| `supabase/scripts/with-local-group-competitions.sh` (whole) | marks stack for reset, activates, runs command | `apps/mobile/scripts/maestro-run-lane.sh:157` (groups-e2e lane), `supabase/tests/groups-competition-live.sh:86`; test `apps/mobile/__tests__/groups-runtime-fixture.test.ts:36-56`; `scripts/triggers.tsv:84`; doc `apps/mobile/README-maestro.md:20` | **drop**; callers run the command directly |
| `supabase/scripts/ensure-local-runtime-baseline.sh:222-240` `stack_reset_reason` | resets a stack if the marker is set **or** `group_competition_active()` is true (:236-240) | `ensure_runtime_and_baseline` :259; test `scripts/tests/baseline-stamp.test.sh:65` (fake psql answers the active query) | **fold**: remove the "protocol 4 active" leg. Without it, every lane that resets a DB without the marker would run on an active stack, which is the new norm |
| `supabase/scripts/_common.sh:244-259` `stack_reset_marker`/`mark_stack_needs_reset`/`clear_stack_reset_marker` | one-way-body marker | producers: `with-local-group-competitions.sh:14`, `supabase/tests/groups-competitions.sh:29`; consumer `reset-local.sh:21,32`; doc `docs/specs/06-testing-strategy.md:69` | **keep if any one-way body remains**; otherwise it has no producers |
| `scripts/lanes.tsv:44` `groups-protocol4` = `run-suite.sh groups-competition-live.sh groups-competitions.sh` | populated pre-cutover reset (`db reset --version 20261004225853`, groups-competitions.sh:31) + activation + client live suite | AGENTS.md test-lane table "Group competitions" row | **rework**: the cutover premise goes. Port the state-independent assertions (D5) into groups-api-live/backend |
| `scripts/triggers.tsv:83-88` (6 rows → groups-protocol4) | path triggers | `./boga test for` | **rework** with the lane |
| `supabase/tests/lib/groups-fixtures.sh:119` `rpc()` | sends no `x-boga-group-contract` header (committed version) | every groups `.sh` lane | **must add the header**: once activation is gone, `group_require_app_user` always requires it, even for `group_create/join/…` |
| `apps/mobile/.maestro/scripts/groups-counterparty.js:67` | already sends `x-boga-group-contract: 4` and calls only membership + V4 RPCs | groups-e2e flow | no change |
| `apps/mobile/scripts/import/seed-dev-groups.ts:204` | already sends header | dev baseline | no change |

### 4.11 Surprises / risks

1. **Old RPCs still granted to `anon`** (and `service_role`): all 27 wrappers (pub:320). The 12 membership RPCs are also anon-granted. V4 RPCs are `authenticated`-only and `group_competition_activate` is `service_role`.
2. **The live evaluator breaks if `_v3` is dropped without folding.** `group_metric_eval_source_graph_v3` is the whole resolver behind `group_metric_eval_prepare`/`_publish`, which production calls. It was created by an anchor-patch DO block (pub:86-95) on a renamed function, so build the fold from the **final** definition in the final function definitions, not from migration text.
3. **V4 RPCs that break if a `_pre_competition` is dropped unfolded:** `group_competition_exercise_create/update/archive`, `group_competition_certify`, `group_competition_certification_end`, `group_competition_week_summary` (8 private bodies).
4. **Two dead `_pre_competition` bodies call wrapper names**, not the private siblings: `group_metric_podiums_pre_competition` → `group_board_podiums(`/`group_metric_board(`, and `group_metric_certification_end_pre_competition` → `group_certification_withdraw(`/`cancel(`. They would raise UPDATE_REQUIRED if ever reached while active. They're harmless only because they're dead.
5. `group_week_summary_pre_competition` is SECURITY INVOKER (pub:328). Its fold must keep running under the V4 function's definer context.
6. **The local gates currently test the *pending* representation.** The baseline resets any active stack (ensure-local-runtime-baseline.sh:236-240), and ensure-dev-baseline.sh:154-156 says the groups gates expect a pending stack. The 7 groups `.sh` lanes reference old RPCs **165 times**: groups-contract 62, boards 35, certification 25, bodyweight 23, week-summary 10, competitions 6, leaderboards 4. This is the D5 porting surface.
7. The activation fence lock 25006 sits on hot paths: every group RPC via `group_require_app_user`, plus `group_eval_complete`, `group_metric_eval_enqueue`, `group_metric_eval_publish`.
8. `group_rule_revisions.representation_version` defaults to **3** (pub:24). Only the trigger makes new rows 4, so dropping the trigger without changing the default would write 3.
9. `group_competition_import_witnesses`' `contract_version='4'` guard and the `group_metric_is_legacy` legs are protocol-3 branches that a `grep group_competition_active` misses (§3, §6c).
10. Out of scope but adjacent: groups-competitions.sh `rpc4` sends `x-boga-sync-protocol: 3`. That is Sync v2's protocol, unrelated.

### 4.12 Summary

| verdict | count | objects |
|---|---|---|
| **drop** | 27 | old public RPC wrappers (§1) |
| **drop** | 19 | `*_pre_competition` with no V4 reuse (§2) |
| **drop** | 5 | activation: table `group_competition_activation`, `group_competition_active()`, `group_competition_activate`, `group_competition_import_frozen_legacy`, `group_competition_preserve_frozen` |
| **drop** | 18 | private helpers reachable only from dropped objects (§6a) |
| **drop after fold** | 5 | `group_exercise_json_v2`, `group_exercise_json`, `group_metric_certification_json`, `group_metric_unit`, `group_metric_rank_value` |
| **drop (candidate, operator call)** | 13 | M25 board engine behind `group_metric_is_legacy` (§6c) (+ `group_metric_is_legacy` itself) |
| **fold into V4** (absorbed, then dropped) | 11 | pairs below |
| **keep, fold branch in place** | 9 | `group_metric_eval_publish`, `group_metric_eval_source_graph`, `group_metric_compute`, `group_metric_import_legacy_certifications`, `group_metric_initial_revision`, `group_require_app_user`, `group_competition_contract`, `group_eval_complete` / `group_metric_eval_enqueue` (25006 lock only); plus trigger `group_rule_revisions_competition_version` + `group_competition_revision_version` → column default 4 (drop trigger) |
| **keep** | — | all 12 worker RPCs and internals (§7), all other triggers (§5), D3 readers/helpers (§6d) |

Fold-into-V4 pairs:
1. `group_exercise_create_v2_pre_competition` → `group_competition_exercise_create`
2. `group_exercise_update_v2_pre_competition` → `group_competition_exercise_update`
3. `group_exercise_archive_v2_pre_competition` → `group_competition_exercise_archive`
4. `group_exercise_unarchive_v2_pre_competition` → `group_competition_exercise_archive`
5. `group_certification_withdraw_pre_competition` → `group_competition_certification_end`
6. `group_certification_cancel_pre_competition` → `group_competition_certification_end`
7. `group_metric_certify_pre_competition` → `group_competition_certify`
8. `group_week_summary_pre_competition` → `group_competition_week_summary`
9. `group_metric_eval_source_graph_v3` → `group_metric_eval_source_graph`
10. `group_competition_require_active` → `group_competition_require_capability` (15 V4 callers)
11. `group_metric_names` → constant `['volume','e1rm']` inlined in `group_exercise_validate_rules`, `group_metric_apply_member`, `group_metric_eval_publish`


## 5. Test map — groups-contract.sh

Source: origin/main 538baa4a (1786 lines). Fixture lib: supabase/tests/lib/groups-fixtures.sh
(285 lines; no supabase/tests/README.md exists). V4 bodies from the final function definitions.

### V4 facts that drive the verdicts

- **Header.** On an active stack `group_require_app_user()` raises `UPDATE_REQUIRED` without
  `x-boga-group-contract: 4`. It checks `AUTH_REQUIRED` and then `AGENT_FORBIDDEN` first, so those
  two tokens don't change. No membership or settings RPC (`group_create/get/update/join/leave/
  list_mine/invite_*/set_role/remove_member/transfer_ownership`) has an active branch. With the
  header, every expected error in those rows stays the same.
- **Grants.** Every `group_competition_*` RPC is granted to `authenticated` only. An anon call
  gets a PostgREST 42501 permission denial, not `AUTH_REQUIRED`. The membership RPCs keep their
  anon grant, so `AUTH_REQUIRED` still holds for them.
- **Exercise RPCs.** `group_competition_exercise_create/update/archive` call
  `group_require_member(lock)`, then `group_competition_require_active()`, then
  `group_exercise_{create,update,archive,unarchive}_v2_pre_competition`. The v2 bodies run
  `group_exercise_require_manager` (FORBIDDEN), then `validate_name`/`validate_load_input_mode`/
  `validate_source_id` in declare order, so "role before validation" and "validation before
  target" still hold. Update then does `validate_rules`, the target lookup (`NOT_FOUND: group
  exercise not found`), the archived check and the `CONFLICT` revision check.
  - Response shape: `{contract_version:4, exercise:{group_exercise_id, name, source_exercise_id,
    archived_at_ms, rules:{load_input_mode, bodyweight_calculations_enabled,
    bodyweight_contribution, default_metric, rules_revision}, published_revision, rebuilding}}`.
    `load_input_mode` moves under `.rules`.
  - Update has no parameter defaults: it needs `p_expected_revision`,
    `p_bodyweight_contribution` and `p_default_metric`.
  - Archive and unarchive are one RPC, `group_competition_exercise_archive(p_archived bool)`.
  - Unarchive fires `group_metric_on_unarchive`, which resets `published_rules_revision`. The
    response is therefore `published_revision:null, rebuilding:true`.
  - A new exercise has `published_revision` 1 and `rebuilding` false (column default 1).
- **List.** `group_competition_exercise_list` orders by `name collate "C", id` only. It does not
  sort case-insensitively and does not put archived rows last (v1 sorted by
  `archived_at is not null, lower(name)`). Each list row has the V4 exercise shape, plus top-level
  `contract_version`.
- **Stream.** `group_competition_stream(p_group_id, p_before text, p_limit)` has the same keyset
  order (`sort_at_ms desc, kind C, key C desc`), the same membership item shape and the same
  limit and membership errors. The differences:
  - The cursor is opaque base64 text of
    `{kind:"competition_stream", group:<id|null>, cursor:{sort_at_ms,kind,key}}`. Bad base64 or a
    non-object gives `VALIDATION: invalid comparison cursor`. A wrong binding gives
    `VALIDATION: stream cursor scope mismatch`. The inner cursor shape is then validated as before.
  - The session card is `{kind,key,sort_at_ms,groups,session:{member,session_id,gym_name,status,
    started_at_ms,completed_at_ms,duration_sec,exercises}}`. Card fields move under `.session`.
    Each exercise gains `visibility` (`"ordinary"` here, because no test group enables
    bodyweight), and sets keep `weight_value` when ordinary.
  - The response adds `contract_version:4`.
- **Detail.** `group_competition_session_detail(p_group_id, p_member_user_id, p_session_id)` is
  group-bound. A non-member of the group, or a nonexistent group, gets `NOT_FOUND: group not
  found`. A member asking for an unshared, nonexistent or tombstoned session gets `NOT_FOUND:
  session not found`. The pre-V4 rule "non-member ≡ nonexistent ≡ tombstoned ≡ unshared" (one
  body) splits into two identity classes. The response is `{contract_version:4, group_id,
  session:{…}}`. The session keys are unchanged; the exercise keys add `visibility`.
- **Caveat on delete-as-duplicate.** The rows below cite groups-competitions.sh:293-318, which is
  state-independent. That lane as a whole resets to a pre-cutover migration and activates
  (lines 29-31, 223-243), which D1 removes. The cited lines must survive that lane's own port, or
  these deletions lose their cover.

### Assertion map

| line(s) | asserts | RPC(s) | verdict |
| --- | --- | --- | --- |
| 136-140 | RLS enabled on all five group tables | psql | keep |
| 141-142 | group tables have no RLS policies | psql | keep |
| 143-147 | anon/authenticated hold no group-table privilege | psql | keep |
| 148-150 | no owner_user_id column | psql | keep |
| 151-158 | no FK into Sync v2 tables | psql | keep |
| 172-178 | every RPCS entry definer, pinned, anon+authenticated executable | psql | keep. The RPCS array (160-163) must drop the 7 pre-V4 names. V4 RPCs can't join it: they are not anon-executable. |
| 179-185 | internal helpers pinned and not client-executable | psql | keep. `group_session_card_json` and `group_session_exercises_json` are called only by pre-V4 stream/detail, so remove them from HELPERS (164-169) if the drop migration removes orphans. |
| 186-190 | three group-exercise helpers not SECURITY DEFINER | psql | keep (all three are still called by the `*_v2_pre_competition` bodies V4 reuses) |
| 194-202 | share trigger posture (AFTER I/U row, definer) | psql | keep |
| 205-206 | invite normalizer mapping | psql | keep |
| 207-209 | generator stays in Crockford alphabet | psql | keep |
| 212-220 | group_active_role rejects client_id (AGENT_FORBIDDEN) | psql | keep |
| 247-250 | create USERNAME_REQUIRED (no profile / null username) | group_create | keep + header |
| 252-261 | create VALIDATION name/description bounds | group_create | keep + header |
| 264-274 | create returns only group_id; trimmed row; single owner period | group_create (+psql) | keep + header |
| 277-279 | 50-char name accepted | group_create | keep + header |
| 286-294 | list_mine order and GroupSummary keys | group_list_mine | keep + header |
| 296-298 | outsider lists no groups | group_list_mine | keep + header |
| 300-304 | invite_get code format, only `code` key | group_invite_get | keep + header |
| 313-317 | preview normalizes mangled code; non-member shape | group_invite_preview | keep + header |
| 324-326 | O/L-mangled join returns joined:true | group_join | keep + header |
| 327-331 | repeat join no-op, no second period | group_join (+psql) | keep + header |
| 333-336 | preview already_member and active member_count | group_invite_preview | keep + header |
| 338-350 | join USERNAME_REQUIRED; joins after username as member | group_join (+psql) | keep + header |
| 357-361 | set_role returns {group, members} with new role | group_set_role | keep + header |
| 363-373 | group_get summary and owner→admin→member ordering | group_get | keep + header |
| 375-380 | null usernames sort last, returned null | group_get | keep + header |
| 388-403 | member FORBIDDEN on every privileged write; no change | invite_get, invite_regenerate, update, remove_member, set_role, transfer_ownership | keep + header |
| 410-412 | admin invite_get sees current code | group_invite_get | keep + header |
| 416-421 | admin update with 280-char description; shape | group_update | keep + header |
| 422-427 | update VALIDATION name/description bounds | group_update | keep + header |
| 429-440 | admin cannot remove owner/admin, set_role, transfer, self-remove | remove_member, set_role, transfer_ownership | keep + header |
| 441-443 | owner demotes joiner | group_set_role | keep + header |
| 450-455 | set_role VALIDATION: owner/unknown role/self | group_set_role | keep + header |
| 456-457 | set_role NOT_FOUND for non-member target | group_set_role | keep + header |
| 458-465 | remove/transfer self VALIDATION; non-member NOT_FOUND | remove_member, transfer_ownership | keep + header |
| 473-476 | regenerate returns new valid code | group_invite_regenerate | keep + header |
| 477-479 | invite_get returns regenerated code | group_invite_get | keep + header |
| 480-487 | INVITE_INVALID: old/out-of-alphabet/empty code | invite_preview, join | keep + header |
| 488-490 | username-less outsider may preview | group_invite_preview | keep + header |
| 497-504 | group_get non-member ≡ nonexistent (byte-identical) | group_get | keep + header |
| 506-513 | invite_get non-member ≡ nonexistent | group_invite_get | keep + header |
| 515-526 | outsider NOT_FOUND on six writes | update, regenerate, leave, remove, set_role, transfer | keep + header |
| 533-544 | leave returns {group_id}; NOT_FOUND after; period ended 'left' | group_leave, get, list_mine (+psql) | keep + header |
| 546-552 | rejoin inserts new member period, keeps old | group_join (+psql) | keep + header |
| 553-557 | rejoined as member; re-promote | group_get, set_role | keep + header |
| 564-570 | remove returns members without target; ended_by=owner | group_remove_member (+psql) | keep + header |
| 571-575 | removed member NOT_FOUND, not listed | group_get, list_mine | keep + header |
| 577-581 | admin removal records ended_by=admin | group_remove_member (+psql) | keep + header |
| 582-583 | removing already-removed member NOT_FOUND | group_remove_member | keep + header |
| 590-593 | OWNER_MUST_TRANSFER incl. sole owner | group_leave | keep + header |
| 595-604 | transfer swaps roles; exactly one owner | group_transfer_ownership (+psql) | keep + header |
| 605-612 | ex-owner FORBIDDEN set_role; new owner can't leave; ex-owner leaves | set_role, invite_get, leave | keep + header |
| 619-629 | soft-deleted group invisible (get, preview, list) | invite_get, get, invite_preview, list_mine | keep + header |
| 706-714 | athlete joins B then A; clock gap holds | group_join (+psql) | keep + header |
| 717-720 | session started before joining never shared | sync_push (+psql) | keep |
| 721-725 | B-only session shared into B only | sync_push (+psql) | keep |
| 734-738 | active S1 shared into A and B | sync_push (+psql) | keep |
| 750-760 | active card exact shape, raw set text | group_stream | port → group_competition_stream. Guards card projection, raw set text, gym/member refs. Fields move under `.session`; each exercise adds `visibility:"ordinary"`. |
| 777-786 | live sets raw; tombstoned set/exercise omitted | group_stream | port → group_competition_stream (`.session.exercises`) |
| 791-794 | completed card status/duration | group_stream | port → group_competition_stream (`.session.*`) |
| 799-801 | set edit flows through | group_stream | port → group_competition_stream |
| 806-808 | tombstoned session card hidden | group_stream | port → group_competition_stream (top-level `.key` unchanged) |
| 809-811 | tombstoned detail NOT_FOUND (TOMB_BODY) | group_session_detail | port → group_competition_session_detail(p_group_id=GA). Body becomes `NOT_FOUND: session not found` (session_json filters deleted_at). |
| 812 | tombstone keeps share rows | psql | keep |
| 817-818 | undelete restores card | group_stream | port → group_competition_stream |
| 819-820 | detail OK after undelete | group_session_detail | port → group_competition_session_detail (GA) |
| 826-847 | detail full shape, raw live sets, member's names | group_session_detail | port → group_competition_session_detail (GA). Top level adds contract_version/group_id; `.exercises[0]` exact object needs `visibility:"ordinary"`. |
| 848-849 | detail has no GPS field | group_session_detail | port → group_competition_session_detail |
| 850-853 | detail key sets exact | group_session_detail | port → group_competition_session_detail. Session keys unchanged; exercise keys add `visibility`. |
| 854-857 | stream has no GPS field | group_stream | port → group_competition_stream |
| 859-860 | athlete may open own shared session | group_session_detail | port → group_competition_session_detail (GA) |
| 861-868 | non-member ≡ nonexistent ≡ tombstoned detail bodies | group_session_detail | port → group_competition_session_detail. Expectation changes: an outsider gets `group not found`, while a member asking for a nonexistent or tombstoned session gets `session not found`. Assert outsider ≡ nonexistent group, and nonexistent ≡ tombstoned session. |
| 869-871 | unshared session looks nonexistent | group_session_detail | port → group_competition_session_detail (GA; share-row check gives `session not found`) |
| 872-873 | nonexistent member NOT_FOUND | group_session_detail | port → group_competition_session_detail (GA) |
| 882-886 | athlete leaves B after late start | group_leave (+psql) | keep + header |
| 887-897 | push-after-leave shared; post-leave not shared into B | sync_push (+psql) | keep |
| 898-904 | B stream keeps pre-leave shares, omits post-leave | group_stream | port → group_competition_stream(GB) (`.session.session_id` or `.key`) |
| 906-910 | athlete rejoins B after gap | group_join (+psql) | keep + header |
| 912-917 | rejoin shares again; gap session stays unshared | sync_push (+psql) | keep |
| 924-935 | forced share failure: sync_push commits, owner reads row | sync_push, REST sessions | keep |
| 935-941 | no share; one sanitized group.share_failed log | psql | keep |
| 942-946 | next push self-heals share | sync_push (+psql) | keep |
| 958-961 | last page has_more false, next_cursor null | group_stream | port → group_competition_stream |
| 962-965 | order sort_at_ms desc, kind asc, key desc | group_stream | port → group_competition_stream (same keyset order) |
| 966-969 | S1 deduped, lists both groups | group_stream | port → group_competition_stream (`groups` stays top-level) |
| 970-971 | sort tie present | group_stream | port → group_competition_stream |
| 972-975 | unshared sessions never appear | group_stream | port → group_competition_stream (`.session.session_id`) |
| 976-983 | membership items keyed, events, exact keys | group_stream | port → group_competition_stream (membership item shape unchanged) |
| 984-986 | session card exact key set | group_stream | port → group_competition_stream. Keys become `groups,key,kind,session,sort_at_ms`. |
| 988-992 | defaults: All scope, limit 20 | group_stream | port → group_competition_stream (same defaults; `'{}'` works) |
| 995-1021 | keyset pagination limits 1 and 3, no gaps or repeats | group_stream | port → group_competition_stream. The cursor is opaque base64 text: pass a string. 1005-1006 must decode: `(.next_cursor\|@base64d\|fromjson)=={kind:"competition_stream",group:null,cursor:(.items[-1]\|{sort_at_ms,kind,key})}`. |
| 1024-1030 | per-group scope A only | group_stream | port → group_competition_stream(GA) |
| 1033-1038 | malformed cursors VALIDATION | group_stream | port → group_competition_stream. Inner shapes must be wrapped in a base64 `{kind,group,cursor}` envelope to reach stream_page validation. Add a raw non-base64 case and a scope-mismatch case (new V4 messages, still VALIDATION). |
| 1039-1042 | p_limit 0/51/-1 VALIDATION | group_stream | port → group_competition_stream |
| 1043-1044 | non-member's bad limit reports NOT_FOUND first | group_stream | port → group_competition_stream (require_member precedes limit check) |
| 1045-1050 | non-member ≡ nonexistent group stream | group_stream | port → group_competition_stream |
| 1051-1053 | user with no groups gets empty stream | group_stream | port → group_competition_stream. Exact object adds `contract_version:4`. |
| 1057-1058 | owner removes viewer from B | group_remove_member | keep + header |
| 1059-1061 | removed member's B stream ≡ nonexistent | group_stream | port → group_competition_stream(GB) |
| 1062-1068 | All excludes removed group | group_stream | port → group_competition_stream |
| 1069-1070 | removed member can't open B-only session | group_session_detail | port → group_competition_session_detail. Use GB (`group not found`) or GA (`session not found`); state which. |
| 1071-1072 | removed member still sees S1 via A | group_session_detail | port → group_competition_session_detail (GA) |
| 1073-1077 | owner sees removal membership item | group_stream | port → group_competition_stream(GB) |
| 1085-1086 | shared ExerciseCore vectors file exists | fs | keep |
| 1102-1104 | owner creates vectors group | group_create | keep + header |
| 1106-1122 | every vector: RPC normalizes or reports the validator issue | group_exercise_create | port → group_competition_exercise_create (→ group_exercise_create_v2_pre_competition). Guards validate_name/validate_load_input_mode exact messages, name checked first. `.exercise.load_input_mode` → `.exercise.rules.load_input_mode`. |
| 1124-1159 | table CHECKs agree with vectors | psql | keep |
| 1171-1173 | CHECK rejects empty/untrimmed/101-char source id | psql | keep |
| 1174-1177 | 100-char source id storable | psql | keep |
| 1180-1183 | padded source id JS-trimmed | group_exercise_create | port → group_competition_exercise_create (validate_source_id; same path) |
| 1184-1186 | blank source id VALIDATION message | group_exercise_create | port → group_competition_exercise_create (same message) |
| 1187-1188 | 101-char source id VALIDATION | group_exercise_create | port → group_competition_exercise_create |
| 1193-1206 | exercises group set up; three join; admin promoted | group_create, invite_get, join, set_role | keep + header |
| 1208-1210 | member lists empty catalogue | group_exercise_list | port → group_competition_exercise_list. Exact object becomes `{contract_version:4, exercises:[]}`. |
| 1212-1223 | create shape, trimmed, custom, active; created_by row | group_exercise_create (+psql) | port → group_competition_exercise_create. Key sets become top `contract_version,exercise` and exercise `archived_at_ms,group_exercise_id,name,published_revision,rebuilding,rules,source_exercise_id`. Mode is under `.rules`. |
| 1225-1231 | admin copy keeps standard id, name, mode | group_exercise_create | port → group_competition_exercise_create (`.rules.load_input_mode`) |
| 1232-1234 | admin creates custom exercise | group_exercise_create | port → group_competition_exercise_create |
| 1236-1239 | member create FORBIDDEN; role before VALIDATION | group_exercise_create | port → group_competition_exercise_create (require_manager precedes validate_name in v2 declare) |
| 1240-1243 | member update FORBIDDEN; role before target | group_exercise_update | port → group_competition_exercise_update (needs revision/contribution/metric args; role precedes lookup) |
| 1244-1247 | member archive/unarchive FORBIDDEN | group_exercise_archive, _unarchive | port → group_competition_exercise_archive(p_archived true/false) |
| 1248-1250 | forbidden writes left catalogue unchanged | psql (verifies 1236-1247) | port (rides on the ported writes; the SQL is unchanged) |
| 1252-1256 | list every exercise, name case-insensitive | group_exercise_list | port → group_competition_exercise_list. V4 orders by `name collate "C"`, so the expected order becomes `[squat, bench, row]`. |
| 1259-1264 | outsider list ≡ nonexistent group | group_exercise_list | delete (duplicate of groups-competitions.sh:293-297). Keep the outsider list call that captures NM_BODY as setup for 1265-1278. |
| 1265-1273 | outsider create/update/archive/unarchive ≡ nonexistent (byte-identical) | group_exercise_create/update/archive/unarchive | port → group_competition_exercise_create/_update/_archive(true,false). groups-competitions.sh:307-308 checks the token only, not byte-identity. |
| 1274-1275 | owner removes joiner from exercises group | group_remove_member | keep + header |
| 1276-1278 | removed member list ≡ nonexistent | group_exercise_list | port → group_competition_exercise_list |
| 1281-1284 | missing exercise has own NOT_FOUND message | group_exercise_update | port → group_competition_exercise_update (same `NOT_FOUND: group exercise not found`; valid contribution/metric needed because validate_rules precedes lookup) |
| 1285-1294 | another group's exercise ≡ nonexistent (update/archive/unarchive) | group_exercise_update/archive/unarchive | port → group_competition_exercise_update/_archive (v2 update and group_exercise_require raise the same message) |
| 1295-1296 | input validated before target | group_exercise_update | port → group_competition_exercise_update (validate_name in v2 declare precedes lookup) |
| 1299-1300 | legacy writer refused mode change | group_exercise_update | delete. M25-only rule (`group_metric_require_legacy` + mode refusal in group_exercise_update_pre_competition). V4 allows the change as a rebuild: groups-competitions.sh:429, groups-competition-api-live.test.ts:99-103. |
| 1301-1306 | admin rename: trimmed name, mode/id/source kept | group_exercise_update | port → group_competition_exercise_update (rule-neutral, expected revision 1). The exact `.exercise` object needs the V4 shape (`rules{…}`, published_revision 1, rebuilding false). |
| 1307-1308 | owner also refused mode change | group_exercise_update | delete (same reason as 1299-1300) |
| 1309-1312 | owner update keeps copy's source id and mode | group_exercise_update | port → group_competition_exercise_update (`.rules.load_input_mode`) |
| 1313-1314 | blank name VALIDATION | group_exercise_update | port → group_competition_exercise_update |
| 1315-1316 | unknown load mode VALIDATION | group_exercise_update | port → group_competition_exercise_update |
| 1319-1325 | archive sets 13-digit archived_at_ms, keeps rest | group_exercise_archive | port → group_competition_exercise_archive(p_archived:true) (`.rules.load_input_mode`) |
| 1326-1328 | archive idempotent, keeps first archived_at | group_exercise_archive | port → group_competition_exercise_archive(true) (archive_v2 skips update when already archived) |
| 1329-1335 | archived stays listed, flagged, after active ones | group_exercise_list | port → group_competition_exercise_list. V4 doesn't sort archived last; the expected `[squat, bench, row]` passes only by C-collation coincidence. Reword to V4 order and the archived flag. |
| 1336-1338 | archived exercise read-only | group_exercise_update | port → group_competition_exercise_update. Message changes to `VALIDATION: unarchive the group exercise before editing its rules`. |
| 1339-1343 | unarchive clears archived_at_ms, keeps exercise | group_exercise_unarchive | port → group_competition_exercise_archive(p_archived:false). The exact object must expect `published_revision:null, rebuilding:true` (unarchive trigger). |
| 1344-1346 | unarchive idempotent | group_exercise_unarchive | port → group_competition_exercise_archive(false). Pin archived_at_ms only; rebuilding depends on eval timing. |
| 1347-1351 | round trip restores active list | group_exercise_list | port → group_competition_exercise_list (expected order `[squat, bench, row]`) |
| 1358-1361 | minted no-client_id token accepted | group_get | keep + header |
| 1363-1392 (12 membership entries) | AGENT_FORBIDDEN (client_id) and AUTH_REQUIRED (anon) per RPC | the 12 membership/invite RPCs | keep + header (both tokens raised before the capability check) |
| 1376-1382 + 1385-1392 (7 pre-V4 entries) | same, for stream/detail/exercise RPCs | group_stream, group_session_detail, group_exercise_* | delete (duplicate of groups-competitions.sh:307-315, which covers OAuth AGENT_FORBIDDEN and anon denial for every authenticated-executable group_competition_% RPC). A V4 anon call gets 42501, not AUTH_REQUIRED. |
| 1384 | RPC_BODIES covers every RPCS entry | — | keep (after both arrays drop the same 7 names) |
| 1393-1396 | rejected calls changed no group, created none | psql (verifies membership loop) | keep + header |
| 1397-1399 | rejected calls wrote/archived no group exercise | psql | delete (vacuous once the exercise entries leave the loop; V4 denial happens before any write, per groups-competitions.sh:307-315) |
| 1402-1404 | group_active_role not callable via PostgREST (42501) | PostgREST → helper | keep |
| 1405-1407 | group_session_card_json not callable (42501) | PostgREST → helper | port → group_competition_session_card. The old helper is orphaned once group_stream/_v2 go; a PGRST202 404 would fail `.code=="42501"`. |
| 1425-1470 | direct select/insert/update/delete denied on five tables | PostgREST tables | keep |
| 1471-1488 | direct access changed no rows | psql | keep |
| 1501-1518 | group_events RLS/policies/grants/owner col/no Sync FK | psql | keep |
| 1519-1526 | event writers definer, pinned, not client-executable | psql | keep |
| 1531-1547 | session/membership event triggers posture and order | psql | keep |
| 1551-1564 | kind CHECK: board kinds hit shape CHECK, unknown rejected | psql | keep (D3 keeps table, kinds and rows) |
| 1565-1581 | direct REST access to group_events denied, unchanged | PostgREST + psql | keep |
| 1595-1610 | one item per group; no dup on re-push; started_at edit moves | sync_push (+psql) | keep |
| 1611-1615 | card sorts at live started_at | group_stream | port → group_competition_stream(GA) (top-level sort_at_ms unchanged) |
| 1622-1641 | event failure: commit, share kept, sanitized event_failed log only | sync_push, REST, psql | keep |
| 1642-1645 | itemless session absent from stream | group_stream | port → group_competition_stream(GA) |
| 1646-1651 | next push self-heals items | sync_push (+psql) | keep |
| 1652-1655 | self-healed session appears in stream | group_stream | port → group_competition_stream(GA) |
| 1673-1676 | group_create writes exactly owner joined item | group_create (+psql) | keep + header |
| 1677-1691 | join writes one item; no-op join and set_role none | invite_get, join, set_role (+psql) | keep + header |
| 1692-1704 | leave/rejoin/remove/join one item each; transfer none | leave, join, remove_member, transfer_ownership (+psql) | keep + header |
| 1705-1710 | membership items at floor epoch ms of period | psql | keep |
| 1763-1766 | live writers = one item per share and edge | psql | keep. A ported exercise update that changes rules makes the eval publish a `rules_change` event (group_metric_eval_publish) in GX and breaks this, so keep the ports rule-neutral. |
| 1767-1770 | snapshot three users' All streams | group_stream | port → group_competition_stream |
| 1772-1773 | stream reads only group_events | group_stream | port → group_competition_stream |
| 1774-1779 | backfill count = live, matches sources, idempotent | psql | keep |
| 1780-1782 | streams byte-identical after backfill | group_stream | port → group_competition_stream |

### Fixture and setup code that must change (not assertions)

- **groups-fixtures.sh:119-128 `rpc()`:** add `-H "x-boga-group-contract: 4"`. Without it every
  membership call in this lane fails `UPDATE_REQUIRED` on an active stack.
  groups-leaderboards.sh shares this helper.
- **groups-contract.sh:5-30 header comment:** names `group_exercise_create`, the role matrix and
  archive in the pre-V4 RPCs; update it.
- **160-163 `RPCS`:** drop `group_stream group_session_detail group_exercise_list
  group_exercise_create group_exercise_update group_exercise_archive group_exercise_unarchive`.
- **164-169 `HELPERS`:** drop `group_session_card_json` and `group_session_exercises_json` if the
  removal migration drops orphaned helpers (their only callers are pre-V4 stream/detail).
  `group_exercise_json` stays (called by `group_exercise_json_v2`, which V4 reaches through the
  v2 pre-competition bodies).
- **641-644 `stream()`:** call `group_competition_stream`. `p_before` becomes a JSON string
  (opaque cursor) or null.
- **646-648 `detail()`:** call `group_competition_session_detail` with an added `p_group_id`
  argument (GA in most call sites; GB at 1069).
- **741-748 `card()`:** jq paths move under `.session`.
- **995-1015 `paginate()` and 1748-1761 `stream_all()`:** pass the cursor as a JSON string
  (`jq '.next_cursor'` already yields one). paginate's 1005-1006 cursor-shape check needs the
  base64 decode (see the 995-1021 row).
- **1033-1035 bad-cursor list:** re-express the inner shapes as base64-encoded
  `{kind:"competition_stream",group:null,cursor:<bad>}` envelopes.
- **1091-1100 `b_gx_create` / `b_gx_update` / `b_gx`:** V4 argument sets.
  - `b_gx_update` needs `p_expected_revision`, `p_bodyweight_contribution` (0) and
    `p_default_metric` (`e1rm`). It needs the current revision from the create response
    (`.exercise.rules.rules_revision`) or from psql.
  - `b_gx` gains `p_archived`.
  - The two loops (1265-1273, 1287-1294) collapse archive and unarchive into one RPC with two
    bodies.
- **1102-1104, 1193-1206, 1673-1704:** group/membership setup only needs the header.
- **1110 vector body:** call `group_competition_exercise_create` (defaults cover contribution 0
  and metric e1rm).
- **1376-1382 `RPC_BODIES`:** drop the 7 pre-V4 entries in step with `RPCS`.
- **1427-1431 `exercise_rows()` / 1487:** unchanged SQL; still valid, because the GX rows are now
  created by the ported V4 calls.

### Totals

Counts are of table rows (a row may group identical-shape checks).

| verdict | rows |
| --- | --- |
| keep | 40 |
| keep + header | 55 |
| port → V4 | 73 |
| delete | 5 |
| **total** | **173** |

Port rows by first-named V4 target:

| V4 target | rows |
| --- | --- |
| group_competition_stream | 32 |
| group_competition_session_detail | 11 |
| group_competition_exercise_create | 9 |
| group_competition_exercise_update | 9 |
| group_competition_exercise_archive | 5 |
| group_competition_exercise_list | 5 |
| group_competition_session_card | 1 |
| psql check that rides on the ported writes (1248-1250) | 1 |

The multi-target rows 1265-1273 and 1285-1294 are counted under their first target.

The 5 delete rows:
- 1259-1264: duplicate of groups-competitions.sh:293-297.
- 1299-1300 and 1307-1308: M25 legacy-only mode-change refusal. V4 allows the change:
  groups-competitions.sh:429 and groups-competition-api-live.test.ts:99-103.
- The 7 pre-V4 RPC_BODIES loop entries: duplicate of groups-competitions.sh:307-315.
- 1397-1399: vacuous once those entries leave the loop.


## 6. Test map — groups-leaderboards.sh, groups-boards.sh

Read-only research against origin/main 538baa4a and the final function definitions (active stack).
Fixture file: `supabase/tests/lib/groups-fixtures.sh` (the version with no header).

### What changes once the stack is V4-active (this decides most verdicts)

1. **Every new comparison is non-legacy.** The trigger `group_metric_initial_revision` writes `legacy = not group_competition_active()`.
   `group_competition_activate` gives every existing exercise a new non-legacy revision, archived ones included.
   So `group_eval_apply` never takes its `group_eval_apply_legacy` branch. The M25 board engine never runs on an active stack.
   That engine wrote `group_board_entries`, `group_board_state` and `group_events.contract_version = 1`.
   Instead, `group_eval_apply` → `group_metric_eval_enqueue` → Edge `group-eval` metric loop → `group_metric_eval_prepare` / `group_metric_eval_publish` → `group_metric_apply_member`.
   That path writes `group_metric_set_scores`, `group_metric_board_entries`, `group_metric_board_state` and `group_events.contract_version = 2` (with `rules_revision`).
   `group_metric_apply_member` is a near line-for-line port of the M25 algorithm:
   - provisional records (step 3)
   - value-based voids (`edited` / `deleted`)
   - `link` / `unlink` / `record` / `rules` (warm-up) / `void` classes
   - carry of unchanged boards into a replacement record
   - All and Certified lead changes with the same reasons
   So almost every groups-boards.sh assertion has a real V4 counterpart: the same logic over a different table, metric names and payload keys.
2. **Metrics are `volume` + `e1rm`, not `weight` + `e1rm`.** `group_metric_names()` returns this when active, and readers reject `weight` (`group_competition_board` takes only `volume` and `e1rm`).
   - Ordinary units are `kg_reps` and `kg` (`competition-score.ts`).
   - Volume is entered kg × reps × D6 factor. 1RM is also × factor.
   - There is no raw-Weight board in protocol 4 (`group-competition-contract.md:38`).
   - Every `weight` expectation becomes `volume = w × r × factor`. Fixtures chosen so that Weight orders members must be re-checked: some no longer produce the same events (noted per row).
3. **Payload keys differ.**
   - Record boards: `value` / `previous_value` / `unit` / `fingerprint` (was `value_kg` / `previous_value_kg`).
   - Holders (`group_metric_holder_json`): `value`, `unit`, `performance`.
   - Link effects: `{rank, value, metric, unit, rules_revision}`.
   - Record payloads have `performance`, not `weight_kg`.
   - Entries: `group_metric_board_entries.value`, filtered by the current `rules_revision`. There are no `entered_weight_kg`, `load_factor` or `weight_kg` columns.
4. **Silence rules differ.**
   - V4 is silent only when the revision is unpublished (a rules change → one `rules_change` event).
   - It is also silent for a source-rules-only rescore (causes ⊆ {load_mode, rules, certification} including load_mode → `rule_rescore_baseline`, no void or record).
   - The M25 "causes ⊆ {rules}" silence (R10) and "load-mode change voids + re-records 1RM" (R7) do not exist in V4.
5. **`group_eval_session_targets` now unions `group_metric_board_state`.** A member already evaluated on an exercise of a group the session is shared to keeps that target after unlinking ("Corrections must validate those raw pins").
   Graph `members` = all active members, so one metric job writes board state for every member.
   On an active stack, leaderboards.sh session-job `targets` expectations widen once GX/GX3/GXA have been published. Rows marked ⚠targets.
6. **Unarchive of a non-legacy exercise** (`group_exercise_unarchive_v2_pre_competition`, reached via `group_competition_exercise_archive(p_archived:false)`) queues no M25 target job.
   Its catch-up is a metric job from the `group_metric_on_unarchive` trigger (cause `membership`).
7. **Readers.**
   - `group_competition_board(p_group_id, p_group_exercise_id, p_metric, p_certified, p_limit 1..100, p_cursor text)` returns `{state, entries[{rank, value, unit, member, former, performance, write_token, certification}], entry_count, me, next_cursor}`. There is no `has_more` and no `all_entry_count`. Rank order is value desc, achieved_at_ms, member uuid.
   - `group_competition_history(..., p_revision, p_before text, p_limit 1..100)` returns `{events, next_cursor}`. It includes `rules_change` rows.
   - `group_competition_podiums(p_group_id, p_certified)` has no `p_metric`. It uses each exercise's `default_metric`, excludes archived exercises and orders by name.
   - `group_competition_stream(p_group_id, p_before text, p_limit 1..50)` returns items `session` / `membership` / `competition` (an event wrapper whose `event.kind` is record / record_voided / link / unlink).
   - No reader is granted to anon (the catalog shows `authenticated` only), so `AUTH_REQUIRED` is unreachable.
8. **Header.** `group_require_app_user()` → `group_competition_require_capability()` needs `x-boga-group-contract: 4` for every group RPC, membership ones included.
   The fix is one line: add `-H "x-boga-group-contract: 4"` to `rpc()` at `groups-fixtures.sh:119-128`.
   `rest()`, `sign_in()`, `push()` (sync_push) and `eval_drain()` need nothing; the header is harmless on sync_push.

#### Dedupe caveat
`groups-competitions.sh:29-280` runs on the pre-cutover reset plus activation, which D1 removes, so that half probably does not survive. Duplicates below cite only steady-state V4 lines in `groups-competitions.sh:282-651` or `apps/mobile/__tests__/groups-competition-api-live.test.ts`.

#### How the evaluator is driven (both files)
- Direct-drain mode: the kick URL is set to `''` and cron `group-eval-sweep` is paused. The lane POSTs `functions/v1/group-eval` with the secret (`eval_drain`, `groups-fixtures.sh:146-151`).
- One drain runs session jobs first and then the metric-job loop (`supabase/functions/group-eval/index.ts:176-197`), so a single drain publishes V4 boards.
- Only `groups-leaderboards.sh:745-805` (unreachable/failing kick, sweep, pg_net smoke) turns a kick URL on.
- The worker RPCs (`group_eval_*`, `group_metric_eval_*`) are live in production and stay.

#### Dependencies on the pending/legacy path (must change)
- **groups-boards.sh, whole body.** Its exercises come from `group_exercise_create` and are legacy on a pending stack, so it tests `group_eval_apply_legacy`.
  - It calls `group_eval_apply_legacy` directly at 819 and 869.
  - It calls `group_eval_apply` at 1137, expecting it to take the group lock. On V4 the lock is in `group_metric_eval_publish`.
  - It reads `group_board_entries` and contract-1 payloads.
- **groups-leaderboards.sh:**
  - The ⚠targets rows: the M25 targets have no board-state union because legacy exercises never write `group_metric_board_state`.
  - 535-538: the legacy unarchive branch.
  - 715-742: on a pending stack the source graph of a legacy GX is null, so the "revived comparison job completes" passes only as a *frozen* no-op. On V4 it is a real protocol-4 evaluation.

#### Fixture / setup code calling pre-V4 RPCs
| file:line | call | change |
|---|---|---|
| groups-fixtures.sh:119-128 | `rpc()` (no contract header) | add `x-boga-group-contract: 4` |
| groups-fixtures.sh:3-4 | comment names the lanes | update if lanes are renamed |
| groups-leaderboards.sh:221-230 | `gx_create` → `group_exercise_create` | → `group_competition_exercise_create` (+`p_bodyweight_contribution:0`, `p_default_metric`); `.exercise.group_exercise_id` is unchanged |
| groups-leaderboards.sh:231 | `group_exercise_archive` | → `group_competition_exercise_archive(p_archived:true)` |
| groups-leaderboards.sh:531 | `group_exercise_unarchive` | → `group_competition_exercise_archive(p_archived:false)` |
| groups-boards.sh:231-238 | `gx()` → `group_exercise_create` | → `group_competition_exercise_create` |
| groups-boards.sh:240-250 | `board()` / `history()` → `group_board` / `group_board_history` | → `group_competition_board` (`p_limit`, `p_cursor` text) / `group_competition_history` (`p_revision`, `p_before` text, `p_limit`) |
| groups-boards.sh:147-158 | `entry()` reads `group_board_entries.value_kg` | → `group_metric_board_entries.value` at the exercise's current `rules_revision`, `not certified` |
| groups-boards.sh:160-180 | `since()` / `latest()` on `group_events` | work as-is (contract 2 rows); metric labels become `volume` / `e1rm` |
| groups-boards.sh:344-351 | `boards_of()` reads `previous_value_kg` | → `previous_value`; metric `volume` |
| groups-boards.sh:125-132 | `e1rm` oracle | keep; add a volume oracle `w*r*factor` |
| groups-boards.sh:656-661, 839-842 | `group_certify` | → `group_competition_certify` (write token from the board, or from `group_metric_set_scores` via psql for a warm-up) |
| groups-boards.sh:764, 775 | `group_exercise_archive` / `group_exercise_unarchive` | → `group_competition_exercise_archive` |
| groups-boards.sh:818-820, 868-870 | direct `group_eval_apply_legacy` | → set `group_metric_set_scores.counting=true` for the warm-up, call `group_metric_apply_member(gid, uid, gx, rev, group_metric_eval_source_graph(gid,gx), false)`, reset |
| groups-boards.sh:1213-1216 | outsider `group_exercise_create` | → `group_competition_exercise_create` |
| groups-boards.sh:61-79 | cleanup | probably fine; verify that `group_metric_*` rows cascade from `groups` (not checked) |

---

### supabase/tests/groups-leaderboards.sh

| line(s) | asserts | RPC(s) | verdict |
|---|---|---|---|
| 64-69 | kick URL, sweep cron job and eval secret exist | psql `group_eval_config`, `cron.job` | keep |
| 133-137 | (helper used by every drain) drain is 200, `jobs` array, rules_version 6 | Edge group-eval | keep |
| 213-215 | owner creates group G | group_create | keep + header |
| 216-218 | other user creates group H | group_create | keep + header |
| 221-230 | create GX, GX3, GXA, HX (setup) | group_exercise_create | port → group_competition_exercise_create (setup only; no logic asserted) |
| 231-232 | archive GXA (setup) | group_exercise_archive | port → group_competition_exercise_archive(p_archived:true) |
| 234-236 | invite code | group_invite_get | keep + header |
| 243-260 | queue/facts/rules_state: RLS, no policies, grants, owner col, FK (×3) | psql catalog | keep |
| 262-265 | evaluator functions pin search_path | psql | keep |
| 266-270 | service_role executes exactly the `group_eval_*` worker surface | psql | keep (worker RPCs stay live) |
| 271-274 | anon/authenticated execute no evaluator function | psql | keep |
| 275-278 | sessions triggers share → stream → eval, name order | psql pg_trigger | keep (V4 stream session cards need `sessions_group_stream_event`) |
| 279-282 | enqueue triggers on the five Sync tables | psql | keep |
| 283-285 | sweep cron schedule and command | psql | keep |
| 286-290 | only sync_push/dev_wipe write exercise_group_links | psql prosrc scan | keep |
| 293-302 | direct PostgREST select of queue/facts denied or empty | REST | keep |
| 303-307 | client `group_eval_claim` is a 42501 denial | group_eval_claim (worker) | keep |
| 308-311 | group-eval 401 with no secret or a wrong one | Edge | keep |
| 312-313 | group-eval GET is 405 | Edge | keep |
| 345-346 | unshared session not queued | psql | keep |
| 348-349 | unshared session has no facts | psql | keep |
| 352-353 | athlete joins G | group_join | keep + header |
| 379-381 | 17-row push coalesces into one session job | psql | keep |
| 383-384 | S1 job completes, no targets | Edge/expect_mine | keep (still `[]`: no metric publish yet) |
| 385-386 | S1 job left queue | psql | keep |
| 397-404 | facts b1/b3/b9/bb/d1/g1 (performed, live, kg, reps, e1RM) | psql group_set_facts | keep (facts feed V4 too: `group_set_is_warm_up` reads them) |
| 405-413 | every S1 fact: position, start, rules version, SQL fingerprint | psql | keep |
| 414-417 | exercise identity and order per fact | psql | keep |
| 426-443 | fingerprint/live through re-push, edit, tombstone, undelete (429, 433, 434, 438, 439, 442, 443) | psql | keep |
| 446-463 | fingerprint ignores type/order; reps/status move it; restore (449, 450-451, 455, 459, 460, 463) | psql | keep |
| 465-470 | exercise tombstone: not live, fingerprint kept | psql | keep |
| 476-477 | session tombstone makes every fact not live | psql | keep |
| 481-483 | undelete restores live per row | psql | keep |
| 488-492 | hard-deleted set's fact removed | psql | keep |
| 500-501 | link queues `target:GX:link` | psql | keep |
| 502-503 | link target job resolves GX | Edge | keep |
| 504-506 | session job resolves linked target `[GX]` | Edge | keep (V4 is still `[GX]`) |
| 511-516 | non-uuid/unknown/foreign-exercise links inert, no failure row | psql | keep |
| 520-522 | foreign-group link: target job, no live target | Edge | keep |
| 525-527 | archived target frozen | Edge | keep |
| 528-530 | session job skips archived target | Edge | keep (still `[GX]`) |
| 531-532 | unarchive GXA ok | group_exercise_unarchive | port → group_competition_exercise_archive(p_archived:false) |
| 533-538 | unarchive queues a catch-up target job; S1 resolves `[GX,GXA]` | Edge | port → group_competition_exercise_archive + metric-job catch-up. A non-legacy unarchive queues no `GXA:link` target job. Expect only the S1 session job, with `.metric_jobs[]` GXA completed (cause membership). Update the comment at 535. |
| 542-546 | load-mode change re-applies GX (live) and HX (not live) | Edge | keep |
| 549-553 | retarget re-applies the old and new target | Edge | keep |
| 555-557 | unlink re-applies the target it left | Edge | keep |
| 558-560 | unlinked exercise no longer resolves (`[GXA]`) | Edge | keep ⚠targets. V4 resolves `[GX,GX3,GXA]` through the board-state union. The assertion then proves the union; reword the message. |
| 567-571 | claimed job is leased | psql group_eval_claim | keep |
| 572-574 | push during the claim bumps the generation | psql | keep |
| 576-580 | stale-generation complete returns completed=false | psql group_eval_complete | keep |
| 581-583 | job released not deleted; stale complete writes nothing | psql | keep |
| 584-585 | next drain writes the newer fact | Edge | keep |
| 588-592 | leased job not claimed twice | psql | keep |
| 593-595 | expired lease reclaimed | Edge | keep ⚠targets (`[GX,GX3,GXA]`) |
| 600-601 | rules bump requeues S1 with cause rules | psql group_eval_requeue_rules | keep |
| 602-603 | rules requeue completes | Edge | keep ⚠targets. On V4 the metric jobs it enqueues are not silent; no event assertion here, so unaffected. |
| 605-606 | rules_state records version 6 | psql | keep |
| 625-627 | every bulk session normalized | psql | keep |
| 628 | sweep doesn't kick when facts are current | psql group_eval_sweep | keep (the sweep also scans `group_metric_eval_queue` globally) |
| 634-641 | bulk rules bump finishes through the sweep; requeues `50 1` | psql + Edge | keep |
| 648-652 | enqueue fault: pushed row still committed | REST | keep |
| 653-657 | one sanitized enqueue-failure row | psql app_logs | keep |
| 659-660 | next push after the fault enqueues | psql | keep |
| 671-674 | failing S2 job, S1 completes | Edge | keep ⚠targets (S1 → `[GX,GX3,GXA]`) |
| 675 | b1 fact written despite S2 fault | psql | keep |
| 676-678 | failed job kept with attempts, backoff, sqlstate | psql | keep |
| 679-682 | one sanitized job-failure row | psql | keep |
| 686-687 | capped attempt fails | Edge | keep |
| 689-692 | failure at cap parks the job | psql | keep |
| 693-698 | one sanitized parked row with attempts | psql | keep |
| 699 | parking logs eval_parked, not eval_failed | psql | keep |
| 700-701 | parked job never claimed | psql group_eval_claim | keep |
| 702 | sweep doesn't kick for a parked job | psql group_eval_sweep | keep |
| 704-707 | group_eval_retry_parked revives with a fresh budget | psql | keep |
| 708-709 | retried S2 completes with no targets | Edge | keep ⚠targets. S2 is shared to G, so the union gives `[GX,GX3,GXA]`. |
| 710 | S2 fact p1 | psql | keep |
| 715 | comparison job enqueued | psql group_metric_eval_enqueue (internal) | keep |
| 716-723 | comparison failure at cap accepted and parks | psql group_metric_eval_fail (worker) | keep |
| 724-727 | parked comparison job: attempts, unclaimable, lease cleared | psql | keep |
| 728-732 | one sanitized comparison parked row | psql | keep |
| 733-735 | parked comparison job never claimed | psql group_metric_eval_claim | keep (claim(20) leases every other claimable metric job; harmless here) |
| 736-739 | retry_parked revives the comparison job | psql | keep |
| 740-742 | revived comparison job completes | Edge metric loop | keep. On V4 this becomes a real protocol-4 publish; on pending it was a frozen no-op. |
| 745-749 | unreachable kick: row committed, job waits | REST/psql | keep |
| 751-752 | drain after unreachable kick writes fact | Edge | keep |
| 757-764 | failing kick: pushed rows committed | REST | keep |
| 765-769 | one sanitized kick-failure row per push | psql | keep |
| 770 | job still queued under failing kick | psql | keep |
| 772-773 | drain after failing kick | Edge | keep |
| 775-776 | no enqueue failures beyond the forced one | psql | keep |
| 782-783 | missed kick leaves job pending | psql | keep |
| 786 | sweep kicks when work is claimable | psql | keep |
| 787-790 | sweep drains the missed kick | psql wait | keep |
| 793-801 | one pg_net request per 32-row push | psql net seq | keep (metric enqueue does not kick) |
| 802-803 | kick drains the push (30 facts) | psql wait | keep |
| 811-812 | athlete leaves G | group_leave | keep + header |
| 813-815 | former member's session job resolves no target | Edge | keep (`target_is_live` needs active membership) |
| 816 | former member's facts still normalized | psql | keep |

---

### supabase/tests/groups-boards.sh

"port → V4 engine" means the same events and entries, produced by `group_metric_apply_member` through a drain (group-eval → `group_metric_eval_publish`). It runs after `group_competition_exercise_create` and the ported helpers above.
"vol" means expected values become volume `w×r×factor`.

| line(s) | asserts | RPC(s) | verdict |
|---|---|---|---|
| 269-271 | group_create G | group_create | keep + header |
| 272-274 | group_create H | group_create | keep + header |
| 275-277 | invite code | group_invite_get | keep + header |
| 278-281 | A, R, M join G | group_join | keep + header |
| 286 | setup drain, no failed job | Edge | keep |
| 293-308 | group_board_entries/state: RLS, no policies, grants, owner col, FK | psql | keep (tables stay, D3). Consider adding `group_metric_board_entries/state` to the loop; only `group_metric_set_scores` direct access is covered (competitions.sh:300). |
| 309-316 | direct REST select of both tables denied or empty | REST | keep |
| 319-323 | board functions pin search_path | psql | keep |
| 324-329 | clients execute exactly group_board, group_board_history, group_board_podiums | psql | port → V4 read surface: group_competition_board/history/podiums/stream executable by authenticated only, never anon. competitions.sh:307-315 only enumerates them. |
| 330-334 | service_role executes no board internal | psql | keep (the dropped names in `not in` become inert) |
| 335-338 | the three reads are security definer | psql | port → assert prosecdef on group_competition_board/history/podiums |
| 339-341 | rejoin catch-up trigger exists | psql | keep (`group_board_enqueue_links` also re-applies from `group_metric_board_state`) |
| 357-362 | (setup) gx + defs + links | group_exercise_create | port → group_competition_exercise_create |
| 365 | link with no counting sets writes no event | Edge | port → V4 engine (P16 no-op link) |
| 370 | first set: record + lead changes on both boards | Edge | port → V4 engine; metrics volume,e1rm |
| 371 | first record boards: previous null, group record | psql payload | port → V4 engine; key `previous_value` |
| 372-373 | A entries weight/e1rm @r1a1 | psql entries | port → V4 engine; vol 500, e1rm |
| 374-378 | first lead change → its record, no previous, leader A | psql | port → V4 engine (holder keys unchanged) |
| 384 | rival takes #1: record + 2 lead changes | Edge | port → V4 engine; **fixture**: R 110×3 has vol 330 < 500, so only the e1rm lead change. Re-pick, e.g. 110×5. |
| 385 | rival record boards | psql | port → V4 engine |
| 386-387 | lead change names previous leader | psql | port → V4 engine |
| 393-394 | non-beating set writes nothing; entry stays | Edge/psql | port → V4 engine |
| 400-401 | PR not #1: record only, `weight:100:false` | Edge/psql | port → V4 engine; **fixture**: 105×2 beats neither vol nor e1rm. Re-pick a set that beats A's own best but not R's. |
| 419 | R2 setup entry | psql | port → V4 engine (vol) |
| 424 | edit down: void(edited) + void lead changes | Edge | port → V4 engine |
| 425 | entry falls back | psql | port → V4 engine |
| 426-429 | lead change points at the void | psql | port → V4 engine |
| 430-431 | void names who now holds the record | psql payload.leaders | port → V4 engine (same shape) |
| 439 | unperformed → void(edited) + lead changes | Edge | port → V4 engine |
| 447 | deleted → void(deleted) + lead changes | Edge | port → V4 engine |
| 448 | entry falls back | psql | port → V4 engine |
| 449-451 | 3 records, each voided once | psql | port → V4 engine |
| 468 | edit up: void + new record | Edge | port → V4 engine |
| 469-472 | both records same set, one voided | psql | port → V4 engine |
| 473 | entry at new value | psql | port → V4 engine |
| 492 | session delete voids (deleted) + lead changes | Edge | port → V4 engine |
| 493 | board empties | psql | port → V4 engine |
| 494-496 | emptied board's lead change has no leader | psql | port → V4 engine |
| 499-502 | voided record card stays in stream while session tombstoned (D15) | group_stream | port → group_competition_stream. The item is `kind:"competition"` with `event.kind:"record"` and `event.voided==true`; V4 has no `voided.reason` on the record, so read it from the record_voided event. |
| 507 | undelete writes fresh records + lead changes | Edge | port → V4 engine |
| 508 | fresh record is a new event | psql | port → V4 engine |
| 534 | retroactive link: link item + lead changes | Edge | port → V4 engine |
| 535-537 | retroactive link writes no record (P16) | psql | port → V4 engine |
| 538-543 | link item effects and exercise ids | psql payload | port → V4 engine; **shape**: effects sort e1rm, volume, so `effects[1]` is volume; `after` is `{rank,value,metric,unit,rules_revision}` |
| 544-545 | lead change related to link item | psql | port → V4 engine |
| 550 | link that moves nothing writes no item | Edge | port → V4 engine |
| 555 | unlink: unlink item + lead_change(link) | Edge | port → V4 engine |
| 556 | unlink falls back to still-linked exercise | psql | port → V4 engine |
| 557-558 | unlink never voids | psql | port → V4 engine |
| 564 | retarget leaves old board (unlink only) | Edge | port → V4 engine |
| 565 | retarget joins new board | Edge | port → V4 engine |
| 566 | no entry left on old board | psql | port → V4 engine |
| 573-574 | no Certified entry without certification | psql group_board_entries | port → `group_metric_board_entries` certified count 0 |
| 575-581 | default podiums Certified·e1RM empty; All count 2 | group_board_podiums | port → group_competition_podiums (`p_certified` default true): `board.entries==[]`, `me==null`, `entry_count==0`. **delete the `all_entry_count` clause**: V4 has no All count on a Certified board. |
| 588-599 | (setup) R7 per-side and total comparisons | group_exercise_create | port → group_competition_exercise_create |
| 600 | D6: Weight is the raw entered kg | psql | delete (no Weight metric in protocol 4; raw Weight is explicitly gone, contract.md:38) |
| 601 | D6: e1RM ÷2 | psql | port → V4 engine (ordinary e1rm × factor; vol 100×5×0.5 = 250 is the new Volume check) |
| 602 | D6: Weight raw (per side → total) | psql | delete (no Weight metric) |
| 603 | D6: e1RM ×2 | psql | port → V4 engine |
| 604-608 | entered_weight_kg/load_factor/weight_kg columns | psql | delete (M25-only entry columns; V4 keeps `performance.source_load_input_mode`, wire-guarded at competitions.sh:129) |
| 609-612 | 1RM entry carries raw Weight | psql | delete (M25-only column) |
| 617 | mode up: 1RM void + record | Edge | port → V4 engine; **expectation inverts**. The load_mode cause is a source-rules-only rescore, so expect `""` (no void or record) with `rule_rescore_baseline` set. |
| 618 | mode up leaves Weight raw | psql | delete (no Weight) |
| 619 | mode up 1RM rescaled | psql | port → V4 engine (also check vol rescaled) |
| 623 | mode down leaves Weight raw | psql | delete (no Weight) |
| 624 | mode down 1RM rescaled | psql | port → V4 engine |
| 625-631 | mode down voids 1RM; replacement keeps only Weight | psql | port → V4 engine, merged with 617: assert silent (no events since MARK) |
| 642-652 | (setup) V raw-Weight fixtures | group_exercise_create | delete with section |
| 653 | V per-side Weight raw | psql | delete (no Weight metric; stored-converted Weight is an M25 forward-only artifact) |
| 654 | V rival leads Weight | psql | delete (same) |
| 656-661 | certify both V sets | group_certify | delete (setup of a deleted section) |
| 663-664 | V athlete record exists | psql | delete (same) |
| 672-673 | stored converted Weight leads the board | group_board | delete (same) |
| 679 | converted best falls silently | Edge | delete (same) |
| 680 | entry falls to raw | psql | delete (same) |
| 681-683 | certified Weight falls to raw | psql | delete (same) |
| 684-685 | rival leads again | group_board | delete (same) |
| 686-687 | stored record stands | psql | delete (same) |
| 693 | raw Weight PR is a record | Edge | delete (same) |
| 694-695 | record boards against raw baseline | psql | delete (same) |
| 696 | raw PR entry | psql | delete (same) |
| 723-724 | V2 stored converted Weight | psql | delete (same) |
| 729 | V2 raw PR on first apply is a record | Edge | delete (same) |
| 730-731 | V2 boards | psql | delete (same) |
| 732 | V2 entry | psql | delete (same) |
| 747 | V3 reps edit voids + replaces | Edge | delete (same; the V4 carry rule is ported at 1054) |
| 748-749 | V3 replacement keeps Weight card | psql | delete (same) |
| 750 | V3 entry raw | psql | delete (same) |
| 764-765 | archive GX9 | group_exercise_archive | port → group_competition_exercise_archive(true) |
| 770 | no event while archived | Edge | port → V4 engine (`group_metric_eval_enqueue` refuses archived) |
| 771 | entries frozen | psql | port → V4 engine |
| 772-774 | archived board readable with its rows | group_board | port → group_competition_board: `state=="archived"`, `entries[0].value` (vol 500). competitions.sh:274 covers only the upgrade-path legacy archive. |
| 775-776 | unarchive GX9 | group_exercise_unarchive | port → group_competition_exercise_archive(false) |
| 777-778 | sets logged while archived count after unarchive | Edge | port → V4 engine (catch-up via the `group_metric_on_unarchive` metric job) |
| 779 | catch-up entry | psql | port → V4 engine |
| 786-787 | (setup) corrupt an entry | psql | port with 789 |
| 789 | rules_version bump requeues | psql group_eval_requeue_rules | port → group_competition_exercise_update. A cause-`rules` requeue is **not** silent in V4 (it would emit a record from the corrupted baseline). V4 silent recompute = new rules revision: only a `rules_change` event, entries recomputed. |
| 790-791 | recompute corrects entries | psql | port (same, new revision's entries) |
| 792-793 | recompute writes no event | psql | port (same: no events except `rules_change`). Alternatively delete; M25 cause-based silence has no V4 counterpart. |
| 800-810 | (setup) W fixtures | group_exercise_create | port → group_competition_exercise_create |
| 811-812 | warm-up doesn't count (entries) | psql | port → V4 engine (publisher `counting and working`). Jest groups-competition-evaluation.test.ts:75 covers only the TS side. |
| 813-814 | warm-up made no record | psql | port → V4 engine |
| 818-820 | (setup) fake stored warm-up best | group_eval_apply_legacy | port → `group_metric_apply_member` with `group_metric_set_scores.counting=true` for wa2. **fixture**: 130×3 has vol 390 < 500, so use e.g. 130×5. |
| 821 | stored warm-up best entry | psql | port → V4 engine |
| 822-823 | stored warm-up record exists | psql | port → V4 engine |
| 829 | warm-up best falls silently (class rules) | Edge | port → V4 engine |
| 830-831 | entries fall to best working set | psql | port → V4 engine |
| 832-834 | rival leads again | group_board | port → group_competition_board (`entries[0].member.user_id`, `.value`) |
| 835-836 | stored warm-up record stands | psql | port → V4 engine |
| 839-845 | stored warm-up record cannot be certified | group_certify | port → group_competition_certify (token from `group_metric_set_scores`); message becomes `NOT_FOUND: record set not found for this metric` |
| 851 | heavy warm-up: only working set records | Edge | port → V4 engine (re-derive with vol) |
| 852 | record boards | psql | port → V4 engine (re-derive) |
| 853-854 | warm-up heavier than working never ranks | psql | port → V4 engine |
| 855-856 | heavy warm-up cannot be certified | group_certify | port → group_competition_certify |
| 857-858 | working record set can be certified | group_certify | port → group_competition_certify (token from board) |
| 868-870 | (setup) fake member warm-up best | group_eval_apply_legacy | port → `group_metric_apply_member` (as 818) |
| 871 | member's stored warm-up best leads | psql | port → V4 engine |
| 876-877 | edited warm-up record voided with lead changes | Edge | port → V4 engine. The protocol-3 twin is groups-bodyweight.sh:452-520; port this section once. |
| 898-899 | 0 kg sets: no Volume/1RM entry | psql | port → V4 engine (Jest groups-competition-contract.test.ts:82 covers only TS omission) |
| 900 | 0 kg makes no event | Edge | port → V4 engine |
| 905 | first loaded set is first record | Edge | port → V4 engine |
| 906 | loaded set ranks | psql | port → V4 engine (vol 20×5×0.5 = 50) |
| 930 | provisional record mid-session (D2) | Edge | port → V4 engine |
| 936 | edit up while active: no event | Edge | port → V4 engine |
| 937-940 | record updated in place with its lead change | psql | port → V4 engine; **keys**: `payload->'boards'[volume].value`, leader `.value` (no `weight_kg`/`value_kg`) |
| 942-945 | in-place edit keeps previous best | psql | port → V4 engine (`previous_value`) |
| 949 | fix that still beats: no event | Edge | port → V4 engine |
| 950-955 | card at corrected value, same baseline, leads | psql | port → V4 engine (keys) |
| 959 | losing #1 via fix: no event | Edge | port → V4 engine |
| 960-962 | record stays; its lead changes retracted | psql | port → V4 engine |
| 963-964 | history ends with rival's lead | psql | port → V4 engine |
| 968 | fix below previous best: no void | Edge | port → V4 engine |
| 969-970 | record and lead changes gone | psql | port → V4 engine |
| 971 | fallback entry | psql | port → V4 engine |
| 972-973 | history ends with rival | psql | port → V4 engine |
| 978 | fresh provisional record | Edge | port → V4 engine |
| 982 | completing the session writes nothing | Edge | port → V4 engine |
| 985 | once complete, an edit voids | Edge | port → V4 engine |
| 1009 | provisional typo record | Edge | port → V4 engine |
| 1013 | set below typo is not a record | Edge | port → V4 engine |
| 1017-1018 | deleting typo records real set vs pre-session best | Edge | port → V4 engine |
| 1019-1020 | record measured against pre-session best | psql | port → V4 engine |
| 1021-1022 | lead change rolls back past the typo | psql | port → V4 engine |
| 1028 | tombstoned active session: no void | Edge | port → V4 engine |
| 1029-1030 | its provisional record and lead changes gone | psql | port → V4 engine |
| 1031 | fallback entry | psql | port → V4 engine |
| 1032-1033 | history ends with rival | psql | port → V4 engine |
| 1050 | whitespace-only edit voids nothing | Edge | port → V4 engine |
| 1054 | reps edit voids and re-records the board it still holds | Edge | port → V4 engine; **fixture**: a reps-only edit moves both volume and e1rm, so no carry. Use an edit that keeps volume (100×5 → 125×4). |
| 1055-1056 | replacement lists the unchanged board | psql | port → V4 engine (`volume:null:true`) |
| 1057 | e1RM entry follows the edit | psql | port → V4 engine |
| 1084 | within a member: exercise order, then set order | psql | port → V4 engine (`group_metric_compute` order) |
| 1085-1089 | equal values: earlier session ranks first | group_board | port → group_competition_board (value desc, achieved_at_ms, uuid); competitions.sh:525-534 covers only full-precision ranking |
| 1103-1104 | M leaves | group_leave | keep + header |
| 1108 | change while away applies nothing | Edge | port → V4 engine (former member not in graph members) |
| 1109 | entry frozen while away | psql | port → V4 engine |
| 1110-1111 | former member listed rank 1, former | group_board | port → group_competition_board (`entries[0].former`) |
| 1112-1113 | M rejoins | group_join | keep + header |
| 1114-1115 | rejoin applies the unlink made while away | Edge | port → V4 engine (trigger → `group_board_enqueue_links` from `group_metric_board_state`) |
| 1116 | entry gone after catch-up | psql | port → V4 engine |
| 1125-1141 | an apply waits for the group's advisory lock (25005) | psql group_eval_apply | port → group_metric_eval_publish (takes `pg_advisory_xact_lock(25005,hashtext(group))`; needs a claimed metric job). Non-legacy `group_eval_apply` only enqueues. |
| 1142 | lock holder still held when apply timed out | psql | port (same) |
| 1144 | failure is a 55P03 lock timeout | psql | port (same) |
| 1151-1152 | podiums All·Weight ok | group_board_podiums | port → group_competition_podiums(p_certified:false); no `p_metric` (default_metric) |
| 1153-1160 | podium order, `me`, entry_count, BoardRow keys | group_board_podiums | port → group_competition_podiums for order, me and entry_count (vol). **Delete the key-list clause**: duplicate of competitions.sh:321 (`isCompetitionPodiumsWire`). |
| 1161-1162 | podium exercise order: active first, archived last | group_board_podiums | port → group_competition_podiums; rule changed, V4 omits archived and orders by name |
| 1164-1166 | board page 1 (limit 1), has_more | group_board | port → group_competition_board (`p_limit:1`, `next_cursor` non-null; no `has_more`) |
| 1168-1172 | page 2 continues with absolute ranks | group_board | port → group_competition_board (`p_cursor`; last page `next_cursor==null`) |
| 1176-1180 | history paging (limit 1) + item key shape | group_board_history | port → group_competition_history paging. **Delete the key-shape check**: duplicate of competitions.sh:325 (`isCompetitionHistoryWire`). |
| 1185-1188 | history walks every lead change newest first, no dups | group_board_history | port → group_competition_history; expected list includes `rules_change` rows of the revision |
| 1189-1194 | reasons, related summary, holders with members | group_board_history | port → group_competition_history; **shape**: `reason`, `related_event_id` (no `related{}`), `values[]` roles leader/previous, `member` |
| 1202 | anon gets AUTH_REQUIRED (×3 reads) | board reads | delete (duplicate of competitions.sh:310: anon non-2xx for every group_competition_* RPC; V4 has no anon grant, so AUTH_REQUIRED is unreachable) |
| 1203 | agent token gets AGENT_FORBIDDEN (×3) | board reads | delete (duplicate of competitions.sh:309) |
| 1204-1205 | non-member NOT_FOUND "group not found" (×3) | board reads | delete (duplicate of competitions.sh:308, 293-297) |
| 1206-1207 | non-member with bad input: membership checked first | board reads | delete (duplicate of competitions.sh:307-318: outsider with `sample` metric args → NOT_FOUND "before payload validation") |
| 1208-1209 | bad metric → VALIDATION | board, history (podiums n/a) | port → group_competition_board/history (`VALIDATION: invalid competition board dimensions` / `invalid history dimensions`) |
| 1210-1211 | null certified → VALIDATION (×3) | board reads | port → group_competition_board/history/podiums |
| 1213-1216 | (setup) foreign group exercise | group_exercise_create | port → group_competition_exercise_create |
| 1217-1219 | board of another group's exercise NOT_FOUND + message | group_board | port → group_competition_board (same `group_board_require_exercise` message) |
| 1220-1221 | history of another group's exercise NOT_FOUND | group_board_history | port → group_competition_history |
| 1222-1224 | board p_limit 0/101 VALIDATION | group_board | port → group_competition_board (same 1..100) |
| 1225-1227 | history p_limit 0/51 VALIDATION | group_board_history | port → group_competition_history; **bounds now 1..100**, so test 0/101 |
| 1228-1233 | malformed board cursors VALIDATION | group_board | port → group_competition_board; **cursor is opaque text**: garbage, wrong scope/revision, negative `after_rank` |
| 1234-1236 | malformed history cursors VALIDATION | group_board_history | port → group_competition_history (opaque text; non-numeric/negative `seq`, scope mismatch) |
| 1248-1250 | stream pages load | group_stream | port → group_competition_stream (`p_before` text) |
| 1259-1260 | only five wire kinds; lead_change never an item | group_stream | port → group_competition_stream: kinds session/membership/competition, `event.kind` never lead_change. Partly covered by the competitions.sh:329 wire guard. |
| 1261-1262 | record, record_voided, link present | group_stream | port → group_competition_stream (`event.kind`) |
| 1263-1267 | record item key shape; sorts at session start | group_stream | port → group_competition_stream for `sort_at_ms` == session start only. **Delete the key list**: duplicate of competitions.sh:329 (`isCompetitionStreamWire`). |
| 1268-1270 | record_voided item key shape | group_stream | delete (duplicate of competitions.sh:329 `isCompetitionStreamWire`) |
| 1271-1273 | link item key shape | group_stream | delete (duplicate of competitions.sh:329) |
| 1275-1277 | link item names the member's exercise, read live | group_stream | delete (no V4 counterpart: `group_competition_event_json` has no exercise names, only `exercise_definition_ids` in the payload) |
| 1278 | no lead_change item across every page | group_stream | port → group_competition_stream |
| 1293-1297 | paging independent of page size, no repeats, reaches records | group_stream | port → group_competition_stream (multi-page walk not covered in competitions.sh) |
| 1304-1305 | R leaves | group_leave | keep + header |
| 1309-1310 | leaving writes no board event | psql | port → V4 engine |
| 1311 | former member's entries stay | psql | port → V4 engine |
| 1312-1314 | former member stays ranked, marked former | group_board | port → group_competition_board |
| 1315-1316 | former member cannot read podiums | group_board_podiums | port → group_competition_podiums (NOT_FOUND; former ≠ outsider) |
| 1318-1319 | owner removes M | group_remove_member | keep + header |
| 1320-1321 | removed member cannot read a board | group_board | port → group_competition_board |
| 1322-1323 | removed member cannot read history | group_board_history | port → group_competition_history |

---

### Totals (rows above)

| file | keep | keep + header | port | delete | rows |
|---|---|---|---|---|---|
| groups-leaderboards.sh | 89 | 5 | 4 | 0 | 98 |
| groups-boards.sh | 6 | 8 | 153 | 34 | 201 |

- **Leaderboards ports**:
  - setup 221-230 and 231-232
  - unarchive 531-532
  - expectation 533-538
- **Leaderboards ⚠targets keeps**: expectation widens under V4 → 558-560, 593-595, 602-603, 671-674, 708-709.
- **Boards deletes**, by reason:
  - no Weight metric: 600, 602, 604-608, 609-612, 618, 623, plus the whole raw-Weight V/V2/V3 section (21 rows, 642-750)
  - duplicate of competitions.sh:307-329: 1202-1207 (4 rows), 1268-1273 (2 rows)
  - no V4 counterpart: 1275-1277
  - 575-581, 1153-1160, 1176-1180 and 1263-1267 are each split into a port plus a deleted clause. They are counted as ports.


## 7. Test map — groups-certification.sh, groups-bodyweight.sh, groups-week-summary.sh

Read-only inventory at origin/main 538baa4a. Function bodies are from the final function definitions, taken from the V4-active stack.

### Facts that drive the verdicts

1. **Once V4 is active, no legacy revision exists and none can be created.**
   - `group_competition_activate` retires every exercise's revision and inserts a new revision with `legacy=false`.
   - `group_metric_initial_revision` sets `legacy = not group_competition_active()`.
   - So `group_eval_apply` always takes the `group_metric_eval_enqueue` branch.
   - `group_eval_apply_legacy`, `group_board_compute`, `group_board_counting` and `group_board_load_factor` can no longer be reached.
   - **The M25 tables `group_board_entries` and `group_certifications` get no new rows.**
   - The V4 engine (`group_metric_apply_member`) writes `group_metric_board_entries` and `group_metric_certifications`. It writes contract-2 `group_events` with metrics `volume` and `e1rm` (`group_metric_names()`).
2. **The certification logic is unchanged; only the tables, metric names and RPC wire differ.** `group_metric_apply_member` does the same jobs M25 did:
   - voids on an observed-pin change, whether the set is edited or deleted, in completed and active sessions;
   - writes a certified `lead_change` with `reason='certification'` and `payload.certification_id`;
   - writes `reason='link'` with `related_event_id` pointing at the unlink event;
   - leaves frozen former members' entries in place.
3. **V4 wire differences** (these force expectation changes):
   - **Certification JSON** (`group_competition_certification_json`) has the keys `certification_id, metric, certified_by, certified_at_ms, observed_rules_revision, ended_at_ms, end_reason`. It has no `member`, `set_id`, `pinned`, `ended_by`, `weight_kg`, `e1rm_kg` or `session_id`.
   - **Board rows** have `metric, value, unit, rank, member, former, performance{set_id,…}, write_token, certification`. There is no `.certified` boolean, no top-level `set_id` and no `fingerprint`.
   - **Board** takes metric `volume` or `e1rm` only, and has no `p_revision` parameter.
   - **Units:** `kg_reps` and `kg` when ordinary; `percent_bw_reps` and `percent_bw` when the group is enabled and contribution > 0. Absolute values are null/unavailable when normalized.
   - **History events** (`group_competition_event_json`) carry `reason`, `certified`, `related_event_id` and `values[]`. There is **no `related` certification object**, and `rules_change` events carry no `rules` payload.
   - **Stream:** record items are `kind:"competition"` with `.event.record_context.metrics[]{metric,write_token,eligible,certification}`. `rules_change` events are omitted.
   - **Podiums:** `{certified, podiums[{exercise, board}]}`. There is no `all_entry_count` and no top-level `me`.
   - **Week summary:** `members` and `training_now` are passed through verbatim from `group_week_summary_pre_competition`. `latest_completed.group_records[]` items are rebuilt as `group_competition_event_json` objects, with `values` of role `record` filtered to the boards where the record took #1. Top-level keys gain `contract_version` and `group_id`.
   - **Errors** on `group_competition_certify`:
     - self-certify or a null set: `VALIDATION: a different member and set are required`;
     - archived exercise: `VALIDATION: archived comparisons are read-only`;
     - unknown set, or a token that doesn't match: `CONFLICT: performance changed; refresh before certifying`;
     - a real token on a set that isn't a record: `NOT_FOUND: record set not found for this metric`.
   - **Errors** on `group_competition_certification_end`:
     - generic `FORBIDDEN: certification action is not allowed`;
     - a null id: `NOT_FOUND`;
     - a null or invalid action or metric: `VALIDATION`.
   - **Grants:** V4 RPCs are granted to `authenticated` only. Anon therefore gets a PostgREST denial, not `AUTH_REQUIRED`.
   - **Enqueue failure:** `group_metric_enqueue_isolated` logs `user_id = actor`, with context `{group_id, group_exercise_id, kind:'exercise', sqlstate}`.
4. **Silent recompute moved.** `group_metric_eval_publish` sets `_silent` only when the job's revision is not yet published (a rules-revision rebuild). A `rules` session-cause job from `group_eval_requeue_rules` publishes **non-silently** on V4.
5. **Caveat on duplicate citations.** `groups-competitions.sh` currently resets the stack to pre-cutover and activates it (lines 31, 223–243). Its post-activation sections, from line 244 on, are what I cite as the existing V4 coverage. These deletions assume those sections survive the D1 rework of that suite.

**Legend.**
- `keep [H]`: a SQL/evaluator assertion whose logic V4 still runs. The lane helper it reads through must be retargeted to the V4 tables (see "Fixture changes"). It counts as **keep**.
- "(values)": the SQL stays, but expected literals change (`weight`→`volume`, units, re-derived counts).

---

### supabase/tests/lib/groups-fixtures.sh (shared)

| line(s) | what it asserts (≤12 words) | RPC(s) | verdict |
|---|---|---|---|
| 119-128 | `rpc()` sends no `x-boga-group-contract` header | (all group RPCs) | **Fixture change:** add `-H "x-boga-group-contract: 4"`. Without it, `group_require_app_user` raises UPDATE_REQUIRED for every group RPC once active. |
| 153-170 | expect_ok / expect_error / check helpers | — | keep |
| 174-182 | password sign-in returns HTTP 200 | auth | keep |
| 278-285 | sync_push ack ok | sync_push | keep (not a group RPC; the header is harmless) |

### supabase/tests/groups-certification.sh

#### Fixture changes (setup code that calls pre-V4 RPCs or reads M25 tables)

| lines | what to change |
|---|---|
| 140-151 `centry` | `group_board_entries.value_kg` → `group_metric_board_entries.value` at `rules_revision = group_exercises.rules_revision`; metric `weight` → `volume` (values become reps×kg, e.g. `95@r1` for 95×1). |
| 155-171 `csince`, `last_lc_cert` | Metric names `weight` → `volume`. The `group_events` columns are unchanged, because V4 writes the same `lead_change` rows. |
| 173-178 `cert_col`, `active_certs` | `group_certifications` → `group_metric_certifications`, plus a `metric` filter. Two rows (volume and e1rm) exist per certified set in V4. |
| 223-228 `gx` | `group_exercise_create` → `group_competition_exercise_create` (`p_bodyweight_contribution:0`, `p_default_metric:"volume"` or `"e1rm"`). |
| 230-240 `certify`/`withdraw`/`cancel` | `group_certify` → `group_competition_certify`. This now needs `p_metric`, `p_expected_revision` and `p_write_token` (from the board entry, the stream `record_context`, or `group_metric_set_scores` for a non-leading record). Withdraw and cancel → `group_competition_certification_end` with `p_metric` and `p_action`. |
| 243-261 `board`/`history`/`podiums`/`stream` | → `group_competition_board` / `_history` / `_podiums` / `_stream`. Metric `weight` → `volume`. |
| 308-309 | `group_exercise_archive` → `group_competition_exercise_archive(p_archived:true)`. |
| 786, 790 | The forced constraint goes on `group_metric_eval_queue`, not `group_eval_queue`. |
| 66-84 cleanup | Also delete the run's `group_metric_eval_queue` rows (rows cascade from groups only if an FK exists — verify). |

#### Assertions

| line(s) | what it asserts (≤12 words) | RPC(s) | verdict |
|---|---|---|---|
| 130-134 | group-eval drain returns 200 and no failed job | group-eval Edge | keep |
| 283-299 | create G/H, invite, joins, promote, remove member succeed | group_create, group_invite_get, group_join, group_set_role, group_remove_member | keep + header |
| 305-309 (226) | group exercises created; GXA archived | group_exercise_create, group_exercise_archive | port → group_competition_exercise_create / group_competition_exercise_archive (setup) |
| 327-329 | record events only for a1, a2, r1 | SQL group_events | keep (V4 writes contract-2 record events) |
| 337 | group_certifications RLS on | SQL | keep |
| 338-339 | group_certifications has no policies | SQL | keep |
| 340-342 | no anon/authenticated/public table grants | SQL | keep |
| 343-345 | no owner_user_id column | SQL | keep |
| 346-351 | no FK into a Sync v2 table | SQL | keep |
| 352-358 | no Sync v2 trigger touches certifications | SQL | keep |
| 359-366 | direct select returns nothing or 42501 | REST table | keep |
| 367-369 | direct insert denied 42501 | REST table | keep |
| 372-375 | every certification function pins search_path | SQL pg_proc | keep |
| 376-381 | clients execute exactly the three certification RPCs | SQL pg_proc | port → `group_competition_certify`, `_certification_end`, `_certification_get`. Grant check: authenticated only; anon is no longer granted. |
| 382-386 | service_role executes no certification internal | SQL pg_proc | keep |
| 387-390 | the three certification RPCs are security definer | SQL pg_proc | port → the same three V4 names |
| 391-394 | service_role cannot execute group_eval_apply / group_board_compute | SQL pg_proc | keep |
| 395-397 | queue cause constraint accepts `certification` | SQL | keep |
| 406-407 | anon certify → AUTH_REQUIRED | group_certify | delete (dup of groups-competitions.sh:307-315, where anon is non-2xx; V4's authenticated-only grant makes AUTH_REQUIRED unreachable) |
| 408-409 | agent-token certify → AGENT_FORBIDDEN | group_certify | delete (dup of groups-competitions.sh:309) |
| 410-415 | withdraw/cancel anon and agent rejected | group_certification_withdraw/cancel | delete (dup of groups-competitions.sh:307-315 for certification_end) |
| 418-426 | outsider and removed member read NOT_FOUND group | group_certify, withdraw, cancel | port → group_competition_certify / group_competition_certification_end. The outsider half duplicates groups-competitions.sh:308; the removed member is uncovered. |
| 428-429 | self-certify rejected | group_certify | port → group_competition_certify (message becomes `VALIDATION: a different member and set are required`) |
| 430-432 | null set id → VALIDATION | group_certify | port → group_competition_certify |
| 433-434 | another group's exercise → NOT_FOUND | group_certify | port → group_competition_certify (message unchanged, from group_board_require_exercise) |
| 435-436 | archived exercise rejected | group_certify | port → group_competition_certify (`VALIDATION: archived comparisons are read-only`) |
| 437-438 | performed non-record set → NOT_FOUND record set | group_certify | port → group_competition_certify (a3's token comes from group_metric_set_scores; message is `…not found for this metric`) |
| 439-440 | unknown set id rejected | group_certify | port → group_competition_certify (now `CONFLICT: performance changed…`, no score row) |
| 441-442 | another member's set id rejected | group_certify | port → group_competition_certify (now CONFLICT) |
| 443-444 | non-member lifter → NOT_FOUND member | group_certify | port → group_competition_certify (member check runs before the token check) |
| 445-446 | withdraw without an id → VALIDATION | group_certification_withdraw | port → group_competition_certification_end (a null id now gives NOT_FOUND; assert VALIDATION on a null `p_action`/`p_metric` instead) |
| 447-448 | withdraw unknown certification → NOT_FOUND | group_certification_withdraw | port → group_competition_certification_end |
| 449-450 | no certification row written | SQL | keep [H] (group_metric_certifications) |
| 458-468 | certify returns created + pinned certification shape | group_certify | port → group_competition_certify. **Shape change:** V4 keys only, plus `created`; no member/set_id/pinned/kg. Optionally guard with isCompetitionCertifyResultWire. |
| 470-474 | stored pin equals the live set's fingerprint | SQL | keep [H] (compare group_metric_certifications.observed_set_pin with the `group_metric_eval_source_graph` set's `observed_set_pin`; group_set_fingerprint is legacy-only) |
| 475 | no Certified entry before the evaluator runs | SQL centry | keep [H] |
| 476-480 | All board row shows certification immediately | group_board | port → group_competition_board(certified:false). Check `.certification.certification_id` and certifier; V4 cert keys; no `.certified` boolean. |
| 481-482 | uncertified All row has no certification | group_board | port → group_competition_board (`.certification == null`) |
| 484-486 | repeat certify is idempotent | group_certify | port → group_competition_certify (created:false, same id) |
| 487-490 | second certifier reuses the same certification | group_certify | port → group_competition_certify |
| 491 | one active certification of r1 | SQL active_certs | keep [H] |
| 493-497 | certified r1 makes Certified volume and e1RM entries | SQL centry | keep [H] (values: volume) |
| 498 | R takes #1 on both Certified boards | SQL csince | keep [H] |
| 499 | lead change payload names the certification | SQL last_lc_cert | keep [H] |
| 500-502 | certified lead changes have no related_event_id | SQL | keep |
| 503-509 | history item reason/related is the certification | group_board_history | port → group_competition_history(certified:true). **Expectation shrinks:** V4 events have no `related` object, so assert `reason=="certification"`, member and leader values only. |
| 510-515 | certified e1RM podium: holder, certification, counts | group_board_podiums | port → group_competition_podiums(true). **Shape:** `.podiums[].board.entries[].certification` and `board.entry_count`; no `all_entry_count` or top-level `me`; uses default_metric. |
| 516-519 | stream record item reads certified | group_stream | port → group_competition_stream (`.event.record_context.metrics[].certification.certification_id`) |
| 527-532 | R certifies a1 (not All entry); C certifies a2 | group_certify | port → group_competition_certify (a1's token from record_context or set_scores) |
| 534 | A's best certified set holds the entry | SQL centry | keep [H] |
| 535 | A takes #1 on the Certified boards | SQL csince | keep [H] |
| 536 | lead change names a2's certification | SQL | keep [H] |
| 538-542 | admin, rival and athlete cannot withdraw another's certification | group_certification_withdraw | port → group_competition_certification_end(withdraw) (`FORBIDDEN: certification action is not allowed`; only the rival half is in groups-competitions.sh:541-542) |
| 544-548 | certifier withdraws: withdrawn, ended_by, ended_at | group_certification_withdraw | port → group_competition_certification_end (`ended_by` is not on the V4 wire; partly a dup of groups-competitions.sh:543-545, but it is setup for 549-561) |
| 549-551 | withdrawn entry leaves the Certified board before the apply | group_board | port → group_competition_board(certified:true) |
| 553 | next-best certified set takes the entry | SQL centry | keep [H] |
| 554 | A loses #1 to R | SQL csince | keep [H] |
| 555 | lead change names the withdrawn certification | SQL | keep [H] |
| 556-557 | history related.event withdrawn | group_board_history | port → group_competition_history (only `reason=="certification"` is on the wire) |
| 558-561 | repeat withdraw is idempotent (same ended_at) | group_certification_withdraw | port → group_competition_certification_end |
| 568-569 | a member cannot cancel → FORBIDDEN | group_certification_cancel | port → group_competition_certification_end(cancel) |
| 571-575 | admin cancels a certification they did not give | group_certification_cancel | port → group_competition_certification_end (no ended_by on the wire) |
| 576-579 | repeat cancel keeps the first end | group_certification_cancel | port → group_competition_certification_end (compare ended_at_ms only) |
| 581 | cancelled set leaves the Certified board | SQL centry | keep [H] |
| 582 | R loses #1 | SQL csince | keep [H] |
| 583-584 | owner cancels a1 | group_certification_cancel | port → group_competition_certification_end (setup for 586-591) |
| 587 | A has no certified set left | SQL centry | keep [H] |
| 588 | Certified board empties | SQL csince | keep [H] |
| 589-591 | emptied board's lead change has a null leader | SQL | keep |
| 594-597 | re-certifying a cancelled set creates a new row | group_certify | port → group_competition_certify |
| 598 | cancelled row stays cancelled | SQL cert_col | keep [H] |
| 600-601 | Certified entry returns; R #1 again | SQL centry/csince | keep [H] |
| 608-610 | certify a set edited ahead of evaluator → CONFLICT | group_certify | delete (dup of groups-competitions.sh:512-516: queued-correction token gives CONFLICT) |
| 612-615 | edited a1: record voided and no entry | SQL | keep [H] (group_metric_board_entries) |
| 616-617 | voided record set holding no entry → NOT_FOUND | group_certify | port → group_competition_certify (token from set_scores) |
| 622-623 | edit voids the certification with no actor | SQL cert_col | keep [H] |
| 624-626 | void leaves board; #1 moves; lead change names cert | SQL | keep [H] |
| 627-628 | history related.event voided | group_board_history | port → group_competition_history (reason only) |
| 629-631 | every r1 record item reads uncertified | group_stream | port → group_competition_stream (record_context certification null) |
| 637-639 | a provisional record set can be certified | group_certify | port → group_competition_certify |
| 641 | provisional certified set makes an entry | SQL centry | keep [H] |
| 645 | an edit in an active session voids too | SQL cert_col | keep [H] |
| 646-647 | no entry after void; #1 moves | SQL | keep [H] |
| 648-650 | provisional record reads uncertified after void | group_stream | port → group_competition_stream |
| 657-659 | certify r1 at 96 | group_certify | port → group_competition_certify |
| 661 | certified r1 entry | SQL centry | keep [H] |
| 665-667 | set tombstone voids; entry gone; #1 moves | SQL | keep [H] |
| 668-671 | undelete revives no certification | SQL | delete (dup of groups-competitions.sh:523-524: restore stays ended) |
| 673-675 | certify a2 (non-voided record, not the All entry) | group_certify | port → group_competition_certify |
| 677 | certified a2 entry | SQL centry | keep [H] |
| 680-681 | session tombstone voids; entry gone | SQL | keep [H] |
| 682-684 | session undelete revives nothing | SQL | keep [H] |
| 696-701 | r3 record voided yet still holds both entries | SQL | keep [H] (`0:2` = volume + e1rm in group_metric_board_entries) |
| 702-704 | a voided record still holding an entry is certifiable | group_certify | port → group_competition_certify |
| 706 | certified r3 entry | SQL centry | keep [H] |
| 711 | unlink voids nothing | SQL active_certs | keep [H] |
| 712-713 | unlinked set leaves the board; lead change reason link | SQL | keep [H] |
| 714-717 | certified lead change points at the unlink item | SQL | keep |
| 721-722 | relink restores the entry; reason link | SQL | keep [H] |
| 724-727 | load-mode change voids nothing; Weight stays raw | sync_push + SQL | delete (Weight is retired; source-mode retention dups groups-competitions.sh:430-434) |
| 734 | rules bump requeues evaluated sessions | SQL group_eval_requeue_rules | keep |
| 731-732, 736-739 | silent rules recompute restores entries, writes no event | SQL | port → group_competition_exercise_update. In V4 a `rules` session-cause job publishes non-silently; the silent path is a rules-revision rebuild. Expect only a `rules_change` event and a restored Certified entry. |
| 746-747 | R leaves | group_leave | keep + header |
| 749-750 | certifying a former member's set → NOT_FOUND member | group_certify | port → group_competition_certify |
| 751-752 | admin cancels a former member's certification | group_certification_cancel | port → group_competition_certification_end |
| 753-755 | ended certification leaves the frozen Certified board at once | group_board | port → group_competition_board(certified:true) (`former` rows) |
| 756-758 | podium count ignores the ended certification | group_board_podiums | port → group_competition_podiums(true) (`board.entry_count`) |
| 760 | frozen stored entry stays until catch-up | SQL centry | keep [H] |
| 772-773 | same-value raw edit writes no event | SQL | keep |
| 774-779 | standing record's payload fingerprint follows the fact | SQL | delete (M25 record payload `fingerprint` vs group_set_facts; V4 records keep `boards[].fingerprint` + `rule_rescore_baseline`, whose equivalent-edit behaviour is groups-bodyweight.sh:703-704,713-716) |
| 786-789 | certify succeeds under a forced enqueue failure | group_certify | port → group_competition_certify (constraint on group_metric_eval_queue) |
| 791 | the certification committed | SQL cert_col | keep [H] |
| 792-796 | exactly one sanitized enqueue-failure log row | SQL app_logs | keep [H]. **Expectation change:** user_id = the certifier; context `{group_id,group_exercise_id,kind:'exercise',sqlstate}`, not table/row_id. |
| 797-798 | no job was queued | SQL | keep [H] (group_metric_eval_queue) |
| 800 | no apply ran | SQL centry | keep [H] |
| 805 | next job for the target repairs the Certified entry | SQL centry | keep [H] |
| 806-807 | A takes #1 despite the stale former entry | SQL csince | keep [H] |
| 808-810 | raw-edited record reads certified | group_stream | port → group_competition_stream |

### supabase/tests/groups-bodyweight.sh

#### Fixture changes

| lines | what to change |
|---|---|
| 76-97 `assert_wire` | Drop the hand-written protocol-3 envelopes and use the competition wire guards (`isCompetitionBoardWire`, `…CertifyResultWire`, `…StreamWire`, `…CertificationResultWire`) via the node decoder, as in groups-competitions.sh:49-80. |
| 112-119 `create_comparison` | `group_exercise_create_v2` → `group_competition_exercise_create`. Check `contract_version==4` and `.exercise.rules.default_metric`. |
| 120-126 `metric_board` | `group_metric_board` → `group_competition_board`: `.state=="ready"`, per-entry `.unit`, `.performance.set_id`, `.certification.certification_id`, `.write_token`. Revision is at `.rules.rules_revision` (also line 458). |
| 144-155 `certify_metric` | `group_metric_certify` (fingerprint) → `group_competition_certify` (`p_write_token` from the board entry). |
| 287-295 `update_comparison` | `group_exercise_update_v2` → `group_competition_exercise_update`. |
| 165-178, 317-321, 413-418, 460-462 | Metric literal `weight` → `volume`. |
| 537-677 | Every M25 legacy exercise (`group_exercise_create`) and `group_certify` call is impossible once active. Lines 569-578 and 634-652 must re-point `GX` at a V4 comparison. |

#### Assertions

| line(s) | what it asserts (≤12 words) | RPC(s) | verdict |
|---|---|---|---|
| 98-101 | drain 200, no failed job | group-eval Edge | keep |
| 112-119 | comparison created on contract 3, default e1rm | group_exercise_create_v2 | port → group_competition_exercise_create (contract 4; rules.default_metric) |
| 120-126 | board contract 3, ready, unit null, wire | group_metric_board | port → group_competition_board (contract 4; units per entry) |
| 144-155 | certify returns a contract-3 certification | group_metric_certify | port → group_competition_certify |
| 156-161 | group policy update echoes the flag | group_update | keep + header |
| 184-185 | zero contribution never queues a rules rebuild | SQL | keep |
| 186 | zero toggle leaves the snapshot unchanged | SQL | keep |
| 187-191 | live and stored zero rules agree on effective flag | SQL | keep |
| 193 | positive-comparison publication leaves zero comparison alone | SQL | keep |
| 200 | SQL/device as-of bodyweight resolver parity | node + psql | keep |
| 206-212 | group create, invite, joins | group_create, group_invite_get, group_join | keep + header |
| 214 | comparison with contribution 1 (setup) | group_exercise_create_v2 | port → group_competition_exercise_create |
| 227-229 | policy-off Weight is the raw entered value (kg) | group_metric_board | port → group_competition_board volume (policy off: expect 100 `kg_reps` for 20×5) |
| 230-231 | public board has no private reading keys | group_metric_board | port → group_competition_board |
| 232-234 | policy-off 1RM uses the ordinary load | group_metric_board | port → group_competition_board e1rm (unit `kg`) |
| 237-239 | policy toggle makes the board rebuilding with no entries | group_metric_board | port → group_competition_board (`state=="rebuilding"`, `entries==[]`) |
| 241-243 | Weight is unchanged by bodyweight math | group_metric_board | delete (Weight is retired; V4 normalizes Volume too, already covered by groups-competitions.sh:246-247) |
| 244-247 | enabling group calculations changes the 1RM | group_metric_board | delete (dup of groups-competitions.sh:246-250 normalized as-of values + api-live.test.ts:78-79 e1rm `percent_bw`; the kg on>off comparison is meaningless in percent units) |
| 248-249 | public 1RM payload has no private reading keys | group_metric_board | port → group_competition_board (normalized e1rm) |
| 256-257 | missing reading still ranks Weight | group_metric_board | delete (Weight is retired; V4 omits both metrics without context, groups-competitions.sh:477-478) |
| 258-259 | missing reading omits only 1RM | group_metric_board | delete (dup of groups-competitions.sh:478) |
| 261-262 | certify Weight and 1RM witnesses (setup) | group_metric_certify | port → group_competition_certify (volume, e1rm) |
| 274-275 | witness audits unchanged | SQL | keep |
| 276-285 | same set stays Certified at its current score | group_metric_board | port → group_competition_board(certified:true) (value equals the current group_metric_set_scores value; groups-competitions.sh `retained` checks the id but not the value) |
| 296-299 | policy toggles retain the witnesses | group_update + board | delete (dup of groups-competitions.sh:427) |
| 300-303 | contribution changes retain the witnesses | group_exercise_update_v2 + board | delete (dup of groups-competitions.sh:428) |
| 304-307 | target distribution changes retain the witnesses | group_exercise_update_v2 + board | delete (dup of groups-competitions.sh:429) |
| 313 | source distribution retains the witnesses | board | delete (dup of groups-competitions.sh:430-434) |
| 314-315 | source rules write no record/correction event | SQL | keep |
| 317-321 | baseline graph fingerprints match the scoring pins | SQL source_graph | keep (values: metrics array `['volume','e1rm']`) |
| 323 | retry with current pin returns the original certificate | group_metric_certify | port → group_competition_certify (created:false, same id) |
| 324, 360, 377 | assert_retained calls | board | port → group_competition_board (via the helper) |
| 325-333 | historical-revision board keeps original score and witness | group_metric_board(p_revision) | delete (V4 board has no revision parameter; per-revision reads exist only via group_competition_history `p_revision`, groups-competitions.sh:323-326) |
| 335-337 | irrelevant future reading retains the witnesses | board | delete (dup of groups-competitions.sh:438) |
| 338-339 | no-op reading retains the witnesses | board | delete (dup of groups-competitions.sh:441) |
| 344-350 | forward migration re-pins active certificates under observed rules | SQL migration replay | keep |
| 351-359 | migration keeps a pending reading correction | SQL migration replay | keep |
| 366-367 | ordinary rival 1RM certification (setup) | group_metric_certify | port → group_competition_certify |
| 369 | ineligible observation keeps its audit | SQL | keep |
| 370-371 | missing reading omits Certified entry, witness not ended | group_metric_board | port → group_competition_board(certified:true) (reading-free witness under a rules change; not in the V4 suite) |
| 372-375 | eligible again via rules uses the same witness | group_exercise_update_v2 + board | port → group_competition_exercise_update + group_competition_board |
| 376 | restore contribution | group_exercise_update_v2 | port → group_competition_exercise_update |
| 381-382 | Weight certification ignores private reading change | SQL | delete (Weight is retired; V4 Volume binds the reading and ends with it, groups-competitions.sh:445-446) |
| 383-384 | 1RM certification voided by reading correction | SQL | delete (dup of groups-competitions.sh:445 `ended value`) |
| 391-392 | personal preference does not enqueue group evaluation | SQL | keep |
| 393-395 | personal preference cannot change the group score | group_metric_board | port → group_competition_board |
| 399-401 | policy off restores ordinary 1RM without a reading | group_metric_board | port → group_competition_board e1rm |
| 403-404 | reading while the policy is off does not enqueue | SQL | delete (dup of groups-competitions.sh:490-492, `off` branch) |
| 408-412 | unsupported metrics rejected with VALIDATION | group_metric_board | port → group_competition_board (`VALIDATION: invalid competition board dimensions`; add `weight`) |
| 413-418 | score/board/certification storage has only Weight/1RM in kg | SQL | keep (values: allow `volume`/`e1rm` with `kg`/`kg_reps`/`percent_bw`/`percent_bw_reps`, and stored D3 `weight`/kg rows) |
| 420-424 | stream exposes ordinary metric names, no private fields | group_stream_v2 | port → group_competition_stream (metrics volume/e1rm; groups-competitions.sh:330-333 covers only an enabled group) |
| 443 | zero-contribution comparison (setup) | group_exercise_create_v2 | port → group_competition_exercise_create |
| 454-457 | a heavier warm-up never ranks | group_metric_board | port → group_competition_board volume (values: 100 vs rival 150 `kg_reps`) |
| 459 | the warm-up made no record | SQL | keep |
| 460-462 | warm-up keeps a non-counting score row | SQL | keep (values: `e1rm:false,volume:false`) |
| 463-472, 499 | a warm-up cannot be certified | group_metric_certify | port → group_competition_certify (token from group_metric_set_scores → `NOT_FOUND: record set not found for this metric`) |
| 477-478 | certify zero-contribution volume/e1RM witnesses | group_metric_certify | port → group_competition_certify |
| 480-482 | zero contribution keeps ordinary 1RM without a reading | group_metric_board | port → group_competition_board |
| 483 | zero toggles leave everything unchanged | group_update + SQL | keep (SQL; group_update needs the header) |
| 484-485 | public board byte-identical across toggles | group_metric_board | port → group_competition_board |
| 486-490 | unchanged zero score keeps its witness | group_metric_board | port → group_competition_board(certified:true) |
| 494-495 | zero-session reading edit never queues | SQL | delete (dup of groups-competitions.sh:481-492, `zero` branch) |
| 502-507 | stored warm-up record exists after a counted apply | SQL group_metric_apply_member | keep |
| 508 | a stored warm-up record cannot be certified | group_metric_certify | port → group_competition_certify |
| 512-513 | warm-up best falls silently | SQL | keep |
| 514-515 | stored warm-up record stands | SQL | keep |
| 516-519 | board falls to the best working set | group_metric_board | port → group_competition_board volume |
| 527-532 | SQL load factor matches the shared TS vectors | SQL group_board_load_factor | delete (`group_board_load_factor` serves only group_board_counting/group_eval_apply_legacy, unreachable once active; the V4 factor is TS `groupEnteredWeightFactor`, vectors in apps/mobile/__tests__/groups-metric-contract.test.ts:10) |
| 537-539 | legacy (M25) exercise created | group_exercise_create | delete (pending-only: no legacy revision can exist once active) |
| 546-548 | legacy raw witness certified | group_certify | delete (pending-only; covered pre-activation by groups-competitions.sh:194-196) |
| 551 | zero toggles leave the legacy comparison unchanged | group_update + SQL | delete (pending-only legacy fixture) |
| 552-553 | zero toggles never activate a legacy revision | SQL | delete (pending-only) |
| 558-566 | legacy witness ID public on both metrics; get projection | group_metric_board, group_metric_certification_get | delete (pending-only; dup of groups-competitions.sh:266-269) |
| 567 | legacy audit not rewritten | SQL | delete (dup of groups-competitions.sh:273) |
| 569-578 | zero-metadata migration canonicalizes rules, keeps clocks | SQL migration replay | keep (re-point GX at a V4 zero comparison) |
| 582-590 | history reports effective zero for exercise, revision, events | group_metric_history | port → group_competition_history. Assert `.exercise.rules` and `.revision.rules`; V4 `rules_change` events carry no `rules`, so drop the per-event clause. |
| 591-605 | stream canonicalizes the old zero rule event | group_stream_v2 | delete (V4 stream omits rules_change, groups-competitions.sh:334) |
| 606-608 | stored rule-event audit preserved | SQL | keep |
| 613-616 | legacy reading correction ends 1RM only; raw witness active | SQL | delete (pending-only legacy witness; dup of groups-competitions.sh:445-446) |
| 617-624 | withdrawing the legacy witness ends root and projections | group_metric_certification_end | delete (dup of groups-competitions.sh:552-556) |
| 626-630 | legacy history exposes original witness IDs | group_metric_history | delete (pending-only; the V4 history wire carries no certification_id) |
| 634, 641 | certify a new e1RM witness | group_metric_certify | port → group_competition_certify |
| 639-640 | equal-score raw spelling edit voids the witness | SQL | keep (GX must be a V4 comparison) |
| 645-646 | set tombstone voids its witness | SQL | delete (dup of groups-competitions.sh:521-522) |
| 650-651 | restoration never revives ended witnesses | SQL | delete (dup of groups-competitions.sh:523-524) |
| 656-658 | pending-deletion legacy exercise created | group_exercise_create | delete (pending-only) |
| 663-665 | legacy certify before retirement | group_certify | delete (pending-only) |
| 669-670 | retirement voids the stale original before the evaluator runs | SQL | delete (pending-only: legacy retirement happens only at activation) |
| 675-676 | ended legacy observation never imported | SQL | delete (pending-only) |
| 681 | zero comparison for the stream witness (setup) | group_exercise_create_v2 | port → group_competition_exercise_create |
| 688 | certify a stream e1RM witness | group_metric_certify | port → group_competition_certify |
| 693-694 | coalesced job emits no record/correction | SQL | keep |
| 695-696 | coalesced job still publishes the certification lead change | SQL | keep (V4 apply_member writes reason `certification` with payload certification_id) |
| 697-702 | record context keeps its witness after source rescore | group_stream_v2 | port → group_competition_stream (`.event.record_context.metrics[]`) |
| 703-704 | record audit unchanged; private baseline exists | SQL | keep |
| 705-707 | withdraw after source rules | group_metric_certification_end | port → group_competition_certification_end (`p_metric:"e1rm"`) |
| 708-711 | later certification job causes no false correction; audit kept | SQL | keep |
| 715-716 | equivalent numeric correction keeps the standing record | SQL | keep |
| 719-721 | newer stronger set is the All-board best | group_metric_board | port → group_competition_board e1rm |
| 722-725 | historic record context exposes the current pin and revision | group_stream_v2 | port → group_competition_stream (`write_fingerprint` → `write_token`; revision at `.event.rules_revision`) |
| 726-730 | certify the historic record with its context token | group_metric_certify | port → group_competition_certify (`p_write_token`) |
| 732-737 | historic context eligible with the new witness | group_stream_v2 | port → group_competition_stream |
| 741-742 | real correction voids the historic record | SQL | keep |
| 743-744 | real correction voids the new witness | SQL | keep |

### supabase/tests/groups-week-summary.sh

#### Fixture changes

| lines | what to change |
|---|---|
| 175-179 `summary` | `group_week_summary` → `group_competition_week_summary` (same arguments). |
| 263-276 | `group_exercise_create` (Bench/Row/Edge) and `group_exercise_create_v2` (Squat, `p_default_metric:"weight"`, now invalid) → `group_competition_exercise_create`. All four become contract-2 V4 comparisons, so every record pipeline drain becomes `drain2`. |
| 354-416, 565 | The record fixtures were designed for Weight/1RM. Re-derive them for Volume (reps×kg) and 1RM; for example, m1 105×1 no longer leads any board (105 < R1's 500). |

#### Assertions

| line(s) | what it asserts (≤12 words) | RPC(s) | verdict |
|---|---|---|---|
| 125-132 | drain/drain2 200, no failed job | group-eval Edge | keep |
| 247-259 | create G/H, invite, joins | group_create, group_invite_get, group_join | keep + header |
| 264-276 | group exercises created (setup) | group_exercise_create, group_exercise_create_v2 | port → group_competition_exercise_create |
| 303-306 | summary RPC is security definer with a pinned search_path | SQL pg_proc | port → proname `group_competition_week_summary` |
| 307-311 | only group_week_summary of group_week_* is client-executable | SQL pg_proc | port → expect no client-executable `group_week_*`, and `group_competition_week_summary` executable by authenticated only |
| 312-315 | week helpers pin search_path, not security definer | SQL pg_proc | keep |
| 317-318 | anon → AUTH_REQUIRED | group_week_summary | delete (dup of groups-competitions.sh:307-315: anon is non-2xx; the authenticated-only grant makes AUTH_REQUIRED unreachable) |
| 319-321 | OAuth token → AGENT_FORBIDDEN | group_week_summary | delete (dup of groups-competitions.sh:309) |
| 322-323 | outsider → NOT_FOUND | group_week_summary | delete (dup of groups-competitions.sh:308) |
| 324-325 | outsider with a bad window: membership before validation | group_week_summary | delete (dup of groups-competitions.sh:307-318: generated args make start = end = 1, an invalid window) |
| 326-327 | nonexistent group → NOT_FOUND | group_week_summary | port → group_competition_week_summary |
| 328-337 | empty/reversed/over-8-day/negative/null window → VALIDATION | group_week_summary | port → group_competition_week_summary (the pre_competition validation message is unchanged) |
| 338-339 | 8-day window accepted | group_week_summary | port → group_competition_week_summary |
| 340-342 | empty week has exact top-level keys | group_week_summary | port → group_competition_week_summary (keys gain `contract_version` and `group_id`) |
| 343 | empty week: no training, no latest | group_week_summary | port → group_competition_week_summary |
| 345 | empty board ranks every member equally | group_week_summary | port → group_competition_week_summary |
| 370-385 | null `working` counts as working everywhere, not a warm-up | SQL group_week_session_counts, group_board_counting, group_set_is_warm_up | keep (the `group_board_counting` term is legacy-evaluator-only; drop that term if the removal drops the function) |
| 396-399 | deleted R2 record is voided | SQL | keep |
| 422-424 | provisional A2 record is a group record on two boards | SQL | keep (values: re-derive for volume/e1rm) |
| 425-432 | per-record group_record flags | SQL | keep (values: re-derive; m1 needs a redesign) |
| 434-439 | m1 leads Weight only; R1 leads both | SQL | keep (values: `weight`→`volume`; redesign m1 to lead exactly one board, e.g. 130×1 leads e1rm but not volume) |
| 441-443 | both record pipelines (contract 1 and 2) are covered | SQL | delete (contract-1 events cannot be produced once active; every comparison is contract 2) |
| 445-453 | board ranks, working sets and group records | group_week_summary | port → group_competition_week_summary (members passed through verbatim; values re-derived) |
| 454-455 | board row and member have exact keys | group_week_summary | port → group_competition_week_summary |
| 458-461 | hard-deleted set stops counting at once | SQL + group_week_summary | port → group_competition_week_summary |
| 465-468 | tombstoned set and record stop counting before drain | group_week_summary | port → group_competition_week_summary |
| 470-473 | restored set counts again | group_week_summary | port → group_competition_week_summary |
| 475-477 | window start is inclusive | group_week_summary | port → group_competition_week_summary |
| 478-480 | window end is exclusive | group_week_summary | port → group_competition_week_summary |
| 487-488 | late member joins | group_join | keep + header |
| 495-496 | pre-join session is not shared | SQL | keep |
| 497-499 | unshared session counts nothing | group_week_summary | port → group_competition_week_summary |
| 524-526 | training now: fresh active sessions, newest first | group_week_summary | port → group_competition_week_summary |
| 527-528 | training row has exact keys | group_week_summary | port → group_competition_week_summary |
| 529-532 | gym name, null gym, live started_at | group_week_summary | port → group_competition_week_summary |
| 533 | active sessions add nothing to the board | group_week_summary | port → group_competition_week_summary |
| 537-540 | a fresh set write makes a stale session train now | group_week_summary | port → group_competition_week_summary |
| 548-550 | latest completed is edge-out | group_week_summary | port → group_competition_week_summary |
| 551-553 | latest_completed has exact keys | group_week_summary | port → group_competition_week_summary (same key set in the V4 rebuild) |
| 554-556 | latest figures: member, times, duration, counts, gym | group_week_summary | port → group_competition_week_summary |
| 557-562 | contract-1 group record normalized (boards, value kg) | group_week_summary | port → group_competition_week_summary. **Shape change:** `group_records[]` are competition events (`group_exercise`, `set_id`, `values[{role,metric,unit,value,unavailable}]` with role `record` filtered to the #1 boards); no `key`/`boards`. Edge becomes contract 2; the unit is `kg_reps`/`kg`. |
| 565-574 | contract-2 group record normalized | group_week_summary | port → group_competition_week_summary (same reshape; partly a dup of groups-competitions.sh:648-650) |
| 579-582 | latest session without group records | group_week_summary | port → group_competition_week_summary |
| 592-594 | X counts on the board before removal | group_week_summary | port → group_competition_week_summary |
| 595-596 | owner removes X | group_remove_member | keep + header |
| 597-601 | removed member leaves the board, training now and latest | group_week_summary | port → group_competition_week_summary |
| 602-603 | removed member reads NOT_FOUND | group_week_summary | port → group_competition_week_summary |
| 604-606 | group H shows nothing of G's | group_week_summary | port → group_competition_week_summary |

---

### Open points for the implementer

1. **The `[H]` helpers carry the certification-engine coverage.** The `group_board_entries` → `group_metric_board_entries` and `group_certifications` → `group_metric_certifications` retargeting is what keeps it. Without the retargeting, those keep rows assert against tables V4 never writes.
2. **No V4 test presents stored contract-1 records in the week summary** (D3 history read path). Once active, nothing can create such a record. If that path must stay guarded, seed a contract-1 `record` event by SQL and assert its `values` (`unit:"kg"`, value from `value_kg`).
3. **The legacy-only SQL helpers lose their only callers** when the removal drops the legacy evaluator. These are `group_board_load_factor` (bodyweight.sh:527-532, deleted above) and `group_board_counting` (week-summary.sh:374-375, a term inside a keep row).
4. **Silent rules recompute** (cert.sh:736-739): V4 does not make a `rules` session-cause job silent. The port moves the silent assertion onto a rules-revision rebuild.

### Totals

Counted from the assertion tables above; fixture-change tables are not counted.

| file | keep | keep + header | port | delete | rows |
|---|---|---|---|---|---|
| groups-fixtures.sh | 3 | 0 | 0 | 0 | 3 (+1 fixture change: the rpc() header) |
| groups-certification.sh | 61 (19 plain + 42 `[H]`) | 2 | 48 | 7 | 118 |
| groups-bodyweight.sh | 30 | 2 | 40 | 32 | 104 |
| groups-week-summary.sh | 8 | 3 | 32 | 5 | 48 |


## 8. Test map — groups-competitions.sh, groups-competition-live.sh, groups-api-live.sh, Jest live suites

Line numbers are from the committed files at 538baa4a. In `supabase/tests/lib/groups-fixtures.sh`,
the committed `rpc()`, `eval_drain()` and `sign_in()` send **no** `x-boga-group-contract` header; T02
adds `x-boga-group-contract: 4` to all three.

Verdict key:
- **keep**: valid on any stack, unchanged.
- **keep + header**: needs `x-boga-group-contract: 4` on an active baseline. The committed `rpc()` does not send it.
- **port → X**: the assertion uses a pre-V4 RPC. Re-express it on V4 RPC X.
- **move**: a V4 chapter assertion. It moves to a default lane.
- **move\***: move, but it reads a fixture that the cutover chapter built with pre-V4 RPCs. It needs a V4 refixture (see "V4 refixture" below).
- **cutover-only**: it needs pending state, protocol-3/M25 fixtures or activation. It stays in groups-protocol4 and is deleted when that lane retires.
- **delete**: removed, with the reason stated.

Lane today: `groups-protocol4` (extra), `scripts/lanes.tsv:44`. It runs
`run-suite.sh groups-competition-live.sh groups-competitions.sh`, in that order.

---

### 8.1 supabase/tests/groups-competitions.sh (654 lines)

#### Chapters

| # | Lines | Chapter | Label |
|---|---|---|---|
| A | 1–146 | Harness: pre-cutover reset, kick-URL off, `rpc4`, wire decoder, helpers | mixed (L29–32 and the `create_old`/`old_board`/`old_certify` helpers are cutover; the rest is V4 harness) |
| B | 147–221 | Protocol-3 + M25 populated fixture (6 users, `_v2`/M25 comparisons, old certs, frozen former/archived) | **cutover** |
| C | 222–264 | `db push` upgrade, pending checks, activation fence, activation effects on old certs | **cutover** |
| D | 266–280 | Legacy raw witness aliases, compatible former/archived ordinary at cutover | **cutover** |
| E | 282–305 | Old readers deny forged header; header negotiation; authz; private helpers | mixed (L283–289 and half of L301–304 cutover; rest V4) |
| F | 307–318 | Every authenticated `group_competition_*` RPC denies anon/OAuth/outsider | **V4** |
| G | 320–352 | Catalog/podium/revision/history/stream/session/week payloads with enabled privacy | **V4** (except L347–350) |
| H | 354–378 | Queued source move and unbound exercise privacy | **V4** |
| I | 380–498 | Both-metric reading correction matrix, rule/distribution retention, inactive isolation | **V4** (except L446) |
| J | 500–557 | Stale write tokens, raw correction/deletion, precision, unweighted, manual lifecycle | **V4** (except L518, L552–556) |
| K | 559–569 | Rejoin and unarchive catch-up of frozen witnesses | **cutover** as written (M25 certs); port candidate |
| L | 571–620 | Metric publication fences, lease reclaim, publication-fault isolation | **V4** |
| M | 622–651 | Week summary: record values only for boards taken #1 | **V4** (self-contained) |

#### A. Harness (1–146)

| line(s) | asserts | RPC(s) | verdict |
|---|---|---|---|
| 29 | marks the stack for reset (one-way body) | — | cutover-only. Drop on move. |
| 31 | `db reset --version 20261004225853` (pre-publication) succeeds | — | cutover-only |
| 32 | Edge proxy reroutes after the reset | — | cutover-only |
| 35–36 | reads the eval secret, **unsets kick URL, disables `group-eval-sweep`, never restores them** | `group_eval_config`, `group_eval_set_url` (SQL) | move with fix: save and restore both in cleanup, as groups-boards.sh:51–63 does |
| 37–44 | `rpc4` helper: `x-boga-group-contract: ${4-4}`, **`x-boga-sync-protocol: 3`** | — | keep. The sync-protocol 3 header is out of scope; flag only. |
| 82 | decoder canary rejects `{}` | wire guards | keep |
| 85–90 | `drain`: group-eval Edge 200, `.failed==n` | Edge `group-eval` (sync-protocol 3 header) | keep |
| 94–98 | `create_old` → expect_ok | `group_exercise_create_v2` | cutover-only (refixture uses `group_competition_exercise_create`) |
| 99–102 | `old_board` → expect_ok | `group_metric_board` | cutover-only |
| 103–120 | `old_certify`: L106 ranked shared set exists; L119 expect_ok | `group_metric_board`, `group_metric_certify` | cutover-only |
| 121–125 | `policy` expect_ok | `group_update` (rpc4) | keep |
| 126–130 | `board` expect_ok + `isCompetitionBoardWire` | `group_competition_board` | keep |
| 131–140 | `certify` expect_ok + `isCompetitionCertifyResultWire` | `group_competition_board`, `group_competition_certify` | keep |
| 141–146 | `audit` SQL snapshot of a metric certification | SQL | keep |

Note: groups-competitions.sh uses fds 7/8 for the decoder. groups-fixtures.sh `psql_session_start` also
uses 7/8. A default-lane body that adopts the psql session must renumber one of them.
Cleanup (L19–26) never deletes `RUN_USER_IDS` data, because it relies on the reset. A default lane must
delete them, as groups-competition-live.sh:43–54 does.

#### B. Protocol-3/M25 populated fixture (147–221): cutover

| line(s) | asserts | RPC(s) | verdict |
|---|---|---|---|
| 147–148 | provisions 6 users + usernames | auth, SQL | cutover (the refixture needs OWNER/ATHLETE/RIVAL/NEVER/OUTSIDER/FROZEN too) |
| 149 | create group expect_ok | `group_create` (`rpc`, no header) | cutover. Refixture: keep + header |
| 151 | invite expect_ok | `group_invite_get` (`rpc`) | cutover. Refixture: keep + header |
| 152 | 4× join expect_ok | `group_join` (`rpc`) | cutover. Refixture: keep + header |
| 153–154 | GX (contribution 1, metric weight) and ZERO_GX (contribution 0) created | `group_exercise_create_v2` | cutover-only. Refixture: port → `group_competition_exercise_create` (GX default `volume`) |
| 156–166 | 3 sources + 2 readings pushed, ack ok | `sync_push` | cutover (reusable as-is in the refixture) |
| 168–172 | secondary link + ordinary-context push ok | `sync_push` | cutover (reusable) |
| 173 | drain ok | Edge | cutover (reusable) |
| 174–176 | WEIGHT, E1RM, NEVER old certifications | `group_metric_board`, `group_metric_certify` | cutover-only (`weight` is not a V4 metric). E1RM/NEVER refixture: port → `group_competition_certify` |
| 180–211 | M25 legacy/archived comparisons; L183, L196 expect_ok; L193, L210 drains | `group_exercise_create`, `group_certify`, `sync_push` | cutover-only |
| 212 | archive before install expect_ok | `group_exercise_archive` (M25) | cutover-only |
| 213 | FROZEN leaves expect_ok + drain | `group_leave` (`rpc`) | cutover |
| 214–218 | raw edits while former/archived pushed; drain | `sync_push` | cutover-only |
| 219 | policy On + drain | `group_update` (rpc4) | cutover (keep in refixture) |
| 220 | never-bound sentinel `reading_pin` exists pre-install | SQL | cutover-only |
| 221 | pending reading correction (90 kg) pushed | `sync_push` | cutover |

#### C. Upgrade, pending state, activation (222–264): cutover

| line(s) | asserts | RPC(s) | verdict |
|---|---|---|---|
| 223 | populated `db push --include-all` succeeds | — | cutover-only |
| 224 | migration cleared the never-bound pin, cert still active | SQL | cutover-only |
| 225 | contract `activation_state=="pending"` + wire | `group_competition_contract` | cutover-only (no pending state, D1) |
| 226 | pending board → UPDATE_REQUIRED | `group_competition_board` | cutover-only |
| 227 | user JWT cannot activate | `group_competition_activate` | cutover-only (function dropped, D1) |
| 228–239 | activation blocks on shared advisory fence 25006 | `group_competition_activate` (SQL) | cutover-only |
| 240 | failed activation leaves capability pending | `group_competition_active()` | cutover-only |
| 241 | service activation `activated && comparisons==4` | `group_competition_activate` | cutover-only |
| 242 | second activation is idempotent | `group_competition_activate` | cutover-only |
| 243 | contract `activation_state=="active"` + wire | `group_competition_contract` | cutover here. V4 equivalent → move (contract read + wire on refixture). The Jest equivalent is already at groups-competition-api-live.test.ts:64 |
| 244 | board `rebuilding`, no entries before drain | `group_competition_board` | cutover (activation enqueue). Port candidate → `group_competition_exercise_update`, then board `rebuilding` |
| 246–247 | Volume ready, `default_metric=="volume"`, 2 normalized entries | `group_competition_board` | weight→volume default mapping is cutover-only. Normalized best-single-set Volume: port onto refixture (move\*) |
| 248–250 | normalized values 611.11 / 583.33 use private as-of reading | `group_competition_board` | move\* (refixture pushes the athlete's reading as 90 directly; it was the pending correction at L221) |
| 251–253 | pending correction voids 1RM, keeps Weight origin | SQL | cutover-only |
| 254 | original audit unchanged at cutover | SQL | cutover-only |
| 255 | Weight witness aliased into Volume, same public ID | `group_competition_board` | cutover-only |
| 256–258 | distinct Volume origin row, null kg audit | SQL | cutover-only |
| 259–260 | first binding leaves audit unchanged | `sync_push`, SQL | cutover-only (sentinel exists only via migration) |
| 261–262 | first valid binding restores Certified | SQL | cutover-only |
| 263 | same public ID back on the Certified e1rm board | `group_competition_board` | cutover-only |

#### D. Legacy raw witness / former / archived at cutover (266–280): cutover

All fixtures come from M25 `group_certify` (L194) and activation's `group_competition_import_frozen_legacy`.

| line(s) | asserts | RPC(s) | verdict |
|---|---|---|---|
| 267–269 | legacy raw witness ID public on volume + e1rm Certified | `group_competition_board` | cutover-only. **D3 gap:** this is the only live proof that V4 presents stored M25 certs (`group_competition_legacy_certification_json`). It dies with the lane unless the stored rows are SQL-seeded |
| 270 | former entry keeps its original period and score in kg | `group_competition_board` | cutover-only (same D3 gap) |
| 271 | former raw correction stays frozen Certified | `group_competition_board` | cutover-only |
| 272 | inactive raw Weight does not invent Volume | `group_competition_board` | cutover-only |
| 273 | legacy audit unchanged at cutover | SQL | cutover-only |
| 274 | archived ordinary legacy board `archived`, 2 kg entries | `group_competition_board` | cutover-only (D3 gap) |
| 275 | archived raw deletion stays frozen Certified | `group_competition_board` | cutover-only |
| 276–277 | frozen raw edits not reconciled early | SQL | cutover-only |
| 278 | archived raw Weight has no Volume | `group_competition_board` | cutover-only |

#### E. Old readers, header, authorization (282–305)

| line(s) | asserts | RPC(s) | verdict |
|---|---|---|---|
| 283–289 | **every RPC with a `_pre_competition` twin returns UPDATE_REQUIRED even with forged header 4**: 27 RPCs, listed in the note below | old public RPCs | cutover-only. Becomes **one catalog assertion** later: no pre-V4 function exists or is granted |
| 290–292 | `group_get` with header missing/`3`/`invalid`/`04`/`4.0` → UPDATE_REQUIRED | `group_get` | move (header negotiation outlives D1; `group_require_app_user` then requires the capability unconditionally) |
| 293–294 | outsider → NOT_FOUND | `group_competition_exercise_list` | move |
| 295–297 | nonexistent group reads exactly like an outsider | `group_competition_exercise_list` | move |
| 298 | OAuth token → AGENT_FORBIDDEN | `group_competition_exercise_list` | move |
| 299 | anon key → non-2xx | `group_competition_exercise_list` | move |
| 300 | direct `group_metric_set_scores` REST read denied | REST table | move |
| 301–304 | private helpers not executable by authenticated/service_role | catalog SQL | split: the `%_pre_competition` half is cutover-only (folded into the catalog assertion). The `group_competition_event_json/history_value/session_json` half → move |

The 27 RPCs in L283–289: `group_board`, `group_board_history`, `group_board_podiums`,
`group_certification_cancel`, `group_certification_withdraw`, `group_certify`, `group_exercise_archive`,
`group_exercise_archive_v2`, `group_exercise_create`, `group_exercise_create_v2`, `group_exercise_list`,
`group_exercise_list_v2`, `group_exercise_unarchive`, `group_exercise_unarchive_v2`,
`group_exercise_update`, `group_exercise_update_v2`, `group_metric_board`,
`group_metric_certification_end`, `group_metric_certification_get`, `group_metric_certify`,
`group_metric_history`, `group_metric_podiums`, `group_metric_revisions`, `group_session_detail`,
`group_stream`, `group_stream_v2`, `group_week_summary`.

#### F. Every current RPC denies before payload validation (307–318): V4

| line(s) | asserts | RPC(s) | verdict |
|---|---|---|---|
| 307–315 | for each authenticated-executable `group_competition_%` (15 RPCs): outsider NOT_FOUND (308), OAuth AGENT_FORBIDDEN (309), anon non-2xx (310) | board, certification_end/get, certify, contract, exercise_archive/create/list/update, history, podiums, revisions, session_detail, stream, week_summary | move. `group_competition_activate` is service_role-only, so it is not in the loop |
| 316–317 | unshared member/session pair → NOT_FOUND | `group_competition_session_detail` | move |

#### G. Payload decode with enabled privacy (320–352): V4

| line(s) | asserts | RPC(s) | verdict |
|---|---|---|---|
| 320 | catalog ok + wire | `group_competition_exercise_list` | move\* |
| 321 | podiums ok + wire | `group_competition_podiums` | move\* |
| 322 | revisions ok + wire | `group_competition_revisions` | move\* |
| 323–327 | history ×(weight, volume, e1rm) at `p_revision:2`: wire; values null or %BW | `group_competition_history` | move\*. `p_revision:2` is the revision activation bumped to, so the refixture uses its current revision. `weight` history has data only on legacy revisions |
| 328–333 | stream (group, all) wire; no private paths; normalized sessions/events have no kg | `group_competition_stream` | move\* |
| 334 | stream omits `rules_change` | `group_competition_stream` | move\* |
| 336 | `rules_change` events exist in `group_events` | SQL | move\*. Today they come from activation/policy; the refixture must make one (policy toggle or rules update) |
| 337–342 | session detail wire; normalized redacted, ordinary 50 kept, no `volume_kg_reps` | `group_competition_session_detail` | move\* |
| 343–345 | week summary wire, `.members|length==4` | `group_competition_week_summary` | move\* (FROZEN must have left) |
| 346 | ZERO_GX ordinary counterpart cannot bypass same-group boundary (empty) | `group_competition_board` | move\* |
| 347–350 | ZERO_GX history `p_revision:1`: old kg event unavailable, not relabeled | `group_competition_history` | cutover-only (revision 1 is the pre-activation protocol-3 revision) |

#### H. Queued identity / unbound exercise (354–378): V4

| line(s) | asserts | RPC(s) | verdict |
|---|---|---|---|
| 357–363 | queued source move: session stays normalized, no `weight_value` | `sync_push`, `group_competition_session_detail` | move\* |
| 365–366 | restore identity, drain | `sync_push`, Edge | move\* |
| 370–377 | unknown exercise keeps reps, omits kg | `sync_push`, `group_competition_session_detail` | move\* |

#### I. Correction matrix (380–498): V4

Helpers: `update_rules` L382–388 (`group_competition_exercise_update` + wire), `pair` L389–398 (2×
`certify` + SQL), `retained` L402–410 (SQL + `board` ×2), `ended` L411–423 (SQL +
`group_competition_certification_get` + wire, L419–420 + `board`, L421). All keep.

| line(s) | asserts | RPC(s) | verdict |
|---|---|---|---|
| 426 | pair certified | `group_competition_certify` | move\* |
| 427 | bodyweight switch off/on retains both | `group_update` + board | move\* |
| 428 | contribution 0/0.5/1 retains | `group_competition_exercise_update` | move\* |
| 429 | target per_side/total retains | `group_competition_exercise_update` | move\* |
| 430–434 | source distribution change retains | `sync_push` | move\* |
| 435–437 | units back to normalized | `group_competition_board` | move\* |
| 438 | future reading retains | `sync_push` + board | move\* |
| 439 | invalid (0 kg) reading retains | same | move\* |
| 440 | losing older reading retains | same | move\* |
| 441 | no-op rewrite retains | same | move\* |
| 442–444 | coalesced edit-and-restore retains | same | move\* |
| 445 | selected value change ends both | same + certification_get | move\* |
| 446 | **raw Weight witness ignores dependent correction** | SQL on WEIGHT_CERT | cutover-only (`weight` cert only from protocol 3) |
| 447 | restoration never reopens | same | move\* |
| 448–449 | date change with same kg ends | same | move\* |
| 450–451 | date leaves session interval ends | same | move\* |
| 452 | date restore remains terminal | same | move\* |
| 453–454 | losing fallback retains | same | move\* |
| 455 | invalid selected input ends | same | move\* |
| 456 | valid restoration stays terminal | same | move\* |
| 457–458 | deletion selects fallback, ends | same | move\* |
| 459–460 | restored winner ends | same | move\* |
| 461–462 | winning backdate ends | same | move\* |
| 463–464 | equal-time binary-tie winner ends | same | move\* |
| 465–466 | equal-time loser retains | same | move\* |
| 469–477 | deleting every candidate ends (no kg/zero fallback) | `sync_push` + certification_get | move\* |
| 478 | missing context omits athlete on both boards | `group_competition_board` | move\* |
| 479 | restore after missing stays terminal | same | move\* |
| 481–483 | off/zero inactive retains | `group_update` / `exercise_update` | move\* |
| 484–489 | inactive source graph never calls private resolver | `group_metric_eval_source_graph` (SQL; today it has an ACTIVE-BRANCH and calls `_v3`) | move\* (the assertion survives the implementation change) |
| 490–492 | inactive reading edit does not enqueue | `group_metric_eval_queue` SQL | move\* |
| 493 | retained pin | board | move\* |
| 494–495 | reactivation detects intervening correction, ends | `group_update`/`exercise_update` | move\* |
| 496 | re-pair | `group_competition_certify` | move\* |

#### J. Tokens, raw corrections, precision, lifecycle (500–557): V4

| line(s) | asserts | RPC(s) | verdict |
|---|---|---|---|
| 502–509 | old write token after rescore → CONFLICT | `group_competition_board`, `group_competition_certify` | move\* |
| 510–516 | token with queued raw correction → CONFLICT | same | move\* |
| 517 | raw correction ends pair | certification_get + board | move\* |
| 518 | **raw correction also ends original Weight witness** | SQL on WEIGHT_CERT | cutover-only |
| 519–520 | raw restoration stays ended | same | move\* |
| 521–522 | raw deletion ends | same | move\* |
| 523–524 | raw set restoration stays ended | same | move\* |
| 526–534 | full precision ranks unequal values above tie-breakers | `group_competition_board` | move\* |
| 535–538 | unweighted (0 and '') bodyweight Volume eligible = 500 | `group_competition_board` | move\* |
| 541–542 | non-witness withdrawal → FORBIDDEN | `group_competition_certification_end` | move\* |
| 543–545 | witness withdrawal ok + wire, `end_reason=="withdrawn"` | `group_competition_certification_end` | move\* |
| 546–548 | admin cancel ok + wire, `end_reason=="cancelled"` | `group_competition_certification_end` | move\* |
| 552–556 | **legacy (M25) ID withdrawal closes root and every projection** | `group_competition_certification_end` + SQL on `group_certifications` | cutover-only (LEGACY_CERT is M25). D3 gap: V4 accepting an M25 ID loses its live proof |

#### K. Rejoin / unarchive catch-up (559–569): cutover as written

| line(s) | asserts | RPC(s) | verdict |
|---|---|---|---|
| 559 | former member rejoins | `group_join` (rpc4) | keep + header (it already sends the header) |
| 560–561 | old membership period hidden before catch-up | `group_competition_board` on LEGACY_GX / FORMER_CERT (M25) | cutover-only. Port candidate: the same fencing on a V4 cert (`group_competition_certify` → `group_leave` → raw edit → `group_join`). Operator call |
| 562–563 | rejoin reconciles frozen raw edit (`group_certifications`) | Edge, SQL | cutover-only (same port candidate) |
| 564–565 | unarchive ok + wire | `group_competition_exercise_archive` | move\* (ARCHIVE_GX was M25-created; refixture via `group_competition_exercise_create` + archive) |
| 567 | unarchive reconciles frozen raw deletion (`group_certifications`) | SQL | cutover-only (port candidate as above) |

#### L. Publication fences / fault isolation (571–620): V4

| line(s) | asserts | RPC(s) | verdict |
|---|---|---|---|
| 573–600 | stale claim/generation/source/`contract_version:3` publish completes nothing and leaves entries unchanged; expired lease reclaimed | `group_metric_eval_enqueue`, `_source_graph`, `_publish` (ACTIVE-BRANCH today), `_claim` (SQL) | move\* |
| 603–604 | injected fault constraint | SQL | move\* |
| 605–606 | personal Sync commits under the fault (reps 6) | `sync_push`, REST `exercise_sets` | move\* |
| 607 | drain reports 1 failure | Edge | move\* |
| 608–609 | job kept: attempts=1, SQLSTATE 23514, claim cleared | SQL | move\* |
| 610–611 | certification commits independently | `group_competition_certify` | move\* |
| 612–615 | fault removed, retry drains | SQL, Edge | move\* |
| 616 | retried publication includes committed witness | `group_competition_board` | move\* |
| 617–619 | `group.eval_failed` logs carry only sanitized keys | SQL `public.app_logs` | move\* |

#### M. Week summary records (622–651): V4, self-contained

| line(s) | asserts | RPC(s) | verdict |
|---|---|---|---|
| 627–629 | week comparison created | `group_competition_exercise_create` | move |
| 631–640 | 2 sessions pushed, drained | `sync_push`, Edge | move |
| 641–644 | athlete record event: `e1rm=false,volume=true` | SQL `group_events` | move |
| 645–650 | week summary wire; latest session's group records = volume only | `group_competition_week_summary` | move |

`pass` checkpoints: 264, 280, 305, 318, 352, 378, 498, 557, 569, 620, 651, 654.

#### V4 refixture needed by every move\* row

On an active baseline the cutover fixture (B) cannot be built, because every pre-V4 write returns
UPDATE_REQUIRED. A default-lane V4 body needs its own fixture:
- the same 6 users;
- `group_create`, `group_invite_get` and `group_join` with the header (**keep + header**);
- GX = `group_competition_exercise_create(contribution 1, default volume)`;
- ZERO_GX = the same with contribution 0, plus the secondary link (L168–172);
- the L156–172 pushes, with ATHLETE's reading pushed at 90;
- `policy true`;
- a `rules_change` event (for L336);
- FROZEN leaves (L343–345 expect 4 members);
- an archived V4 comparison for L564–565.

Variables that come from pre-V4 writes and have no V4 source: WEIGHT_CERT, E1RM_CERT, NEVER_CERT,
LEGACY_CERT, FORMER_CERT, ARCHIVE_CERT, LEGACY_GX, ARCHIVE_GX (M25). Every row that reads them is
marked cutover-only above.

---

### 8.2 supabase/tests/groups-competition-live.sh (89 lines): wrapper, lane groups-protocol4

| line(s) | what it does |
|---|---|
| 2–9 | header: "protocol-4 server (lane groups-protocol4)", activation is one-way and forces a rebuild, "ordinary client wire is groups-api-live.sh's job" |
| 11–15 | ORDER note: it must run before groups-competitions.sh, because that body unsets the kick URL (L36) without restoring it, and this suite needs the live evaluator |
| 25–26 | `LANE_LABEL`/`FIXTURE_EMAIL_PREFIX=groups-protocol4` |
| 30–36 | requires curl/docker/jq/npm, status env, db container |
| 43–54 | cleanup deletes the run users' logs, M25 `group_eval_queue` rows, groups (cascade covers `group_metric_eval_queue`) and auth users |
| 72–75 | provisions OWNER and MEMBER (password sign-in; no group RPC), sets usernames |
| 80–85 | exports the `GROUPS_LIVE_*` env |
| 86 | **`with-local-group-competitions.sh npm run test:groups:competition-live`** |

`supabase/scripts/with-local-group-competitions.sh` (24 lines):
- L11 reads `group_competition_active()`.
- L14 marks the stack for reset if it was pending.
- L15–19 calls `group_competition_activate` (service_role, header 4).
- L20 requires HTTP 200 and `contract_version==4`.
- L24 runs the command.

On an active stack it does not mark the stack. Activation is idempotent (200), so it still passes until D1
drops `group_competition_activate`; after that, the call fails.

**Changes needed for an active baseline:**
- L86: drop the wrapper and run `npm run --silent test:groups:competition-live` directly.
- L2–9: drop the protocol-4/one-way/rebuild wording.
- L11–15: the ORDER note is moot once groups-competitions.sh is out of the lane. Whichever V4 body moves must restore the kick URL and sweep.
- L25–26: rename if the lane changes. One option is to run both Jest suites in groups-api-live, which would make groups-api-live.test.ts:6–8 true again.
- `scripts/triggers.tsv`: L84 (the wrapper), L86 and L88 point at groups-protocol4.

Other dependents of the wrapper, outside the files mapped here:
- `apps/mobile/scripts/maestro-run-lane.sh:157` (ios-groups-e2e).
- `apps/mobile/README-maestro.md:20`.
- `apps/mobile/__tests__/groups-runtime-fixture.test.ts:30–64`: 3 Jest tests execute the wrapper itself. They are deleted with it. The first test, L9–25 (counterparty headers), stays.
- `supabase/scripts/group-competitions-activate.sh:11`.
- **`supabase/scripts/ensure-local-runtime-baseline.sh:229–241`**: `stack_reset_reason` treats "protocol 4 is active" as needing a reset. On an active baseline every preflight would reset, so this check must flip or go.

### 8.3 supabase/tests/groups-api-live.sh (83 lines): wrapper, lane groups-api-live (slow-backend)

| line(s) | what it does |
|---|---|
| 2–9 | header. L8–9: "protocol-4 client wire is groups-competition-live.sh (lane groups-protocol4): activating competitions is one-way and forces a stack rebuild". This goes stale on an active baseline |
| 37–48 | cleanup, same as above |
| 66–69 | provisions OWNER and MEMBER (no group RPC), sets usernames |
| 74–80 | exports `GROUPS_LIVE_*` and runs `npm run test:groups:live` |

Changes for an active baseline:
- The body makes no group RPC, so it needs no header change.
- L8–9 needs a rewrite.
- If the competition suite joins this lane, add `npm run --silent test:groups:competition-live` after L80. It needs a live evaluator kick URL. The baseline configures one (`group-eval-configure.sh`), but a stamped baseline skips repairs (ensure-local-runtime-baseline.sh:258–260), so an earlier lane that unsets the URL must restore it.

---

### 8.4 Jest live suites

Client: `apps/mobile/src/groups/api.ts`. `callGroupRpc` (L132–152) sends `x-boga-group-contract: 4` for
`capability===4` (every `competitionRpc`, L290–294) **and** for the 12 `PUBLIC_GROUP_RPCS` (L129–131).
So both suites already speak the active-stack header. The endpoint helper
(`__tests__/helpers/groups-live-endpoint.ts:76–79`) adds only `x-boga-sync-protocol: 4`.

#### apps/mobile/__tests__/groups-api-live.test.ts (lane groups-api-live)

| test (lines) | client fn → RPC | pre-V4 RPC? | needs active? | verdict |
|---|---|---|---|---|
| L85–105 "creates, invites, previews, joins, reads and updates a group" | createGroup→`group_create`; getGroupInviteCode→`group_invite_get`; regenerateGroupInviteCode→`group_invite_regenerate` (L89 new code); previewGroupInvite→`group_invite_preview` (L92); joinGroup→`group_join` (L93); listMyGroups→`group_list_mine` (L96, guard `groups:v5:mine`); getGroup→`group_get` (L98–99, guard `group:v5:<id>`); updateGroup→`group_update` (L104 bodyweight flag) | no | no (passes on pending or active; header always sent) | keep |
| L107–122 "changes roles, transfers ownership, removes a member, and leaves" | setGroupMemberRole→`group_set_role` (L110); transferGroupOwnership→`group_transfer_ownership` (L114); removeGroupMember→`group_remove_member` (L116); leaveGroup→`group_leave` (L119); getGroup (L121); helper `groupWithMember` (L67–72): create/invite_get/join | no | no | keep |

**Stale comment L6–8:** it says the competition calls run in `groups-competition-api-live.test.ts`,
"the same lane's second suite, with protocol 4 active". Today that suite runs in a different lane
(groups-protocol4, via groups-competition-live.sh), not in groups-api-live. Replacement text:
- If the suite joins this lane: "The competition calls run in `groups-competition-api-live.test.ts`, this lane's second suite."
- Otherwise: "The competition calls run in `groups-competition-api-live.test.ts` (supabase/tests/groups-competition-live.sh, lane <X>)."

Either way, drop "with protocol 4 active", because V4 is the only state. Also minor: helper
`groups-live-endpoint.ts:2–3` and `:35–36` mention only groups-api-live, although both suites use it.

#### apps/mobile/__tests__/groups-competition-api-live.test.ts (lane groups-protocol4 today)

One test, L60–106, "matches every safe competition endpoint, normalized disclosure, and certification
lifecycle" (timeout 840 s). Pre-V4 RPCs: **none**. Needs an active stack: **yes**. Every
`group_competition_*` reader returns UPDATE_REQUIRED on a pending stack (compare groups-competitions.sh:226),
and L64 asserts `active`. It also needs a live evaluator: `poll` L22–32 waits up to 360 s for a kick or
the 5-min cron sweep. Verdict: **keep. Move to a default lane once the baseline is active, without the wrapper.**

| line(s) | client fn → RPC | notable expect |
|---|---|---|
| 61–63 | createGroup, getGroupInviteCode, joinGroup → `group_create`/`group_invite_get`/`group_join` | — |
| 64 | getCompetitionContract → `group_competition_contract` | `{activation_state:'active', cache_version:5}`. Keep, because the wire is frozen (D4) and the server returns the constant |
| 65–67 | updateGroup, getGroup, listMyGroups → `group_update`/`group_get`/`group_list_mine` | bodyweight flag true; group listed |
| 68–70 | createCompetitionExercise → `group_competition_exercise_create`; listCompetitionExercises → `group_competition_exercise_list` | default_metric volume |
| 71–72 | getCompetitionStream → `group_competition_stream` | membership item present |
| 55 (in `pushPerformance` L38–58) | direct `member.client.schema('app_public').rpc('sync_push')`, not through api.ts, no group header | `ok:true` |
| 74–77 | getCompetitionBoard volume → `group_competition_board` (polled) | value 625 `percent_bw_reps`, normalized, no `weight_value` |
| 78–79 | board e1rm | unit `percent_bw` |
| 80–82 | getCompetitionSession → `group_competition_session_detail` | normalized, no `weight_value` |
| 83–84 | stream | session item present |
| 85 | getCompetitionWeek → `group_competition_week_summary` | `contract_version:4` |
| 86 | getCompetitionPodiums → `group_competition_podiums` | metric volume |
| 87 | getCompetitionRevisions → `group_competition_revisions` | ≥1 revision |
| 88 | getCompetitionHistory → `group_competition_history` | metric/certified echoed |
| 89–92 | certifyCompetition → `group_competition_certify` | — |
| 93 | getCompetitionCertification → `group_competition_certification_get` | `ended_at_ms` null |
| 94 | endCompetitionCertification → `group_competition_certification_end` (withdraw) | `withdrawn` |
| 99–103 | updateCompetitionExercise → `group_competition_exercise_update` | rules updated, revision bumped |
| 104–105 | archiveCompetitionExercise → `group_competition_exercise_archive` ×2 | archived then unarchived |

The comment at L95–98 cites groups-competitions.sh for cancel and the rebuild. If those chapters move,
point it at the new default-lane body.

**Stale comment L2–4:** "The groups-api-live lane activates locally for this phase and restores pending
state on exit." This is wrong today in two ways:
- The lane is groups-protocol4 (via groups-competition-live.sh + with-local-group-competitions.sh).
- Nothing restores pending state on exit. The wrapper marks the stack, and the next baseline preflight resets it.

It should say: "Actual protocol-4 client RPCs and guards against this worktree's leased local stack
(supabase/tests/groups-competition-live.sh, lane <X>); the baseline is V4-active. Server
arithmetic/privacy vectors remain in backend fixtures."

#### Other apps/mobile/__tests__ files that hit a live server for groups

None. The grep for `GROUPS_LIVE`/`SUPABASE_URL`/`_LIVE_` returns these files:
- profile-screen, sign-in-screen, auth-service and ui-design-primitives use `EXPO_PUBLIC_SUPABASE_URL` only as config/copy.
- `sync/cycle-round-trip.test.ts:489` uses the live sync endpoint and round-trips an `exercise_group_links` row. Its comment at L491 notes there is "no server group row", and it calls no group RPC.
- `groups-runtime-fixture.test.ts` is offline: it mocks curl/docker and runs the wrapper. See §2.

---

### Totals

groups-competitions.sh: 13 chapters.
- cutover: B, C, D, K.
- V4: F, G, H, I, J, L, M.
- mixed: A, E.

Assertion rows (147 table rows, recounted; helper and setup rows included):

| verdict | rows | where |
|---|---|---|
| keep | 7 | A helpers: rpc4, canary L82, drain, policy, board, certify, audit |
| keep + header | 1 | L559. The B refixture also needs the header on `group_create`/`invite_get`/`join`/`leave` (L149, 151, 152, 213) |
| port | 0 strictly | Port candidates are kept under cutover-only: L244 (rebuilding after a rules update), L246–247 (normalized Volume), L560–567 (membership fencing on a V4 cert). The refixture ports `_v2` create and old certify to `group_competition_exercise_create`/`_certify` |
| move | 15 | E 7 (L290, 293, 295, 298, 299, 300 and the V4 half of 301–304), F 2, M 4, A L35–36 (with restore fix), C L243 (V4 equivalent) |
| move\* (needs V4 refixture) | 68 | C 1 (L248–250), G 10, H 3, I 33, J 11, K 1, L 9 |
| cutover-only | 56 | A 6, B 16, C 17, D 9, E 1 (L283–289; plus the `_pre_competition` half of L301–304), G 1 (L347–350), I 1 (L446), J 2 (L518, L552–556), K 3 |
| delete | 0 | Nothing is deleted outright. The 27-RPC forged-header loop (L283–289) and the `_pre_competition` privilege half (L301–304) collapse into **one catalog assertion** when groups-protocol4 retires |

D3 gaps that lose their only live proof when groups-protocol4 retires:
- L267–270 and L274: V4 boards presenting stored M25 certs and former/archived legacy scores.
- L552–556: V4 `certification_end` on an M25 ID.

They can survive only through an SQL-seeded historical fixture.

Jest suites:
- groups-api-live.test.ts: 2 tests, keep, no pre-V4 RPC, no active-state need.
- groups-competition-api-live.test.ts: 1 test (≈22 RPC calls across 21 client functions + direct `sync_push`), keep, no pre-V4 RPC, needs an active stack and a live evaluator.
- Stale comments to fix: groups-api-live.test.ts:6–8, groups-competition-api-live.test.ts:2–4, groups-api-live.sh:8–9, groups-competition-live.sh:2–15, groups-live-endpoint.ts:2–3.

Wrappers:
- groups-api-live.sh: unchanged apart from the comment.
- groups-competition-live.sh: drop `with-local-group-competitions.sh` (L86) and the ORDER/one-way comments.
- The wrapper's other users must go too: maestro-run-lane.sh:157, README-maestro.md:20, groups-runtime-fixture.test.ts (3 tests), triggers.tsv:84.
- ensure-local-runtime-baseline.sh:229–241 must stop resetting an active stack.
