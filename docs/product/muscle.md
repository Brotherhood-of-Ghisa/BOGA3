# Muscle

### muscle.set-count · definition · open

How many sets a muscle gets from a working set mapped to it. One rule, to be
decided, then applied on every screen that shows sets per muscle. Today two
screens disagree:

| Screen | Primary | Secondary |
| --- | --- | --- |
| Session summary, "Sets by muscle" | 1 | ½ |
| Progress muscle comparisons and tables | 1 | 1 |

A builder touching either screen, or adding a third, stops and asks.

Code: `summarizeCurrentSessionMuscleLoad` in `apps/mobile/src/session-insights/calculations.ts`; `apps/mobile/src/data/progress-comparisons.ts`.
Signature: `primary + ½ secondary`
