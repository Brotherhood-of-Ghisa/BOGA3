# M28 — Simplify bodyweight UX and semantics

- Status: `planned`
- Created: 2026-09-28, planning baseline `2e5db9e9` on `origin/main`
- Workstream: https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/401

## Objective

Make bodyweight-aware calculations an explicit optional capability rather than
a special logging mode. Ordinary exercise logging uses the same Weight / 1RM /
Volume contract for every exercise; private users and groups can independently
enable bodyweight-aware calculations without losing their saved contributions
when the capability is disabled.

Ship one coherent replacement for issues #392, #395, #396, #398 and #399 while
preserving workout history and dated bodyweight readings.

## Scope

- In:
  - the durable personal, group, coaching and UI contracts;
  - synced private and group bodyweight-aware settings;
  - per-exercise personal and group contributions;
  - kg-only schema/wire/UI cleanup and conversion of retained lb history;
  - ordinary and bodyweight-aware personal calculations;
  - strict bodyweight-aware group scoring and private-reading use;
  - personal settings, exercise editing, logging, records, history, Stats,
    completion/share and group-administration UI;
  - migrations, sync, imports/exports, coaching API and all affected tests;
  - human interaction/design acceptance before aggregate closeout gates.
- Out:
  - unrelated exercise, session, group or coaching redesigns;
  - changing the Wathan estimator itself;
  - inferring exercise semantics from names;
  - exposing a bodyweight calculation breakdown in user-facing UI;
  - retaining obsolete fields or old-client behavior solely for compatibility.

## Agreed design direction

### D1. Private and group capabilities are independent

The user owns a synced `Bodyweight calculations` preference. Each group owns a
separate admin-controlled `Bodyweight calculations` preference. Both default to
off after migration. A user's private preference controls personal UI,
analytics and connected-coach responses; it does not control group scoring.

### D2. Disabling a capability ignores values but never deletes them

Turning either preference off hides its contribution controls and makes its
calculations ordinary. Existing contributions and dated readings remain stored.
Repeated off/on cycles restore every contribution unchanged. Changing either
preference refreshes affected derived views; it never rewrites a raw set.

### D3. Contribution is the only per-exercise bodyweight rule

When the applicable capability is on, every personal or group exercise exposes
`Bodyweight contribution (%)`, accepting decimals from 0 through 100. Zero uses
ordinary math; a positive value enables bodyweight-aware math. New exercises
default to zero. Movement standard and loading method are removed.

Exact personal seed identities keep curated hidden defaults: pull-up 100%,
chin-up 100%, parallel-bar dip 100%, and push-up 70%. Every other seed and new
exercise starts at zero. The app never infers a contribution from a name.
Personal seed presets do not copy into group exercises.

### D4. Ordinary logging uses entered weight only

With the applicable capability off, or contribution at zero, the entered Weight
is the complete calculation load. Volume is Weight times reps and 1RM is
estimated from Weight. Bodyweight readings and contributions are irrelevant.

Weight is optional for every performed set. Blank Weight canonicalizes to zero
kg. A valid zero-load set produces numeric Volume 0 and 1RM 0 while its reps,
performed-set count and working-set classification remain usable. Zero never
creates a personal or group record or ranking entry.

### D5. Bodyweight-aware personal math

For contribution `c`, applicable bodyweight `B`, entered kg `E`, and external
factor `F` (1 for total entry, 2 for per-side entry):

- calculated load = `c * B + F * E`;
- Volume = calculated load times reps;
- estimate total 1RM from calculated load;
- displayed 1RM = `(estimated total 1RM - c * B) / F`.

Bodyweight is counted once. The UI does not explain or expose this breakdown.

### D6. Missing bodyweight differs for personal and group projections

Personal calculation treats a missing applicable bodyweight as zero rather than
making ordinary UI unavailable. For example, positive contribution plus Weight
20 kg x 8 uses 20 kg for Volume 160; blank Weight x 10 gives Volume 0, 1RM 0
and 10 reps. Adding a dated reading later recalculates the affected history.
Personal UI shows no warning or incomplete label for this fallback.

Group calculation is strict: when the group capability is on, contribution is
positive and the member has no applicable reading, no bodyweight-dependent
Volume, 1RM, record or ranking score is produced. Raw shared sets and metrics
that do not require bodyweight remain available.

### D7. Dated readings remain the bodyweight source

`Manage weights` owns kg-only dated readings. A session selects the latest valid
reading at or before its exact start; later readings never apply backwards.
Adding, editing or deleting a reading recalculates affected history without
rewriting sessions or sets. There are no session-local overrides, prompts or
automatic entry dialogs.

### D8. Current rules reinterpret history

The current private preference and current personal contribution determine all
personal historical projections. The current group preference and current
group contribution determine live group projections under the group's normal
revision/publication rules. Turning a capability off applies ordinary math to
its history; turning it back on restores bodyweight-aware math from the saved
contributions and dated readings.

### D9. Weight records remain raw

`Top weight` is always the highest raw entered Weight and never includes a
bodyweight contribution. Preference, contribution or reading changes may alter
derived historical Volume and 1RM but never alter raw Weight. Personal 1RM
records use whichever private calculation mode currently applies.

### D10. The product is kg-only

Exercise weights, planned weights, readings, calculators, group rules/results,
imports/exports and coaching payloads use kg only. Remove kg/lb selectors and
unit fields. Convert retained lb exercise weights, planned weights and readings
to kg without display rounding; presentation formatting remains separate.

### D11. User-facing vocabulary is ordinary and calculation details stay hidden

Normal and advanced UI use `Weight`, `Top weight`, `1RM` and `Volume`. Remove
user-facing `Added`, `External weight` and `Effective load`. Bodyweight-aware
math is neither explained nor broken down for now. Internal calculation names
need not retain obsolete compatibility vocabulary.

### D12. Personal settings and exercise UI stay concise

Private Settings presents one same-line row when space allows:
`Bodyweight calculations` + toggle + `Manage weights`. The link appears only
while enabled and opens the dated-reading screen. No session surface shows a
bodyweight card, entry link, prompt or dialog.

When private mode is enabled, the personal exercise editor adds only
`Bodyweight contribution (%)` with a short field hint. When disabled it hides
the field without modifying it. Group settings and group exercise editing use
the analogous toggle and conditional contribution field.

### D13. Personal and group exercise rules remain independent

An explicit personal-exercise to group-exercise link is sufficient. Group
scoring uses the group contribution; personal analytics uses the personal
contribution. Linking copies or changes neither. Different movements require
deliberately separate exercises; the system does not infer compatibility.

### D14. Group use does not expose private bodyweight

Participation in a group permits the server to use the member's applicable
private dated bodyweight when that group's bodyweight capability and exercise
contribution require it. Other members and admins see derived metrics, not the
weight value, reading date/history or reading identifier.

Certification attests the observed/logged performance, not that the certifier
verified the member's weight. An internal dependency fingerprint may include
the applicable private reading so a later set, contribution or reading change
cannot silently transfer certification to a recalculated result. The value and
fingerprint are not displayed. This design is intentionally tentative and must
be called out during implementation review if a simpler honest model emerges.

### D15. Coaching follows the private preference

When private bodyweight calculations are off, connected-agent/coaching metrics
use ordinary math and expose no bodyweight reading. When on, an authorised
coach may receive the bodyweight-aware derived metrics and applicable private
bodyweight required to interpret them. Group behavior remains governed by the
separate group preference.

### D16. Clean schema over legacy compatibility

The new durable model contains the private preference, group preference,
personal/group contributions, kg weights and kg dated readings. Remove
movement-standard, loading-method, weight-unit, external-load-mode and
compatibility/hydration fields that exist only for the retired contract.

Preserve workout/session/set history, dated bodyweight readings and existing
contribution values. Existing contributions migrate under their new name and
remain hidden/ignored until the relevant default-off preference is enabled. A
coordinated protocol cutover may require old clients to update; do not keep
obsolete branches solely to serve them.

### D17. One human UI gate precedes aggregate closeout

Build the integrated workstream far enough for hands-on use, run only focused
developer checks needed for a reliable review build, and present the private
Settings/editor/logger/history plus group settings/editor states to the user.
Run `./boga test for --diff origin/main...HEAD` and the aggregate closeout suite
only after explicit UI acceptance. Material later UI changes return to human
review before the final pass.

## Task breakdown

| Task | Summary | Depends on | Status |
| --- | --- | --- | --- |
| `M28-T01-Define_simplified_bodyweight_contract` | Replace the durable contracts and accepted design target with D1-D17. | none | completed |
| `M28-T02-Implement_simplified_bodyweight_contract` | Ship the coordinated schema, calculations, UI, sync, groups, coaching and verification work. | T01 | planned |

## Risks / dependencies

- The clean kg-only wire/schema is a coordinated client/backend cutover; old
  builds may need an explicit update-required response rather than compatibility.
- Converting retained lb text values must preserve numeric meaning without
  accidentally rounding or changing raw workout identity.
- Private zero fallback and strict group missing-context behavior deliberately
  differ; typed boundaries and tests must prevent the two policies mixing.
- The private and group preferences must invalidate every affected derived
  cache/view without rewriting raw sessions or sets.
- Group evaluation may use a private reading but must never leak it through
  board, event, certification, cache or API payloads.
- Certification dependency pinning is accepted provisionally and deserves a
  focused design/code review before it becomes a durable shipped contract.
- This is a large cross-stack change. The issue's human UI hold point and the
  repository's local backend/iOS gates are both mandatory.
