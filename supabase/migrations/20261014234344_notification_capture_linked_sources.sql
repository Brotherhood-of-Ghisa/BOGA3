-- Unlinked shared sets are evaluator inputs, not notification comparison targets.
do $$ declare definition text; anchor text; begin
  definition:=pg_get_functiondef('app_public.notification_capture_comparison(uuid,uuid,bigint,boolean,jsonb)'::regprocedure);
  anchor:=$old$        where nw.eligible or (nw.member_user_id is null and (raw.status='active' or
          raw.completed_at>=floor(extract(epoch from (select started_at from notification_workout_epoch))*1000)))$old$;
  if strpos(definition,anchor)=0 then raise exception 'notification source admission anchor changed'; end if;
  definition:=replace(definition,anchor,$new$        where (x->>'counting')::boolean and (nw.eligible or (nw.member_user_id is null and (raw.status='active' or
          raw.completed_at>=floor(extract(epoch from (select started_at from notification_workout_epoch))*1000))))$new$);
  anchor:=$old$        where nw.eligible and l.deleted_at is null and group_eval_try_uuid(l.group_exercise_id)=p_exercise$old$;
  if strpos(definition,anchor)=0 then raise exception 'notification linked-block admission anchor changed'; end if;
  execute replace(definition,anchor,$new$        where nw.eligible and l.deleted_at is null and group_eval_try_uuid(l.group_exercise_id)=p_exercise
          and group_eval_try_uuid(l.group_id)=p_group$new$);
end $$;
