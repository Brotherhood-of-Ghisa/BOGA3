#!/usr/bin/env bash

# groups-cow-zones.sh — the CoW calendar's time-zone validation
# (app_public.group_cow_zone) accepts and rejects exactly the names it did when
# it read pg_timezone_names on every call (a body of the groups-competitions
# lane).
#
# Contract: docs/specs/tech/group-cow-contract.md ("Calendar"). Proves, against
# the real local stack, with the original validator installed in pg_temp from
# the migration that created it:
#
#   - every name pg_timezone_names lists gets the same answer from both;
#   - a set of names that are not zones (abbreviations, offsets, POSIX
#     strings, other cases, padding, a directory, a path escape, the posix/ and
#     right/ trees, null) is rejected by both with the same error, and the
#     well-formed zones among the answers are accepted;
#   - the list taken at migration time is exactly the catalog's names outside
#     posix/ and right/, so no listed name is a stale one;
#   - a name outside that list still gets the catalog's answer (the fallback a
#     later tz update relies on), checked by emptying the list in a rolled-back
#     transaction. group_cow_calendar_get end to end is groups-competitions.sh's
#     calendar cases;
#
# Wall-clock is reported, never asserted. Hermetic: nothing outlives the run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"
LANE_LABEL="groups-cow-zones"
FIXTURE_EMAIL_PREFIX="groups-cow-zones"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/tests/lib/groups-fixtures.sh"

command -v docker >/dev/null 2>&1 || fail "docker is required"
load_supabase_status_env
DB_CONTAINER="$(resolve_db_container)" || exit 1

LIFECYCLE="${SUPABASE_DIR}/migrations/20261029204606_group_cow_lifecycle.sql"
[[ -f "${LIFECYCLE}" ]] || fail "missing ${LIFECYCLE}"

# The original validator, verbatim from the migration that created it, renamed
# into pg_temp.
LEGACY_SQL="$(node -e '
  const sql = require("fs").readFileSync(process.argv[1], "utf8");
  const start = sql.indexOf("create function app_public.group_cow_zone(");
  const end = sql.indexOf("end $$;", start) + "end $$;".length;
  if (start < 0 || end < start) { console.error("no group_cow_zone definition"); process.exit(1); }
  process.stdout.write(sql.slice(start, end).replace("app_public.group_cow_zone(", "pg_temp.legacy_cow_zone("));
' "${LIFECYCLE}")"

# One batch: legacy and current answer for a name, as 'ok' or the error text.
HELPERS_SQL="
${LEGACY_SQL}
create function pg_temp.answer(f text, z text) returns text language plpgsql as \$\$
declare r text;
begin
  if f = 'legacy' then r := pg_temp.legacy_cow_zone(z); else r := app_public.group_cow_zone(z); end if;
  return coalesce(r, 'null-result');
exception when others then return 'error: ' || sqlstate || ' ' || sqlerrm;
end \$\$;
"

# Every catalog name: both validators agree, and many are accepted.
run_psql_once "${HELPERS_SQL}
do \$\$
declare n int := 0; accepted int := 0; z text;
begin
  for z in select name from pg_catalog.pg_timezone_names loop
    n := n + 1;
    if pg_temp.answer('legacy', z) is distinct from pg_temp.answer('current', z) then
      raise exception 'zone % answers % before and % now', z, pg_temp.answer('legacy', z), pg_temp.answer('current', z);
    end if;
    if pg_temp.answer('current', z) = z then accepted := accepted + 1; end if;
  end loop;
  if n < 500 or accepted < 300 then raise exception 'too few zones compared: % names, % accepted', n, accepted; end if;
  if pg_temp.answer('current', 'UTC') <> 'UTC' or pg_temp.answer('current', 'Europe/London') <> 'Europe/London'
     or pg_temp.answer('current', 'America/Argentina/Buenos_Aires') <> 'America/Argentina/Buenos_Aires'
     or pg_temp.answer('current', 'Etc/GMT+5') <> 'Etc/GMT+5' then
    raise exception 'a well-formed zone was rejected';
  end if;
end \$\$;" >/dev/null
pass "every pg_timezone_names name gets the same answer as before"

# Names that are not accepted zones: the same error, and rejected.
run_psql_once "${HELPERS_SQL}
do \$\$
declare z text; rejected int := 0;
begin
  foreach z in array array[
    'EST','PST8PDT','CET','GMT','Zulu','utc','UTC ',' UTC','Europe/london','europe/London','EUROPE/LONDON',
    'Europe/London ',' Europe/London','Europe/London/','/Europe/London','Europe//London','Europe',
    'America/Argentina','UTC+3','UTC-05:00','+05:00','-0500','XXX3YYY','EST5EDT','Etc/GMT+99','Europe/Nowhere',
    'Mars/Olympus_Mons','Europe/../UTC','../Europe/London','posix/Europe/London','right/Europe/London',
    'posix/UTC','right/UTC','posixrules','zone.tab','tzdata.zi','leapseconds','','  ','Europe/Lon don',
    E'Europe/London\n',E'Europe/London\t','Europe/London;','Europe/London''','Europe/Lond%','Europe/L_ndon',
    'Europe/Zürich','Etc/UTC+1'] loop
    if pg_temp.answer('legacy', z) is distinct from pg_temp.answer('current', z) then
      raise exception 'name [%] answers % before and % now', z, pg_temp.answer('legacy', z), pg_temp.answer('current', z);
    end if;
    if pg_temp.answer('current', z) like 'error: P0001 VALIDATION%' then rejected := rejected + 1; end if;
  end loop;
  if rejected < 35 then raise exception 'only % of the invalid names were rejected', rejected; end if;
  if pg_temp.answer('current', null) <> pg_temp.answer('legacy', null)
     or pg_temp.answer('current', null) not like 'error: P0001 VALIDATION%' then
    raise exception 'a null zone was not rejected the same way: %', pg_temp.answer('current', null);
  end if;
end \$\$;" >/dev/null
pass "abbreviations, offsets, other cases, padding, trees and null are rejected as before"

# The list is the catalog's names, minus posix/ and right/.
run_psql_once "do \$\$
declare missing text; extra text;
begin
  select string_agg(name, ', ') into missing from pg_catalog.pg_timezone_names
   where name !~ '^(posix|right)/' and not app_public.group_cow_zone_known(name);
  if missing is not null then raise exception 'catalog names not in the list: %', missing; end if;
  if app_public.group_cow_zone_known('posix/UTC') or app_public.group_cow_zone_known('right/UTC')
     or app_public.group_cow_zone_known('Europe/Nowhere') or app_public.group_cow_zone_known(null) then
    raise exception 'the list holds a name the catalog does not';
  end if;
end \$\$;" >/dev/null
pass "the migration-time list holds exactly the catalog's names outside posix/ and right/"

# The fallback: with an empty list every well-formed catalog name is still accepted
# through the view, and a name that is not a zone is still rejected.
run_psql_once "begin;
${HELPERS_SQL}
create or replace function app_public.group_cow_zone_known(p_zone text) returns boolean language sql immutable as \$f\$ select false \$f\$;
do \$\$
declare z text; n int := 0;
begin
  for z in select name from pg_catalog.pg_timezone_names loop
    if pg_temp.answer('legacy', z) is distinct from pg_temp.answer('current', z) then
      raise exception 'fallback: zone % answers % before and % now', z, pg_temp.answer('legacy', z), pg_temp.answer('current', z);
    end if;
    if pg_temp.answer('current', z) = z then n := n + 1; end if;
  end loop;
  if n < 300 then raise exception 'fallback accepted only % zones', n; end if;
  if pg_temp.answer('current', 'Europe/Nowhere') not like 'error: P0001 VALIDATION%' then
    raise exception 'fallback accepted a name that is not a zone';
  end if;
end \$\$;
rollback;" >/dev/null
pass "a name outside the list still gets the catalog's answer"

# Reported, not asserted: what one validation costs now and what it cost.
TIMES="$(run_psql_once "${HELPERS_SQL}
do \$\$
declare t0 timestamptz; t1 timestamptz; t2 timestamptz; i int;
begin
  t0 := clock_timestamp();
  for i in 1..200 loop perform app_public.group_cow_zone('Europe/London'); end loop;
  t1 := clock_timestamp();
  for i in 1..20 loop perform pg_temp.legacy_cow_zone('Europe/London'); end loop;
  t2 := clock_timestamp();
  raise warning 'zone validation: % ms per call now, % ms per call before',
    round((extract(epoch from t1 - t0) * 1000 / 200)::numeric, 3), round((extract(epoch from t2 - t1) * 1000 / 20)::numeric, 3);
end \$\$;" 2>&1 || true)"
echo "[${LANE_LABEL}] ${TIMES//$'\n'/ }"
pass "CoW calendar zone validation"
