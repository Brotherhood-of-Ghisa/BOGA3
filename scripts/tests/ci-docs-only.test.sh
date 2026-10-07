#!/usr/bin/env bash

# Tests for scripts/ci-docs-only.sh (CI's docs-only fast-path classifier).
# Infra-free: explicit path lists on stdin, run inside a throwaway git
# repository whose docs/product/ files the classifier reads.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CLASSIFY="${REPO_ROOT}/scripts/ci-docs-only.sh"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }

FIXTURE="$(mktemp -d)"
trap 'rm -rf "${FIXTURE}"' EXIT

# The base commit: two fact files with tables, one without, and the format
# doc, which shows the marker with a placeholder id (not a marker).
mkdir -p "${FIXTURE}/docs/product"
(
  cd "${FIXTURE}"
  git init -q
  printf '# Set\n\n<!-- fact-table: set.eligibility -->\n\n| a |\n' > docs/product/set.md
  printf '# 1RM\n\n<!-- fact-table: 1rm.formula -->\n\n| a |\n' > docs/product/1rm.md
  printf '# Copy\n\nNo tables.\n' > docs/product/copy.md
  printf '# Muscle\n\nNo tables.\n' > docs/product/muscle.md
  printf 'Tables carry `<!-- fact-table: <id> -->` above them.\n' > docs/product/README.md
  git add -A
  git -c user.name=t -c user.email=t@t commit -qm base
  # The change under test: 1rm.md loses its marker, copy.md gains one,
  # muscle.md is deleted, and set.md and README.md are edited in prose.
  printf '# 1RM\n\nTable removed.\n' > docs/product/1rm.md
  printf '# Copy\n\n<!-- fact-table: copy.x -->\n' > docs/product/copy.md
  rm docs/product/muscle.md
  printf 'More prose.\n' >> docs/product/set.md
  printf 'More prose.\n' >> docs/product/README.md
)

# classify <event> [extra args...] -- <paths...>: run in the fixture.
classify() {
  local args=()
  while [[ "$1" != "--" ]]; do args+=("$1"); shift; done
  shift
  (cd "${FIXTURE}" && printf '%s\n' "$@" | "${CLASSIFY}" "${args[@]}")
}

# expect <true|false> <event> <paths...>: paths are piped one per line.
expect() {
  local want="$1" event="$2"; shift 2
  local got
  got="$(classify --event "${event}" -- "$@")"
  [[ "${got}" == "${want}" ]] \
    || fail "expected ${want} for event=${event} paths=[$*] — got ${got}"
}

# expect_base <true|false> <paths...>: a pull_request diffed against the
# fixture's base commit, as CI passes `--base HEAD^1`.
expect_base() {
  local want="$1"; shift
  local got
  got="$(classify --event pull_request --base HEAD -- "$@")"
  [[ "${got}" == "${want}" ]] \
    || fail "expected ${want} with --base for paths=[$*] — got ${got}"
}

# docs tree and root-level markdown → fast path
expect true  pull_request docs/specs/05-data-model.md
expect true  pull_request docs/specs/ui/reference.png
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
# Jest runs the product fact tables: a docs/product/ file with one is code
expect false pull_request docs/product/set.md
expect false pull_request docs/specs/05-data-model.md docs/product/set.md
expect_base false docs/product/set.md
# …a file gaining a table is code…
expect false pull_request docs/product/copy.md
expect_base false docs/product/copy.md
# …and so is one losing it, which only its base version shows
expect true pull_request docs/product/1rm.md
expect_base false docs/product/1rm.md
# a deleted product file is code unless its base version had no table
expect false pull_request docs/product/muscle.md
expect_base true docs/product/muscle.md
# a path in neither the tree nor the base is never assumed docs-only
expect_base false docs/product/never-existed.md
# product files without a table stay on the fast path; the format doc's
# placeholder `<id>` is not a marker
expect true pull_request docs/product/README.md
expect true pull_request docs/specs/05-data-model.md docs/product/README.md
expect_base true docs/product/README.md AGENTS.md
# a directory named docs below the root is not the docs tree
expect false pull_request apps/mobile/docs/x.md

# push to main (or any non-PR event) always runs everything
expect false push docs/specs/05-data-model.md
expect false workflow_dispatch AGENTS.md

# an empty change list is never treated as docs-only
got="$(cd "${FIXTURE}" && printf '' | "${CLASSIFY}" --event pull_request)"
[[ "${got}" == "false" ]] || fail "expected false for an empty path list — got ${got}"

# a missing --event is a usage error, not a silent classification
if printf 'AGENTS.md\n' | "${CLASSIFY}" >/dev/null 2>&1; then
  fail "expected a non-zero exit without --event"
fi

echo "  ci-docs-only: all assertions passed"
