#!/usr/bin/env bash

# ci-docs-only.sh — classify a change for CI's docs-only fast path.
#
# Usage: <changed paths, one per line> |
#          scripts/ci-docs-only.sh --event <name> [--base <git ref>]
#
# Prints `true` when the GitHub event is `pull_request` and every changed path
# is under `docs/` or is a root-level `*.md` (AGENTS.md, RUNBOOK.md, …);
# otherwise `false`. A `docs/product/` file carrying a
# `<!-- fact-table: <id> -->` marker is code: Jest runs its tables
# (apps/mobile/__tests__/product-fact-tables.test.ts). The marker is looked
# for in the working-tree file and, with `--base`, in its base version, so
# adding, editing, removing or deleting a fact table all count. A
# `docs/product/` path found in neither place also counts as code. Paths are
# read relative to the current directory (CI: the repository root). Any other
# event (push to main), an empty path list, or a single path outside those two
# places means `false`: CI then runs every step. Feed it
# `git diff --name-only --no-renames` so a rename out of `docs/` also lists its
# non-docs side. Tested by scripts/tests/ci-docs-only.test.sh.

set -euo pipefail

event=""
base=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --event) event="${2:-}"; shift 2 ;;
    --base) base="${2:-}"; shift 2 ;;
    *) echo "ci-docs-only: unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "${event}" ]] || { echo "ci-docs-only: --event is required" >&2; exit 2; }

FACT_TABLE_MARKER='<!-- fact-table: [^[:space:]<>]+ -->'

# has_fact_table <path>: true when the file, as it is now or at --base,
# carries a fact-table marker, or exists in neither place.
has_fact_table() {
  local path="$1" found=0
  if [[ -f "${path}" ]]; then
    found=1
    grep -Eq -- "${FACT_TABLE_MARKER}" "${path}" && return 0
  fi
  if [[ -n "${base}" ]] && git cat-file -e "${base}:${path}" 2>/dev/null; then
    found=1
    # Read whole, not piped: grep -q exiting early would SIGPIPE git show
    # and pipefail would turn the match into a failure.
    grep -Eq -- "${FACT_TABLE_MARKER}" <<<"$(git show "${base}:${path}")" && return 0
  fi
  [[ "${found}" == "0" ]]
}

if [[ "${event}" != "pull_request" ]]; then
  echo false
  exit 0
fi

seen=0
while IFS= read -r path || [[ -n "${path}" ]]; do
  [[ -n "${path}" ]] || continue
  seen=1
  case "${path}" in
    docs/product/*)
      if has_fact_table "${path}"; then echo false; exit 0; fi ;;
    docs/*) ;;
    */*) echo false; exit 0 ;;
    *.md) ;;
    *) echo false; exit 0 ;;
  esac
done

if [[ "${seen}" == "1" ]]; then echo true; else echo false; fi
