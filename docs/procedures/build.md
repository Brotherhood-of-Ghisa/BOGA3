# Default build

Load only when you were given no build protocol (engine run, task card, user
instruction), or one silent on lanes or on merging. Follow your protocol where
it speaks; apply the matching rule below only for the topic it leaves open.

- **Lanes:** Jest always (`./boga test fast`). Before running any lane beyond
  it, propose a lane set to your reviewer agent: the path default from
  `./boga test for`, lowered or raised by judgement (spec `02`, "Choosing
  lanes"). Run what you agree to green before opening the PR, and put the
  agreement on the PR's **Tests** section.
- **Merge:** after opening the PR, report the evidence. Merge only on the
  user's explicit approval of that PR. Never auto-merge.
