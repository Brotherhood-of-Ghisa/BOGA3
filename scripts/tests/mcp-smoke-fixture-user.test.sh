#!/usr/bin/env bash

# mcp-smoke-fixture-user.test.sh — enforces that the MCP smoke
# (scripts/smoke-boga-mcp.sh) owns its auth fixture user. The smoke asserts
# account-wide state (no active workout before it starts one, agent-plan and
# audit counts), and the backend gate runs it after the sync and contract suites
# on one local Supabase without a reset. Those suites sign in as user_a and may
# leave rows behind (an active session, for one), so a shared user lets their
# residue fail the smoke depending on lane order.
#
# Rules checked:
#   1. the smoke signs in as USER_G only (no other USER_*_EMAIL/PASSWORD);
#   2. USER_G is defined in auth-fixture-constants.sh and provisioned by
#      auth-provision-local-fixtures.sh;
#   3. no other test, suite, flow or script references USER_G or its email.
#
# Infra-free: greps files only. Part of the `meta-tests` lane (and CI).
# Self-tests the rule on synthetic trees first, then checks the real repo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }

SMOKE_REL="scripts/smoke-boga-mcp.sh"
CONSTANTS_REL="supabase/scripts/auth-fixture-constants.sh"
PROVISION_REL="supabase/scripts/auth-provision-local-fixtures.sh"
THIS_REL="scripts/tests/mcp-smoke-fixture-user.test.sh"
# Where another flow could sign in as a fixture user.
SEARCH_DIRS=(scripts supabase/scripts supabase/tests apps/mobile/__tests__
  apps/mobile/.maestro apps/mobile/scripts services apps/agent-auth-web)

# check_tree <root>: exits non-zero on the first violation. Run it in a subshell.
check_tree() {
  local root="$1" smoke="$1/${SMOKE_REL}" constants="$1/${CONSTANTS_REL}" email users
  [[ -f "${smoke}" ]] || fail "smoke script not found: ${smoke}"

  users="$(grep -oE 'USER_[A-Z0-9]+_(EMAIL|PASSWORD|FIXTURE_KEY)' "${smoke}" | sort -u | tr '\n' ' ')"
  [[ "${users}" == "USER_G_EMAIL USER_G_PASSWORD " ]] \
    || fail "${SMOKE_REL} must sign in as USER_G only (found: ${users:-none})"

  email="$(sed -nE 's/^export USER_G_EMAIL="([^"]+)"$/\1/p' "${constants}")"
  [[ -n "${email}" ]] || fail "USER_G_EMAIL is not defined in ${CONSTANTS_REL}"
  # Provisioned by name, or by the `for fixture in E F G` loop over USER_<X>_*.
  grep -q 'USER_G_EMAIL' "${root}/${PROVISION_REL}" \
    || grep -qE '^for fixture in( [A-Z])* G( [A-Z])*; do$' "${root}/${PROVISION_REL}" \
    || fail "${PROVISION_REL} does not provision USER_G"

  local dir others=""
  for dir in "${SEARCH_DIRS[@]}"; do
    [[ -d "${root}/${dir}" ]] || continue
    others+="$(grep -rlE "USER_G_|${email//./\\.}" --exclude-dir=node_modules "${root}/${dir}" 2>/dev/null || true)"$'\n'
  done
  others="$(printf '%s\n' "${others}" | grep . | sed "s#^${root}/##" \
    | grep -vxF -e "${SMOKE_REL}" -e "${CONSTANTS_REL}" -e "${PROVISION_REL}" -e "${THIS_REL}" | sort -u || true)"
  [[ -z "${others}" ]] \
    || fail "USER_G is dedicated to ${SMOKE_REL}; also used by: ${others//$'\n'/ } — add a new fixture in ${CONSTANTS_REL}"
  echo "  mcp-smoke-fixture-user: ${SMOKE_REL} is the only user of ${email}"
}

# --- self-tests on synthetic trees ---------------------------------------------

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

# make_tree <dir> <smoke-body>: constants define USER_A and USER_G; the
# provisioner loops over G.
make_tree() {
  mkdir -p "$1/scripts" "$1/supabase/scripts" "$1/supabase/tests"
  printf 'export USER_A_EMAIL="a@x.test"\nexport USER_G_EMAIL="g@x.test"\n' >"$1/${CONSTANTS_REL}"
  printf 'for fixture in E F G; do\n  email_var="USER_${fixture}_EMAIL"\ndone\n' >"$1/${PROVISION_REL}"
  printf '%s\n' "$2" >"$1/${SMOKE_REL}"
}

expect_check() {
  local expected="$1" label="$2" dir="$3" out
  if out="$( (check_tree "${dir}") 2>&1 )"; then
    [[ "${expected}" == pass ]] || fail "self-test '${label}': expected a violation, got: ${out}"
  else
    [[ "${expected}" == fail ]] || fail "self-test '${label}': expected a pass, got: ${out}"
  fi
  echo "  self-test ok (${expected}): ${label}"
}

SMOKE_OK='EMAIL="${USER_G_EMAIL}" PASSWORD="${USER_G_PASSWORD}"'

make_tree "${TMP}/ok" "${SMOKE_OK}"
printf 'sign_in "${USER_A_EMAIL}"\n' >"${TMP}/ok/supabase/tests/other.sh"
expect_check pass "smoke owns USER_G, others use USER_A" "${TMP}/ok"

make_tree "${TMP}/shared-user" "${SMOKE_OK} KEY=\"\${USER_A_FIXTURE_KEY}\""
expect_check fail "smoke also uses USER_A" "${TMP}/shared-user"

make_tree "${TMP}/reused-var" "${SMOKE_OK}"
printf 'sign_in "${USER_G_EMAIL}"\n' >"${TMP}/reused-var/supabase/tests/other.sh"
expect_check fail "another suite signs in as USER_G" "${TMP}/reused-var"

make_tree "${TMP}/reused-email" "${SMOKE_OK}"
printf "const creds = { email: 'g@x.test' };\n" >"${TMP}/reused-email/supabase/tests/other.ts"
expect_check fail "another suite hardcodes USER_G's email" "${TMP}/reused-email"

make_tree "${TMP}/unprovisioned" "${SMOKE_OK}"
printf 'for fixture in E F; do\n  :\ndone\n' >"${TMP}/unprovisioned/${PROVISION_REL}"
expect_check fail "USER_G is never provisioned" "${TMP}/unprovisioned"

# --- the real repo ---------------------------------------------------------------

check_tree "${REPO_ROOT}"
