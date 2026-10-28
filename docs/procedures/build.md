# Default build

The default build process, for work started with no other process. When the
user runs a skill (engine, task protocol) or gives you another process, follow
that process and ignore this procedure entirely, including its lane and merge
rules.

- **Lanes:** Jest always (`./boga test fast`). Before running any lane beyond
  it, propose a lane set to your reviewer agent: the path default from
  `./boga test for`, lowered or raised by judgement (spec `02`, "Choosing
  lanes"). Run what you agree to green before opening the PR, and put the
  agreement on the PR's **Tests** section.
- **Merge:** after opening the PR, report the evidence. Merge only on the
  user's explicit approval of that PR. Never auto-merge.
