#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVICE_DIR="${REPO_ROOT}/services/boga-mcp"

echo "[boga-mcp] installing locked dependencies"
(cd "${SERVICE_DIR}" && npm ci)

echo "[boga-mcp] auditing production dependencies"
(cd "${SERVICE_DIR}" && npm audit --omit=dev)

echo "[boga-mcp] running typecheck, unit tests, and production build"
(cd "${SERVICE_DIR}" && npm run lint && npm test && npm run build)

echo "[boga-mcp] PASS"
