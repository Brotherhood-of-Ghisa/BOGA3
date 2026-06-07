#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck disable=SC1091
source "${REPO_ROOT}/scripts/worktree-lib.sh"
boga_validate_runtime_worktree "${REPO_ROOT}" || exit 1

usage() {
  cat <<'EOF'
Usage:
  ./scripts/quality-fast.sh [frontend|backend]

Runs local fast quality gates.
- no args: runs all available fast gates (frontend + backend)
- frontend: runs apps/mobile lint + typecheck + test
- backend: runs supabase local fast smoke suite
EOF
}

area="${1:-all}"

if [[ "${area}" == "--help" || "${area}" == "-h" ]]; then
  usage
  exit 0
fi

run_frontend() {
  if [[ ! -f "${REPO_ROOT}/apps/mobile/package.json" ]]; then
    echo "[quality-fast] skipping frontend: apps/mobile/package.json not found"
    return 0
  fi

  if [[ ! -d "${REPO_ROOT}/apps/mobile/node_modules" ]]; then
    echo "[quality-fast] frontend: dependencies missing; running worktree setup (idempotent)"
    "${REPO_ROOT}/scripts/worktree-setup.sh"
  fi

  echo "[quality-fast] frontend: lint"
  (cd "${REPO_ROOT}/apps/mobile" && npm run lint)

  echo "[quality-fast] frontend: typecheck"
  (cd "${REPO_ROOT}/apps/mobile" && npm run typecheck)

  echo "[quality-fast] frontend: test"
  (cd "${REPO_ROOT}/apps/mobile" && npm run test)
}

run_backend() {
  if [[ ! -x "${REPO_ROOT}/supabase/scripts/test-fast.sh" ]]; then
    echo "[quality-fast] skipping backend: supabase/scripts/test-fast.sh not found or not executable"
    return 0
  fi

  echo "[quality-fast] backend: test-fast"
  "${REPO_ROOT}/supabase/scripts/test-fast.sh"
}

case "${area}" in
  all)
    run_frontend
    run_backend
    ;;
  frontend)
    run_frontend
    ;;
  backend)
    run_backend
    ;;
  *)
    echo "[quality-fast] unknown area: ${area}" >&2
    usage >&2
    exit 2
    ;;
esac

echo "[quality-fast] done (${area})"
