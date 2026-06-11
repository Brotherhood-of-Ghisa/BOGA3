#!/usr/bin/env bash

# Legacy forwarder — the gates live in ./boga now (lanes: scripts/lanes.tsv).
#   ./scripts/quality-fast.sh            -> ./boga test fast
#   ./scripts/quality-fast.sh frontend   -> ./boga test fast-frontend
#   ./scripts/quality-fast.sh backend    -> ./boga test fast-backend

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

area="${1:-all}"
case "${area}" in
  all)        target="fast" ;;
  frontend)   target="fast-frontend" ;;
  backend)    target="fast-backend" ;;
  --help|-h)  exec "${REPO_ROOT}/boga" help ;;
  *) echo "[quality-fast] unknown area: ${area} (frontend|backend)" >&2; exit 2 ;;
esac

echo "[quality-fast] forwarding to: ./boga test ${target}"
exec "${REPO_ROOT}/boga" test "${target}"
