# Challenge of the Week contract

> **Owns:** CoW intake, cutoff, aggregation and publication boundaries.
> **Status:** aggregation, server definitions, intake and typed API implemented;
> worker publication and mobile screens pending. **Load when:** changing CoW.

Product rules belong to [[groups.cow-metrics]], [[groups.cow-baseline]],
[[groups.cow-calendar]], [[groups.cow-participation]],
[[groups.cow-submissions]] and [[groups.cow-finality]]. This contract specifies
their implementation boundary, not new product choices.

## Existing boundaries

`apps/mobile/src/groups/cow-scoring.ts` aggregates authorized per-set group
projections. It imports only the competition representation; raw parsing,
load conversion, effort and 1RM stay in the existing scorer/kernel
([[set.performed]], [[set.eligibility]], [[1rm.formula]]).
If changing those, load [group-competition-contract.md](group-competition-contract.md).
Existing lifetime boards retain their single-set aggregation and achieved-time
tie ordering. CoW has no runtime caller yet and changes neither publication
nor private Sync v2.

If changing lifecycle or endpoints, load [groups-contract.md](groups-contract.md)
for server-only group storage, role checks, OAuth denial, protocol-4 negotiation,
non-member/nonexistent equivalence and current disclosure. New RPCs use exact
allowlists rather than extending old exact response shapes. Group storage has
no owner column, direct client grants or FK into synced rows. No new sync
entity, service, certification action or notification is needed.

## Authoritative acceptance fence

The existing sync `server_received_at` is a pull-cursor timestamp:
`touch_server_received_at()` in
`supabase/migrations/20260525120000_sync_v2_clean_room.sql` uses transaction-start
`now()`. Queue generation, source tokens and published score tokens prove
freshness, not timely acceptance. None is a CoW receipt.

Use a **transaction-end intake seal**, taken after all accepted writes and
required deferred validations, using a fresh database wall clock. This is the
logical acceptance point, not request start, first row arrival, worker time
or an assumed commit timestamp. The seal and intake records commit with the
source transaction; rollback/rejection creates no receipt. If more relevant
writes occur after a seal, invalidate it and reseal after the last validation.
Never backdate receipt to an earlier dependency or transaction timestamp.

Serialize the seal, membership/context mutations and start/close barriers on
the same affected group/comparison lock, retained through commit. A barrier
waits for earlier holders; writes obtaining their final seal after the edge
cannot enter it. Closing records an immutable intake high-water mark, after
observing committed pre-edge holders. A transaction straddling the edge is
eligible only if its final validated seal precedes it; rejected transactions
and incomplete dependencies supply nothing. Failure-isolated capture must
persist an uncertainty marker if intake fails: retry or Finalizing, never
quietly publish an incomplete result. Personal sync must still commit.

Acceptance tests against Postgres must prove the seal/rollback/lock ordering,
including a request begun before end whose final dependency or lock acquisition
crosses end. The pure tests exercise the receipt contract only; they do not
prove transaction semantics, authorization or scheduler behavior.

## Retained input and version identity

Capture a minimal service-only per-source intake envelope, not a copy of a
workout graph: group/target, member/set identity, membership period, session
start/completion/eligibility, pinned comparison/scorer context, dependency
identity and authoritative receipt. Retain the scoring inputs needed by the
existing scorer until a fenced evaluation produces the coherent projection.
Private reading inputs stay within its existing private boundary and never
become CoW public payloads or caches.

An intake version changes only when a scoring/eligibility dependency changes:
set inputs/effort/state, session start/completion/deletion, source distribution,
share or link eligibility. Include the receipt at which completion or another
dependency makes the full contribution eligible. A numeric score equality
does not imply an identical version. Retries of the same dependency identity
retain the original version and receipt; unrelated writes create none.
Use an immutable positive safe-integer sequence to order versions sharing a
receipt. Duplicated input versions must have identical contents; conflicts
fail closed. Member/set identity deduplicates repeated blocks or links.

Retain the latest pre-start state per source **including non-counting
states**, then every relevant in-week source revision through finalization.
Never keep only positive winners. Worker coalescing may merge wakeups, not
erase additions, revisions or removals: the reducer derives Volume priority
from those transitions, including a removed set's previous counting state.
Retention is scoped to pending/active CoWs, not lifetime version history;
no intermediate aggregate-score history is needed. Do not compact in-week
transitions before final publication: the reducer accepts no saved aggregate
receipt checkpoint. After immutable final publication, transient intake can
be discarded under the audit policy. Later mutations cannot overwrite a
sealed boundary, even when scoring has not yet run.

## Server lifecycle and intake

`supabase/migrations/20261029204606_group_cow_lifecycle.sql` owns definitions,
calendar validation and RPCs. `group_create` has one defaulted zone argument:
old calls create an unset calendar; the typed client supplies its creator's
device zone. Existing summary payloads remain exact. Legacy calendars require
an explicit manager choice through the separate calendar RPCs.

Calendar, create, edit and cancel serialize on the existing group lock. Create
uses a caller-held UUID and immutable request identity; an identical authorized
retry resolves that identity before recalculating next week, including after
cancellation, rollover or a zone change. Edit/cancel retain the last successful
mutation identity and expected revision. Retries cannot undo a superseding
admin write. The same lock checks both local-week identity and UTC overlap.
Each local midnight is converted separately by `group_cow_bounds`.

`supabase/migrations/20261029205006_group_cow_intake.sql` owns capture. Source
triggers mark targets without resolving child parents. The final pending event
follows the relevant `RI_` FK events; `sync_push`'s existing constraint drain
therefore closes dependencies before capture. An early forced drain is safe:
another relevant write deletes that transaction's earlier intake and reseals,
even after end. Other transactions' sealed versions remain untouched. A
definition transaction must finish its validated intake before start; failure
rolls back the admin mutation. Internal capture errors are sanitized before
returning to an admin: PostgreSQL row-error details may contain private source
inputs. Source-only capture failures remain isolated.

The source envelope's `eligible` means live source/link/definition only.
The worker must apply the existing performed/working scorer rules before
mapping it to `CoWSetVersion.eligible`; SQL mirrors no effort or load formula.
Share-ledger inserts/deletes are dependencies too: a repaired share gets its
own timely receipt even when a session's other change is only duration.

An active CoW reuses its matching, eligible completed source's stored private
reading context first, including an explicit missing context. First intake
reuses an existing group binding or captures the as-of context. A later
ordinary evaluator binding cannot change the CoW input or receipt while its
raw binding key stands. Before start the baseline candidates can still
refresh. Zero contribution canonicalizes the effective switch to Off, so an
irrelevant group toggle creates no scoring-context change.

Admission receipts retain candidate periods independently of mutable membership
timestamps. A first end and same-transaction source revisions share the final
seal instant; a new period never reopens the old one. Context versions retain
comparison/scorer/unit availability separately. Capture failures persist
SQLSTATE and transaction identity without an FK or group-lock acquisition.
The worker must check both CoW-specific and applicable unscoped failure markers;
later successful input cannot reconstruct lost intermediate priority or
silently clear uncertainty.

Start/close high-water marks, frozen participants and claim/generation fields
are storage for the worker's barriers. Automatic discovery, bound-start
selection, final publication and uncertainty recovery are still pending;
definition reads return Finalizing after end, never a fabricated final.
`apps/mobile/src/groups/cow-wire.ts` owns exact public definition/calendar
shapes, and `api.ts` remains the sole group RPC caller.

## Pure reducer

`scoreCoW` consumes the fixed roster, its first membership ends, immutable UTC
bounds, an exclusive live read fence and retained authorized set versions.
All time fields are exact epoch microseconds represented as safe integers;
convert PostgreSQL timestamps without a millisecond `Date` round-trip. Equal
microseconds fall back to canonical member UUID ordering, matching SQL `C`.
The IANA calendar is resolved by the server; this helper never guesses the
viewer zone or adds a fixed 168-hour duration. DST vectors supply 167/169-hour
Monday windows. Calendar validation and scheduling remain server work.

Each input state includes the already resolved `shared`, `completed`, `eligible`
flags and unit-tagged projections from `scoreCompetitionPerformance` or its
coherently published equivalent. `eligible` includes live source/link,
fixed group effort and applicable bound-context requirements. Missing metric
projections are omitted, not replaced with zero. This trusted service adapter
is responsible for dependency closure and access checks; boolean inputs cannot
establish either. It scores baseline inputs under the context bound at start,
not historical rules. Mixed contexts or units are errors.

For each member the reducer resolves latest baseline states strictly before
start and latest weekly states strictly before the earlier of read fence,
end or membership end. It then applies eligibility. Weekly receipts must also
be at/after start; pre-start uploads of future-dated performances cannot enter.
Rows after the member's cutoff are ignored before context validation. Start
baseline state remains frozen even when its source changes during the week.

The reducer selects best 1RM, sums Volume and computes
`(weekly / baseline - 1) × 100` under [[groups.cow-baseline]]. It never rounds.
Winning-set receipt resolves 1RM/improvement ties; a counting Volume addition,
revision or removal advances aggregate receipt even when the final total is
equal. Zero/nonpositive attained scores are omitted; invalid per-set metrics,
overflowing sums or percentages mark only that member/metric unavailable.
Its output is service-only: the public encoder must separately apply current
disclosure, units and allowlists. Do not expose receipt, dependency or private
scoring context just because the reducer carries it.

## Start, closure and reads

The start barrier binds the eligible comparison revision, scorer version and
unit context, the actual starting roster and the baseline source checkpoint.
A delayed worker uses sealed start state, never today's membership or rules.
An archive or scoring-context change accepted inside the stored weekly bounds
sets terminal unavailability, even if later reversed. A change at/after end
does not affect that outcome. Record the first such change, not merely the
latest revision. Source corrections remain intake changes, not rules changes.

The existing group evaluator's kick/sweep discovers starts and ends without
app activity. Closing seals all participants and metrics together. Drain every
accepted dependency version up to the close high-water mark under the pinned
scorer; fence generation/context, then atomically insert the immutable final
outcome, including empty or unavailable. A crash or stale claim retries; it
cannot replace an existing final. Processing failure is retryable Finalizing,
distinct from terminal context unavailability. Read paths must not finalize
from mutable workouts or expose a partial evaluator pass as final.

Final readers use stored results under [[groups.cow-finality]], checking
current access and disclosure on each read. Suppression never renumbers or
promotes a new winner. API/cache history stores only allowlisted safe figures;
paired endpoint tests must prevent reconstruction of suppressed kg values
from totals, baselines or other sessions. Do not reinterpret stored finals
through this reducer under later rules.

## Verification ownership

`apps/mobile/__tests__/groups-cow-scoring.test.ts` proves aggregation, signed
improvement, latest-state selection, inclusive start/exclusive cutoff,
membership crossing, normalized units, duplicate retries, corrected equal
scores, removal receipts, precision, finite-result isolation and supplied DST
windows. It deliberately asserts no server authorization or durable-finality
claim. Backend lifecycle/publication tests must separately prove actual
calendar computation, roster capture, intake sealing/uncertainty, worker
backlog/crash recovery, immutable snapshots and current disclosure.
