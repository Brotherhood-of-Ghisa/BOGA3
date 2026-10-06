#!/usr/bin/env bash

# ci-docs-only.sh — classify a change for CI's docs-only fast path.
#
# Usage: <changed paths, one per line> | scripts/ci-docs-only.sh --event <name>
#
# Prints `true` when the GitHub event is `pull_request` and every changed path
# is under `docs/` or is a root-level `*.md` (AGENTS.md, RUNBOOK.md, …);
# otherwise `false`. `docs/product/` is not docs-only: Jest runs its fact
# tables (apps/mobile/__tests__/product-fact-tables.test.ts). Any other event (push to main), an empty path list, or a
# single path outside those two places means `false`: CI then runs every step.
# Feed it `git diff --name-only --no-renames` so a rename out of `docs/` also
# lists its non-docs side. Tested by scripts/tests/ci-docs-only.test.sh.

set -euo pipefail

event=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --event) event="${2:-}"; shift 2 ;;
    *) echo "ci-docs-only: unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "${event}" ]] || { echo "ci-docs-only: --event is required" >&2; exit 2; }

if [[ "${event}" != "pull_request" ]]; then
  echo false
  exit 0
fi

seen=0
while IFS= read -r path || [[ -n "${path}" ]]; do
  [[ -n "${path}" ]] || continue
  seen=1
  case "${path}" in
    docs/product/*) echo false; exit 0 ;;
    docs/*) ;;
    */*) echo false; exit 0 ;;
    *.md) ;;
    *) echo false; exit 0 ;;
  esac
done

if [[ "${seen}" == "1" ]]; then echo true; else echo false; fi
