# Split exercise by gym (#707)

Facts: `docs/product/gym.md` (`gym.split`, `gym.split-label`). Decided with the
product owner on 2026-10-17.

## Decisions

| # | Decision |
| --- | --- |
| Model | Read-time split. One definition plus a flag; reports key on (definition, gym bucket). Raw data is never rewritten. |
| Granularity | Every gym is its own bucket; no gym is the `No gym` bucket. "Only some gyms" (others pooled) is deferred; keep the bucket key open for a pooled bucket. |
| Storage | Synced: `exercise_definitions.split_by_gym` (boolean, default false). |
| Retroactive | Toggling recomputes all history, PRs included. |
| Pooled view | None for split exercises in v1 (no `All gyms` on a split exercise). |
| `Past records gym filter` | Unchanged. On a split exercise `Current gym only` selects what the split already selects. |
| Groups | Links and figures stay on the whole definition. |
| Coaching | Applies the split; returns the bucket's gym. Bumps `METRIC_REVISION`. |
| Labels | `gym.split-label`. |
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
  record bands, share image (plain name). `loadExerciseBests` gained
  `atGymId` — the gym the reader is at, which picks the bucket; unset, the
  most recently performed bucket answers (the coaching default).
- Lanes: `fast`, `backend` (sync path), `frontend-android` if flows touch
  record bands.
- Gym-scoped APIs now use one three-state convention, stated in spec `09`
  (`src/utils/gym-scope-route.ts`). The gym chips PR 4 adds carry
  `NO_GYM_ROUTE_PARAM` at the route boundary. `Past records gym filter` stays
  `Unchanged` per the Decisions table: a session with no gym has no current
  gym to narrow to, so the filter is inert there (operator's call, after the
  product review raised it).

### 4. Aggregations and labels

- Stats / Progress exercise rows, catalog stats (`Last`, sessions, favourites),
  exercise history, heatmaps / progress history, 1RM curve (lock the picker to
  the bucket), Repeat last / plan prefill (`exercise-block-history.ts`).
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
