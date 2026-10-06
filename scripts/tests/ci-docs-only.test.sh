#!/usr/bin/env bash

# Tests for scripts/ci-docs-only.sh (CI's docs-only fast-path classifier).
# Infra-free: explicit path lists on stdin, no git.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CLASSIFY="${REPO_ROOT}/scripts/ci-docs-only.sh"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }

# expect <true|false> <event> <paths...>: paths are piped one per line.
expect() {
  local want="$1" event="$2"; shift 2
  local got
  got="$(printf '%s\n' "$@" | "${CLASSIFY}" --event "${event}")"
  [[ "${got}" == "${want}" ]] \
    || fail "expected ${want} for event=${event} paths=[$*] — got ${got}"
}

# docs tree and root-level markdown → fast path
expect true  pull_request docs/specs/05-data-model.md
expect true  pull_request docs/specs/ui/design-targets/daily-history-calendar/reference.png
expect true  pull_request AGENTS.md
expect true  pull_request CLAUDE.md RUNBOOK.md docs/testing/x.md

# anything outside docs/ or the root → full run, even when it is markdown
expect false pull_request scripts/doc-budgets.tsv
expect false pull_request docs/specs/02-quality-and-test-gates.md scripts/doc-budgets.tsv
expect false pull_request apps/mobile/README-LOCAL-DEV-BUILD.md
expect false pull_request apps/mobile/__tests__/README.md docs/specs/06-testing-strategy.md
expect false pull_request .github/workflows/ci.yml
expect false pull_request .github/pull_request_template.md
expect false pull_request boga
expect false pull_request README.txt
# Jest runs the product fact tables, so a fact change is code
expect false pull_request docs/product/set.md
expect false pull_request docs/specs/05-data-model.md docs/product/README.md
# a directory named docs below the root is not the docs tree
expect false pull_request apps/mobile/docs/x.md

# push to main (or any non-PR event) always runs everything
expect false push docs/specs/05-data-model.md
expect false workflow_dispatch AGENTS.md

# an empty change list is never treated as docs-only
got="$(printf '' | "${CLASSIFY}" --event pull_request)"
[[ "${got}" == "false" ]] || fail "expected false for an empty path list — got ${got}"

# a missing --event is a usage error, not a silent classification
if printf 'AGENTS.md\n' | "${CLASSIFY}" >/dev/null 2>&1; then
  fail "expected a non-zero exit without --event"
fi

echo "  ci-docs-only: all assertions passed"
