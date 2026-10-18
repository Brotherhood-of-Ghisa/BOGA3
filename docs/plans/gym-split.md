# Split exercise by gym (#707)

Facts: `docs/product/gym.md` (`gym.split`, `gym.split-label`). Decided with the
product owner on 2026-10-17.

## Decisions

| # | Decision |
| --- | --- |
| Model | Read-time split. One definition plus a flag; reports key on (definition, gym bucket). Raw data is never rewritten. |
| Granularity | Every gym gets its own record book **beside** the whole exercise's. A session with no gym is measured against the whole exercise — no gym is usually a gym not worth recording (operator, 2026-10-18). "Only some gyms" is deferred. |
| Storage | Synced: `exercise_definitions.split_by_gym` (boolean, default false). |
| Retroactive | Toggling recomputes all history, PRs included. |
| Pooled view | **Always there.** Every view (Progress, history, catalog stats, heatmaps, 1RM curve) shows the whole exercise until a gym is chosen (operator, 2026-10-18; replaces "none in v1"). The API's unset gym filter means all gyms for a split exercise too. |
| PRs | A split exercise's records and PRs are per gym wherever *a session's* PRs show: recorder, completion, share image, Today. A no-gym session's are the whole exercise's. Gym PRs and global PRs side by side: **parked** (operator, 2026-10-18). |
| `Past records gym filter` | Unchanged. On a split exercise `Current gym only` selects what the split already selects; in a session with no gym it is off (all gyms). |
| Groups | Links and figures stay on the whole definition. |
| Coaching | Applies the split; returns the bucket's gym. Bumps `METRIC_REVISION`. Shipped in PR 2 with the old model — default = most recent bucket, no gym its own bucket — so it needs the follow-up below. |
| Labels | `gym.split-label` was written for per-gym rows in mixed lists. With a gym picker instead, revisit it in PR 4. |
| Sync | Additive column, **no protocol bump**. `sync_push` writes the column only when the key is present, so a writer that omits it keeps the stored value. Migration deploys before the app release. |

## Why not a physical split

A definition per gym makes every reader free, but every writer pays: the
recorder must choose the variant from the session's gym and re-point blocks when
the gym changes; plans, programmes and group links reference one definition;
un-splitting is a merge. Rejected.

## PRs

### 1. Facts, then plan (docs only, two PRs)

- `docs/product/gym.md` + README subject row; this plan.
- Sync contract: unknown `fields` keys are ignored, not rejected (the live
  `sync_push` reads named keys only).
- Facts land in their own PR (new subject); the product corpus budget is met
  by trimming `README.md` / `REVIEW.md` process prose (operator's choice).
- Lanes: `fast` (docs-check).

### 2. Server column + coaching

- Migration: `alter table app_public.exercise_definitions add column
  split_by_gym boolean not null default false`; patch `sync_push`'s
  `exercise_definitions` branch: insert `coalesce((_fields->>'split_by_gym')::boolean, false)`,
  update `case when _fields ? 'split_by_gym' then excluded.split_by_gym else <stored> end`.
  `sync_pull` emits it.
- Client schema column + `ENTITY_FIELDS` entry (`src/sync/cycle.ts`) + Drizzle
  migration, so the drift checker stays green. No UI yet; nothing writes `true`.
- Import CLI (`scripts/import/`) sends the field.
- Agent API: `getExerciseContext` / `getExerciseHistory` partition by bucket
  for split definitions and return `gym`; bump `METRIC_REVISION` and its pins
  (`git grep working_sets_v5`).
- Spec 05 drift rule: additive columns never bump the protocol; omitted keys
  keep the stored value. Word-neutral (05 is at 2,963 / 3,000).
- Rollout: migration → `agent-api` → app release (`docs/procedures/rule-upgrade.md`).
- Lanes: `fast`, `backend`, `mcp-smoke`.

### 3. Personal facts and records — shipped

- One helper, `reportingBucket(definition, sessionGymId)`, in the calculation
  layer; a single-source test bans re-implementing it.
- `exercise_session_facts`: add `gym_bucket`; the fold (`createRecordBook`) runs
  per (definition, bucket). Bump `EXERCISE_SESSION_FACTS_RULES_VERSION`.
- Stale triggers (new Drizzle migration): `sessions.gym_id` update and
  `exercise_definitions.split_by_gym` update queue the definition(s).
- Readers: `loadExerciseBests`, `loadEarlierBestsByDefinition`,
  `recordBaselinesOf`, flagged facts (Today PRs), session insights baselines,
  record bands, share image (plain name). `loadExerciseBests` keeps one gym
  filter (unset = all gyms, split or not) and takes `inSessionId` — the
  session in hand, whose gym's book answers on a split exercise. Exercise
  history is a view, so it reads all gyms until a gym is chosen.
- Lanes: `fast`, `backend` (sync path), `frontend-android` if flows touch
  record bands.
- Gym-scoped APIs use one three-state convention and **one gym filter per
  reader**, stated in spec `09` (`src/utils/gym-scope-route.ts`). The gym chip
  PR 4 adds carries `NO_GYM_ROUTE_PARAM` at the route boundary; a session
  context takes a session id, never a second gym.

### 3b. Coaching follow-up (agent-api)

- PR 2 shipped the old model. Move it to the new one: a split exercise's
  default is the whole exercise, `gym_bucket` selects one gym, and a no-gym
  session is not its own bucket. Bump `METRIC_REVISION` and its pins.
- Ships before PR 5, so nothing can turn the split on first.
- Lanes: `fast`, `backend`, `mcp-smoke`.

### 4. Aggregations and labels

- **A gym picker, defaulting to all gyms** — not one row per gym — in Stats /
  Progress exercise rows, catalog stats (`Last`, sessions, favourites),
  exercise history, heatmaps / progress history and the 1RM curve. The curve
  already offers `All gyms` plus each gym (`[[1rm.curve-population]]`), so it
  is the model; the earlier fact conflict is gone.
- **Mock first:** how a split exercise's gym PRs show in Progress — the
  operator wants them visible, probably behind a setting.
- Repeat last / plan prefill (`exercise-block-history.ts`): newest session at
  the same gym; a session with no gym takes the whole exercise's newest.
- Open: does an unsplit exercise get the gym picker too?
- The curve picker is the last gym filter off the three-state convention
  (spec `09`, `gym-scope-route.ts`): drop `ALL_GYMS = '__all_gyms__'`
  (`src/rm-curve/model.ts`) so unset is every gym, and resolve its "latest
  trained gym" default to a concrete id before the scope is built. Operator's
  call on 2026-10-17 to do it here, not in PR 3.
- `gym.split-label` formatter, used only by the multi-gym lists.
- Lanes: `fast`, `frontend-android`.

### 5. Editor toggle

- `Track each gym separately` in `components/exercise-catalog/exercise-editor-modal.tsx`.
  Ships last so nobody can turn it on before every reader respects it.
- Lanes: `fast`, `frontend-android`.

Remove the facts' `Pending:` lines in PR 5, and delete this plan.

## Open

- Exercise-editor complexity: check the editor stays under the per-function
  limits after adding the toggle.
- Not in scope: a generic `sync_push` that preserves every omitted key and a
  protocol range check. Separate issue.
