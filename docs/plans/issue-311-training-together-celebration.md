# Issue #311 — celebrate brothers training together

Status: proposed implementation plan for
[#311](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/311).

This is an ephemeral delivery plan. Delete it when the feature ships, and move
the final product/data/security decisions into the owning specs in the same PR.

## Outcome

When a signed-in athlete has an active session and at least one brother in the
same group also has an active session, BoGa should turn that already-visible
group activity into a small shared moment:

- show a warm, non-blocking **Training together** card on Today and the relevant
  group stream;
- pair the two athletes visually (profile pictures when available, initials as
  the complete fallback) and name the shared group;
- play one brief, accessible celebration when the overlap is first observed;
- keep both workout flows uninterrupted and keep the ordinary `Training now`
  cards as the source of detail.

The recommended scope is **in-app celebration only**. Push notifications,
friendship outside groups, reactions, and a permanent “trained together” event
are follow-ups, not requirements for #311.

## Why this fits the app as built

The group stream already exposes live session status, member identity, start
time, and the groups through which a session is shared. It refreshes on focus,
on pull, and while focused. The first release can therefore derive a shared
moment from stream data already authorized by the group RPC instead of adding a
second presence system or writing a synthetic event.

This deliberately means “together” is eventually observed, not real-time
presence: the moment becomes visible after the athlete's sync and the viewer's
group refresh. The UI must not promise instant detection.

## Product rules to settle in the implementation PR

Recommended defaults:

1. **Who qualifies:** the viewer has one active session and another active
   member shares at least one currently active group with the viewer.
2. **What “at the same time” means:** both sessions are currently `active` in
   the latest group-stream snapshot. Do not infer presence from a recent start
   timestamp, app foreground state, or device connectivity.
3. **Which group to show:** on a group screen, that group; on Today, the first
   common group in stable name/id order. Collapse the same pair of sessions
   shared through multiple groups into one moment.
4. **More than two athletes:** show the viewer plus the earliest-started active
   brother and `+N`; the expanded accessible label names all active athletes.
5. **When it ends:** remove the live card as soon as either qualifying session
   is no longer active in a successful refresh. Cached offline content may stay
   visible only with the existing offline marker.
6. **Celebration frequency:** animate once per `(group, my session, brother
   session)` tuple on a device. Persist a bounded set of seen tuple keys so a
   focus refresh or app restart does not repeatedly celebrate. A new overlap
   involving a new session may celebrate again.
7. **Self and privacy:** never celebrate two sessions belonging to the same
   user; never reveal an avatar or overlap unless the existing group read
   authorization allows the viewer to see that member/session.
8. **Reduced motion:** replace movement/confetti with a short static highlight;
   never use sound or haptics without an explicit later product decision.

One product question should be answered before build: should the moment appear
only when **I** am one of the active athletes (recommended), or should observers
also see that two other group members are training together? The narrower rule
is more personal, less noisy, and easier to explain.

## Proposed experience

### Repo-native design brief (proposed target)

The implementation task should promote this brief plus reviewed simulator
captures into the accepted design target before production UI is merged.

- Compose existing surfaces, typography, spacing, and status treatments; do
  not introduce a separate visual language.
- A compact card sits above group activity. It shows two overlapping circular
  portraits, a small celebratory accent, `Training together`, and copy such as
  `You and Marco are training now in Barbell Club`.
- The card is celebratory but not modal: no blocked taps, full-screen confetti,
  auto-navigation, sound, or dismissal requirement.
- Tapping opens the brother's existing shared-session detail. With `+N`, tapping
  opens the group stream filtered to active sessions rather than guessing one.
- Portraits always reserve the same geometry. Missing, loading, failed, or
  removed images render initials on a semantic surface, so profile pictures are
  enhancement rather than a dependency.

### UX contract

#### Flow A — first shared live moment

- **Trigger:** my active session and another member's active session first
  coexist in a successful group-stream snapshot.
- **Steps:** derive a stable overlap key; render the card; run the one-shot,
  reduced-motion-aware accent; record the key as seen; let the athlete continue
  recording without interruption.
- **Success outcome:** both people and the shared group are clear within a
  glance, and tapping reaches existing shared-session context.
- **Failure/edge outcome:** if the avatar cannot load, initials appear; if the
  overlap disappears before interaction, the card quietly leaves on refresh.

#### Flow B — returning to an existing overlap

- **Trigger:** focus, poll, pull-to-refresh, or relaunch returns the same active
  overlap.
- **Steps:** render the current card from the snapshot and consult the local
  seen-key store.
- **Success outcome:** the useful live state remains without replaying the
  celebration.
- **Failure/edge outcome:** offline cache remains readable under the existing
  stale-data banner and does not create a new celebration.

#### Flow C — choose or replace a profile picture

- **Trigger:** the signed-in user chooses `Add photo` / `Change photo` while
  editing Profile.
- **Steps:** request photo-library permission only after the tap; select one
  image; show a crop/preview; normalize size and format; upload; update the
  profile avatar revision; show inline success.
- **Success outcome:** Profile and subsequent authorized group reads show the
  new picture, with initials available while it loads.
- **Failure/edge outcome:** cancellation changes nothing; denied permission,
  invalid media, upload failure, or profile update failure stays inline and
  preserves the previous picture.

#### Flow D — remove a profile picture

- **Trigger:** the signed-in user chooses `Remove photo`.
- **Steps:** confirm the destructive action, remove the object/profile
  reference, and refresh the local profile state.
- **Success outcome:** all surfaces fall back to initials.
- **Failure/edge outcome:** failure is inline and the previous image/reference
  remains intact; cleanup is idempotent if the object is already absent.

## Delivery slices

### Slice 1 — pure overlap model and initials-first UI

1. Add a pure `training-together` view model under `apps/mobile/src/groups/`.
   It should accept stream items, viewer id, optional selected group, and seen
   keys, then return stable presentation models. Keep grouping, deduplication,
   ordering, and accessible copy out of route components.
2. Add a reusable card under `apps/mobile/components/groups/` and a small
   avatar/initials primitive in the appropriate shared component layer.
3. Render it from the selected Groups stream and the Today aggregate stream.
   Reuse existing navigation and offline semantics.
4. Add a bounded local seen-key repository. This state is device-local UI
   memory, not sync-domain or backend data. Prune ended/old keys and cap storage.
5. Ship this slice with initials even if avatar backend work is not yet ready.
   That separates the core delight from storage and permission risk.

Acceptance:

- exactly one card for duplicate shares of the same session pair;
- no card when my session is absent, either session is completed, or both
  sessions belong to me;
- stable `+N` behavior for three or more active athletes;
- one animation per overlap key, including after focus refresh and relaunch;
- useful, non-animated output with Reduce Motion enabled;
- correct offline marker behavior and no celebration created from a failed
  refresh.

### Slice 2 — private avatar foundation

1. Extend `app_public.user_profiles` with a nullable avatar object key and a
   monotonic avatar revision (or updated timestamp explicitly safe for cache
   busting). Keep profile data outside Sync v2, matching the existing profile
   boundary.
2. Create a **private** `profile-avatars` Storage bucket. Use a fixed per-user
   namespace, enforce image MIME/type and size limits server-side where
   possible, and add policies for:
   - owner upload/update/delete;
   - owner read;
   - read by a caller who currently shares an active group with the owner;
   - denial to unauthenticated users, OAuth agent tokens, former members, and
     unrelated authenticated users.
3. Return only the avatar object key/revision in authorized group member payloads
   (`group_get`, `group_stream`, session detail, boards/events where a member is
   embedded). Do not return a service credential or make the bucket public.
4. Resolve short-lived signed URLs through the authenticated Storage client and
   cache them by `(object key, revision)`. Treat expiry or access loss as a
   normal fallback-to-initials state.
5. Add an owner-only upload service in `src/auth/` and Profile UI for select,
   crop/resize, preview, save, replace, and remove. Upload the new object before
   switching the profile reference; clean old objects after success so a failed
   replacement cannot destroy the current avatar.
6. Strip metadata through image re-encoding, cap dimensions/file size, and do
   not request camera access in this issue. Photo-library-only keeps the first
   permission surface smaller.

Acceptance:

- owner can add, replace, and remove an image;
- cancel/denied permission/upload failure preserves the old profile state;
- authorized group members can display it while unrelated/former members and
  agent tokens cannot read it;
- stale signed URLs fail closed to initials after access removal;
- a replaced image visibly refreshes rather than sticking in image cache;
- account deletion/cascade has an explicit Storage cleanup path.

### Slice 3 — integrate and polish

1. Feed authorized avatar references into the overlap model and existing group
   member/session surfaces where the same identity treatment improves
   consistency. Avoid a one-off avatar contract used only by the celebration.
2. Finalize the accepted design target with small/large iPhone captures for:
   two initials, two photos, mixed photo/fallback, `+N`, offline cached state,
   upload failure, and Reduce Motion.
3. Compare the running app to the target, document intentional differences,
   and update the durable UI, data-model, auth, group-contract, architecture,
   and test-strategy specs with only the decisions that shipped.

## Data and API contract notes

- Prefer deriving overlaps on-device from the current `group_stream` response.
  A new `training_together` database event would outlive or duplicate a
  transient condition and adds write/deduplication complexity without improving
  the in-app moment.
- The current session items already contain `member`, `groups`, `status`, and
  session timestamps. Any stream change for #311 should be limited to extending
  member references with avatar metadata.
- Group RPCs are the authorization boundary for member metadata. Every function
  that embeds a member reference must use one canonical helper/shape so avatar
  authorization and null fallback do not drift between stream, member list,
  detail, and leaderboard responses.
- Do not put signed URLs in persistent group cache: cache the stable object
  key/revision and mint/refresh URLs at presentation time. Never log URLs or
  image bytes.
- Define image constraints before migration/UI work (recommended starting
  point: JPEG/WebP output, square crop, maximum 1024 px, maximum 2 MB). Confirm
  actual Expo/iOS library support before choosing the encoded format.

## Verification plan

Read each test directory's README before editing tests. At minimum:

### Infra-free mobile tests

- pure overlap-model matrix: selected/aggregate group, duplicate shares,
  completed sessions, self duplicates, `+N`, ordering, fallback names, and
  stable keys;
- Today and Groups rendering/navigation tests;
- celebration seen-key persistence/pruning and Reduce Motion behavior;
- avatar service upload/replace/remove/error tests with mocked Image Picker,
  manipulation, and Storage clients;
- Profile UI permission, cancellation, preview, save, removal, and inline
  failure tests;
- fallback rendering for missing, expired, and failed image URLs.

### Local Supabase contracts

- migration/schema assertions for profile columns and the private bucket;
- Storage policy matrix for owner, current group member, former member,
  unrelated user, anonymous request, and OAuth agent token;
- every affected group RPC returns avatar metadata only to an authorized member
  and preserves `NOT_FOUND` anti-enumeration behavior;
- replacement/removal and account cleanup leave no unintended readable object.

### iOS end to end and visual evidence

- extend the auth/profile lane for photo choose/replace/remove and denied/error
  states;
- extend the two-user groups lane so user A starts, user B starts, both devices
  observe the same overlap, one session completes, and the card disappears;
- assert the celebration does not replay on refresh/relaunch;
- capture every accepted state at the target simulator sizes and compare it to
  the accepted design target.

Expected gate set for implementation (confirm from the actual diff with
`./boga test for`):

```bash
./boga test fast
./boga test backend
./boga test frontend
./boga test ios-sync-e2e
./boga test ios-groups-e2e
```

If image picking/manipulation adds or upgrades a native Expo module, first run
`./boga ios build-client --force`, then the frontend gate. Run
`./boga test handles` as well if URL refresh, animation, polling, or image-load
work adds timers/subscriptions.

## Main risks and mitigations

| Risk | Mitigation |
| --- | --- |
| “Live” feels late | Keep wording honest, reuse refresh/poll behavior, and measure sync-to-visible latency in the two-user lane rather than promising a number. |
| Celebration becomes noisy | Require the viewer's active session, dedupe by stable tuple, persist bounded seen keys, and use a compact non-modal treatment. |
| Avatar broadens identity exposure | Private bucket, common-active-group read rule, short-lived URLs, fallback on revocation, and explicit negative auth tests. |
| Signed URLs leak through cache/logs | Persist only key/revision, never log URLs, use short expiry, and clear in-memory URL cache on sign-out/account switch. |
| Replacing a photo loses the old one | Upload/validate first, atomically switch profile metadata, then best-effort delete the superseded object. |
| Image payload harms performance | Client normalization, hard byte/dimension caps, thumbnail-sized rendering, and URL/image caching keyed by revision. |
| Backend shapes drift | One canonical member JSON helper and contract vectors across every affected RPC. |

## Explicit non-goals

- exact real-time presence or WebSocket presence infrastructure;
- push notifications saying that a brother started training;
- public profiles, global user search, or avatars visible outside authorized
  groups;
- camera capture, social reactions, chat, streaks, or permanent overlap history;
- changing Sync v2 to carry profile pictures or celebration state.

