# Default build

Load only when you were given no build protocol: no engine run, no task card
and no user instruction on lanes or merging. If you were given one, follow it
and do not load this.

- **Lanes:** Jest always (`./boga test fast`). Before running any lane beyond
  it, propose a lane set to your reviewer agent: the path default from
  `./boga test for`, lowered or raised by judgement (spec `02`, "Choosing
  lanes"). Run what you agree to green before opening the PR, and put the
  agreement on the PR's **Tests** section.
- **Merge:** after opening the PR, report the evidence. Merge only on the
  user's explicit approval of that PR. Never auto-merge.
