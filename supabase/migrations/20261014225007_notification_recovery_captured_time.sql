-- Mutable source timestamps cannot hide a still-fresh captured event from recovery.
do $$ declare definition text; anchor text; begin
  definition:=pg_get_functiondef('app_public.notification_recover_workouts(integer)'::regprocedure);
  anchor:=$old$(s.started_at>=floor(extract(epoch from now()-interval '24 hours')*1000) or
       s.completed_at>=floor(extract(epoch from now()-interval '24 hours')*1000))$old$;
  if strpos(definition,anchor)=0 then raise exception 'notification recovery time anchor changed'; end if;
  execute replace(definition,anchor,$new$(s.started_at>=floor(extract(epoch from now()-interval '24 hours')*1000) or
       s.completed_at>=floor(extract(epoch from now()-interval '24 hours')*1000) or
       w.start_at+interval '24 hours'>now() or w.completion_at+interval '24 hours'>now() or
       exists(select 1 from notification_workout_moments m where m.member_user_id=s.owner_user_id
         and m.session_id=s.id and m.event_at+interval '24 hours'>now()))$new$);
end $$;
