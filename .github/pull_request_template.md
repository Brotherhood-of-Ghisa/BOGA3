<!--
Keep this lean: data and file:line pointers, not prose. ~25 lines.
Link CI runs / artifacts / prior threads — do not paste them.
-->

## Objective

<!-- 1-2 sentences: what changes and why. UI: show the selected approved template/variant; custom design names parent/delta and its pre-build human acceptance. Append the ui-pattern-selection JSON block from spec 08, including promotions when registering/changing a template. Selection/acceptance workflow: docs/specs/08-ux-delivery-standard.md. -->

## Tests

<!-- The lanes that ran (docs/specs/02-quality-and-test-gates.md, "Choosing lanes"). One row per lane or gate, with evidence.
     "CI green" alone is not enough. Note any default lane (`./boga test for`) you skipped and why. -->

| Lane / gate | Result | Evidence |
| --- | --- | --- |
| `./boga test fast` | | |
| `./boga test jest-coverage` | | |
| `./boga test complexity` | | |
| `./boga test dependencies` | | |

Lane agreement: <!-- who agreed the set, plus anything lowered or raised and why | n/a -->

Product facts: <!-- **highlight** each id added, changed or decided (`set.eligibility`, …) | none --> — product review: <!-- verdict of docs/procedures/product-review.md on this diff -->

## Review hard

<!-- 2-4 spots that need real scrutiny, each with file:line. "Nothing risky — mechanical" is a valid answer.
     Custom design: link native component/reference evidence; record explicit authorized human design acceptance at the full reviewed commit, devices/viewports and paths, or state awaiting design acceptance. Generic PR approval is not design acceptance. Promotion requires separate UI template acceptance of the exact head/contract digest (spec 08). Unchanged template reuse needs no new design acceptance. -->

-

## Deviations from brief

<!-- What differs from the ask, and why. Write "None." — never leave blank. -->

- None.
