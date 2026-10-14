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
or automatic hosted enablement is installed by the delivery foundation.

## Installation lifecycle

An installation uses a random UUID and a 32-byte random capability, whose
SHA-256 digest is stored. Rebinding an existing installation requires that
capability. Registration checks the service-configured project, environment,
bundle identifier and payload version; these are compatibility gates, not
binary attestation. Local registrations accept only synthetic local tokens.
Production accepts Expo token syntax; possession is not proof of APNs ownership.

Account, Auth session, token or encryption-key changes rotate a random binding
UUID and cancel unsent old-binding deliveries. Tokens are unique within the
configured project/environment. Permission and opt-in are installation state;
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
unsent contributions. Each intent captures eligible installation bindings once;
re-registration never replays historical deliveries.

Four jobs run concurrently per fresh claim, with at most five claim rounds
per receipt/send phase; no claimed job waits behind a serial twenty-job batch.
Claims are fenced by random claim UUIDs. A leased job can recover
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
under explicit hosted rollout authority. Tests seed intents directly, exercise real app
and service role boundaries, and never register a production token locally.
Use `./boga test fast` plus the operator-agreed backend lane set; registration,
claims and the sink contract live in `supabase/tests/notification-delivery.sh`.
