-- Operational notification delivery. No producer, client table grants or sync entity.
create table app_public.notification_config (
  singleton boolean primary key default true check (singleton),
  environment text not null check (environment in ('local','production')),
  project_id uuid not null,
  bundle_id text not null check (length(bundle_id) between 1 and 160),
  sending_enabled boolean not null default false,
  provider text not null default 'disabled' check (provider in ('disabled','local','expo')),
  check (provider <> 'local' or environment = 'local'),
  check (provider <> 'expo' or environment = 'production')
);
create table app_public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  activity boolean not null default true,
  bests boolean not null default true,
  ranks boolean not null default true
);
create table app_public.notification_group_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null references app_public.groups(id) on delete cascade,
  muted boolean not null default false,
  primary key (user_id,group_id)
);
create table app_public.notification_installations (
  id uuid primary key,
  capability_hash bytea not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  auth_session_id uuid not null,
  binding_id uuid not null default gen_random_uuid(),
  encryption_key text not null,
  token text not null,
  environment text not null,
  project_id uuid not null,
  bundle_id text not null,
  permission boolean not null default false,
  opted_in boolean not null default false,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique(environment,project_id,token)
);
create table app_public.notification_intents (
  id bigint generated always as identity primary key,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  lifter_user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null check (length(session_id) between 1 and 160),
  kind text not null check (kind in ('start','completion')),
  event_at timestamptz not null,
  expires_at timestamptz not null,
  generation bigint not null default 1 check (generation > 0),
  contributions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  check (recipient_user_id <> lifter_user_id),
  check (expires_at = event_at + interval '24 hours'),
  unique(recipient_user_id,lifter_user_id,session_id,kind)
);
create table app_public.notification_deliveries (
  id bigint generated always as identity primary key,
  intent_id bigint not null references app_public.notification_intents(id) on delete cascade,
  installation_id uuid not null references app_public.notification_installations(id) on delete cascade,
  binding_id uuid not null,
  state text not null default 'pending' check (state in
    ('pending','leased','sending','retry','disabled','ticket','receipt_ok','cancelled','expired','uncertain','failed')),
  generation bigint not null,
  claim_id uuid,
  lease_until timestamptz,
  available_at timestamptz not null default now(),
  attempts int not null default 0,
  error_code text,
  provider text check (provider in ('local','expo')),
  ticket_id text,
  ticket_at timestamptz,
  receipt_attempts int not null default 0,
  receipt_available_at timestamptz,
  receipt_claim_id uuid,
  receipt_lease_until timestamptz,
  unique(intent_id,installation_id)
);
create index notification_delivery_ready_idx on app_public.notification_deliveries(available_at,id)
  where state in ('pending','retry','disabled','leased','sending');
create index notification_receipt_ready_idx on app_public.notification_deliveries(receipt_available_at,id)
  where state='ticket';
create index notification_installation_user_idx on app_public.notification_installations(user_id) where active;
create index notification_intent_workout_idx on app_public.notification_intents(recipient_user_id,lifter_user_id,session_id);

-- No app or OAuth token may directly read even its own token/key/queue rows.
do $$ declare t text; begin
  foreach t in array array['notification_config','notification_preferences','notification_group_preferences',
    'notification_installations','notification_intents','notification_deliveries'] loop
    execute format('alter table app_public.%I enable row level security',t);
    execute format('revoke all on app_public.%I from public,anon,authenticated',t);
    execute format('grant all on app_public.%I to service_role',t);
  end loop;
end $$;
grant usage,select on sequence app_public.notification_intents_id_seq, app_public.notification_deliveries_id_seq to service_role;

create function app_public.notification_app_user() returns uuid
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid := auth.uid(); sid uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED: notification access requires authentication'; end if;
  if auth.jwt()->>'client_id' is not null then raise exception 'AGENT_FORBIDDEN: notification access unavailable'; end if;
  begin sid := (auth.jwt()->>'session_id')::uuid; exception when invalid_text_representation then sid := null; end;
  if not exists (select 1 from auth.sessions s where s.id=sid and s.user_id=u
      and (s.not_after is null or s.not_after > now())) then
    raise exception 'AUTH_REQUIRED: notification access requires an active session';
  end if;
  return u;
end $$;

create function app_public.notification_register(p_installation_id uuid,p_capability text,p_encryption_key text,
  p_token text,p_environment text,p_project_id uuid,p_bundle_id text,p_permission boolean,p_opted_in boolean,
  p_payload_version int default 1) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid := app_public.notification_app_user(); c notification_config; old notification_installations;
  h bytea; b uuid; sid uuid := (auth.jwt()->>'session_id')::uuid;
begin
  select * into c from notification_config where singleton;
  if not found then raise exception 'UNAVAILABLE: notification registration is disabled'; end if;
  if p_installation_id is null or p_payload_version is distinct from 1 or
     p_environment is distinct from c.environment or p_project_id is distinct from c.project_id or
     p_bundle_id is distinct from c.bundle_id or p_permission is null or p_opted_in is null or
     p_capability is null or p_capability !~ '^[A-Za-z0-9+/]{43}=$' or
     p_encryption_key is null or p_encryption_key !~ '^[A-Za-z0-9+/]{43}=$' or
     p_token is null or length(p_token)>256 or
     (c.environment='local' and p_token !~ '^LocalPushToken\[[a-zA-Z0-9_-]{1,120}\]$') or
     (c.environment='production' and p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[a-zA-Z0-9_-]{1,120}\]$') then
    raise exception 'VALIDATION: invalid notification registration';
  end if;
  h := extensions.digest(decode(p_capability,'base64'),'sha256');
  perform pg_advisory_xact_lock(hashtextextended(p_installation_id::text,0));
  select * into old from notification_installations where id=p_installation_id for update;
  if found and old.capability_hash <> h then raise exception 'NOT_FOUND: installation not found'; end if;
  -- A token is a high-entropy provider capability; new-device reassignment retires the old binding.
  update notification_installations set active=false,permission=false,opted_in=false,encryption_key='',updated_at=now()
    where environment=c.environment and project_id=c.project_id and token=p_token and id<>p_installation_id;
  -- Retired token rows keep their identity but release the unique token before reassignment.
  update notification_installations set token='retired:'||id::text where
    environment=c.environment and project_id=c.project_id and token=p_token and id<>p_installation_id;
  b := case when old.id is not null and old.user_id=u and old.auth_session_id=sid and old.token=p_token
      and old.encryption_key=p_encryption_key and old.environment=c.environment and old.project_id=c.project_id
      and old.bundle_id=c.bundle_id and old.active then old.binding_id else gen_random_uuid() end;
  insert into notification_installations(id,capability_hash,user_id,auth_session_id,binding_id,encryption_key,
    token,environment,project_id,bundle_id,permission,opted_in,active)
  values(p_installation_id,h,u,sid,b,p_encryption_key,p_token,c.environment,c.project_id,c.bundle_id,p_permission,p_opted_in,true)
  on conflict(id) do update set user_id=excluded.user_id,auth_session_id=excluded.auth_session_id,
    binding_id=excluded.binding_id,encryption_key=excluded.encryption_key,token=excluded.token,
    environment=excluded.environment,project_id=excluded.project_id,bundle_id=excluded.bundle_id,
    permission=excluded.permission,opted_in=excluded.opted_in,active=true,updated_at=now();
  update notification_deliveries d set state='cancelled',claim_id=null,lease_until=null
    from notification_installations i where i.id=d.installation_id
    and (not i.active or i.binding_id<>d.binding_id) and d.state in ('pending','retry','leased','disabled');
  insert into notification_preferences(user_id) values(u) on conflict do nothing;
  return jsonb_build_object('binding_id',b,'permission',p_permission,'opted_in',p_opted_in,'payload_version',1);
end $$;

create function app_public.notification_unregister(p_installation_id uuid,p_binding_id uuid) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid := app_public.notification_app_user();
begin
  update notification_installations set active=false,permission=false,opted_in=false,encryption_key='',updated_at=now()
    where id=p_installation_id and user_id=u and binding_id=p_binding_id;
  update notification_deliveries set state='cancelled',claim_id=null,lease_until=null
    where installation_id=p_installation_id and binding_id=p_binding_id
      and exists(select 1 from notification_installations where id=p_installation_id and user_id=u and not active)
      and state in ('pending','leased','retry','disabled');
  return jsonb_build_object('ok',true);
end $$;

create function app_public.notification_preferences_get(p_group_id uuid default null) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid := app_public.notification_app_user(); p notification_preferences; muted boolean := false;
begin
  if p_group_id is not null then
    perform app_public.group_require_member(p_group_id,u,false);
    select g.muted into muted from notification_group_preferences g where g.user_id=u and g.group_id=p_group_id;
  end if;
  select * into p from notification_preferences where user_id=u;
  return jsonb_build_object('activity',coalesce(p.activity,true),'bests',coalesce(p.bests,true),
    'ranks',coalesce(p.ranks,true),'muted',coalesce(muted,false));
end $$;

create function app_public.notification_preferences_set(p_activity boolean,p_bests boolean,p_ranks boolean) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid := app_public.notification_app_user();
begin
  if p_activity is null or p_bests is null or p_ranks is null then raise exception 'VALIDATION: invalid categories'; end if;
  insert into notification_preferences(user_id,activity,bests,ranks) values(u,p_activity,p_bests,p_ranks)
    on conflict(user_id) do update set activity=excluded.activity,bests=excluded.bests,ranks=excluded.ranks;
  return app_public.notification_preferences_get();
end $$;

create function app_public.notification_group_mute(p_group_id uuid,p_muted boolean) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid := app_public.notification_app_user();
begin
  perform app_public.group_require_member(p_group_id,u,true);
  if p_muted is null then raise exception 'VALIDATION: invalid mute'; end if;
  insert into notification_group_preferences(user_id,group_id,muted) values(u,p_group_id,p_muted)
    on conflict(user_id,group_id) do update set muted=excluded.muted;
  return app_public.notification_preferences_get(p_group_id);
end $$;

-- Producer seam: narrow counts only. A newer generation cannot replace an accepted handoff.
create function app_public.notification_enqueue(p_recipient uuid,p_lifter uuid,p_session text,p_kind text,
  p_event_at timestamptz,p_generation bigint,p_contributions jsonb) returns bigint
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare k bigint; row notification_intents;
begin
  if p_recipient is null or p_lifter is null or p_recipient=p_lifter or p_session is null or
     length(p_session) not between 1 and 160 or p_kind not in ('start','completion') or p_kind is null or
     p_event_at is null or p_event_at>now()+interval '5 minutes' or p_generation is null or p_generation<1 or
     jsonb_typeof(p_contributions) is distinct from 'array' or jsonb_array_length(p_contributions)>100 or
     octet_length(p_contributions::text)>20000 then raise exception 'VALIDATION: invalid notification intent'; end if;
  if exists(select 1 from jsonb_array_elements(p_contributions) x where
    jsonb_typeof(x) <> 'object' or not (x ?& array['group_id','best_count','rank_count']) or
    x - array['group_id','best_count','rank_count'] <> '{}'::jsonb or
    jsonb_typeof(x->'group_id') is distinct from 'string' or
    jsonb_typeof(x->'best_count') is distinct from 'number' or jsonb_typeof(x->'rank_count') is distinct from 'number' or
    coalesce(x->>'group_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or
    coalesce(x->>'best_count','') !~ '^[0-9]{1,5}$' or coalesce(x->>'rank_count','') !~ '^[0-9]{1,5}$') then
    raise exception 'VALIDATION: invalid notification contribution';
  end if;
  if (select count(*) <> count(distinct x->>'group_id') from jsonb_array_elements(p_contributions) x) then
    raise exception 'VALIDATION: duplicate notification group';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_recipient::text||':'||p_lifter::text||':'||p_session,0));
  select * into row from notification_intents where recipient_user_id=p_recipient and lifter_user_id=p_lifter
    and session_id=p_session and kind=p_kind for update;
  if found then
    k:=row.id;
    if p_event_at is distinct from row.event_at then raise exception 'CONFLICT: original event time is immutable'; end if;
    if p_generation>row.generation and not exists(select 1 from notification_deliveries where intent_id=k
        and state in ('sending','ticket','receipt_ok','uncertain')) then
      update notification_intents set generation=p_generation,contributions=p_contributions where id=k;
      update notification_deliveries set generation=p_generation,state='pending',available_at=now(),claim_id=null,
        lease_until=null where intent_id=k and state in ('pending','leased','retry','disabled');
    end if;
    return k;
  end if;
  insert into notification_intents(recipient_user_id,lifter_user_id,session_id,kind,event_at,expires_at,generation,contributions)
    values(p_recipient,p_lifter,p_session,p_kind,p_event_at,p_event_at+interval '24 hours',p_generation,p_contributions)
    returning id into k;
  insert into notification_deliveries(intent_id,installation_id,binding_id,generation)
    select k,i.id,i.binding_id,p_generation from notification_installations i
    where i.user_id=p_recipient and i.active and i.permission and i.opted_in and p_event_at+interval '24 hours'>now();
  return k;
end $$;

create function app_public.notification_claim(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare jobs jsonb;
begin
  if p_limit is null or p_limit not between 1 and 20 then raise exception 'VALIDATION: invalid claim limit'; end if;
  update notification_deliveries set state='uncertain',error_code='HANDOFF_UNKNOWN',claim_id=null,lease_until=null
    where state='sending' and lease_until<=now();
  update notification_deliveries d set state='expired',claim_id=null,lease_until=null from notification_intents n
    where n.id=d.intent_id and n.expires_at<=now() and d.state in ('pending','retry','disabled','leased');
  if not exists(select 1 from notification_config where singleton and sending_enabled and provider<>'disabled') then
    update notification_deliveries set state='disabled',claim_id=null,lease_until=null
      where state in ('pending','retry') or (state='leased' and lease_until<=now());
    return jsonb_build_object('jobs','[]'::jsonb,'disabled',true);
  end if;
  with candidates as (
    select d.id from notification_deliveries d where
      (d.state in ('pending','retry','disabled') and d.available_at<=now()) or (d.state='leased' and d.lease_until<=now())
      order by d.available_at,d.id for update skip locked limit p_limit
  ), claimed as (
    update notification_deliveries d set state='leased',claim_id=gen_random_uuid(),lease_until=now()+interval '60 seconds'
      from candidates c where d.id=c.id returning d.id,d.claim_id,d.generation
  ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into jobs from claimed;
  return jsonb_build_object('jobs',jobs,'disabled',false);
end $$;

-- Public projection seam: current authorization and preference filtering, never raw group event payloads.
create function app_public.notification_projection(p_intent_id bigint) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare n notification_intents; pref notification_preferences; parts jsonb; count_groups int; bests int; ranks int;
  first_group uuid; group_name text; lifter_name text; activity boolean;
begin
  select * into n from notification_intents where id=p_intent_id;
  if not found or n.expires_at<=now() then return null; end if;
  if not exists(select 1 from sessions s where s.owner_user_id=n.lifter_user_id and s.id=n.session_id and s.deleted_at is null)
    then return null; end if;
  select * into pref from notification_preferences where user_id=n.recipient_user_id;
  activity:=coalesce(pref.activity,true);
  if n.kind='start' and (not activity or exists(select 1 from sessions s where s.owner_user_id=n.lifter_user_id
      and s.id=n.session_id and s.status<>'active')) then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',left(g.name,100),
      'bests',case when coalesce(pref.bests,true) then (x->>'best_count')::int else 0 end,
      'ranks',case when coalesce(pref.ranks,true) then (x->>'rank_count')::int else 0 end) order by g.id),'[]'::jsonb)
    into parts from jsonb_array_elements(n.contributions) x
    join groups g on g.id=(x->>'group_id')::uuid and g.deleted_at is null
    where exists(select 1 from group_memberships m where m.group_id=g.id and m.user_id=n.recipient_user_id and m.ended_at is null)
      and exists(select 1 from group_memberships m where m.group_id=g.id and m.user_id=n.lifter_user_id and m.ended_at is null)
      and exists(select 1 from group_session_shares sh where sh.group_id=g.id and sh.member_user_id=n.lifter_user_id and sh.session_id=n.session_id)
      and not exists(select 1 from notification_group_preferences p where p.user_id=n.recipient_user_id and p.group_id=g.id and p.muted)
      and (activity or (coalesce(pref.bests,true) and (x->>'best_count')::int>0)
        or (coalesce(pref.ranks,true) and (x->>'rank_count')::int>0));
  count_groups:=jsonb_array_length(parts);
  if count_groups=0 then return null; end if;
  first_group:=(parts->0->>'id')::uuid; group_name:=parts->0->>'name';
  select coalesce(sum((x->>'bests')::int),0),coalesce(sum((x->>'ranks')::int),0) into bests,ranks from jsonb_array_elements(parts) x;
  if n.kind='start' then bests:=0; ranks:=0; end if;
  if not activity and bests=0 and ranks=0 then return null; end if;
  select coalesce(nullif(left(username,100),''),'Group member') into lifter_name from user_profiles where id=n.lifter_user_id;
  return jsonb_build_object('v',1,'recipientUserId',n.recipient_user_id,'expiresAt',floor(extract(epoch from n.expires_at)*1000),
    'notificationId',n.id::text,'kind',n.kind,'identity',coalesce(lifter_name,'Group member')||' · '||
      case when count_groups=1 then group_name else count_groups||' groups' end,
    'heading',case when activity then case when n.kind='start' then 'Started a workout' else 'Finished a workout' end
      when bests>0 and ranks>0 then 'Workout achievements' when bests>0 then 'Group exercise bests' else 'Leaderboard changes' end,
    'bestCount',bests,'rankCount',ranks,'route',jsonb_build_object('groupId',first_group,'memberId',n.lifter_user_id,'sessionId',n.session_id));
end $$;

create function app_public.notification_begin_send(p_delivery_id bigint,p_claim_id uuid,p_generation bigint) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare d notification_deliveries; n notification_intents; i notification_installations; c notification_config; p jsonb;
begin
  select * into d from notification_deliveries where id=p_delivery_id;
  if not found then return null; end if;
  select * into n from notification_intents where id=d.intent_id;
  -- Installation before delivery everywhere, including registration/receipt rotation.
  select * into i from notification_installations where id=d.installation_id for update;
  perform pg_advisory_xact_lock(hashtextextended(n.recipient_user_id::text||':'||n.lifter_user_id::text||':'||n.session_id,0));
  select * into d from notification_deliveries where id=p_delivery_id for update;
  select * into n from notification_intents where id=d.intent_id;
  if d.state<>'leased' or d.claim_id is distinct from p_claim_id or d.generation<>p_generation or
      n.generation<>p_generation or d.lease_until<=now() then return null; end if;
  select * into c from notification_config where singleton;
  if not i.active or not i.permission or not i.opted_in or i.binding_id<>d.binding_id or i.user_id<>n.recipient_user_id or
    i.environment is distinct from c.environment or i.project_id is distinct from c.project_id or
    i.bundle_id is distinct from c.bundle_id or not exists(select 1 from auth.sessions s where s.id=i.auth_session_id
      and s.user_id=i.user_id and (s.not_after is null or s.not_after>now())) then
    update notification_deliveries set state='cancelled',claim_id=null,lease_until=null where id=d.id; return null;
  end if;
  if not coalesce(c.sending_enabled,false) or c.provider='disabled' then
    update notification_deliveries set state='disabled',claim_id=null,lease_until=null where id=d.id; return null;
  end if;
  if n.expires_at<=now() then
    update notification_deliveries set state='expired',claim_id=null,lease_until=null where id=d.id; return null;
  end if;
  if n.kind='completion' then
    if exists(select 1 from notification_deliveries sd join notification_intents sn on sn.id=sd.intent_id
        where sn.recipient_user_id=n.recipient_user_id and sn.lifter_user_id=n.lifter_user_id and sn.session_id=n.session_id
        and sn.kind='start' and sd.state='sending' and sd.lease_until>now()) then
      update notification_deliveries set state='retry',available_at=now()+interval '10 seconds',claim_id=null,lease_until=null
        where id=d.id; return null;
    end if;
    update notification_deliveries sd set state='cancelled',claim_id=null,lease_until=null from notification_intents sn
      where sn.id=sd.intent_id and sn.recipient_user_id=n.recipient_user_id and sn.lifter_user_id=n.lifter_user_id
      and sn.session_id=n.session_id and sn.kind='start' and sd.state in ('pending','retry','leased','disabled');
  elsif exists(select 1 from notification_deliveries cd join notification_intents cn on cn.id=cd.intent_id
      where cn.recipient_user_id=n.recipient_user_id and cn.lifter_user_id=n.lifter_user_id and cn.session_id=n.session_id
      and cn.kind='completion' and cd.state in ('sending','ticket','receipt_ok','uncertain')) then
    update notification_deliveries set state='cancelled',claim_id=null,lease_until=null where id=d.id; return null;
  end if;
  p:=app_public.notification_projection(n.id);
  if p is null then
    update notification_deliveries set state='cancelled',claim_id=null,lease_until=null where id=d.id; return null;
  end if;
  update notification_deliveries set state='sending',provider=c.provider,attempts=attempts+1,lease_until=now()+interval '60 seconds' where id=d.id;
  return jsonb_build_object('delivery_id',d.id,'claim_id',d.claim_id,'generation',d.generation,'binding_id',i.binding_id,
    'encryption_key',i.encryption_key,'token',i.token,'provider',c.provider,'expires_at',n.expires_at,
    'projection',p||jsonb_build_object('bindingId',i.binding_id));
end $$;

create function app_public.notification_send_result(p_delivery_id bigint,p_claim_id uuid,p_outcome text,
  p_ticket_id text default null,p_code text default null) returns boolean
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare d notification_deliveries;
begin
  if p_outcome is null or p_outcome not in ('ticket','retry','failed','uncertain','device_unregistered') or
      (p_outcome='ticket' and (p_ticket_id is null or length(p_ticket_id) not between 1 and 160)) or
      (p_code is not null and p_code not in ('RATE_LIMIT','PROVIDER_TEMPORARY','INVALID_PAYLOAD','INVALID_CREDENTIALS',
        'DEVICE_NOT_REGISTERED','HANDOFF_UNKNOWN','PROVIDER_INVALID_RESPONSE','RETRY_LIMIT')) then
    raise exception 'VALIDATION: invalid delivery outcome';
  end if;
  select * into d from notification_deliveries where id=p_delivery_id;
  if not found then return false; end if;
  perform 1 from notification_installations where id=d.installation_id for update;
  select * into d from notification_deliveries where id=p_delivery_id for update;
  if not found or d.state<>'sending' or d.claim_id is distinct from p_claim_id then return false; end if;
  if p_outcome='device_unregistered' then
    update notification_installations set active=false,permission=false,opted_in=false,encryption_key='',updated_at=now()
      where id=d.installation_id and binding_id=d.binding_id;
  end if;
  update notification_deliveries set state=case when p_outcome='device_unregistered' then 'failed'
      when p_outcome='retry' and attempts>=5 then 'failed' else p_outcome end,
    error_code=case when p_outcome='retry' and attempts>=5 then 'RETRY_LIMIT' else p_code end,
    ticket_id=case when p_outcome='ticket' then p_ticket_id else null end,
    ticket_at=case when p_outcome='ticket' then now() else null end,
    receipt_available_at=case when p_outcome='ticket' then now()+interval '15 minutes' else null end,
    available_at=now()+make_interval(secs=>least(300,power(2,attempts)::int)),claim_id=null,lease_until=null
    where id=d.id;
  return true;
end $$;

create function app_public.notification_receipt_claim(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare jobs jsonb;
begin
  if p_limit is null or p_limit not between 1 and 20 then raise exception 'VALIDATION: invalid receipt limit'; end if;
  update notification_deliveries set state='failed',error_code='RECEIPT_UNKNOWN',receipt_claim_id=null,receipt_lease_until=null
    where state='ticket' and (ticket_at+interval '24 hours'<=now() or receipt_attempts>=20);
  with candidates as (select id from notification_deliveries where state='ticket' and receipt_available_at<=now()
      and (receipt_lease_until is null or receipt_lease_until<=now()) order by receipt_available_at,id for update skip locked limit p_limit),
  claimed as (update notification_deliveries d set receipt_claim_id=gen_random_uuid(),receipt_lease_until=now()+interval '60 seconds',
      receipt_attempts=receipt_attempts+1 from candidates c where d.id=c.id returning d.id,d.receipt_claim_id,d.ticket_id,d.provider)
  select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into jobs from claimed;
  return jsonb_build_object('jobs',jobs);
end $$;

create function app_public.notification_receipt_result(p_delivery_id bigint,p_claim_id uuid,p_outcome text,p_code text default null)
returns boolean language plpgsql security definer set search_path=app_public,pg_temp as $$
declare d notification_deliveries;
begin
  if p_outcome is null or p_outcome not in ('receipt_ok','retry','failed','device_unregistered') or
    (p_code is not null and p_code not in ('RATE_LIMIT','PROVIDER_TEMPORARY','INVALID_PAYLOAD','INVALID_CREDENTIALS',
      'DEVICE_NOT_REGISTERED','PROVIDER_INVALID_RESPONSE','RECEIPT_UNKNOWN')) then raise exception 'VALIDATION: invalid receipt'; end if;
  select * into d from notification_deliveries where id=p_delivery_id;
  if not found then return false; end if;
  perform 1 from notification_installations where id=d.installation_id for update;
  select * into d from notification_deliveries where id=p_delivery_id for update;
  if not found or d.state<>'ticket' or d.receipt_claim_id is distinct from p_claim_id then return false; end if;
  if p_outcome='device_unregistered' then
    update notification_installations set active=false,permission=false,opted_in=false,encryption_key='',updated_at=now()
      where id=d.installation_id and binding_id=d.binding_id;
  end if;
  update notification_deliveries set state=case when p_outcome='retry' then 'ticket'
      when p_outcome='device_unregistered' then 'failed' else p_outcome end,error_code=p_code,
    receipt_available_at=now()+make_interval(secs=>least(3600,60*power(2,receipt_attempts)::int)),
    receipt_claim_id=null,receipt_lease_until=null where id=d.id;
  return true;
end $$;

-- Purge content/secrets, not logical tombstones. Account deletion cascades all operational rows.
create function app_public.notification_prune() returns void
language plpgsql security definer set search_path=app_public,pg_temp as $$ begin
  update notification_intents set contributions='[]' where expires_at<now()-interval '30 days' and contributions<>'[]';
  update notification_installations set encryption_key='',token='retired:'||id::text
    where not active and updated_at<now()-interval '30 days';
  update notification_deliveries set ticket_id=null,error_code=null where intent_id in
    (select id from notification_intents where expires_at<now()-interval '30 days');
end $$;

create function app_public.notification_sweep() returns bigint
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare endpoint text; key text;
begin
  -- Disabling new sends must not stop accepted-ticket receipts or secret pruning.
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='notification_worker_url' order by created_at desc limit 1;
  select decrypted_secret into key from vault.decrypted_secrets where name='notification_worker_key' order by created_at desc limit 1;
  if endpoint is null or key is null then return null; end if;
  return net.http_post(url:=endpoint,body:='{}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json','apikey',key),timeout_milliseconds:=10000);
exception when others then
  raise warning 'notification_worker_sweep_failed'; return null;
end $$;
select cron.schedule('notification-delivery-sweep','*/5 * * * *','select app_public.notification_sweep()');

-- Explicit grants: internal helpers and worker seams are never client executable.
do $$ declare f record; begin
  for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='app_public' and p.proname like 'notification_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.oid::regprocedure);
    if f.proname in ('notification_register','notification_unregister','notification_preferences_get',
        'notification_preferences_set','notification_group_mute') then
      execute format('grant execute on function %s to anon,authenticated',f.oid::regprocedure);
    else
      execute format('grant execute on function %s to service_role',f.oid::regprocedure);
    end if;
  end loop;
end $$;
