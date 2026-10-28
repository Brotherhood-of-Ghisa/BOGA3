# T-20261028-01 — Selected muscle relief fibres

- Status: `planned` — design approved by the operator on 2026-10-28.
- Depends on: none; start implementation after this planning PR merges.
- Milestone: none. One implementation session, worktree and PR.
- Areas: frontend; UI impact: yes.

## Objective

Replace the selected-muscle boundary outline in the native Progress 3D body
with the approved relief fibre overlay. Keep the live muscle colouring and
all current selection, comparison and rotation behaviour. Selected fibres
remain visible even when their owning muscle surface faces away or is covered.

## Approved design target

The operator selected **Relief fibres**, approved **Medium** as the visual
reference fill, requested that fibres surface irrespective of muscle-surface
visibility, then approved the version with body colouring.

The repo-native target is the **Relief fibres panel** of the
[approved runnable snapshot](../targets/T-20261028-01-relief-fibres.html).
Its other panels are comparison controls, not implementation alternatives.
The brief below governs production behaviour; the snapshot governs the relief
treatment and its contrast against coloured anatomy. Current repository
contracts govern native integration. Report material differences in the PR.

- Snapshot: 563,778 bytes; SHA-256
  `051b13e759a5accd58b94f887031d1f5cdf9ed60dcc92b7c407c6cb6c37d4c68`.
- The snapshot embeds its model, fibre geometry, styles and scripts. It requires
  no server-side code, external assets, chat history or temporary localhost URL.
  Open it in a browser, or serve its directory with a local static server.
- Reference state: Chest, Front, selected fill Medium, Body colours on,
  Deep projections on, Always surface fibres on, 280-point model height.
  Also inspect Chest from Back and Lats from Back.
- Original mock provenance: projection/theme/assets at commit `c92ca7ce`.
  That commit pins the target; the implementation branches from current main.
- Local comparison captures, when available, are in the gitignored
  `apps/mobile/artifacts/muscle-fibres-effort/` directory. They supplement the
  self-contained target; they are not a dependency for executing this card.

Delete this card and its HTML snapshot in the implementation PR. Keep native
completion evidence in that PR and the gitignored artifacts tree; the shipped
component, tests and owning documentation become the record.

## Decided — do not reopen the approved direction

1. **Relief, not outlines.** Use the source fibre directions as a light-and-shade
   texture on the selected muscle. Remove its old selection contour. Keep body
   facet seam strokes that serve the base rendering.
2. **Always surfaced selection.** Project every available selected segment with
   the body's camera, then draw the fibres above the body. Neither body depth
   occlusion nor the owning face's back-face culling hides the selection overlay.
   Chest fibres therefore remain visible at 180 degrees, through the back.
   The base body retains its normal visibility and lighting.
3. **Only the selected reported muscle.** Resolve anatomy-entry fibres through
   the existing reporting assignment, aliases and tracking rules
   ([[muscle.report-groups]], [[muscle.untracked]], [[muscle.no-breakdown]]).
   Merged entries select together, on both sides; unrelated fibres stay absent.
4. **Live data colours stay authoritative.** Preserve
   [[comparison.colour-scale]] and the existing Now/Prev/Change figures.
   The operator called these effort colours; current 3D colouring follows that
   fact's period comparisons. This task changes no analytics or colour meaning.
   Medium and the mock's sample scores are contrast fixtures, never a production
   override. Selection and rotation must not change any computed body colour.
5. **No body fading.** Keep the body opaque and retain the selected surface
   fibres. The earlier experiment that faded surface anatomy to emphasise deep
   guides was superseded by the always-surfaced design.
6. **Use the available schematic geometry.** Include the selected asset's surface
   and deep-projection guides. Preserve independent segments and existing gaps.
   Do not join by `path`, invent hidden extents, add anatomy entries, or turn
   pectoralis minor into a new catalog/analytics muscle.
7. **Brachialis refinement is deferred.** Its currently limited extent and other
   anatomy-quality gaps do not block this rendering task. Preserve the supplied
   mesh/fibre geometry; repairing it is separate work.

Relief reference values, in logical display points, from the approved snapshot:

| Pass | Theme role | Width | Opacity | Offset |
| --- | --- | --- | --- | --- |
| Highlight | `surface` | 1.1 | 0.95 | +0.45 x, -0.45 y |
| Fibre shade | `inkMuted` | 0.9 | 0.72 surface / 0.70 deep | none |

Both passes use round caps/joins. Deep guides are solid in the surfaced relief
treatment. Start with these values using native SVG; tune only for demonstrated
native rendering differences and record the deviation. Check contrast on light,
middle and dark body shades and supported theme presets.

## Scope and implementation boundaries

- Integrate into `apps/mobile/components/stats/muscle-body-card.tsx` and
  `apps/mobile/components/stats/muscle-body-projection.ts`, with only the small
  typed asset/projection helper needed beside them.
- Reuse `apps/mobile/components/stats/muscle-body-fascicles.json` and
  `apps/mobile/components/stats/muscle-body-mesh.json`. When consuming them, load
  `apps/mobile/components/stats/muscle-body-fascicles.md` and preserve its mesh
  binding, provenance and schematic/deep-projection caveats.
- Reconstruct endpoints from each face and its barycentric anchors, using the
  same rotation, viewport and scale as the body. The highlight offset is visual;
  it does not alter the stored geometry. Batch independent M/L segments rather
  than creating a React/SVG element for every segment.
- Use the existing React Native/SVG renderer and theme tokens. The snapshot's
  browser canvas, software depth buffer and UI are design inputs only; do not
  transplant that parallel renderer into the app. Selected-only preparation
  should avoid recomputing all muscles' fibres during every drag frame.
- Keep existing picker, previous/next, Front/Back, drag, accessible rotation,
  selected labels, hit testing and contribution navigation. The visual overlay
  does not intercept taps or change frontmost body-surface hit testing.
- Do not ship the mock's fill/data/size controls, colour toggle, density variants,
  deep toggle, always-surface toggle, sample score map or comparison gallery.
  The chosen overlay is the app's selection treatment, not another preference.
- No schema, sync, analytics, effort-policy, native dependency or model-generator
  change is planned. Do not expand into anatomical reconstruction.

## Remaining implementation choices

- Choose the smallest typed loading/projection/batching shape after checking
  current main. Preserve the approved appearance and behaviour above.
- Communicate schematic and projected-depth limitations using the existing
  on-demand `Information`/`Sheet` pattern (spec 08, pattern 14), respecting
  [[copy.no-inline-explanation]]. Settle its compact placement/copy in the native
  component; the mock's explanatory footer is not production screen copy.
- Measure native drag/render and bundle/load cost before and after. The source
  fibre JSON is about 1.27 MB; the browser mock is not native performance proof.
  Optimise only a demonstrated regression. Do not lower quality thresholds.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Select | Open Progress 3D; tap a muscle, use picker or stepper | Existing name/figures/contributions select normally; only that reported muscle gets relief fibres | No geometry: retain name, figures and controls without inventing a shape or crashing |
| Rotate | Keep selection; drag or use Front/Back/accessible rotation | Body rotates normally; selected fibres stay aligned and surfaced at front, rear and oblique angles | An owning face being hidden never suppresses an available selected segment |
| Reporting | Select Detailed, Broad or Custom reported muscles | Matching tracked anatomy entries show together; existing selection/hit semantics remain | Disabled entries contribute no overlay; legacy aliases and geometry-free custom muscles remain safe |
| Colours | View actual body colours and change selected muscle/angle | Data-derived colours and figures stay unchanged; relief reads over light/middle/dark shading | Empty, unavailable and zero states retain existing data semantics; no mock score/fill override |
| No selection | Clear selection where existing UI permits | Coloured body remains; selection fibres and contour are absent | Empty input/invalid viewport returns a safe empty projection |

## Acceptance and verification

1. Native relief replaces the boundary contour and matches the approved target
   at the existing 280-point height. The body remains coloured and opaque.
2. Jest proves: correct anchors/rotation; independent segments; selected-only
   fibres; surfaced segments despite a hidden/back-facing owning face or nearer
   occluder; front/rear/oblique cases; reported groups, aliases and disabled
   entries; no selection/no asset/empty input; unchanged colours and hit testing.
   Include a Chest-at-180-degrees regression and all 25 source IDs. Read the
   test directory README before editing the existing muscle-body suites.
3. Render and compare native screenshots against the target at matched viewport,
   selection, angle, theme and shade. Cover Chest, Lats, Quads and the existing
   Brachialis/deep-only geometry, including medium selected fill and mixed body
   colours. Check small/large phones and the supported colour themes.
4. Record actual before/after native performance and asset cost; no unsupported
   performance claim based on the standalone browser demonstration.
5. Preserve the model/asset identity and existing figures, settings and controls.
   Remove unused contour computation only after checking every caller/test.
6. Attach native screenshots, comparisons, gate logs, reviewer lane agreement,
   performance evidence and any material target deviations to the execution PR.

## Owning documentation and product facts

Product facts: **none changed or decided by this planning PR**. The intended
change is the single component's selection presentation; pin it in its header
and tests per product-facts-authoring rather than adding an unnecessary fact.
Reassess this classification if implementation broadens the behaviour.

In the execution PR, update the component header and the fascicle companion doc:
it currently says the asset is offline-only and requires depth occlusion. Explain
runtime consumption and the intentional always-surfaced selection exception;
retain the asset's anatomy/provenance limitations. Update UI catalog/rules only
if their actual maintenance triggers apply. No design target belongs in specs.

## Gates and execution handoff

Expected implementation defaults: `./boga test fast` plus `frontend-ui` on macOS
or `frontend-android` on Linux. Propose the smallest relevant device set to the
reviewer: on macOS the existing `ios-data-smoke` lane includes the Broad 3D
selection flow. Settle any narrowing with the reviewer; do not add a Maestro
scenario without the written Jest-insufficiency justification. Run
`jest-coverage`, `complexity` and `dependencies` once on the finished code before
the implementation PR, with the repository's existing thresholds. Re-run
`./boga test for` on the actual diff and follow AGENTS.md for all review/PR gates.

After this planning PR merges, start a new session with:

```text
Execute docs/plans/tasks/T-20261028-01-Selected_muscle_relief_fibres.md with the task-protocol skill.
```

Check the card assumptions against current main, implement in a fresh leased
local worktree, and preserve this approved direction. Native implementation has
not started; this planning PR does not claim its gates or performance are proven.
