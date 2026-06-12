# Milestone Specs

Store milestone deep-dive specs here — **active milestones only**. When a
milestone ships, `git mv` its spec to `archive/` in the closing change:
`docs/specs/**` stays "true now", and a shipped milestone's spec is history,
not current direction (its `Status:` field will lie eventually — the archive
move is what marks it done). `archive/` is reference material; do not load it
for current behavior.

Naming convention:

- `M1-<short-name>.md`
- `M2-<short-name>.md`

Use template:

- `docs/specs/templates/milestone-spec-template.md`
