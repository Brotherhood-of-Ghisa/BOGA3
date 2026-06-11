#!/usr/bin/env bash

# Legacy forwarder — the gates live in ./boga now (lanes: scripts/lanes.tsv).
#   ./scripts/quality-slow.sh            -> ./boga test slow
#   ./scripts/quality-slow.sh frontend   -> ./boga test frontend
#   ./scripts/quality-slow.sh backend    -> ./boga test backend

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

area="${1:-all}"
case "${area}" in
  all)        target="slow" ;;
  frontend)   target="frontend" ;;
  backend)    target="backend" ;;
  --help|-h)  exec "${REPO_ROOT}/boga" help ;;
  *) echo "[quality-slow] unknown area: ${area} (frontend|backend)" >&2; exit 2 ;;
esac

echo "[quality-slow] forwarding to: ./boga test ${target}"
exec "${REPO_ROOT}/boga" test "${target}"
