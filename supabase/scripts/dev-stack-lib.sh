#!/usr/bin/env bash
#
# dev-stack-lib.sh — the dedicated local DEV Supabase stack (project_id BOGA-dev).
#
# A second local Supabase, isolated from the slot-0 "BOGA" stack the gates use, so
# a gate run (which truncates/resets slot-0) never touches a human dev session's
# data. See docs/plans/dev-test-supabase-split.md and docs/specs/12.
#
# The stack runs from a gitignored workdir (.supabase-dev/) whose supabase/ holds
# a port/project-rewritten config.toml plus SYMLINKS to the repo's migrations,
# seed.sql, and functions — so migrations stay single-source. `supabase
# --workdir <dir>` runs it concurrently with slot-0. The Supabase helpers in
# _common.sh follow BOGA_SUPABASE_WORKDIR, so engaging the dev stack is just
# "generate the workdir + export that var"; every existing helper then targets it.
#
# SOURCE this AFTER _common.sh (it relies on REPO_ROOT, SUPABASE_DIR, and
# boga_port_for_slot from worktree-lib.sh).

# Reserved pseudo-slot for the dev stack: outside the allocatable 0..99 range, so
# its ports (655xx via the slot formula) can never collide with a real worktree.
BOGA_DEV_SLOT=100
# project_id is centralized in worktree-lib.sh so the orphan sweep's exemption
# and these scripts can never disagree on the name.
BOGA_DEV_PROJECT_ID="$(boga_dev_project_id)"
BOGA_DEV_WORKDIR="${REPO_ROOT}/.supabase-dev"

# Render .supabase-dev/supabase/config.toml from the shared template with the dev
# project_id + slot-100 ports, and (re)link migrations/seed/functions. Idempotent;
# regenerates the config when missing or older than the template.
generate_dev_supabase_config() {
  local template="${SUPABASE_DIR}/config.toml.template"
  local dev_supabase_dir="${BOGA_DEV_WORKDIR}/supabase"
  local config="${dev_supabase_dir}/config.toml"
  local tmp_file

  [[ -f "${template}" ]] || { echo "[dev-stack] missing template: ${template}" >&2; return 1; }
  mkdir -p "${dev_supabase_dir}"

  # Migrations/seed/functions are symlinked so the dev stack applies the exact
  # same schema as slot-0 — single source of truth, no drift.
  ln -sfn "${SUPABASE_DIR}/migrations" "${dev_supabase_dir}/migrations"
  ln -sfn "${SUPABASE_DIR}/seed.sql" "${dev_supabase_dir}/seed.sql"
  ln -sfn "${SUPABASE_DIR}/functions" "${dev_supabase_dir}/functions"

  if [[ -f "${config}" && "${config}" -nt "${template}" ]]; then
    return 0
  fi

  tmp_file="$(mktemp)"
  PROJECT_ID="${BOGA_DEV_PROJECT_ID}" \
  API_PORT="$(boga_port_for_slot api "${BOGA_DEV_SLOT}")" \
  DB_PORT="$(boga_port_for_slot db "${BOGA_DEV_SLOT}")" \
  SHADOW_PORT="$(boga_port_for_slot shadow "${BOGA_DEV_SLOT}")" \
  STUDIO_PORT="$(boga_port_for_slot studio "${BOGA_DEV_SLOT}")" \
  INBUCKET_PORT="$(boga_port_for_slot inbucket "${BOGA_DEV_SLOT}")" \
  ANALYTICS_PORT="$(boga_port_for_slot analytics "${BOGA_DEV_SLOT}")" \
  POOLER_PORT="$(boga_port_for_slot pooler "${BOGA_DEV_SLOT}")" \
  INSPECTOR_PORT="$(boga_port_for_slot inspector "${BOGA_DEV_SLOT}")" \
  perl -pe '
    s/\{\{PROJECT_ID\}\}/$ENV{PROJECT_ID}/g;
    s/\{\{API_PORT\}\}/$ENV{API_PORT}/g;
    s/\{\{DB_PORT\}\}/$ENV{DB_PORT}/g;
    s/\{\{SHADOW_PORT\}\}/$ENV{SHADOW_PORT}/g;
    s/\{\{STUDIO_PORT\}\}/$ENV{STUDIO_PORT}/g;
    s/\{\{INBUCKET_PORT\}\}/$ENV{INBUCKET_PORT}/g;
    s/\{\{ANALYTICS_PORT\}\}/$ENV{ANALYTICS_PORT}/g;
    s/\{\{POOLER_PORT\}\}/$ENV{POOLER_PORT}/g;
    s/\{\{INSPECTOR_PORT\}\}/$ENV{INSPECTOR_PORT}/g;
  ' "${template}" >"${tmp_file}"
  mv "${tmp_file}" "${config}"
}

# Generate the workdir (if needed) and point all subsequent Supabase helpers at
# the dev stack by exporting BOGA_SUPABASE_WORKDIR. Call once near the top of a
# dev-stack script; child scripts inherit the var.
engage_dev_stack() {
  generate_dev_supabase_config
  export BOGA_SUPABASE_WORKDIR="${BOGA_DEV_WORKDIR}"
}

# Guardrail: refuse to operate unless we are actually pointed at the dev stack.
# Prevents a dev script from ever running against the slot-0 gate stack (which a
# gate would wipe — and which holds the test fixtures, not dev data).
dev_stack_assert_engaged() {
  local active
  active="$(worktree_project_id)"
  if [[ "${active}" != "${BOGA_DEV_PROJECT_ID}" ]]; then
    echo "[dev-stack] refusing to run: active project_id is '${active:-<none>}', expected '${BOGA_DEV_PROJECT_ID}'." >&2
    echo "[dev-stack] call engage_dev_stack first (BOGA_SUPABASE_WORKDIR must point at ${BOGA_DEV_WORKDIR})." >&2
    exit 1
  fi
}
