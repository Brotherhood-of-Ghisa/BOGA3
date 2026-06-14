#!/usr/bin/env bash

# Human development sign-in accounts for local/dev use.
#
# These are deliberately SEPARATE from the integration-test fixtures in
# auth-fixture-constants.sh (user_a / user_b). The backend contract suites and
# the Maestro iOS lanes create, mutate, and wipe the fixture users on every run,
# so signing into the app as a fixture user collides with test data — your
# manual edits perturb a run, and a run wipes your manual data.
#
# Sign in as one of these dev accounts instead. They are NOT registered in
# public.dev_fixture_principals (that table is integration-test infrastructure)
# and nothing in CI, the gates, or seed.sql touches them.

# Short, simple credentials on purpose — these only ever target a local/dev
# Supabase, never production. Password is 6 chars to satisfy the local
# minimum_password_length (config.toml); no complexity is required
# (password_requirements = "").
export DEV_ACCOUNT_A_EMAIL="a@dev.local"
export DEV_ACCOUNT_A_PASSWORD="dev123"

export DEV_ACCOUNT_B_EMAIL="b@dev.local"
export DEV_ACCOUNT_B_PASSWORD="dev123"
