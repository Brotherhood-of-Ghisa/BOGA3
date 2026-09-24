---
task_id: DLM-T05-Sign_in_sync_gate_Profile_Connected_agents
milestone_id: "none (plan: docs/plans/design-language-migration.md)"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend + ./boga test backend + ./boga test ios-sync-e2e"
docs_touched: "docs/specs/ui/{screen-map,ux-rules}.md, docs/specs/ui/design-targets/account.md (new)"
---

# DLM-T05 Sign-in, sync gate, Profile, Connected agents

- Status: `planned`, **approved 2026-09-24** (decisions as recommended).
- Depends on: T01, T02.
- Design target (G1): brief + gallery → `design-targets/account.md`.
- Files: `app/sign-in.tsx` (244), `src/sync/SyncGate.tsx` (236),
  `app/profile.tsx` (663), `app/connected-agents.tsx` (272).
- **Gates:** `src/sync/SyncGate.tsx` matches "sync runtime", so this card needs
  `backend` + `ios-sync-e2e` as well as `fast` + `frontend`. The change there is
  presentational only; the gate's state machine and `SYNC_GATE_TEST_IDS` are not
  touched.

## Today → becomes

| Today (file:line) | Becomes |
| --- | --- |
| **Sign-in**: title + subtitle; auth-disabled **warning card** (:207-215); card with Email, Password (inputs duplicated from Profile), inline error (danger-subtle), **Sign In (primary)**; centred in `KeyboardAvoidingView` | `Screen` with the title in Archivo 800 and the subtitle `ink-muted`. The auth-disabled card becomes `Notice` with `triangle-alert` + "Sign-in unavailable" + reason (G3). Email and Password become `FormField`s (`sign-in-*-input` kept), the error a `Notice tone="danger"` (`sign-in-inline-error` kept), and `Sign in` the `accent` primary (`sign-in-submit-button`). Centring and keyboard avoidance are kept |
| **SyncGate**: full-screen `surfaceMuted` card "Setting up your data…"; phase label + spinner (`actionPrimary`) + activity line; offline message; **error in `textSecondary`** + Retry (primary) | `Screen` + `Card`: the title in Archivo 700, the phase in `ink`, spinner `inkMuted`, the activity line (`Layer K of N · M items`) in Plex Mono `ink-muted`. Offline: `wifi-off` + copy. Error: **`danger`** (T05-D3) + `Retry` `accent`. Copy and testIDs are unchanged |
| **Profile**: restoring **info card** (:568); auth-disabled **warning card** (:571-579); signed-out sign-in card (**Sign In primary**); view mode with values in **`textAccentStrong`** (:616) + Edit (secondary) + **Sign Out (danger)**; edit mode Username / New email / New password + Cancel (secondary) + **Update (primary)**; load error; **success feedback card** (:653-661); inline error | Restoring → `StatePanel kind="loading"` (copy kept). Auth-disabled → `Notice` + `triangle-alert`. Values → a `Card` of `Stat kind="text"` rows in `ink` (not accent). Inputs → `FormField`. Update / Sign in → `accent`. Edit → outline. Cancel → text button (`profile-cancel-edit-button` kept; inline edit is kept, T05-D2). Sign Out → outline `tone="danger"`. Success feedback → `Notice` + `circle-check` ("Profile updated." kept). Errors → `Notice tone="danger"`. testIDs are unchanged, including `profile-inline-error` in both places |
| **Connected agents**: in-content title "Connected agents" + intro, **duplicating the native header** (:106-114); signed-out, loading and empty cards; per-agent card with an "AI" badge (`actionPrimarySubtle*`), "Read training data", Access granted / Last access rows, **Revoke access (danger) ×N**; error card + Retry | The in-content title is dropped (native header, G4), and the intro stays (Maestro asserts it). States → `StatePanel`. One `Card` per agent: name, "Read training data", `Stat` rows (dates in Plex Mono), and `Revoke access` as an outline `tone="danger"` button (the `Alert.alert` confirm is unchanged). The "AI" badge becomes a `Tag`. The error → `StatePanel kind="error"` + `Retry` |

## Decisions

| # | Question | Recommendation |
| --- | --- | --- |
| T05-D1 | Connected agents shows its title twice (native + in-content) | Drop the in-content title; keep the intro |
| T05-D2 | Profile's inline edit (`Cancel` + `Update` in place) vs moving it into a `Sheet` | **Keep inline.** It is a form, not a menu; the Maestro flow depends on the inline card |
| T05-D3 | The SyncGate error is `textSecondary` today, not an error colour | Show it in **`danger`**. It is an error, and the `Retry` beside it reads correctly. This is a small visual change, listed here so it is decided |
| T05-D4 | `Sign Out` has no confirmation (unlike Revoke, Wipe) | **Keep as is** (behaviour stays). Signing out loses no data |
| T05-D5 | The Profile header says "Profile" while Settings' row says "Account" | Out of scope (copy). Noted for a follow-up |

## UX contract

- **Sign in.** Trigger: `Sign in`. Success: the gate or tabs open. Edge: a bad
  password shows the `danger` notice; the auth-disabled build shows the
  unavailable notice and no form.
- **First sync gate.** Trigger: first sign-in on a device. Success: phases
  progress and the gate lifts. Edge: offline shows `wifi-off` + copy; failure
  shows the `danger` error + `Retry`.
- **Edit profile.** Trigger: `Edit` → change → `Update`. Success: the "Profile
  updated." notice. Edge: validation or server failure shows the `danger`
  notice; `Cancel` restores view mode.
- **Revoke an agent.** Trigger: `Revoke access` → confirm. Success: the card
  disappears. Edge: a failure shows the error panel + `Retry`.

## Gallery

- `05-auth-profile-gate-start` (sign-in), `06-auth-profile-signed-in`,
  `07-auth-profile-signed-out-end` (auth-profile);
  `16-first-run-roundtrip-signed-out` (sync e2e).
- **New** (asserted, in `auth-profile-happy-path.yaml`): `profile-editing`
  (after `profile-edit-button`), `profile-updated` (after
  `profile-update-feedback`), `connected-agents-empty` (at
  `connected-agents-screen`).
- **New** (sync e2e): `sync-gate-progress`. The flow already passes the gate;
  add an `extendedWaitUntil` visible `sync-gate-block` + capture before the
  existing notVisible wait. If the gate lifts too fast to catch reliably, keep
  it jest-only and say so in the PR (no flaky capture).
- Jest-only: auth-disabled sign-in and profile, the restoring card, the gate
  error, and a populated agents list. There is no harness seam for these.

## Tests

- `sign-in-screen`, `sync-gate-screen`, `auth-profile-service`,
  `settings-profile-navigation`, `connected-agents-screen`: behaviour, copy and
  `Alert.alert` spies are unchanged. Add: the SyncGate error text uses `danger`,
  and connected agents renders no in-content title.

## Docs

- `screen-map.md` (`/sign-in` 2, `/profile` 8, `/connected-agents` 7) and
  `design-targets/account.md`.

## Gates

`./boga test fast`, then `./boga test frontend`, then `./boga db reset`, then
`./boga test backend`, then `./boga test ios-sync-e2e`, run serially.

## Acceptance

1. No legacy identifier in the four files.
2. All four gates green, with evidence.
3. Gallery accepted.
4. Estimate: about 1,200 lines.
