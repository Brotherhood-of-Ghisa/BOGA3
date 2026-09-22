#!/usr/bin/env bash

# _containers.sh — resolving THIS worktree's Supabase containers.
#
# Deliberately a library, not an entrypoint: sourcing it has no side effects and
# needs no slot lease, so the `meta-tests` lane (infra-free, runs in CI) can
# source it directly. `_common.sh` cannot serve that purpose — it requires a
# lease at source time and exits without one, which is correct for a runtime
# entrypoint and useless for a unit test.
#
# Sourced by _common.sh; tested by scripts/tests/supabase-container-resolver.test.sh.

_CONTAINERS_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_CONTAINERS_REPO_ROOT="$(cd "${_CONTAINERS_SCRIPT_DIR}/../.." && pwd)"

# For SUPABASE_CLI_PROJECT_ID_LIMIT. worktree-lib.sh is itself side-effect-free.
# shellcheck disable=SC1091
source "${_CONTAINERS_REPO_ROOT}/scripts/worktree-lib.sh"

# The Supabase CLI caps `project_id` at SUPABASE_CLI_PROJECT_ID_LIMIT characters
# (defined in scripts/worktree-lib.sh) and silently rewrites a longer one on
# every invocation, so a worktree whose derived id is longer runs containers
# named for a *prefix* of what config.toml says. An exact-name lookup then finds
# nothing while the stack sits there perfectly healthy.
#
# Matching the truncation is not enough on its own. The id ends in the slot
# number, which is exactly what the cut removes, so two worktrees whose names
# agree in their first 35-odd characters truncate to the SAME container name —
# and this repo's parallel plans produce sibling worktrees of exactly that
# shape. Binding a foreign worktree's Postgres is the failure `resolve_db_container`
# exists to prevent, and it is silent: the suite runs green against another
# worktree's data.
#
# So the truncated candidate must prove it belongs to THIS worktree before it is
# accepted. Ports are allocated per slot and written into config.toml, so the
# published host port is a discriminator the truncated name has lost. The exact
# name needs no such proof — nothing else can carry it.

# Does ${container} publish ${want_port} on the host?
container_publishes_host_port() {
  local container="$1" want_port="$2"

  # An empty port must never match: the real --format output contains empty
  # tokens for unpublished ports, and `grep -Fxq ""` would match one.
  [[ -n "${want_port}" ]] || return 1

  docker inspect "${container}" \
    --format '{{range $p, $conf := .NetworkSettings.Ports}}{{range $conf}}{{.HostPort}} {{end}}{{end}}' \
    2>/dev/null | tr ' ' '\n' | grep -Fxq "${want_port}"
}

# resolve_worktree_container <service> <project_id> <expected_host_port>
#
# Echoes the container name for this worktree's <service> and returns 0.
# Returns 1 when no candidate is running at all, and 2 when a candidate matched
# by name but was REFUSED because it is not this slot's — the two need different
# advice, so callers must not collapse them. <expected_host_port> is this
# worktree's slot-allocated port for that service, from config.toml.
resolve_worktree_container() {
  local service="$1" project_id="$2" expected_port="$3"
  local exact truncated

  exact="supabase_${service}_${project_id}"
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -Fxq "${exact}"; then
    printf '%s\n' "${exact}"
    return 0
  fi

  truncated="supabase_${service}_${project_id:0:SUPABASE_CLI_PROJECT_ID_LIMIT}"
  if [[ "${truncated}" != "${exact}" ]] &&
    docker ps --format '{{.Names}}' 2>/dev/null | grep -Fxq "${truncated}"; then
    if [[ -n "${expected_port}" ]] && container_publishes_host_port "${truncated}" "${expected_port}"; then
      printf '%s\n' "${truncated}"
      return 0
    fi
    echo "[resolve_worktree_container] refusing '${truncated}': it matches this" \
         "worktree's truncated project_id but does not publish this slot's" \
         "${service} port ${expected_port:-<unset>}." >&2
    echo "[resolve_worktree_container] that means it is another worktree's stack, or" \
         "this worktree's stack is not fully up. Either way, binding it would run" \
         "against the wrong database. Check \`./boga worktree doctor\`." >&2
    return 2
  fi

  return 1
}

