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
An isolated session trigger appends immutable activity moments and queues each
fresh, non-forfeited moment once; shared sources kick the worker. Start admission
survives completion before admission. Descendant writes queue and kick nothing. Raw intake
retains no source/workout/allocator locks. Exact current digests reject changed
graphs even if intake failed. Admission claims a bounded batch of queued sources,
locks their share groups then all sources before enqueue, tracks and starts each
once, then forgets it; it never rescans recent sessions or replays stream
history. Nothing repairs a failed trigger later: a missed share or a failed
admission loses that alert and is logged. Missing first moments fail closed;
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
New comparison targets require a live workout-definition link; unlinked evaluator
inputs cannot expand confirmation context. Older unrelated captures retain their
baselines until normal pruning because unlink history is ambiguous; completions
may require reconfirmation within their original delivery window.

Confirmation proves the declared graph at that instant, not that another
device can never add a future row. A change before handoff makes the completion
pending until reconfirmed and re-evaluated. The final readiness/generation check
uses one stable MVCC snapshot at the logical handoff; later raw writes remain
later edits even when intake was deferred. Missing/parked evaluation remains
pending, never an empty-achievement success. Accepted summaries retain their
identity after later edits or reopen/completion cycles.

The authenticated `notification_pending_completions` reader selects the
caller's live completed sessions using immutable captured completion time,
retaining epoch, eligibility, forfeiture and original deadline guards. It pages
ten IDs in stable ID order. A keyset
cursor prevents an unprovable early graph from starving later candidates;
confirmed graphs with unfinished completion deliveries remain candidates because
their context can change; settled summaries leave this polling backlog. The
mobile quiet-round hook reads one page under the existing local-data lock,
captures the five domain types including tombstones through `entityToWire`,
and omits dirty/quarantined graphs. It excludes clocks/bookkeeping, pins the
request's account token and bounds acknowledgement requests; an acknowledgement
failure never changes personal sync's converged outcome.

The publisher captures a full actual rank baseline before a workout's first
affected comparison publication, outside its member loop. Baseline capture and
publication commit atomically; failure retries asynchronous publication without
failing personal sync. A publication builds its source graph once and shares
it with its score writes and both capture passes for all workouts; raw sources
are revalidated once, after all of its writes, over the sets the rebuilt graph
still reaches (its writes can end a reference), and the rebuilt graph's digest
is the one persisted for readiness. Each pass rechecks live
disclosure per workout and at its final boundary; a mismatch rolls back the
publication. Within one statement (one snapshot) a capture rank, baseline or
control asks disclosure once per member and definition, never per score row.
Standalone rank/capture helpers still resolve current sources and
revalidate them at both boundaries.
Final net movements are intersected with a same-direction
causal comparison that restores its original published contribution while
keeping other workouts and control eligibility current. Four private original
source best/tie rows cover a workout below its member's board winner. Up to four
additional rows freeze the first coherent link/membership admission; later
performed edits cannot claim the admission itself. Original per-set performed
and control pins also cover non-winners. Unchanged original performances use
current qualified scorer rows, including metadata rescoring and witnesses;
changed performances restore comparable frozen contributions. These proofs never
enter jobs or provider data. Both scopes reuse applicable frozen scores under
current witnesses for the original performed pin, including re-certification;
original scope constrains which unknown lower scores they can bound.
An incomparable source mode, dated reading context
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

## Native app integration

`apps/mobile/src/notifications/` owns the injectable Expo adapter, confirmed
server preferences, installation lifecycle and pending encrypted tap. The auth
service calls its synchronous account boundary before publishing an identity
transition or explicitly signing out; a failed Keychain deletion stops that
mutation. Initial restore preserves a matching account/session binding for a
cold-launch tap. Unsupported builds remain usable without registration.
Bundle identity selects preview/production; it is separate from APNs' own
sandbox/production token inference.

The local Expo module under `apps/mobile/modules/boga-notifications/` shares
one atomic Keychain binding with the two extensions. Registration material uses
platform randomness and preserves installation capability independently from
the current decryption binding. Existing Auth SecureStore access remains in
the app's default Keychain group. The plugin generates extension targets,
shared entitlements and embedded fonts; applied launch colour roles are shared
through an atomic app-group file, implementing [[notifications.theme]].
The service extension leaves the original encrypted envelope in `userInfo`;
the content extension and app tap both decrypt again against current identity.
Native and JS readers validate version, recipient, binding, expiry and routing
shape before use. Foreground handling implements [[notifications.foreground]].

Settings' notification sheet reuses shared controls and reflects OS permission,
registration and confirmed server preference state. Group mute uses the live
membership RPC. Failed writes retain confirmed values with Retry; account and
group changes remount their controls. No background write queue is introduced.
The root tap bridge stays alongside the mounted navigator, waits for its key
and existing auth/first-sync gates, then requires a live authorized session read.
It rechecks identity after that request. Offline taps retain only the encrypted
intent for explicit retry; dismissal discards it. Duplicate taps never stack the
current target, and access failure opens existing unavailable words in a sheet.

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
Completion handoff waits for live installations' fresh admitted starts to settle,
and for an in-flight start handoff; other unsent starts are cancelled. A provider
ticket settles that handoff, but does not prove display.
Explicit temporary rejection backs off, at most five send attempts; permanent
payload/credential errors park with an allowlisted code. Sending-disabled jobs
have an explicit state and are reconsidered only while their original expiry
permits. Provider `expiration` is the original absolute Unix-second deadline; omit
relative `ttl`, which takes precedence and could renew expiry after handoff
delay. The adapter checks expiry immediately before the request.

Preparation rechecks opt-in, permission, binding/session, category/mute state,
membership, live share/session and expiry. It composes a narrow public preview
([[notifications.preview]]) from current names and authorized contributions;
no privileged raw event is a push payload. The workout's gym display name is
resolved through the lifter's live owner-scoped row before encryption. Event
producers must refresh coherent achievement contributions before handoff; the
dormant foundation creates none.

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
Provider sending defaults off. A service-only due-work check gates both the
five-minute backstop's HTTP invocation and duplicate worker requests. It keeps
due sends, expired leases and deliveries, receipts (including exhausted or
expired receipt windows), queued admissions and pruning independent from new-send
enablement. Identical valid confirmations retain their generation without a
tuple rewrite; they can still wake unfinished work after a missed kick.
Private-only source edits do not kick the worker. A transaction consumes its
kick only after a request is queued, so an idle early row cannot suppress later
work in the same transaction. The backstop uses Vault entries
`notification_worker_url` and `notification_worker_key`; absent entries do
nothing. The key matches the runtime's default secret API key, with legacy
service-role fallback for projects without one. The worker accepts both runtime
credentials. Releases authenticate a read-only worker probe before building. Configure
credentials only under explicit hosted rollout authority. Tests use real sync intake, confirmation,
publication and service boundaries, with synthetic local registrations.
Use `./boga test fast` plus the operator-agreed backend lane set; registration,
claims and the sink contract live in `supabase/tests/notification-delivery.sh`;
workout proof/publication fixtures in `supabase/tests/notification-workout-events.sh`,
which also asserts `supabase/tests/notification-idle-benchmark.sql`: idle work
must not grow with recent workouts or history.

## Rollout boundary

Before signing/submitting a device build, load
[`ios-release.md`](../../procedures/ios-release.md) and agree the profile and
release identity with the operator. Local gates do not authorize hosted sending.

1. Apply the forward migrations before shipping the compatible client; keep
   notification sending disabled. Deploy the current worker under the existing
   service-only/Vault invocation boundary.
2. Configure the one notification environment with the exact EAS project and
   chosen bundle: preview `com.phano.boga3.dev` or production `com.phano.boga3`.
   The singleton configuration accepts one environment at a time. Keep Expo
   credentials, including `EXPO_ACCESS_TOKEN` when required, server-side.
3. Provision the app and both generated extension targets, their shared app
   group/Keychain entitlements and APNs credentials through the approved signing
   workflow. Rebuild the binary; a JavaScript update cannot add these targets.
4. Use explicitly authorized test accounts in an isolated group on signed
   devices. Opt in through Settings and verify start/completion, expanded theme,
   denied permission, muting/categories, cold-launch Back and account switching.
   Enable actual Expo sending only for that agreed test/rollout window; local
   synthetic sink success is not provider or device-display proof.
5. Record the signed-device evidence before closing the feature. Revert sending
   to disabled if the test fails; native generic fallback and original deadlines
   remain unchanged. Publish a release only under separate operator authority.
