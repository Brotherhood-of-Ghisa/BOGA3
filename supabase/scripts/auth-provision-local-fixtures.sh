#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/auth-fixture-constants.sh"

echo "[supabase] provisioning local auth fixtures (controlled users only)"
"${SCRIPT_DIR}/auth-provision-user.sh" \
  --email "${USER_A_EMAIL}" \
  --password "${USER_A_PASSWORD}" \
  --fixture-key "${USER_A_FIXTURE_KEY}" \
  --email-confirm true

"${SCRIPT_DIR}/auth-provision-user.sh" \
  --email "${USER_B_EMAIL}" \
  --password "${USER_B_PASSWORD}" \
  --fixture-key "${USER_B_FIXTURE_KEY}" \
  --email-confirm true

"${SCRIPT_DIR}/auth-provision-user.sh" \
  --email "${USER_C_EMAIL}" \
  --password "${USER_C_PASSWORD}" \
  --email-confirm true

"${SCRIPT_DIR}/auth-provision-user.sh" \
  --email "${USER_D_EMAIL}" \
  --password "${USER_D_PASSWORD}" \
  --email-confirm true

"${SCRIPT_DIR}/auth-provision-user.sh" \
  --email "${USER_E_EMAIL}" \
  --password "${USER_E_PASSWORD}" \
  --email-confirm true

echo "[supabase] local auth fixture provisioning complete"

