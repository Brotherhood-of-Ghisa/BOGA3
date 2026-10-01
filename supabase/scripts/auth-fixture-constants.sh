#!/usr/bin/env bash

# Deterministic local auth fixture aliases for M5 auth/authz tests.

export USER_A_FIXTURE_KEY="user_a"
export USER_A_EMAIL="user_a.local@example.test"
export USER_A_PASSWORD="ScaffoldingUserA!234"

export USER_B_FIXTURE_KEY="user_b"
export USER_B_EMAIL="user_b.local@example.test"
export USER_B_PASSWORD="ScaffoldingUserB!234"

# M22 two-user groups Maestro lane (ios-groups-e2e): user_c is the device user,
# user_d the scripted counterparty. Dedicated to that flow (spec 11 fixture
# rule); supabase/scripts/groups-fixture-reset.sh resets their group state.
# They have no dev_fixture_principals row (seed.sql), so no fixture key.
export USER_C_EMAIL="user_c.local@example.test"
export USER_C_PASSWORD="ScaffoldingUserC!234"
export USER_C_USERNAME="maestro-user-c"

export USER_D_EMAIL="user_d.local@example.test"
export USER_D_PASSWORD="ScaffoldingUserD!234"
export USER_D_USERNAME="maestro-user-d"
