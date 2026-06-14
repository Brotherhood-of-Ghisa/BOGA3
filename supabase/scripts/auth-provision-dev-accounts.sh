#!/usr/bin/env bash

# Provision the human development sign-in accounts (a@dev.local / b@dev.local).
#
# These are intentionally SEPARATE from the integration-test fixtures
# (user_a / user_b) — see dev-account-constants.sh. We reuse
# auth-provision-user.sh but pass NO --fixture-key, so these are plain
# auth.users rows and are never linked into public.dev_fixture_principals.
#
# Idempotent: creates each account if missing, or resets its password if it
# already exists. `supabase db reset` (and a fresh local stack) wipes
# auth.users, so re-run this after a reset.
#
# Target database:
#   - Local (default): start local Supabase first; this script auto-loads the
#     local admin env from `supabase status`.
#   - Hosted: export SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (the legacy JWT
#     service_role key, NOT an sb_publishable_.../sb_secret_... key) before
#     running, e.g.  `set -a; source supabase/.env.hosted; set +a`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/dev-account-constants.sh"

echo "[supabase] provisioning human development accounts (separate from test fixtures)"

"${SCRIPT_DIR}/auth-provision-user.sh" \
  --email "${DEV_ACCOUNT_A_EMAIL}" \
  --password "${DEV_ACCOUNT_A_PASSWORD}" \
  --email-confirm true

"${SCRIPT_DIR}/auth-provision-user.sh" \
  --email "${DEV_ACCOUNT_B_EMAIL}" \
  --password "${DEV_ACCOUNT_B_PASSWORD}" \
  --email-confirm true

echo "[supabase] development accounts ready (sign in through the app):"
echo "  - ${DEV_ACCOUNT_A_EMAIL} / ${DEV_ACCOUNT_A_PASSWORD}"
echo "  - ${DEV_ACCOUNT_B_EMAIL} / ${DEV_ACCOUNT_B_PASSWORD}"
