-- A comparison score's performance carries the set's reps as a number. Reps are
-- any positive integer text the app's parser accepts (parseSetReps), but the
-- publication cast them to int4: a set above 2,147,483,647 reps failed the whole
-- publication with 22003 on every retry, so the job parked and the comparison
-- stopped publishing for the group. numeric keeps every accepted value exact.
-- Patched on the final definition, as 20261004233855 patches its anchors.
do $patch$
declare
  _definition text;
  _anchor text := $a$'reps',(r->>'reps_value')::integer$a$;
begin
  _definition := pg_get_functiondef('app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb)'::regprocedure);
  if (length(_definition) - length(replace(_definition, _anchor, ''))) <> length(_anchor) then
    raise exception 'group_metric_eval_publish: reps anchor not found exactly once';
  end if;
  execute replace(_definition, _anchor, $r$'reps',(r->>'reps_value')::numeric$r$);
end
$patch$;
