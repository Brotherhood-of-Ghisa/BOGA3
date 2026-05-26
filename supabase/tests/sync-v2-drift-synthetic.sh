#!/usr/bin/env bash

# tFINAL integration test — Drift checker rejects synthetic drift
# (plan outcome #9 negative case).
#
# The drift checker (apps/mobile/scripts/check-sync-schema-drift.ts) must
# detect a client schema change with no paired server migration and exit
# non-zero in --strict mode with a useful failure message.
#
# This script:
#   1. Saves the current content of
#      apps/mobile/src/data/schema/exercise-sets.ts to a temp file.
#   2. Programmatically appends a `notes: text('notes')` column to the
#      schema definition.
#   3. Runs `npm run check:sync-drift -- --strict` against the modified tree.
#   4. Asserts the exit code is non-zero AND the failure output contains:
#        - the literal string `exercise_sets`
#        - the literal string `notes`
#        - the fix-flow template
#          `alter table app_public.exercise_sets add column notes`
#      (per t1 §7.4).
#   5. Restores the original schema file (idempotent — re-runs leave the
#      working tree clean).
#
# HERMETIC: an `EXIT` trap restores the file unconditionally so a test
# failure between steps 2 and 5 still leaves the working tree unchanged.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SUPABASE_DIR}/.." && pwd)"
MOBILE_DIR="${REPO_ROOT}/apps/mobile"
SCHEMA_FILE="${MOBILE_DIR}/src/data/schema/exercise-sets.ts"

fail() { echo "[sync-v2-drift-synthetic] FAIL: $*" >&2; exit 1; }
pass() { echo "[sync-v2-drift-synthetic] pass: $*"; }

[[ -f "${SCHEMA_FILE}" ]] || fail "schema file not found at ${SCHEMA_FILE}"
[[ -f "${MOBILE_DIR}/package.json" ]] || fail "apps/mobile/package.json not found at ${MOBILE_DIR}/package.json"

# Snapshot the original schema file so we can restore on exit.
ORIGINAL_BACKUP="$(mktemp)"
cp "${SCHEMA_FILE}" "${ORIGINAL_BACKUP}"
HERMETIC_RESTORED=0
restore_schema_file() {
  if [[ "${HERMETIC_RESTORED}" == "1" ]]; then
    return 0
  fi
  if [[ -f "${ORIGINAL_BACKUP}" ]]; then
    cp "${ORIGINAL_BACKUP}" "${SCHEMA_FILE}"
    rm -f "${ORIGINAL_BACKUP}"
  fi
  HERMETIC_RESTORED=1
}
trap restore_schema_file EXIT

# Append a `notes` text column to the schema definition. The original file
# defines the columns inside `sqliteTable('exercise_sets', { ... })`. We
# insert the new column right before the `createdAt:` declaration to keep
# the file syntactically valid.
#
# Use a Python one-liner for the in-place edit — sed's portability story
# across BSD/GNU is too painful for a literal text injection into a TS file.
python3 - <<'PY'
import sys
from pathlib import Path

schema_path = Path("apps/mobile/src/data/schema/exercise-sets.ts")
src = schema_path.read_text()
needle = "    createdAt: integer('created_at', { mode: 'timestamp_ms' })"
if needle not in src:
    sys.stderr.write("[sync-v2-drift-synthetic] could not locate createdAt anchor in exercise-sets.ts; expected literal: " + repr(needle) + "\n")
    sys.exit(2)
# Insert the drift column right before createdAt.
inject = "    notes: text('notes'),\n"
src = src.replace(needle, inject + needle, 1)
schema_path.write_text(src)
PY
cd "${REPO_ROOT}"

# Run the drift checker in --strict mode. Capture stdout+stderr to a file so
# we can grep without losing the exit code.
OUTPUT_FILE="$(mktemp)"
set +e
(cd "${MOBILE_DIR}" && npm run check:sync-drift -- --strict) >"${OUTPUT_FILE}" 2>&1
DRIFT_RC=$?
set -e

# Restore the schema file BEFORE asserting — keeps the working tree clean
# even if assertions below fail.
restore_schema_file

# Show a short tail of the output so a failing assertion is debuggable.
echo "[sync-v2-drift-synthetic] drift checker rc=${DRIFT_RC}; tail of output:"
tail -n 40 "${OUTPUT_FILE}" || true

if [[ "${DRIFT_RC}" == "0" ]]; then
  fail "drift checker exited 0; expected non-zero (a client column with no server counterpart should fail --strict)"
fi
pass "outcome #9 negative — drift checker exited non-zero (rc=${DRIFT_RC}) on synthetic drift"

# Assert the failure output mentions the table, the new column, and the
# fix-flow template snippet.
if ! grep -q "exercise_sets" "${OUTPUT_FILE}"; then
  fail "drift checker output missing literal 'exercise_sets'"
fi
if ! grep -q "notes" "${OUTPUT_FILE}"; then
  fail "drift checker output missing literal 'notes'"
fi
if ! grep -q "alter table app_public.exercise_sets" "${OUTPUT_FILE}"; then
  fail "drift checker output missing fix-flow template 'alter table app_public.exercise_sets'"
fi
# The full fix-flow line per t1 §7.4 reads
#   alter table app_public.exercise_sets
#     add column notes
# which our `add column notes` substring catches even if the checker line-
# wraps the SQL across two lines.
if ! grep -q "add column notes" "${OUTPUT_FILE}"; then
  fail "drift checker output missing 'add column notes' fix-flow snippet"
fi
pass "outcome #9 negative — output cites exercise_sets, notes, and the 'alter table app_public.exercise_sets … add column notes' fix template"

# Hermetic sanity — the working tree should be unchanged after this script.
# Use git diff against the SCHEMA_FILE; an exit-0 means no diff.
if ! (cd "${REPO_ROOT}" && git diff --quiet -- "${SCHEMA_FILE}"); then
  fail "schema file ${SCHEMA_FILE} not restored to original after drift run (working tree is DIRTY)"
fi
pass "outcome #9 — hermetic: schema file restored, git diff is clean"

rm -f "${OUTPUT_FILE}"

# ---------------------------------------------------------------------------
# Positive case (plan outcome #9 positive — folded into this script per the
# task card's "or fold into the synthetic script" allowance).
#
# After restoring, the drift checker against the unmodified tree must exit 0
# in --strict mode.
# ---------------------------------------------------------------------------
echo "[sync-v2-drift-synthetic] positive case — drift checker on unmodified tree"
POS_OUTPUT_FILE="$(mktemp)"
set +e
(cd "${MOBILE_DIR}" && npm run check:sync-drift -- --strict) >"${POS_OUTPUT_FILE}" 2>&1
POS_RC=$?
set -e
echo "[sync-v2-drift-synthetic] positive-case rc=${POS_RC}; tail of output:"
tail -n 20 "${POS_OUTPUT_FILE}" || true
if [[ "${POS_RC}" != "0" ]]; then
  fail "drift checker on the unmodified tree exited rc=${POS_RC}; expected 0 (as-built schema must pass)"
fi
rm -f "${POS_OUTPUT_FILE}"
pass "outcome #9 positive — drift checker exits 0 on the as-built tree"

echo "[sync-v2-drift-synthetic] all assertions passed"
