#!/usr/bin/env bash

# Integration test — drift checker passes on the as-built schema
# (positive case).
#
# Standalone positive-case test for the slow gate. Lives separately from
# sync-v2-drift-synthetic.sh so the orchestration wrapper can run the
# positive case even if a future refactor splits the synthetic test out.
# Both scripts ultimately invoke the same `npm run check:sync-drift --
# --strict` command and both must pass for the drift gate to hold.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SUPABASE_DIR}/.." && pwd)"
MOBILE_DIR="${REPO_ROOT}/apps/mobile"

fail() { echo "[sync-v2-drift-asbuilt] FAIL: $*" >&2; exit 1; }
pass() { echo "[sync-v2-drift-asbuilt] pass: $*"; }

[[ -f "${MOBILE_DIR}/package.json" ]] || fail "apps/mobile/package.json not found at ${MOBILE_DIR}/package.json"

OUTPUT_FILE="$(mktemp)"
set +e
(cd "${MOBILE_DIR}" && npm run check:sync-drift -- --strict) >"${OUTPUT_FILE}" 2>&1
RC=$?
set -e
echo "[sync-v2-drift-asbuilt] check:sync-drift rc=${RC}; tail of output:"
tail -n 20 "${OUTPUT_FILE}" || true

if [[ "${RC}" != "0" ]]; then
  echo "[sync-v2-drift-asbuilt] full output:" >&2
  cat "${OUTPUT_FILE}" >&2
  fail "drift checker exited rc=${RC} on as-built tree; expected 0"
fi
rm -f "${OUTPUT_FILE}"
pass "drift positive — drift checker exits 0 on the as-built schema"
