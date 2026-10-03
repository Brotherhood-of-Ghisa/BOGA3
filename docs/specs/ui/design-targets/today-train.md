# Accepted target — Train (repo-native brief)

Target record per `../ai-design-policy.md`, for DLM-T03 of the design-language
migration. Chosen by the user on 2026-09-24 (plan decision G1 (a)): a brief plus
the gallery states the user accepts. **Pending acceptance** in the DLM-T03
gallery.

Today's half of this record was replaced by `today-landing.md` (accepted
2026-10-02); this record now covers Train only.

## Target

- Vocabulary: `../design-language.md` and the app frame (`app-frame.md`).
- This brief, plus the gallery states below. No artboards.

## Brief

- The page is `paper` under a `PageHeader` (Archivo 800 title, `ink-muted`
  intro). Each section has a `SectionHeader`.
- An active workout is a `Card` marked by the `set-current` ring and the words
  "Continue your active session", with no green. `Resume workout` is the
  screen's one `accent`.
- Train shows one `accent` at a time. When a plan is ready, `Start planned
  workout` is the primary and `Start empty workout` is an outline (T03-D1).
- Loading, empty, error and unavailable states are `StatePanel`s inside cards,
  with their copy kept, including "Watch this space 👀".

## States

Device: iPhone simulator at 390pt width, light.

| Screenshot (lane) | State |
| --- | --- |
| `02-m26-train` (`ios-smoke`) | Train, idle: empty start (primary) and the planning placeholder |
| `train-active-workout` (ad hoc) | Train with a workout running |
| `02-abandoned-back-on-train` (`ios-session-view`) | Train after an abandon |

`(ad hoc)` states are no longer captured by a lane: their flow keeps only
the claims that need a device (spec 06, "Maestro scope policy") and Jest
proves the rest. When the screen changes, capture them with a one-off flow
run (`apps/mobile/scripts/maestro-ios-run-flow.sh --flow …`); git history
holds the flow steps that reached them.

Jest only (no harness seam reaches them): the plan loading, error and ready
states.

No target screenshots are committed; runtime captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence.
