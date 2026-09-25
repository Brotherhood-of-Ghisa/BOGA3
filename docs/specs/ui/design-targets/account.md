# Accepted target — Sign-in, first-sync gate, Profile, Connected agents (repo-native brief)

Target record per `../ai-design-policy.md`, for DLM-T05 of the design-language
migration. Chosen by the user on 2026-09-24 (plan decision G1 (a)): a brief plus
the gallery states the user accepts. **Accepted** by the user in the DLM-T05
gallery on 2026-09-25.

## Target

- Vocabulary: `../design-language.md` and the app frame (`app-frame.md`).
- This brief, plus the gallery states below. No artboards.

## Brief

- **Sign in** is `paper`, centred, with no header: a `PageHeader` ("Sign in"
  and an `ink-muted` intro) over one `Card` holding the Email and Password
  `FormField`s, a `danger` `Notice` for a failure, and `Sign in`, the screen's
  one `accent`. An auth-unconfigured build shows a `Notice` with the `warning`
  glyph, "Sign-in unavailable" and the reason, and no form (G3).
- **The first-sync gate** is one `Card` centred on `paper`: "Setting up your
  data…" in Archivo 700, the phase in `ink`, an `ink-muted` spinner, and the
  activity line (`Layer K of N · M items`) in Plex Mono `ink-muted`. Offline is
  a `Notice` with the `offline` glyph and the copy. A failed cycle shows its
  message in `danger` (T05-D3) above `Retry`, the gate's one `accent`.
- **Profile** view mode is one `Card` of `Stat kind="text"` rows (Username,
  Email, Pending email) in `ink`, over `Edit` (outline) and `Sign out` (outline
  in `danger`, no confirmation, T05-D4). There is no `accent` in view mode. Edit
  stays inline (T05-D2): a `Card` of `FormField`s with `Cancel` (text) and
  `Update` (the `accent`). An update is a `Notice` with the `success` glyph; a
  failure, a load error and a sign-in or sign-out error are `danger` `Notice`s.
  Restoring is a loading `StatePanel`; auth-unconfigured is the `warning`
  `Notice` ("Auth setup required"). Signed out, Profile shows the sign-in
  `Card` with `Sign in` as its `accent`.
- **Connected agents** has no in-content title: the native header carries it
  (G4, T05-D1), and the `ink-muted` intro stays. Signed-out, loading, empty and
  error states are `StatePanel`s in a `Card`; the error's `Retry` is an outline.
  Each agent is a `Card`: the name in Archivo 700, "Read training data" in
  `ink-muted`, an `AI` `Tag`, `ListRow`s for Access granted and Last access
  (dates in Plex Mono), and `Revoke access` as an outline in `danger` behind the
  unchanged `Alert.alert` confirmation. The screen has no `accent`.

## States

Device: iPhone simulator at 390pt width, light.

| Screenshot (lane) | State |
| --- | --- |
| `05-auth-profile-gate-start` (`ios-auth-profile`) | Sign in, empty form |
| `16-first-run-roundtrip-signed-out` (`ios-sync-e2e`) | Sign in on a fresh install |
| `connected-agents-empty` (`ios-auth-profile`) | Connected agents, no grants |
| `06-auth-profile-signed-in` (`ios-auth-profile`) | Profile, view mode |
| `profile-editing` (`ios-auth-profile`) | Profile, inline edit |
| `profile-updated` (`ios-auth-profile`) | Profile, the "Profile updated." notice |
| `07-auth-profile-signed-out-end` (`ios-auth-profile`) | Sign in after signing out |

Jest only (no flow reaches them): auth-unconfigured sign-in and Profile, the
restoring panel, the first-sync gate, and a populated agents list. The gate is
up for under two seconds after a sign-in on the simulator, and what it shows in
that window (the pre-network offline copy or the spinner) is timing-dependent,
so it is not an asserted capture. A one-off capture was reviewed in the DLM-T05
gallery.

No target screenshots are committed; runtime captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence.
