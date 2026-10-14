# Notification delivery contract

> **Owns:** installation/account binding, operational delivery and provider receipts.
> **Load when:** changing notification RPCs, the worker or native registration.
> Product eligibility remains in `docs/product/notifications.md`.

## Boundaries

`app_public.notification_*` tables are operational, outside Sync v2; they have
no `owner_user_id`, client table grants or permissive RLS policies. App RPCs
derive identity from Auth, reject OAuth clients and require a live Auth session.
Group preferences use the existing indistinguishable membership boundary.
The service-only worker never participates in personal sync. No event producer
automatically enables hosted sending.

## Workout source and confirmation

The source ledger records original activity times and a migration cutover.
Pre-cutover completed history never replays; a pre-cutover active workout can
complete freshly without replaying its start. Its rank baseline starts at the
cutover's current coherent board, or the first trustworthy later publication
if rebuilding; unavailable earlier ranks are never invented.
Isolated session triggers append immutable activity moments; descendant writes
kick the worker. Raw intake retains no source/workout/allocator locks. Exact
current digests reject changed graphs even if intake failed. Recovery admits a
fair bounded batch, locks all repair groups then all sources before enqueue,
and reads source rows/shares with the same identity and
deadline, rather than replaying stream history. Missing first moments fail closed;
known failed admissions become immutable forfeiture markers, never newer source
timestamps. A first capture failure can forfeit that alert. If both the isolated
write and its diagnostic fail, erased earlier timing cannot be reconstructed.

[[notifications.completion-readiness]] uses a separate authenticated RPC after
ordinary sync converges. The client declares canonical session, exercise, set,
definition and link domain rows, including tombstones. The server compares exact
membership and contents; sync clocks and bookkeeping are excluded because the
existing future-clock clamp can leave their values different after convergence.
Only digests persist. Current scoring dependencies and comparison publications
are fenced independently; capture uses the exact evaluated graph and one stable
snapshot of live disclosure/evidence, with safe ranks rechecked at readiness; no private Sync v2 envelope changes.

Confirmation proves the declared graph at that instant, not that another
device can never add a future row. A change before handoff makes the completion
pending until reconfirmed and re-evaluated. The final readiness/generation check
uses one stable MVCC snapshot at the logical handoff; later raw writes remain
later edits even when intake was deferred. Missing/parked evaluation remains
pending, never an empty-achievement success. Accepted summaries retain their
identity after later edits or reopen/completion cycles.

The publisher captures a full actual rank baseline before a workout's first
affected comparison publication, outside its member loop. Baseline capture and
publication commit atomically; failure retries asynchronous publication without
failing personal sync. Final net movements are intersected with a same-direction
causal comparison that restores its original published contribution while
keeping other workouts and control eligibility current. Four private original
source best/tie rows cover a workout below its member's board winner. Up to four
additional rows freeze the first coherent link/membership admission; later
performed edits cannot claim the admission itself. Original per-set performed
and control pins also cover non-winners. Unchanged original performances use
current qualified scorer rows, including metadata rescoring and witnesses;
changed performances restore comparable frozen contributions. These proofs never
enter jobs or provider data. An incomparable source mode, dated reading context
or achieved instant suppresses that board's rank attribution, while current
activity/bests can still deliver; the same applies when eligibility reselection
needs an unfrozen lower original score. SQL never reinterprets an old numeric score. Initial/lost
placement requires that workout's own eligibility transition; another member's
new placement is not attributed merely because its numeric position shifts.
This excludes unrelated coalesced causes while preserving
[[notifications.achievements]]. Unchanged evidence-set performance may retain only the same
non-voided record identity or initial-set fingerprint; changing another set cannot
admit a recompute-created replacement. Non-workout alerts follow
[[notifications.non-workout-ranks]]. Operational snapshots are pruned after the
original completion delivery window; minimal workout/intent tombstones preserve
deduplication. Unfinished, abandoned or hard-missing sources retain their actual
baselines until completion; no maximum active age is imposed. Account deletion
cascades them. This can grow operational storage for unfinished workouts.

## Installation lifecycle

An installation uses a random UUID and a 32-byte random capability, whose
SHA-256 digest is stored. Rebinding an existing installation requires that
capability. Registration checks the service-configured project, environment,
bundle identifier and payload version; these are compatibility gates, not
binary attestation. Local registrations accept only synthetic local tokens.
Preview/production use Expo only with an exact configured project/environment/
bundle; actual sends require explicit isolated device-test or rollout enablement.
Preview and production accept Expo token syntax; possession is not proof of APNs ownership.

Account, Auth session, token or encryption-key changes rotate a random binding
UUID and cancel unsent old-binding deliveries. Tokens are unique within the
configured project/environment. A single registration allocator lock serializes
token reassignment before any installation row locks; enqueue and pruning share
that allocator before their intent/FK or installation writes. Permission and opt-in are installation state;
categories and group mutes are account preferences ([[notifications.defaults]]).
The sender verifies the current binding and live Auth session again at handoff.
Permission is the latest client report; OS changes cannot be observed instantly.

Offline logout cannot notify the server synchronously. The native client must
delete its shared encryption key/current binding **before** clearing auth or
switching accounts, and attempt remote unregister when possible. Push requests
contain only generic `BoGa` / `Open the app to view your notification` fallback
text. Public preview and routing are encrypted, never placed in clear provider
data. A service extension decrypts only for the locally current account/binding;
missing key, mismatch, expiration, malformed data and timeout retain the generic
fallback and provide no route. Logout also clears delivered/pending alerts; an
already decrypted OS alert or accepted native handoff can race that asynchronous
cleanup. Key invalidation prevents new decrypt/routing, not instant OS recall.
A content-extension account check alone cannot
protect the system banner, which is why the service extension is required.

Encryption uses standard AES-256-GCM: a fresh 12-byte nonce; standard base64
key/nonce/ciphertext; ciphertext ends with the 16-byte authentication tag.
AAD is UTF-8 `boga-notification-v1:<binding UUID>`. Edge WebCrypto and iOS
CryptoKit share this format. Clear data is exactly `{v:1,bindingId,nonce,ciphertext}`.
The encrypted projection carries its original expiry and recipient identity;
native code validates both before rendering or routing. Keys are service-only
operational secrets, never returned by a read RPC or logged.

## Durable delivery

One intent per recipient/lifter/session/start-or-completion implements
[[notifications.workout-delivery]]. Original event time and deadline never move
on an update ([[notifications.freshness]]). Only a newer generation replaces
unsent contributions. A sending handoff defers generation adoption until its
result; an accepted or uncertain summary freezes content and cancels stale
unsent installation deliveries. Each intent captures eligible installation bindings once;
re-registration never replays historical deliveries.

Four jobs run concurrently per fresh claim, with at most five claim rounds
per receipt/send phase; no claimed job waits behind a serial twenty-job batch.
Claims are fenced by random claim UUIDs. Admission and the sending lease use
fresh wall-clock time after policy/source lock waits. A leased job can recover
after worker death. Handoff changes it to `sending`; a crashed or timed-out
handoff becomes `uncertain`, parked for diagnosis rather than blindly resent.
Completion handoff cancels unsent starts and waits while a start handoff is
in flight. A provider ticket settles that handoff, but does not prove display.
Explicit temporary rejection backs off, at most five send attempts; permanent
payload/credential errors park with an allowlisted code. Sending-disabled jobs
have an explicit state and are reconsidered only while their original expiry
permits. Provider `expiration` is the original absolute Unix-second deadline; omit
relative `ttl`, which takes precedence and could renew expiry after handoff
delay. The adapter checks expiry immediately before the request.

Preparation rechecks opt-in, permission, binding/session, category/mute state,
membership, live share/session and expiry. It composes a narrow public preview
([[notifications.preview]]) from current names and authorized contributions;
no privileged raw event is a push payload. Event producers must refresh coherent
achievement contributions before handoff; the dormant foundation creates none.

Ticket IDs persist; receipts start after 15 minutes, retry with bounded backoff
and stop after 24 hours. `DeviceNotRegistered` disables only the matching token
binding, so an old receipt cannot deactivate a rotated token. Receipt success
means provider acceptance, never device display. Completed intents retain their
logical identity; maintenance removes secret/payload contents after 30 days,
preserving the minimal deduplication tombstone. Logs contain job IDs and
allowlisted outcomes only, never tokens, ciphertext, names, secrets or raw errors.

## Local verification

The deterministic sink is enabled only by the local configuration and handles
synthetic tokens; the production adapter uses Expo's fixed HTTPS endpoints.
Provider sending defaults off. The five-minute backstop uses Vault entries
`notification_worker_url` and `notification_worker_key`; absent entries do
nothing. The key is the service-only project credential; configure it only
under explicit hosted rollout authority. Tests use real sync intake, confirmation,
publication and service boundaries, with synthetic local registrations.
Use `./boga test fast` plus the operator-agreed backend lane set; registration,
claims and the sink contract live in `supabase/tests/notification-delivery.sh`;
workout proof/publication fixtures in `supabase/tests/notification-workout-events.sh`.
