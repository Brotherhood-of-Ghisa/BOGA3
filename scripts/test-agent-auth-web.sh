#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${REPO_ROOT}/apps/agent-auth-web"

echo "[agent-auth-web] installing locked dependencies"
(cd "${APP_DIR}" && npm ci)

echo "[agent-auth-web] auditing production dependencies"
(cd "${APP_DIR}" && npm audit --omit=dev)

echo "[agent-auth-web] running tests and production build"
(cd "${APP_DIR}" && npm test && npm run build)

echo "[agent-auth-web] PASS"
