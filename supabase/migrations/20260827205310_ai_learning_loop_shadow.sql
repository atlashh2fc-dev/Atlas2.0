-- Post-call learning loop. Default OFF; no operational action is executable.
-- Worker RPCs are invoker/service-only. Privileged trigger/review implementations
-- live outside the exposed schema and enforce actor/source scope explicitly.
create schema if not exists atlas_loop_private;
revoke all on schema atlas_loop_private from public, anon;
grant usage on schema atlas_loop_private to authenticated, service_role;

create table public.ai_loop_campaign_configs (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  mode text not null default 'off' check (mode in ('off', 'shadow')),
  policy_version text not null default 'callback-v1' check (policy_version = 'callback-v1'),
  daily_attempt_limit integer not null default 20 check (daily_attempt_limit between 1 and 100),
  quota_day date,
  attempts_today integer not null default 0 check (attempts_today >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index ai_loop_config_actor_idx on public.ai_loop_campaign_configs(updated_by);

create table public.ai_loop_runs (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.call_recordings(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  source_hash text not null,
  policy_version text not null default 'callback-v1',
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','superseded')),
  mode text not null default 'shadow' check (mode = 'shadow'),
  attempt_count integer not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  available_at timestamptz not null default now(),
  context_snapshot jsonb,
  analysis jsonb,
  decision jsonb,
  model text,
  extractor_version text,
  provider_request_id text,
  usage jsonb,
  error_code text,
  review_version integer not null default 0,
  review jsonb,
  expires_at timestamptz not null,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(recording_id, source_hash, policy_version),
  check (length(source_hash) = 32),
  check (attempt_count between 0 and 3),
  check ((lease_token is null) = (lease_until is null))
);
create index ai_loop_runs_queue_idx on public.ai_loop_runs(campaign_id, available_at, created_at)
  where status in ('pending','processing');
create index ai_loop_runs_lead_idx on public.ai_loop_runs(lead_id, created_at desc);
create index ai_loop_runs_campaign_idx on public.ai_loop_runs(campaign_id, created_at desc);

create table public.ai_loop_memory (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_loop_runs(id) on delete cascade,
  fact_index integer not null,
  kind text not null check (kind in ('callback_request','contact_restriction','commitment','objection')),
  quote text not null check (length(quote) between 3 and 500),
  speaker text not null check (speaker in ('customer','agent','unknown')),
  requested_time_text text,
  state text not null default 'candidate' check (state in ('candidate','confirmed','retracted')),
  retracted_at timestamptz,
  expires_at timestamptz not null,
  unique(run_id, fact_index)
);

create table public.ai_loop_feedback (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_loop_runs(id) on delete cascade,
  kind text not null check (kind in ('human_review','observed_outcome','source_revision')),
  actor_id uuid references public.profiles(id) on delete set null,
  source_call_id uuid references public.calls(id) on delete cascade,
  source_version text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(run_id, kind, source_version)
);
create index ai_loop_feedback_call_idx on public.ai_loop_feedback(source_call_id);
create index ai_loop_feedback_actor_idx on public.ai_loop_feedback(actor_id);

alter table public.ai_loop_campaign_configs enable row level security;
alter table public.ai_loop_runs enable row level security;
alter table public.ai_loop_memory enable row level security;
alter table public.ai_loop_feedback enable row level security;
revoke all on public.ai_loop_campaign_configs, public.ai_loop_runs, public.ai_loop_memory, public.ai_loop_feedback from public, anon, authenticated;
grant select on public.ai_loop_campaign_configs, public.ai_loop_runs, public.ai_loop_memory, public.ai_loop_feedback to authenticated;
grant all on public.ai_loop_campaign_configs, public.ai_loop_runs, public.ai_loop_memory, public.ai_loop_feedback to service_role;

create policy ai_loop_config_read on public.ai_loop_campaign_configs for select to authenticated using (
  (select public.current_role_name()) = 'admin' or exists (
    select 1 from public.call_recordings r where r.campaign_id = ai_loop_campaign_configs.campaign_id
  )
);
-- Inherit the source recording's real RLS. Only post-call voice is ingested;
-- WhatsApp is deliberately excluded, including from derived memory/context.
create policy ai_loop_run_read on public.ai_loop_runs for select to authenticated using (
  (select public.current_role_name()) in ('admin','supervisor') and exists (
    select 1 from public.call_recordings r where r.id = recording_id
      and r.status = 'ready' and r.retention_until > now()
  )
);
create policy ai_loop_memory_read on public.ai_loop_memory for select to authenticated using (
  expires_at > now() and exists (select 1 from public.ai_loop_runs r where r.id = run_id)
);
create policy ai_loop_feedback_read on public.ai_loop_feedback for select to authenticated using (
  exists (select 1 from public.ai_loop_runs r where r.id = run_id)
  and (source_call_id is null or exists (select 1 from public.calls c where c.id = source_call_id))
);

create function atlas_loop_private.source(p_recording_id uuid) returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select jsonb_build_object(
    'recording_id', r.id, 'call_id', c.id, 'lead_id', l.id, 'campaign_id', r.campaign_id,
    'transcription_id', t.id, 'transcription_sha256', t.source_sha256,
    'transcript_text', t.transcript_text, 'transcript_hash',md5(t.transcript_text), 'transcription_updated_at', t.updated_at,
    'call', jsonb_build_object('started_at',c.started_at,'ended_at',c.ended_at,'updated_at',c.updated_at,
      'outcome',c.outcome,'reason',c.reason,'next_action_at',c.next_action_at),
    'lead', jsonb_build_object('assigned_to',l.assigned_to,'next_action_at',l.next_action_at,'workflow_status',l.workflow_status),
    'campaign_active', campaign.is_active,
    'has_open_call', exists(select 1 from public.calls active where active.lead_id=l.id and active.ended_at is null),
    'memory', coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'expires_at',m.expires_at) order by m.id)
      from public.ai_loop_memory m join public.ai_loop_runs old on old.id=m.run_id
      join public.call_recordings prior on prior.id=old.recording_id
      join public.call_transcriptions prior_text on prior_text.recording_id=prior.id
      where old.lead_id=l.id and old.campaign_id=r.campaign_id
        and prior_text.status='completed' and prior_text.source_sha256=prior.sha256
        and old.context_snapshot->>'transcript_hash'=md5(prior_text.transcript_text)
        and prior.team_id is not distinct from r.team_id and prior.status='ready' and prior.retention_until>now()
        and (prior.started_at,prior.id)<(r.started_at,r.id)
        and m.state='confirmed' and m.expires_at>now()),'[]'::jsonb)
  )
  from public.call_recordings r join public.calls c on c.id=r.call_id
  join public.leads l on l.id=r.lead_id and l.campaign_id=r.campaign_id
  join public.campaigns campaign on campaign.id=r.campaign_id
  join public.call_transcriptions t on t.recording_id=r.id
  where r.id=p_recording_id and r.status='ready' and r.retention_until>now()
    and t.status='completed' and t.source_sha256=r.sha256
    and length(btrim(t.transcript_text)) between 1 and 60000
    and c.ended_at is not null and coalesce(nullif(btrim(c.outcome),''),nullif(btrim(c.reason),'')) is not null;
$$;
revoke all on function atlas_loop_private.source(uuid) from public, anon, authenticated;
grant execute on function atlas_loop_private.source(uuid) to service_role;

-- Identity of factual input is independent of transient operational context.
-- Confirmed facts survive opening another call or changing assignment.
create function atlas_loop_private.source_hash(p_source jsonb) returns text
language sql immutable security invoker set search_path = '' as $$
  select md5((p_source-'lead'-'has_open_call'-'campaign_active'-'memory')::text);
$$;
revoke all on function atlas_loop_private.source_hash(jsonb) from public,anon,authenticated;
grant execute on function atlas_loop_private.source_hash(jsonb) to service_role;

create function atlas_loop_private.enqueue(p_recording_id uuid) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_source jsonb; v_hash text; v_id uuid; v_config public.ai_loop_campaign_configs; v_retention timestamptz;
begin
  select cfg.* into v_config from public.ai_loop_campaign_configs cfg
    join public.call_recordings r on r.campaign_id=cfg.campaign_id where r.id=p_recording_id;
  if not found or v_config.mode<>'shadow' then return null; end if;
  v_source := atlas_loop_private.source(p_recording_id);
  if v_source is null then
    update public.ai_loop_runs set superseded_at=coalesce(superseded_at,now()),
      status=case when status in ('pending','processing') then 'superseded' else status end,
      lease_token=null,lease_until=null where recording_id=p_recording_id and superseded_at is null;
    return null;
  end if;
  v_hash:=atlas_loop_private.source_hash(v_source);
  select retention_until into v_retention from public.call_recordings where id=p_recording_id;
  insert into public.ai_loop_runs(recording_id,lead_id,campaign_id,source_hash,policy_version,expires_at)
    values(p_recording_id,(v_source->>'lead_id')::uuid,(v_source->>'campaign_id')::uuid,v_hash,v_config.policy_version,least(now()+interval '24 hours',v_retention))
    on conflict(recording_id,source_hash,policy_version) do nothing returning id into v_id;
  update public.ai_loop_runs set superseded_at=coalesce(superseded_at,now()),
    status=case when status in ('pending','processing') then 'superseded' else status end,
    lease_token=null,lease_until=null
    where recording_id=p_recording_id and source_hash<>v_hash and superseded_at is null;
  return v_id;
end;
$$;
revoke all on function atlas_loop_private.enqueue(uuid) from public, anon, authenticated;
grant execute on function atlas_loop_private.enqueue(uuid) to service_role;

create function atlas_loop_private.capture() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_recording uuid; v_campaign uuid; v_payload jsonb;
begin
  if tg_table_name='call_transcriptions' then
    perform atlas_loop_private.enqueue(new.recording_id);
  elsif tg_table_name='call_recordings' then
    perform atlas_loop_private.enqueue(new.id);
    if new.status in ('deleted','archived') then
      -- Do not retain source-derived text after source withdrawal.
      delete from public.ai_loop_runs where recording_id=new.id;
    end if;
  else
    select campaign_id into v_campaign from public.leads where id=new.lead_id;
    v_payload:=jsonb_build_object('status',new.status,'outcome',new.outcome,'reason',new.reason,
      'next_action_at',new.next_action_at,'ended_at',new.ended_at,'updated_at',new.updated_at,
      'attribution','observed_only');
    -- Historical observations are never labelled as effects of a shadow decision.
    insert into public.ai_loop_feedback(run_id,kind,source_call_id,source_version,payload)
      select run.id,case when recording.call_id=new.id then 'source_revision' else 'observed_outcome' end,
        new.id,new.id::text||':'||md5(v_payload::text),v_payload
      from public.ai_loop_runs run join public.call_recordings recording on recording.id=run.recording_id
      where run.lead_id=new.lead_id and run.campaign_id=v_campaign
        and recording.retention_until>now() and recording.status='ready'
        and (recording.call_id=new.id or new.started_at>run.created_at)
        and (new.ended_at is not null or exists(select 1 from public.ai_loop_feedback f where f.run_id=run.id and f.source_call_id=new.id))
      on conflict(run_id,kind,source_version) do nothing;
    for v_recording in select id from public.call_recordings where call_id=new.id loop
      perform atlas_loop_private.enqueue(v_recording);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function atlas_loop_private.capture() from public, anon, authenticated, service_role;
create trigger ai_loop_transcription_capture after insert or update of status,transcript_text,source_sha256 on public.call_transcriptions
  for each row execute function atlas_loop_private.capture();
create trigger ai_loop_call_capture after insert or update of ended_at,status,outcome,reason,notes,next_action_at on public.calls
  for each row execute function atlas_loop_private.capture();
create trigger ai_loop_recording_capture after update of status,sha256 on public.call_recordings
  for each row execute function atlas_loop_private.capture();

create function public.reconcile_ai_loop_runs() returns integer
language plpgsql security invoker set search_path = '' as $$
declare v_recording uuid; v_count integer:=0;
begin
  -- Bounded catch-up for enabling a campaign, retries and context changes.
  for v_recording in
    select r.id from public.call_recordings r join public.ai_loop_campaign_configs cfg on cfg.campaign_id=r.campaign_id
      join public.call_transcriptions t on t.recording_id=r.id and t.status='completed'
      where cfg.mode='shadow' and r.status='ready' and r.retention_until>now()
      order by r.started_at desc,r.id limit 200
  loop
    if atlas_loop_private.enqueue(v_recording) is not null then v_count:=v_count+1; end if;
  end loop;
  delete from public.ai_loop_runs run using public.call_recordings r
    where run.recording_id=r.id and (r.retention_until<=now() or r.status in ('deleted','archived'));
  update public.ai_loop_runs set status='superseded',superseded_at=coalesce(superseded_at,now()),lease_token=null,lease_until=null
    where status in ('pending','processing') and expires_at<=now();
  return v_count;
end;
$$;

create function public.claim_ai_loop_run(p_worker uuid,p_policy_version text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare cfg public.ai_loop_campaign_configs; job public.ai_loop_runs; v_source jsonb; v_token uuid;
begin
  if p_worker is null or p_policy_version<>'callback-v1' then raise exception 'invalid_worker'; end if;
  for cfg in select * from public.ai_loop_campaign_configs
    where mode='shadow' and policy_version=p_policy_version
      and (quota_day is distinct from (now() at time zone 'UTC')::date or attempts_today<daily_attempt_limit)
    order by updated_at,campaign_id for update skip locked
  loop
    update public.ai_loop_runs set status='failed',error_code='lease_exhausted',lease_token=null,lease_until=null
      where campaign_id=cfg.campaign_id and status='processing' and lease_until<now() and attempt_count>=3;
    select * into job from public.ai_loop_runs
      where campaign_id=cfg.campaign_id and policy_version=p_policy_version and superseded_at is null and expires_at>now()
        and attempt_count<3 and ((status='pending' and available_at<=now()) or (status='processing' and lease_until<now()))
      order by created_at,id limit 1 for update skip locked;
    if not found then continue; end if;
    v_source:=atlas_loop_private.source(job.recording_id);
    if v_source is null or atlas_loop_private.source_hash(v_source)<>job.source_hash then
      update public.ai_loop_runs set status='superseded',superseded_at=now(),lease_token=null,lease_until=null where id=job.id;
      continue;
    end if;
    v_token:=gen_random_uuid();
    update public.ai_loop_runs set status='processing',attempt_count=attempt_count+1,
      lease_token=v_token,lease_until=now()+interval '120 seconds',error_code=null,
      context_snapshot=(v_source-'transcript_text'-'memory')||jsonb_build_object('memory_ids',
        (select coalesce(jsonb_agg(item->>'id'),'[]'::jsonb) from jsonb_array_elements(v_source->'memory') item)) where id=job.id;
    update public.ai_loop_campaign_configs set quota_day=(now() at time zone 'UTC')::date,
      attempts_today=case when quota_day=(now() at time zone 'UTC')::date then attempts_today+1 else 1 end
      where campaign_id=cfg.campaign_id;
    return jsonb_build_object('id',job.id,'lease_token',v_token,'source',v_source||jsonb_build_object('source_hash',job.source_hash));
  end loop;
  return null;
end;
$$;

create function public.complete_ai_loop_run(p_run_id uuid,p_lease_token uuid,p_result jsonb) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare job public.ai_loop_runs; v_recording uuid; v_source jsonb; fact jsonb; n integer:=0; v_retention timestamptz;
begin
  select recording_id into v_recording from public.ai_loop_runs where id=p_run_id;
  if v_recording is null then return false; end if;
  -- Match the write path lock order: source call/transcription, then run.
  perform 1 from public.calls c join public.call_recordings r on r.call_id=c.id where r.id=v_recording for share of c;
  perform 1 from public.call_transcriptions where recording_id=v_recording for share;
  select * into job from public.ai_loop_runs where id=p_run_id for update;
  if job.status<>'processing' or job.lease_token is distinct from p_lease_token or job.lease_until<=now()
      or job.superseded_at is not null or job.expires_at<=now() then return false; end if;
  v_source:=atlas_loop_private.source(v_recording);
  if v_source is null or atlas_loop_private.source_hash(v_source)<>job.source_hash
      or not exists(select 1 from public.ai_loop_campaign_configs where campaign_id=job.campaign_id and mode='shadow') then
    update public.ai_loop_runs set status='superseded',superseded_at=now(),lease_token=null,lease_until=null where id=job.id;
    return false;
  end if;
  if p_result->'decision'->>'policy_version' is distinct from job.policy_version
      or p_result->'decision'->>'execution' is distinct from 'not_executed_shadow'
      or coalesce(p_result->'decision'->>'action','') not in ('callback_candidate','human_review','no_action')
      or jsonb_typeof(p_result->'analysis'->'facts') is distinct from 'array'
      or jsonb_array_length(p_result->'analysis'->'facts')>8 then raise exception 'invalid_analysis'; end if;
  select retention_until into v_retention from public.call_recordings where id=v_recording;
  for fact in select value from jsonb_array_elements(p_result->'analysis'->'facts') loop
    if length(coalesce(fact->>'quote',''))<3 or strpos(v_source->>'transcript_text',fact->>'quote')=0
      or (fact->>'requested_time_text' is not null and strpos(fact->>'quote',fact->>'requested_time_text')=0)
      then raise exception 'invalid_evidence'; end if;
    insert into public.ai_loop_memory(run_id,fact_index,kind,quote,speaker,requested_time_text,expires_at)
      values(job.id,n,fact->>'kind',fact->>'quote',fact->>'speaker',fact->>'requested_time_text',least(now()+interval '7 days',v_retention));
    n:=n+1;
  end loop;
  update public.ai_loop_runs set status='completed',analysis=p_result->'analysis',decision=p_result->'decision',
    model=p_result->>'model',extractor_version=p_result->>'extractor_version',provider_request_id=p_result->>'provider_request_id',
    usage=p_result->'usage',completed_at=now(),lease_token=null,lease_until=null where id=job.id;
  return true;
end;
$$;

create function public.fail_ai_loop_run(p_run_id uuid,p_lease_token uuid,p_error_code text) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  update public.ai_loop_runs set status=case when attempt_count>=3 then 'failed' else 'pending' end,
    error_code=left(p_error_code,80),available_at=now()+interval '5 minutes',lease_token=null,lease_until=null
    where id=p_run_id and status='processing' and lease_token=p_lease_token and lease_until>now() and superseded_at is null;
  return found;
end;
$$;

revoke all on function public.reconcile_ai_loop_runs(),public.claim_ai_loop_run(uuid,text),public.complete_ai_loop_run(uuid,uuid,jsonb),public.fail_ai_loop_run(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reconcile_ai_loop_runs(),public.claim_ai_loop_run(uuid,text),public.complete_ai_loop_run(uuid,uuid,jsonb),public.fail_ai_loop_run(uuid,uuid,text) to service_role;

create function atlas_loop_private.review(p_run_id uuid,p_expected_version integer,p_recommendation text,p_extraction text,p_note text) returns integer
language plpgsql security definer set search_path = '' as $$
declare job public.ai_loop_runs; v_source jsonb; v_review jsonb;
begin
  if auth.uid() is null or not public.is_current_app_session_valid() then raise exception 'not_authorized'; end if;
  select run.* into job from public.ai_loop_runs run join public.call_recordings r on r.id=run.recording_id
    where run.id=p_run_id and r.status='ready' and r.retention_until>now()
      and (public.current_role_name()='admin' or (public.current_role_name()='supervisor' and r.team_id=any(public.supervised_team_ids())))
    for update of run;
  if not found then raise exception 'not_authorized'; end if;
  if job.review_version<>p_expected_version then raise exception 'review_conflict'; end if;
  v_source:=atlas_loop_private.source(job.recording_id);
  if job.status<>'completed' or job.superseded_at is not null or job.expires_at<=now()
      or v_source is null or atlas_loop_private.source_hash(v_source)<>job.source_hash then raise exception 'stale_decision'; end if;
  if coalesce(p_recommendation,'') not in ('accepted','rejected') or coalesce(p_extraction,'') not in ('confirmed','rejected','unreviewed')
      or length(btrim(coalesce(p_note,''))) not between 3 and 1000 then raise exception 'invalid_review'; end if;
  v_review:=jsonb_build_object('recommendation',p_recommendation,'extraction',p_extraction,'note',btrim(p_note),'actor_id',auth.uid());
  insert into public.ai_loop_feedback(run_id,kind,actor_id,source_version,payload)
    values(job.id,'human_review',auth.uid(),'review:'||(job.review_version+1)::text,v_review);
  update public.ai_loop_runs set review=v_review,review_version=review_version+1 where id=job.id;
  update public.ai_loop_memory set state=case p_extraction when 'confirmed' then 'confirmed' when 'rejected' then 'retracted' else 'candidate' end
    where run_id=job.id and retracted_at is null;
  return job.review_version+1;
end;
$$;
revoke all on function atlas_loop_private.review(uuid,integer,text,text,text) from public,anon;
grant execute on function atlas_loop_private.review(uuid,integer,text,text,text) to authenticated;
create function public.review_ai_loop_decision(p_run_id uuid,p_expected_version integer,p_recommendation text,p_extraction text,p_note text) returns integer
language sql security invoker set search_path = '' as $$
  select atlas_loop_private.review(p_run_id,p_expected_version,p_recommendation,p_extraction,p_note);
$$;
revoke all on function public.review_ai_loop_decision(uuid,integer,text,text,text) from public,anon;
grant execute on function public.review_ai_loop_decision(uuid,integer,text,text,text) to authenticated;

create function atlas_loop_private.configure(p_campaign_id uuid,p_mode text,p_daily_limit integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.current_role_name() is distinct from 'admin'::public.app_role
      or not public.is_current_app_session_valid() then raise exception 'not_authorized'; end if;
  if coalesce(p_mode,'') not in ('off','shadow') or p_daily_limit is null or p_daily_limit not between 1 and 100 then raise exception 'invalid_configuration'; end if;
  insert into public.ai_loop_campaign_configs(campaign_id,mode,daily_attempt_limit,updated_by)
    values(p_campaign_id,p_mode,p_daily_limit,auth.uid()) on conflict(campaign_id) do update
    set mode=excluded.mode,daily_attempt_limit=excluded.daily_attempt_limit,updated_by=auth.uid(),updated_at=now();
  -- Pausing fences in-flight inference immediately; restarting never silently
  -- revives a completed/failed run or permits an operational effect.
  if p_mode='off' then
    update public.ai_loop_runs set status=case when attempt_count>=3 then 'failed' else 'pending' end,
      error_code=case when attempt_count>=3 then 'paused_at_attempt_limit' else error_code end,lease_token=null,lease_until=null
      where campaign_id=p_campaign_id and status='processing';
  end if;
end;
$$;
revoke all on function atlas_loop_private.configure(uuid,text,integer) from public,anon;
grant execute on function atlas_loop_private.configure(uuid,text,integer) to authenticated;
create function public.configure_ai_loop(p_campaign_id uuid,p_mode text,p_daily_limit integer) returns void
language sql security invoker set search_path = '' as $$
  select atlas_loop_private.configure(p_campaign_id,p_mode,p_daily_limit);
$$;
revoke all on function public.configure_ai_loop(uuid,text,integer) from public,anon;
grant execute on function public.configure_ai_loop(uuid,text,integer) to authenticated;

comment on table public.ai_loop_runs is 'Voice-only shadow decisions. No calls, messages, agenda or assignment writes. Access inherits recording scope.';
comment on table public.ai_loop_feedback is 'Append-only human feedback and observed subsequent management/revisions; observations do not establish causal lift.';

-- A factual correction remains possible after its decision expires or is
-- superseded. It never reopens acceptance of an expired recommendation.
create function atlas_loop_private.retract_memory(p_memory_id uuid,p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare fact public.ai_loop_memory; v_run_id uuid;
begin
  if auth.uid() is null or not public.is_current_app_session_valid() then raise exception 'not_authorized'; end if;
  select run.id into v_run_id from public.ai_loop_memory m
    join public.ai_loop_runs run on run.id=m.run_id join public.call_recordings r on r.id=run.recording_id
    where m.id=p_memory_id and r.status='ready' and r.retention_until>now()
      and (public.current_role_name()='admin' or (public.current_role_name()='supervisor' and r.team_id=any(public.supervised_team_ids())))
    for update of run;
  if not found then raise exception 'not_authorized'; end if;
  -- Same run → memory lock order as review; avoid a correction/review deadlock.
  select * into fact from public.ai_loop_memory where id=p_memory_id and run_id=v_run_id for update;
  if not found then raise exception 'not_authorized'; end if;
  if length(btrim(coalesce(p_note,''))) not between 3 and 1000 then raise exception 'invalid_review'; end if;
  if fact.retracted_at is not null then return false; end if;
  update public.ai_loop_memory set state='retracted',retracted_at=now() where id=fact.id;
  insert into public.ai_loop_feedback(run_id,kind,actor_id,source_version,payload)
    values(fact.run_id,'human_review',auth.uid(),'memory-retract:'||fact.id::text,
      jsonb_build_object('scope','memory_retraction','memory_id',fact.id,'note',btrim(p_note)));
  return true;
end;
$$;
revoke all on function atlas_loop_private.retract_memory(uuid,text) from public,anon;
grant execute on function atlas_loop_private.retract_memory(uuid,text) to authenticated;
create function public.retract_ai_loop_memory(p_memory_id uuid,p_note text) returns boolean
language sql security invoker set search_path = '' as $$
  select atlas_loop_private.retract_memory(p_memory_id,p_note);
$$;
revoke all on function public.retract_ai_loop_memory(uuid,text) from public,anon;
grant execute on function public.retract_ai_loop_memory(uuid,text) to authenticated;

-- Read confirmed voice memory in the existing 360, using the caller's source
-- RLS rather than a service-role read. Stale transcript facts are never returned.
create function public.get_ai_loop_memory(p_lead_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'run_id',m.run_id,'kind',m.kind,
    'quote',m.quote,'expires_at',m.expires_at) order by run.created_at desc),'[]'::jsonb)
  from public.ai_loop_memory m join public.ai_loop_runs run on run.id=m.run_id
  join public.call_recordings r on r.id=run.recording_id
  join public.call_transcriptions t on t.recording_id=r.id
  where run.lead_id=p_lead_id and m.state='confirmed' and m.expires_at>now()
    and r.status='ready' and r.retention_until>now() and t.status='completed' and t.source_sha256=r.sha256
    and run.context_snapshot->>'transcript_hash'=md5(t.transcript_text);
$$;
revoke all on function public.get_ai_loop_memory(uuid) from public,anon;
grant execute on function public.get_ai_loop_memory(uuid) to authenticated,service_role;
notify pgrst, 'reload schema';
