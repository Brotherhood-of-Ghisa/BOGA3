#!/usr/bin/env bash

# supabase-exit-trap-guard.test.sh — enforces the completion sentinel on the
# backend lane bodies. macOS's system bash 3.2 hands an EXIT trap `$? = 0`
# after a `set -u` (unbound variable) abort, so a body with an EXIT trap exits
# 0 for a run that stopped midway and run-suite.sh prints "passed". Every body
# in supabase/tests/ that installs an EXIT trap must therefore:
#   - set `COMPLETED=0` before installing the trap,
#   - force a non-zero status in the trap when `COMPLETED` is not 1,
#   - set `COMPLETED=1` on the line just before its final line.
#
# Infra-free: first proves the guard fails an unbound-variable abort under the
# bash on PATH (with a synthetic body), then checks the real bodies statically.
# Part of the `meta-tests` lane (and CI).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TESTS_DIR="${REPO_ROOT}/supabase/tests"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

# --- behaviour: the guard turns an abort into a failure --------------------------

cat >"${TMP}/guarded.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
unset UNSET_BY_DESIGN
COMPLETED=0
cleanup_on_exit() {
  local status=$?
  trap - EXIT
  if [[ ${status} -eq 0 && ${COMPLETED} -ne 1 ]]; then
    status=1
  fi
  exit "${status}"
}
trap cleanup_on_exit EXIT
# An unset name aborts under set -u on every bash (bash >= 4.4 no longer treats
# an empty "${a[@]}" as unbound, so that trigger only fires on 3.2).
f() { echo "${UNSET_BY_DESIGN}"; }
[[ "${1:-}" == "abort" ]] && f
COMPLETED=1
echo "passed"
EOF
chmod +x "${TMP}/guarded.sh"

if "${TMP}/guarded.sh" abort >/dev/null 2>&1; then
  fail "guarded body exited 0 after an unbound-variable abort"
fi
"${TMP}/guarded.sh" >/dev/null 2>&1 || fail "guarded body failed a run that completed"
echo "  self-test ok: guard fails an aborted run and passes a completed one"

# --- the real bodies -------------------------------------------------------------

checked=0
for body in "${TESTS_DIR}"/*.sh; do
  name="$(basename "${body}")"
  grep -qE '^[[:space:]]*trap [^-].* EXIT' "${body}" || continue
  checked=$((checked + 1))
  grep -qE '^COMPLETED=0$' "${body}" || fail "${name}: EXIT trap without a 'COMPLETED=0' sentinel"
  grep -qF '${COMPLETED} -ne 1' "${body}" || fail "${name}: EXIT trap does not fail a run with COMPLETED != 1"
  penultimate="$(grep -v '^[[:space:]]*$' "${body}" | tail -2 | head -1)"
  [[ "${penultimate}" == "COMPLETED=1" ]] ||
    fail "${name}: 'COMPLETED=1' must sit just before the final line (found '${penultimate}')"
done
[[ ${checked} -gt 0 ]] || fail "found no bodies with an EXIT trap in ${TESTS_DIR}"
echo "  ok: ${checked} bodies with an EXIT trap carry the completion sentinel"
