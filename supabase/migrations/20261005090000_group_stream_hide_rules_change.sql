-- A rules change says nothing a member can act on, and activation writes one
-- per comparison, so the group stream (and Today) stops listing them. They stay
-- in group_events and in board history. The cursor still accepts the
-- 'rules_change' kind so a cursor issued before this migration keeps paging.
do $stream$
declare
  _definition text;
  _branch constant text := '
    union all
    select ''rules_change'',e.id::text,e.sort_at_ms,e.member_user_id,null,null,null,e.group_id,e.id
      from app_public.group_events e where e.group_id=any(_scope) and e.kind=''rules_change''';
begin
  _definition:=pg_get_functiondef('app_public.group_competition_stream_page(uuid,jsonb,integer)'::regprocedure);
  if position(_branch in _definition)=0 then raise exception 'stream rules_change branch missing'; end if;
  execute replace(_definition,_branch,'');
end
$stream$;
