<!--
Keep this lean: data and file:line pointers, not prose. ~25 lines.
Link CI runs / artifacts / prior threads — do not paste them.
-->

## Objective

<!-- 1-2 sentences: what changes and why. No history/background. -->

## Tests

<!-- The lanes that ran, agreed with the operator before running anything beyond `./boga test fast`
     (docs/specs/02-quality-and-test-gates.md, "Choosing lanes"). One row per lane or gate, with evidence.
     "CI green" alone is not enough. Note any default lane (`./boga test for`) you skipped and why. -->

| Lane / gate | Result | Evidence |
| --- | --- | --- |
| `./boga test fast` | | |
| `./boga test jest-coverage` | | |
| `./boga test complexity` | | |

Agreed with operator: <!-- yes, plus anything lowered or raised and why -->

## Review hard

<!-- 2-4 spots that need real scrutiny, each with file:line. "Nothing risky — mechanical" is a valid answer. -->

-

## Deviations from brief

<!-- What differs from the ask, and why. Write "None." — never leave blank. -->

- None.
