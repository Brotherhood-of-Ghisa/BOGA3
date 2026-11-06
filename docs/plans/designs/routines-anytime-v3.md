# Routine plan property — mock v3

## Selected direction

The operator accepted Routine as a property of the existing plan, selected
**Switch row (recommended)** from the BoGa-control comparison, and requested
that locked Anytime be visually clear. The switch choice is settled; this
version presents the requested locked state and has been accepted.

- Current target: `docs/plans/designs/routines-anytime-v3.html`.
- Evidence: `apps/mobile/artifacts/routines-anytime/v3/` (gitignored).
- Acceptance: **accepted** by the operator (the human user of this thread) on
  2026-11-06. Explicit response: **Accept mock v3**, to the question identifying
  the selected Routine switch and lock-marked read-only Anytime row. The
  accepted surfaces are the existing plan creation/edit card and its
  locked/editable Schedule states within the same-plan flow.
- Frozen source SHA-256:
  `92887b1d63adef608c899ec8f99c75220847cab23cdb27e4fbe4995e7cfa2860`.
  Keep the HTML unchanged as the build input. The small/normal captures were
  supplied; the operator did not separately enumerate which widths they viewed.
- There is no production UI change or running-native acceptance yet.

## Subsequent scope clarification

The operator then answered **No Routine inside a programme** and requested
reuse of existing non-routine logic wherever possible. The accepted control
composition applies to standalone plans. Programme forms omit Routine, and
storage must reject Routine plus programme membership without detaching a
child. Earlier programme-conversion examples in the frozen HTML are therefore
superseded by this explicit scope decision; the HTML stays unchanged as the
accepted visual input. Programme progression remains unchanged.

Completion eligibility and history operations reuse existing recorder/plan
logic. New behavior is limited to the agreed repeat-use lifecycle and explicit
routine Skip; the operator did not request a separate completion/date engine.

## Existing BoGa composition

1. **Routine:** existing SwitchRow, `density="list"`, in the current plan
   creation/edit card. Both on/off states remain visible.
2. **Routine on:** replace the Schedule ChoiceRow with the existing read-only
   ValueRow. Its value is **Anytime** with a 16 pt muted lock icon. Keep normal
   readable type; the glyph carries the locked state rather than relying on
   faint text. There is no chevron, button role, press handler or picker target.
3. **Routine off:** restore the Schedule ChoiceRow, its saved date and chevron.
   It opens the existing Plan schedule picker. Changing the property never
   silently discards its prior scheduled instant.
4. Accessibility names the passive row “Schedule, Anytime, locked while Routine
   is on”. The lock is decorative within that one accessible read-only element.
   The Routine switch remains the separate full-row control.

The lock comes from the same Lucide 1.47.0 release used by BoGa's vendored icon
set: [source SVG](https://unpkg.com/lucide-static@1.47.0/icons/lock.svg), ISC.
ValueRow already supports a value icon; implementing this target will add that
glyph to the existing Icon vocabulary, not add a new UI primitive or dependency.
The mock uses the source geometry. Its switch is represented in HTML; production
will use the native switch through SwitchRow.

## Focused review evidence

- `schedule-normal.png`: 390 × 844 pt phone frames, showing on/locked,
  off/editable and retained state after a save failure.
- `schedule-small.png`: the same states at 320 × 700 pt, with the editable
  date/time wrapping without breaking the Schedule label.
- The in-app browser exposed locked Schedule as a read-only group, with zero
  buttons and no chevron; toggling Routine off restored the date button.
- The restored button opened Plan schedule with the retained date/time. Set
  schedule dismissed the picker, and switching Routine on restored locked
  Anytime. These are mock interactions, not persistence/sync proof.
- DOM measurement confirmed all three frames at each intended width, and no
  horizontal overflow in the reviewed cards/rows. Saved final screenshots were
  inspected. An early picker capture that missed its content is explicitly
  labelled rejected and is not visual evidence. A crop attempt that returned
  the page header is likewise labelled rejected; use the full reviewed captures.

For implementation boundaries and planned verification coverage, load the
corresponding sections of
`docs/plans/designs/routines-anytime-v2.md`. V3 supersedes its visual control and
disabled-row treatment. Native rendering, VoiceOver/touch behavior, app gates,
independent reviews and running-UI acceptance remain outstanding.
