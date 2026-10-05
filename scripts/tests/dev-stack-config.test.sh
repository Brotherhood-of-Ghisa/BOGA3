#!/usr/bin/env bash

# Tests for the dev stack's generated config (supabase/scripts/dev-stack-lib.sh,
# generate_dev_supabase_config). Infra-free: a temp repo with the real template
# and functions; no Docker.
#
# Proves: every [functions.<name>] gets an entrypoint through the real
# supabase/ dir (so the functions' relative imports of apps/mobile resolve to
# paths the Edge runtime mounts), and a config rendered by an older generator
# is regenerated.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck disable=SC1091
source "${SOURCE_ROOT}/scripts/worktree-lib.sh"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
REPO_ROOT="${TMP}/repo"
SUPABASE_DIR="${REPO_ROOT}/supabase"
mkdir -p "${SUPABASE_DIR}"
cp "${SOURCE_ROOT}/supabase/config.toml.template" "${SUPABASE_DIR}/"
ln -s "${SOURCE_ROOT}/supabase/functions" "${SUPABASE_DIR}/functions"
mkdir -p "${SUPABASE_DIR}/migrations" && touch "${SUPABASE_DIR}/seed.sql"

# shellcheck disable=SC1091
source "${SOURCE_ROOT}/supabase/scripts/dev-stack-lib.sh"
generate_dev_supabase_config
config="${BOGA_DEV_WORKDIR}/supabase/config.toml"
[[ -f "${config}" ]] || fail "no config rendered at ${config}"

functions="$(sed -n 's/^\[functions\.\([A-Za-z0-9_-]*\)\]$/\1/p' "${SUPABASE_DIR}/config.toml.template")"
[[ -n "${functions}" ]] || fail "the template declares no [functions.*] sections"
for name in ${functions}; do
  entry="$(awk -v section="[functions.${name}]" '
    $0 == section { getline; print; exit }' "${config}")"
  want="entrypoint = \"../../supabase/functions/${name}/index.ts\""
  [[ "${entry}" == "${want}" ]] || fail "${name}: expected '${want}' after its section, got '${entry}'"
  # Resolved from the dev workdir's supabase/, the entrypoint is the real file.
  resolved="${BOGA_DEV_WORKDIR}/supabase/../../supabase/functions/${name}/index.ts"
  [[ -f "${resolved}" ]] || fail "${name}: entrypoint does not resolve to a file (${resolved})"
  [[ "$(cd "$(dirname "${resolved}")" && pwd)" != *"/.supabase-dev/"* ]] ||
    fail "${name}: entrypoint resolves through .supabase-dev"
done
[[ "$(grep -c '^entrypoint = ' "${config}")" -eq "$(wc -w <<<"${functions}" | tr -d ' ')" ]] ||
  fail "an entrypoint was added outside a [functions.*] section"

# A config rendered by an older generator (no entrypoints) is regenerated.
grep -v '^entrypoint = ' "${config}" >"${config}.old" && mv "${config}.old" "${config}"
touch -t 202001010000 "${config}"
generate_dev_supabase_config
grep -q '^entrypoint = ' "${config}" || fail "a stale config was not regenerated"

echo "dev-stack-config: OK"
