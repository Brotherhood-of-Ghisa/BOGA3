# Gym Tracker Project Specs

This folder is the source of truth for product and technical decisions.

## File map

The three always-load docs (per `AGENTS.md`) are marked **[always-load]**; the
rest load on demand per the `AGENTS.md` routing table. (Spec numbering has
gaps — `04`, `07` — from retired docs; gaps are intentional, do not renumber.)

- `docs/specs/00-product.md`: Product overview.
- `docs/specs/01-worktree-and-environment.md`: The agent-owned worktree lifecycle — open, PR, release (quickref; `12` is the deep contract).
- `docs/specs/02-quality-and-test-gates.md`: **[always-load]** Quality/test gate ladder, what's mandatory, and how to run each lane (quickref; `06` is the deep companion).
- `docs/specs/03-technical-architecture.md`: **[always-load]** Top-level architecture decisions and rationale.
- `docs/specs/05-data-model.md`: Canonical data model boundaries, sync scope, ownership invariants, and the client schema drift rule.
- `docs/specs/06-testing-strategy.md`: Which test layer a claim belongs in, per-lane purpose, and coverage policies; deep companion to `02`.
- `docs/specs/writing-tests.md`: How to write a test once you know which layer it belongs in — fixtures, config and framework gotchas. Load when writing or changing a test.
- `docs/specs/08-ux-delivery-standard.md`: Standard UX contract, iteration loop, and evidence requirements for UI work.
- `docs/specs/09-project-structure.md`: **[always-load]** Canonical repo/project structure and path conventions (current state + agreed additions).
- `docs/specs/10-api-authn-authz-guidelines.md`: Minimal authN/authZ/API development and consumption rules for backend work.
- `docs/specs/11-maestro-runtime-and-testing-conventions.md`: Authoritative Maestro iOS runtime/testing contract.
- `docs/specs/12-worktree-config-and-isolation.md`: Slot-lease model, port derivation, per-worktree isolation, lifecycle command mechanism, and the removed cleanup mechanisms and why.
- `docs/specs/tech/README.md`: Index of the subsystem deep-dive contracts (sync, groups, metrics, bodyweight, session planning, competitions). Load it to find the one that owns your subsystem.
- `docs/specs/ui/README.md`: Index of the UI docs and the maintenance trigger map. Load it when changing screens, components or routes.

Planning docs (milestones, task cards, plans, and their templates) are not
specs. They are optional and ephemeral and live under `docs/plans/` (see
`docs/plans/README.md`).

## Doc rules

These apply to every persistent doc, meaning everything outside `docs/plans/**`
and `docs/brainstorms/**`. `docs-check` (`scripts/gen-docs.sh`) enforces rules
1, 2 and 4, and rule 5 for product facts.

1. **Word budget.** An agent can load `AGENTS.md` and every doc reachable from
   it through a Markdown link or an inline-code `.md` path. Each of those docs
   has a budget in `scripts/doc-budgets.tsv`: 2,000 words for `AGENTS.md`,
   2,500 for each always-load spec, and 3,000 for the rest, counted as
   `wc -w` counts. Design targets (`docs/specs/ui/design-targets/`) are exempt.
   `./boga docs budgets` prints every doc's count, its budget, and the doc
   that first links to it. `docs/product/` is loaded whole, so its docs also
   share one `corpus` budget (6,000 words).
2. **Over budget: split or trim.** Ask of every section: does it repeat another
   doc, or repeat what the code already says? Does an agent need it at all?
   Does it need this level of detail? Cut what fails, or split the doc into
   parts that each sit behind their own load trigger. A doc that was already
   over budget when the budgets landed has a grandfathered `ceiling` row and
   may not grow. `./boga docs gen` lowers that ceiling as the doc shrinks and
   drops it once the doc fits. Raising a budget or adding a ceiling needs the
   operator's agreement, stated in the PR's Deviations section.
3. **Every link is a load trigger.** A link to another doc says when to follow
   it ("if you are changing X, load Y"), as the `AGENTS.md` routing table and
   the specs' `Load when:` headers do. Never write an unconditional "see also":
   an agent loads only what its task needs.
4. **Cited paths exist.** Every repo path in inline code or in a link target
   must exist. A path resolves against the doc's directory, its package root,
   the repo root, or `apps/mobile`, and a bare spec number (`docs/specs/11`)
   means that spec. The check skips fenced code, globs, `<placeholders>` and
   gitignored outputs. A line that names a removed path on purpose ends with
   `<!-- docs-check: historical-path -->`. Link to a file or path, never to a
   line (no `:<line>` suffix, no `#L<line>` anchor): line numbers rot with
   every edit.
5. **One place per fact.** State a rule in the doc that owns it and link to it
   from elsewhere. When code or a registry is the source (for example
   `scripts/lanes.tsv`), the doc links to it or is generated from it; it never
   restates it. A product decision is a fact in `docs/product/`, cited as
   `[[<id>]]`; `docs-check` fails a doc that repeats a fact's `Signature:`
   text in a paragraph without that citation.
