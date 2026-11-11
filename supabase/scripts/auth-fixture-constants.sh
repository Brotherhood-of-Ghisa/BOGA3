#!/usr/bin/env bash

# Deterministic local auth fixture aliases for the auth/authz tests.

export USER_A_FIXTURE_KEY="user_a"
export USER_A_EMAIL="user_a.local@example.test"
export USER_A_PASSWORD="ScaffoldingUserA!234"

export USER_B_FIXTURE_KEY="user_b"
export USER_B_EMAIL="user_b.local@example.test"
export USER_B_PASSWORD="ScaffoldingUserB!234"

# Two-user groups Maestro lane (ios-groups-e2e): user_c is the device user,
# user_d the scripted counterparty. Dedicated to that flow (spec 11 fixture
# rule); supabase/scripts/groups-fixture-reset.sh resets their group state.
# They have no dev_fixture_principals row (seed.sql), so no fixture key.
export USER_C_EMAIL="user_c.local@example.test"
export USER_C_PASSWORD="ScaffoldingUserC!234"
export USER_C_USERNAME="maestro-user-c"

export USER_D_EMAIL="user_d.local@example.test"
export USER_D_PASSWORD="ScaffoldingUserD!234"
export USER_D_USERNAME="maestro-user-d"

# sync-infra jest suite (apps/mobile/__tests__/sync/cycle-fresh-device-and-
# account-switch.test.ts): user_e is the account a fresh device restores and the
# one a device switches to; user_f the account the device held before the
# switch. The synced muscle-targets suite (muscle-targets-live.test.ts) and the
# Apple Health import suite (health-import-live.test.ts) sign in as user_e too. Dedicated to those sync-infra suites, which hard-reset their
# users' Sync v2 rows with the service role at the start of each test. No
# fixture key.
export USER_E_EMAIL="user_e.local@example.test"
export USER_E_PASSWORD="ScaffoldingUserE!234"

export USER_F_EMAIL="user_f.local@example.test"
export USER_F_PASSWORD="ScaffoldingUserF!234"

# MCP smoke (scripts/smoke-boga-mcp.sh, the mcp-smoke lane): user_g is the
# account the smoke seeds, connects an agent to and logs a workout for. It
# asserts account-wide state (no active workout before it starts one, agent
# plan and audit counts), and the backend gate runs it after the user_a sync
# and contract suites without a reset, so it must not share their user.
# Dedicated to that smoke (scripts/tests/mcp-smoke-fixture-user.test.sh). No
# fixture key.
export USER_G_EMAIL="user_g.local@example.test"
export USER_G_PASSWORD="ScaffoldingUserG!234"
