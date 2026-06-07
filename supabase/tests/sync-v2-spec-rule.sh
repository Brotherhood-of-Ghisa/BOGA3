#!/usr/bin/env bash

# Integration test — client-schema-drift rule present in the data-model spec.
#
# Greps docs/specs/05-data-model.md for:
#   - The literal heading `## Client schema drift rule (Sync v2)`
#   - The exact sentence about the server migration being deployed first
#     before the client change ships (the server-first deploy rule, server
#     contract §A.8)
#
# Exits non-zero if either is missing. This is intentionally a one-shot
# grep — the rule wording is contractual and must not drift; any rephrasing
# should be a deliberate co-edit of the spec and this assertion.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SUPABASE_DIR}/.." && pwd)"
SPEC_FILE="${REPO_ROOT}/docs/specs/05-data-model.md"

fail() { echo "[sync-v2-spec-rule] FAIL: $*" >&2; exit 1; }
pass() { echo "[sync-v2-spec-rule] pass: $*"; }

[[ -f "${SPEC_FILE}" ]] || fail "spec file not found at ${SPEC_FILE}"

# Assertion A: literal heading.
if ! grep -qxF "## Client schema drift rule (Sync v2)" "${SPEC_FILE}"; then
  fail "spec is missing the literal heading '## Client schema drift rule (Sync v2)'"
fi
pass "spec rule — heading '## Client schema drift rule (Sync v2)' present"

# Assertion B: the server-first deploy sentence (server contract §A.8).
#
# The exact wording in the as-merged spec is:
#   "and the server migration must be deployed to production before the
#    client change ships"
# Markdown soft-wraps the line at ~80 chars so the literal sentence spans
# two physical lines. We collapse newlines to spaces before grepping so the
# assertion is robust to line-wrap variation while still catching any
# rewording of the actual phrase.
NORMALISED="$(tr '\n' ' ' < "${SPEC_FILE}" | tr -s ' ')"
if ! printf '%s' "${NORMALISED}" | grep -qF "the server migration must be deployed to production before the client change ships"; then
  fail "spec is missing the server-first deploy sentence ('the server migration must be deployed to production before the client change ships')"
fi
pass "spec rule — server-first deploy sentence present verbatim (whitespace-normalised match)"

echo "[sync-v2-spec-rule] all assertions passed"
