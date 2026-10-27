# Exercise merge contract

Load when changing exercise merging, protected history revisions, recovery, or the sync protocol.
Product scope and interpretation: [[exercise.merge-scope]], [[exercise.merge-values]], [[exercise.merge-recovery]].
The affected-row exception is [[set.count-display]]; ordinary metrics keep their existing rules.

## Storage and authority

The three mirrored performed tables carry `merge_revision` (bigint/server, integer/device), initially zero:
`session_exercises`, `exercise_sets`, `session_exercise_tags`. These fields are **in sync scope**.
Writers must echo the revision their editor loaded, including graph rewrites, removals and imports.
An importer starts at zero; it must never attach today's revision to an older package.

`public.exercise_merge_operations`, `public.exercise_merge_contexts` and
`public.exercise_merge_conflicts` are **out of the sixteen-table mirror**.
They are owner-private server control/recovery storage, reached only through authenticated app RPCs.
No direct table grants; RLS enabled; OAuth `client_id` requests denied.
Receipts keep input hashes and counts, contexts keep immutable conversion factors, and unresolved
conflicts keep the saved edit. Resolution removes its payload but retains an idempotency hash.
Account deletion and the authorized server developer wipe remove this control state.

`exercise_merge_local` is **out of sync scope**, with no mirror counterpart or domain FK.
Its owner-scoped pending snapshots and operation IDs survive sign-out/account wipes until acknowledged.
Staged pages, sequence state and review caches are disposable and cleared by those wipes.
Every read and mutation supplies the captured owner. Another account cannot display or upload these records.
Emergency whole-database snapshots retain recovery; explicit exports share a temporary copy filtered to
the current owner and vacuumed so foreign payloads cannot survive in freed pages.

## Transaction and concurrency

The implementation is `supabase/migrations/20261027163253_exercise_merge.sql`.
Preview, execute, sync writers, agent exercise writers and direct domain writes take the same
per-owner advisory lock before row locks. Different owners remain independent.

Preview fingerprints source/destination definitions and the complete affected completed-session graph,
including membership, raw values, tombstones, tags, mappings and links. Execute rechecks that token;
a same-count edit is stale too. Conversion validation precedes mutation. A required conversion with an
invalid/overflowing nonblank weight aborts the whole merge.

Execute retains IDs/provenance, remaps referenced tags by normalized destination name, converts actual
and planned weights exactly, advances context revisions, soft-deletes the source and commits a receipt.
It has no sync-batch row limit. Same-mode text remains verbatim; tombstoned sets in moved live blocks
are converted without revival. Deleted destination tags are reused without revival.

The context fence covers every block in an affected completed session, including unchanged siblings.
Only selected live source blocks move; sibling factors are one. This protects shared ordering slots:
an old full-session reorder cannot bypass review through an unchanged sibling.
A future client clock never bypasses revision comparison. Parent or protected-row hard deletes and
protected reparenting are refused; ordinary current-context soft deletes remain supported.

## Sync protocol 5

Authenticated sync now requires `x-boga-sync-protocol: 5`. Group representation remains protocol 4.
Old sync clients receive UPDATE_REQUIRED before revised behavior.
Coordinate activation with app distribution: the server accepts one sync version.
This code change does not deploy the migration or authorize activation.

`sync_push` returns selective `outcomes` whenever a row is preserved:
each sent row must appear exactly once as accepted or preserved. A compact `{ok:true}` still means
all accepted. Invalid/incomplete acknowledgements never clear dirty rows.
Preserved payloads enter owner-private review before an obsolete row is acknowledged.

`sync_pull` includes committed `merge_sequence` and `merge_conflict_count`.
Sequence discovery avoids the ordinary timestamp cursor's commit-order race.
A known uncertain-operation receipt also triggers discovery before convergence.

The client stages an exhaustive, token-fenced snapshot of affected sessions and required ancestors
in durable pages. A changed token restarts staging; interruption resumes from its last page.
Ordinary pulls retain the complete old context until the snapshot is ready.
One SQLite transaction preserves stale dirty rows, replaces the complete canonical context,
and restores valid unsent additions with collision-safe slots.
Edits made while fetching are captured again at apply time. Future-clock stale rows are still fenced.
Readers never see a destination block with source-unit children.
Facts triggers stale both definitions; existing projection invalidation refreshes catalogue/history/stats/RM.

## Recovery

The UI persists an operation ID before sending. Status lookup and retry use the same ID and input hash.
A lost response is never treated as proof that nothing committed.
Confirmed refusals permit a new preview/confirmation; uncertain outcomes remain visible in Data & Sync.

Review re-reads current context and translates saved weights through the immutable factor chain exactly
once. Its token covers displayed metadata, session and sibling graph.
Keep current changes no canonical history; Apply edits only the selected saved row.
New rows and reorders reserve live/tombstone slots safely. Identity and parent cannot revert to the source.
Row-ID collisions with another block are reminted for explicit review instead of stealing the existing row.
Resolution and closure commit atomically, with input-idempotent retry.
A changed token refreshes the values and requires a new decision.
Offline review reads cached items; unresolved/recovering changes prevent an Up to date status.

## Groups and proof

Existing destination links govern moved data; no links or certifications are copied.
Changed source input mode ends affected witnesses even at zero weight.
Eager certification correction is failure-isolated; immutable merge boundaries also fence readers and
supply the real terminal timestamp if correction fails. New root witnesses use observation-time
`clock_timestamp()`; inherited projections retain the original witness time.

Local verification lives in `apps/mobile/__tests__/exercise-merge-sync.test.ts`,
`apps/mobile/__tests__/exercise-merge-service.test.ts`,
`apps/mobile/__tests__/sync/exercise-merge-live.test.ts`,
`apps/mobile/__tests__/database-backups.test.ts` and the catalogue screen suite.
Backend/group contracts and the existing iOS sync lane exercise the real runtime.
