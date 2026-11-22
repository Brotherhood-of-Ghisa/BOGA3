# Default build

Use this process when no other process applies, including the missing-Engine
fallback in `AGENTS.md`, even if an Engine build skill was already loaded.
When Engine is available, follow its selected skill (`build` or the `engine`
skill's server executor mode). Follow any other user-given process instead.
The test gates in `AGENTS.md`
apply under every process (Jest always, chosen lanes green, quality targets);
only which lanes to run and how to merge come from the process: the agent's
judgement, or the lanes agreed on the ticket for unattended work.

- **Lanes:** Jest always (`./boga test fast`). Before running any lane beyond
  it, propose a lane set to your reviewer agent: the path default from
  `./boga test for`, lowered or raised by judgement (spec `02`, "Choosing
  lanes"). Run what you agree to green before opening the PR, and put the
  agreement on the PR's **Tests** section.
- **Merge:** after opening the PR, report the evidence. Merge only on the
  user's explicit approval of that PR. Never auto-merge.
