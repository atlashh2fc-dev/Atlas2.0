-- Integration v2: bounded durable transport. Business projections remain in
-- their existing tables; this migration only adds an asynchronous envelope.

-- Avoid a write-blocking index build on the calls hot path.
create index concurrently if not exists calls_integration_feedback_keyset_idx
  on public.calls (ended_at, id)
  where ended_at is not null;

begin;

insert into public.integration_sources (code, name, source_kind, provider, is_active)
values ('bigdata', 'Bigdata', 'bigdata', 'bigdata', true)
on conflict (code) do update set is_active = true, updated_at = now();

create table public.integration_campaign_mappings (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.integration_sources(id) on delete cascade,
  external_campaign_key text not null,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_campaign_mappings_key_not_blank check (btrim(external_campaign_key) <> ''),
  unique (source_id, external_campaign_key)
);

create table public.integration_inbox_batches (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.integration_sources(id) on delete restrict,
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  campaign_key text,
  idempotency_key text not null,
  content_sha256 text not null,
  schema_version text not null default '1',
  status text not null default 'accepted'
    check (status in ('accepted', 'processing', 'succeeded', 'partially_succeeded', 'dead_letter')),
  rows_total integer not null check (rows_total between 1 and 500),
  rows_succeeded integer not null default 0 check (rows_succeeded >= 0),
  rows_replayed integer not null default 0 check (rows_replayed >= 0),
  rows_dead_letter integer not null default 0 check (rows_dead_letter >= 0),
  metadata jsonb not null default '{}'::jsonb,
  accepted_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint integration_inbox_batches_idempotency_not_blank check (btrim(idempotency_key) <> ''),
  constraint integration_inbox_batches_sha256 check (content_sha256 ~ '^[0-9a-f]{64}$'),
  unique (source_id, idempotency_key)
);

create table public.integration_inbox_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.integration_inbox_batches(id) on delete cascade,
  source_id uuid not null references public.integration_sources(id) on delete restrict,
  sequence integer not null check (sequence between 1 and 500),
  event_id text not null,
  event_type text not null check (event_type in ('intelligence.decision.v1', 'engagement.event.v1')),
  external_key text not null,
  occurred_at timestamptz not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 32),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  processed_at timestamptz,
  result jsonb,
  last_error_code text,
  last_error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_inbox_items_event_id_not_blank check (btrim(event_id) <> ''),
  constraint integration_inbox_items_external_key_not_blank check (btrim(external_key) <> ''),
  unique (batch_id, sequence),
  unique (source_id, event_id)
);

create table public.integration_dead_letters (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('inbox', 'outbox')),
  inbox_item_id uuid unique references public.integration_inbox_items(id) on delete cascade,
  outbox_event_id uuid,
  event_type text not null,
  payload jsonb not null,
  attempts integer not null,
  error_code text not null,
  error_detail text,
  failed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint integration_dead_letters_target check (
    (direction = 'inbox' and inbox_item_id is not null and outbox_event_id is null)
    or (direction = 'outbox' and inbox_item_id is null and outbox_event_id is not null)
  )
);

create table public.integration_outbox_events (
  id uuid primary key default gen_random_uuid(),
  destination_source_id uuid not null references public.integration_sources(id) on delete restrict,
  event_id text not null,
  event_type text not null,
  schema_version text not null default '1',
  aggregate_type text,
  aggregate_id text,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'delivered', 'dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 32),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  provider_ack text,
  last_http_status integer,
  last_error_code text,
  last_error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_outbox_events_event_id_not_blank check (btrim(event_id) <> ''),
  constraint integration_outbox_events_event_type_not_blank check (btrim(event_type) <> ''),
  unique (destination_source_id, event_id)
);

create table public.integration_feedback_checkpoints (
  destination_source_id uuid not null references public.integration_sources(id) on delete cascade,
  feed_type text not null,
  last_ended_at timestamptz not null default 'epoch'::timestamptz,
  last_call_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
  updated_at timestamptz not null default now(),
  primary key (destination_source_id, feed_type)
);

alter table public.integration_dead_letters
  add constraint integration_dead_letters_outbox_fkey
  foreign key (outbox_event_id) references public.integration_outbox_events(id) on delete cascade;

alter table public.external_lead_events
  add column if not exists integration_item_id uuid
    references public.integration_inbox_items(id) on delete set null;

create unique index external_lead_events_integration_item_uidx
  on public.external_lead_events (integration_item_id)
  where integration_item_id is not null;

create index integration_inbox_items_claim_idx
  on public.integration_inbox_items (available_at, created_at, id)
  where status = 'pending';
create index integration_inbox_items_expired_lease_idx
  on public.integration_inbox_items (lease_expires_at, id)
  where status = 'processing';
create index integration_inbox_items_batch_status_idx
  on public.integration_inbox_items (batch_id, status);
create index integration_inbox_batches_status_idx
  on public.integration_inbox_batches (status, accepted_at);
create index integration_campaign_mappings_campaign_idx
  on public.integration_campaign_mappings (campaign_id, source_id)
  where is_active;
create index integration_outbox_claim_idx
  on public.integration_outbox_events (available_at, created_at, id)
  where status = 'pending';
create index integration_outbox_expired_lease_idx
  on public.integration_outbox_events (lease_expires_at, id)
  where status = 'processing';
create index integration_dead_letters_failed_idx
  on public.integration_dead_letters (direction, failed_at desc);
create unique index integration_dead_letters_outbox_uidx
  on public.integration_dead_letters (outbox_event_id)
  where outbox_event_id is not null;

alter table public.integration_campaign_mappings enable row level security;
alter table public.integration_inbox_batches enable row level security;
alter table public.integration_inbox_items enable row level security;
alter table public.integration_dead_letters enable row level security;
alter table public.integration_outbox_events enable row level security;
alter table public.integration_feedback_checkpoints enable row level security;

revoke all on table public.integration_inbox_batches from public, anon, authenticated;
revoke all on table public.integration_inbox_items from public, anon, authenticated;
revoke all on table public.integration_dead_letters from public, anon, authenticated;
revoke all on table public.integration_outbox_events from public, anon, authenticated;
revoke all on table public.integration_campaign_mappings from public, anon, authenticated;
revoke all on table public.integration_feedback_checkpoints from public, anon, authenticated;
grant select, insert, update, delete on table public.integration_inbox_batches to service_role;
grant select, insert, update, delete on table public.integration_inbox_items to service_role;
grant select, insert, update, delete on table public.integration_dead_letters to service_role;
grant select, insert, update, delete on table public.integration_outbox_events to service_role;
grant select, insert, update, delete on table public.integration_campaign_mappings to service_role;
grant select, insert, update, delete on table public.integration_feedback_checkpoints to service_role;

create or replace function public.integration_v2_refresh_batch_status(p_batch_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  with totals as (
    select i.batch_id,
      count(*) filter (where i.status = 'succeeded')::integer as succeeded,
      count(*) filter (where i.status = 'dead_letter')::integer as dead_letter,
      count(*) filter (where i.status in ('pending', 'processing'))::integer as remaining
    from public.integration_inbox_items i
    where i.batch_id = any(coalesce(p_batch_ids, array[]::uuid[]))
    group by i.batch_id
  )
  update public.integration_inbox_batches b
  set rows_succeeded = t.succeeded,
      rows_dead_letter = t.dead_letter,
      status = case
        when t.remaining > 0 then 'processing'
        when t.succeeded + b.rows_replayed = b.rows_total then 'succeeded'
        when t.dead_letter = b.rows_total then 'dead_letter'
        else 'partially_succeeded'
      end,
      completed_at = case when t.remaining = 0 then coalesce(b.completed_at, now()) else null end,
      updated_at = now()
  from totals t
  where b.id = t.batch_id;
$$;

create or replace function public.accept_integration_batch_v2(
  p_source_code text,
  p_campaign_id uuid,
  p_campaign_key text,
  p_idempotency_key text,
  p_content_sha256 text,
  p_schema_version text,
  p_items jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_id uuid;
  v_source_code text;
  v_resolved_campaign_id uuid;
  v_campaign_key text := nullif(btrim(coalesce(p_campaign_key, '')), '');
  v_batch_id uuid;
  v_existing_hash text;
  v_total integer;
  v_replayed integer := 0;
begin
  select s.id, s.code into v_source_id, v_source_code
  from public.integration_sources s
  where s.code = lower(btrim(p_source_code)) and s.is_active;
  if v_source_id is null then raise exception 'integration_v2_source_not_active'; end if;
  if v_campaign_key is not null then
    if v_source_code = 'atlas_lead' then
      select mc.campaign_id into v_resolved_campaign_id
      from public.mail_campaigns mc
      where mc.source_id = v_source_id and mc.external_campaign_key = v_campaign_key;
    else
      select m.campaign_id into v_resolved_campaign_id
      from public.integration_campaign_mappings m
      where m.source_id = v_source_id and m.external_campaign_key = v_campaign_key and m.is_active;
    end if;
    if v_resolved_campaign_id is null then raise exception 'integration_v2_campaign_mapping_not_found'; end if;
    if p_campaign_id is not null and p_campaign_id <> v_resolved_campaign_id then
      raise exception 'integration_v2_campaign_mapping_conflict';
    end if;
  else
    v_resolved_campaign_id := p_campaign_id;
  end if;
  if v_resolved_campaign_id is null or not exists (select 1 from public.campaigns c where c.id = v_resolved_campaign_id) then
    raise exception 'integration_v2_campaign_not_found';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then raise exception 'integration_v2_idempotency_required'; end if;
  if coalesce(p_content_sha256, '') !~ '^[0-9a-f]{64}$' then raise exception 'integration_v2_invalid_sha256'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'integration_v2_items_must_be_array'; end if;
  v_total := jsonb_array_length(p_items);
  if v_total < 1 or v_total > 500 then raise exception 'integration_v2_batch_limit'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) x
    group by x->>'event_id' having count(*) > 1
  ) then raise exception 'integration_v2_duplicate_event_id'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) x
    join public.integration_inbox_items i
      on i.source_id = v_source_id and i.event_id = btrim(x->>'event_id')
    join public.integration_inbox_batches existing_batch on existing_batch.id = i.batch_id
    where existing_batch.campaign_id <> v_resolved_campaign_id
       or i.event_type <> btrim(x->>'event_type')
       or i.external_key <> btrim(x->>'external_key')
       or i.occurred_at <> (x->>'occurred_at')::timestamptz
       or i.payload <> coalesce(x->'payload', '{}'::jsonb)
  ) then raise exception 'integration_v2_event_id_conflict'; end if;

  select count(*)::integer into v_replayed
  from jsonb_array_elements(p_items) x
  join public.integration_inbox_items i
    on i.source_id = v_source_id and i.event_id = btrim(x->>'event_id');

  insert into public.integration_inbox_batches (
    source_id, campaign_id, campaign_key, idempotency_key, content_sha256, schema_version,
    rows_total, rows_replayed, metadata
  ) values (
    v_source_id, v_resolved_campaign_id, v_campaign_key, btrim(p_idempotency_key), p_content_sha256,
    coalesce(nullif(btrim(p_schema_version), ''), '1'), v_total, v_replayed,
    coalesce(p_metadata, '{}'::jsonb)
  ) on conflict (source_id, idempotency_key) do nothing
  returning id into v_batch_id;

  if v_batch_id is null then
    select b.id, b.content_sha256 into v_batch_id, v_existing_hash
    from public.integration_inbox_batches b
    where b.source_id = v_source_id and b.idempotency_key = btrim(p_idempotency_key);
    if v_existing_hash <> p_content_sha256 then raise exception 'integration_v2_idempotency_conflict'; end if;
    return jsonb_build_object('batch_id', v_batch_id, 'accepted', true, 'replayed', true, 'rows_total', v_total);
  end if;

  insert into public.integration_inbox_items (
    batch_id, source_id, sequence, event_id, event_type, external_key,
    occurred_at, payload
  )
  select v_batch_id, v_source_id, x.ordinality::integer,
    btrim(x.item->>'event_id'), btrim(x.item->>'event_type'),
    btrim(x.item->>'external_key'), (x.item->>'occurred_at')::timestamptz,
    coalesce(x.item->'payload', '{}'::jsonb)
  from jsonb_array_elements(p_items) with ordinality as x(item, ordinality)
  on conflict (source_id, event_id) do nothing;

  -- Recheck after INSERT to close the race where another batch committed the
  -- same event_id between prevalidation and ON CONFLICT.
  if exists (
    select 1
    from jsonb_array_elements(p_items) x
    join public.integration_inbox_items i
      on i.source_id = v_source_id and i.event_id = btrim(x->>'event_id')
    join public.integration_inbox_batches existing_batch on existing_batch.id = i.batch_id
    where existing_batch.campaign_id <> v_resolved_campaign_id
       or i.event_type <> btrim(x->>'event_type')
       or i.external_key <> btrim(x->>'external_key')
       or i.occurred_at <> (x->>'occurred_at')::timestamptz
       or i.payload <> coalesce(x->'payload', '{}'::jsonb)
  ) then raise exception 'integration_v2_event_id_conflict'; end if;

  select count(*)::integer into v_replayed
  from jsonb_array_elements(p_items) x
  join public.integration_inbox_items i
    on i.source_id = v_source_id and i.event_id = btrim(x->>'event_id')
   and i.batch_id <> v_batch_id;
  update public.integration_inbox_batches set rows_replayed = v_replayed,
    updated_at = now() where id = v_batch_id;

  if v_replayed = v_total then
    update public.integration_inbox_batches set status = 'succeeded',
      rows_succeeded = 0, completed_at = now(), updated_at = now()
    where id = v_batch_id;
  end if;

  return jsonb_build_object('batch_id', v_batch_id, 'accepted', true,
    'replayed', false, 'rows_total', v_total, 'rows_replayed', v_replayed);
exception
  when unique_violation then
    raise exception 'integration_v2_duplicate_event_id';
end;
$$;

create or replace function public.claim_integration_items_v2(
  p_worker_id text,
  p_limit integer default 100,
  p_lease_seconds integer default 60
)
returns table (
  item_id uuid, batch_id uuid, source_code text, campaign_id uuid,
  event_id text, event_type text, external_key text, occurred_at timestamptz,
  payload jsonb, attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare v_batch_ids uuid[];
begin
  if nullif(btrim(p_worker_id), '') is null then raise exception 'integration_v2_worker_required'; end if;
  return query
  with candidates as (
    select i.id
    from public.integration_inbox_items i
    where (i.status = 'pending' and i.available_at <= now())
       or (i.status = 'processing' and i.lease_expires_at < now())
    order by i.available_at, i.created_at, i.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ), claimed as (
    update public.integration_inbox_items i
    set status = 'processing', attempts = i.attempts + 1,
        lease_owner = btrim(p_worker_id),
        lease_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 60), 15), 900)),
        updated_at = now()
    from candidates c where i.id = c.id
    returning i.*
  ), started as (
    update public.integration_inbox_batches b
    set status = 'processing', started_at = coalesce(b.started_at, now()),
        completed_at = null, updated_at = now()
    where b.id in (select distinct c.batch_id from claimed c)
    returning b.id
  )
  select c.id, c.batch_id, s.code, b.campaign_id, c.event_id, c.event_type,
    c.external_key, c.occurred_at, c.payload, c.attempts
  from claimed c
  join public.integration_inbox_batches b on b.id = c.batch_id
  join public.integration_sources s on s.id = c.source_id
  order by c.created_at, c.id;
end;
$$;

create or replace function public.ack_integration_items_v2(
  p_worker_id text, p_item_ids uuid[], p_result jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer; v_batches uuid[];
begin
  if coalesce(cardinality(p_item_ids), 0) > 500 then raise exception 'integration_v2_batch_limit'; end if;
  with changed as (
    update public.integration_inbox_items i
    set status = 'succeeded', processed_at = now(), result = coalesce(p_result, '{}'::jsonb),
        lease_owner = null, lease_expires_at = null, last_error_code = null,
        last_error_detail = null, updated_at = now()
    where i.id = any(coalesce(p_item_ids, array[]::uuid[]))
      and i.status = 'processing' and i.lease_owner = btrim(p_worker_id)
    returning i.batch_id
  )
  select count(*)::integer, array_agg(distinct batch_id) into v_count, v_batches from changed;
  perform public.integration_v2_refresh_batch_status(coalesce(v_batches, array[]::uuid[]));
  return coalesce(v_count, 0);
end;
$$;

create or replace function public.nack_integration_items_v2(
  p_worker_id text, p_item_ids uuid[], p_error_code text,
  p_error_detail text default null, p_retryable boolean default true,
  p_retry_after_seconds integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_retried integer := 0; v_dead integer := 0; v_batches uuid[];
begin
  if coalesce(cardinality(p_item_ids), 0) > 500 then raise exception 'integration_v2_batch_limit'; end if;
  with changed as (
    update public.integration_inbox_items i
    set status = case when p_retryable and i.attempts < i.max_attempts then 'pending' else 'dead_letter' end,
        available_at = case when p_retryable and i.attempts < i.max_attempts
          then now() + make_interval(secs => least(greatest(coalesce(p_retry_after_seconds, 30), 1), 86400))
          else i.available_at end,
        processed_at = case when p_retryable and i.attempts < i.max_attempts then null else now() end,
        lease_owner = null, lease_expires_at = null,
        last_error_code = coalesce(nullif(btrim(p_error_code), ''), 'processing_error'),
        last_error_detail = left(p_error_detail, 4000), updated_at = now()
    where i.id = any(coalesce(p_item_ids, array[]::uuid[]))
      and i.status = 'processing' and i.lease_owner = btrim(p_worker_id)
    returning i.*
  ), dlq as (
    insert into public.integration_dead_letters (
      direction, inbox_item_id, event_type, payload, attempts, error_code, error_detail
    )
    select 'inbox', c.id, c.event_type, c.payload, c.attempts,
      c.last_error_code, c.last_error_detail from changed c where c.status = 'dead_letter'
    on conflict (inbox_item_id) do update set attempts = excluded.attempts,
      error_code = excluded.error_code, error_detail = excluded.error_detail, failed_at = now()
    returning inbox_item_id
  )
  select count(*) filter (where status = 'pending')::integer,
    count(*) filter (where status = 'dead_letter')::integer,
    array_agg(distinct batch_id)
  into v_retried, v_dead, v_batches from changed;
  perform public.integration_v2_refresh_batch_status(coalesce(v_batches, array[]::uuid[]));
  return jsonb_build_object('retried', coalesce(v_retried, 0), 'dead_lettered', coalesce(v_dead, 0));
end;
$$;

create or replace function public.enqueue_integration_outbox_v2(
  p_destination_source_code text, p_event_id text, p_event_type text,
  p_payload jsonb, p_aggregate_type text default null, p_aggregate_id text default null
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_source uuid; v_id uuid; v_existing_type text; v_existing_payload jsonb;
begin
  select id into v_source from public.integration_sources
  where code = lower(btrim(p_destination_source_code)) and is_active;
  if v_source is null then raise exception 'integration_v2_source_not_active'; end if;
  select o.id, o.event_type, o.payload into v_id, v_existing_type, v_existing_payload
  from public.integration_outbox_events o
  where o.destination_source_id = v_source and o.event_id = btrim(p_event_id);
  if v_id is not null then
    if v_existing_type <> btrim(p_event_type) or v_existing_payload <> p_payload then
      raise exception 'integration_v2_outbox_idempotency_conflict';
    end if;
    return v_id;
  end if;
  insert into public.integration_outbox_events (
    destination_source_id, event_id, event_type, aggregate_type, aggregate_id, payload
  ) values (v_source, btrim(p_event_id), btrim(p_event_type), p_aggregate_type, p_aggregate_id, p_payload)
  on conflict (destination_source_id, event_id) do nothing
  returning id into v_id;
  if v_id is null then
    select o.id, o.event_type, o.payload into v_id, v_existing_type, v_existing_payload
    from public.integration_outbox_events o
    where o.destination_source_id = v_source and o.event_id = btrim(p_event_id);
    if v_existing_type <> btrim(p_event_type) or v_existing_payload <> p_payload then
      raise exception 'integration_v2_outbox_idempotency_conflict';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.upsert_integration_campaign_mapping_v2(
  p_source_code text, p_campaign_key text, p_campaign_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_source_id uuid; v_mapping_id uuid;
begin
  select s.id into v_source_id from public.integration_sources s
  where s.code = lower(btrim(p_source_code)) and s.is_active;
  if v_source_id is null then raise exception 'integration_v2_source_not_active'; end if;
  if nullif(btrim(p_campaign_key),'') is null then raise exception 'integration_v2_campaign_key_required'; end if;
  if not exists (select 1 from public.campaigns c where c.id = p_campaign_id) then
    raise exception 'integration_v2_campaign_not_found';
  end if;
  insert into public.integration_campaign_mappings (
    source_id, external_campaign_key, campaign_id, is_active, metadata
  ) values (v_source_id,btrim(p_campaign_key),p_campaign_id,true,coalesce(p_metadata,'{}'::jsonb))
  on conflict (source_id,external_campaign_key) do update set
    campaign_id=excluded.campaign_id,is_active=true,
    metadata=public.integration_campaign_mappings.metadata || excluded.metadata,updated_at=now()
  returning id into v_mapping_id;
  return v_mapping_id;
end;
$$;

create or replace function public.claim_integration_outbox_v2(
  p_worker_id text, p_limit integer default 100, p_lease_seconds integer default 60
)
returns table (
  outbox_id uuid, destination_source_code text, event_id text, event_type text,
  schema_version text, payload jsonb, created_at timestamptz, attempts integer
)
language sql security definer set search_path = '' as $$
  with candidates as (
    select o.id from public.integration_outbox_events o
    where (o.status = 'pending' and o.available_at <= now())
       or (o.status = 'processing' and o.lease_expires_at < now())
    order by o.available_at, o.created_at, o.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  )
  , claimed as (
    update public.integration_outbox_events o
    set status = 'processing', attempts = o.attempts + 1,
        lease_owner = btrim(p_worker_id),
        lease_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 60), 15), 900)),
        updated_at = now()
    from candidates c where o.id = c.id returning o.*
  )
  select c.id, s.code, c.event_id, c.event_type, c.schema_version,
    c.payload, c.created_at, c.attempts
  from claimed c join public.integration_sources s on s.id = c.destination_source_id;
$$;

create or replace function public.ack_integration_outbox_v2(
  p_worker_id text, p_event_ids uuid[], p_provider_ack text default null,
  p_http_status integer default null
)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if coalesce(cardinality(p_event_ids),0) > 500 then raise exception 'integration_v2_batch_limit'; end if;
  with changed as (
    update public.integration_outbox_events o
    set status = 'delivered', delivered_at = now(), provider_ack = left(p_provider_ack, 1000),
        last_http_status = p_http_status, lease_owner = null, lease_expires_at = null,
        last_error_code = null, last_error_detail = null, updated_at = now()
    where o.id = any(coalesce(p_event_ids, array[]::uuid[]))
      and o.status = 'processing' and o.lease_owner = btrim(p_worker_id)
    returning 1
  ) select count(*)::integer into v_count from changed;
  return coalesce(v_count,0);
end;
$$;

create or replace function public.nack_integration_outbox_v2(
  p_worker_id text, p_event_ids uuid[], p_error_code text,
  p_error_detail text default null, p_retryable boolean default true,
  p_retry_after_seconds integer default 30, p_http_status integer default null
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_retried integer; v_dead integer;
begin
  if coalesce(cardinality(p_event_ids), 0) > 500 then raise exception 'integration_v2_batch_limit'; end if;
  with changed as (
    update public.integration_outbox_events o
    set status = case when p_retryable and o.attempts < o.max_attempts then 'pending' else 'dead_letter' end,
      available_at = case when p_retryable and o.attempts < o.max_attempts
        then now() + make_interval(secs => least(greatest(coalesce(p_retry_after_seconds, 30), 1), 86400))
        else o.available_at end,
      lease_owner = null, lease_expires_at = null, last_http_status = p_http_status,
      last_error_code = coalesce(nullif(btrim(p_error_code), ''), 'delivery_error'),
      last_error_detail = left(p_error_detail, 4000), updated_at = now()
    where o.id = any(coalesce(p_event_ids, array[]::uuid[]))
      and o.status = 'processing' and o.lease_owner = btrim(p_worker_id)
    returning o.*
  ), dlq as (
    insert into public.integration_dead_letters (
      direction, outbox_event_id, event_type, payload, attempts, error_code, error_detail
    ) select 'outbox', c.id, c.event_type, c.payload, c.attempts,
      c.last_error_code, c.last_error_detail from changed c where c.status = 'dead_letter'
    on conflict (outbox_event_id) where outbox_event_id is not null
    do update set attempts = excluded.attempts,
      error_code = excluded.error_code, error_detail = excluded.error_detail, failed_at = now()
    returning outbox_event_id
  )
  select count(*) filter (where status = 'pending')::integer,
    count(*) filter (where status = 'dead_letter')::integer
  into v_retried, v_dead from changed;
  return jsonb_build_object('retried', coalesce(v_retried, 0), 'dead_lettered', coalesce(v_dead, 0));
end;
$$;

-- Incremental daily feedback: no trigger and no HTTP inside Postgres. The
-- checkpoint advances in the same transaction that inserts the outbox rows.
create or replace function public.generate_operation_feedback_v2(
  p_destination_source_code text default 'bigdata', p_limit integer default 500
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_source_id uuid;
  v_last_ended_at timestamptz;
  v_last_call_id uuid;
  v_generated integer := 0;
  v_new_ended_at timestamptz;
  v_new_call_id uuid;
begin
  select s.id into v_source_id from public.integration_sources s
  where s.code = lower(btrim(p_destination_source_code)) and s.is_active;
  if v_source_id is null then raise exception 'integration_v2_source_not_active'; end if;

  insert into public.integration_feedback_checkpoints (destination_source_id, feed_type)
  values (v_source_id, 'operation.feedback.v1') on conflict do nothing;
  select c.last_ended_at, c.last_call_id into v_last_ended_at, v_last_call_id
  from public.integration_feedback_checkpoints c
  where c.destination_source_id = v_source_id and c.feed_type = 'operation.feedback.v1'
  for update;

  with selected as materialized (
    select c.id, c.ended_at, c.started_at, c.status, c.outcome, c.reason,
      c.next_action_at, r.external_key, m.external_campaign_key
    from public.calls c
    join public.leads l on l.id = c.lead_id
    join lateral (
      select ref.external_key from public.lead_external_refs ref
      where ref.source_id = v_source_id and ref.campaign_id = l.campaign_id and ref.lead_id = l.id
      order by ref.last_seen_at desc, ref.id limit 1
    ) r on true
    join public.integration_campaign_mappings m on m.source_id = v_source_id
      and m.campaign_id = l.campaign_id and m.is_active
    where c.ended_at is not null and (c.ended_at, c.id) > (v_last_ended_at, v_last_call_id)
    order by c.ended_at, c.id
    limit least(greatest(coalesce(p_limit, 500), 1), 500)
  ), inserted as (
    insert into public.integration_outbox_events (
      destination_source_id, event_id, event_type, aggregate_type, aggregate_id, payload
    ) select v_source_id, 'operation.feedback.v1:' || s.id::text,
      'operation.feedback.v1', 'lead', s.external_key,
      jsonb_strip_nulls(jsonb_build_object(
        'campaign_key', s.external_campaign_key,
        'external_key', s.external_key,
        'ended_at', s.ended_at,
        'duration_seconds', case when s.started_at is not null then greatest(extract(epoch from (s.ended_at-s.started_at))::integer,0) end,
        'status', s.status, 'outcome', s.outcome, 'reason', s.reason,
        'next_action_at', s.next_action_at
      ))
    from selected s on conflict (destination_source_id, event_id) do nothing
    returning id
  ), last_selected as (
    select s.ended_at, s.id from selected s order by s.ended_at desc, s.id desc limit 1
  )
  select (select count(*)::integer from inserted), l.ended_at, l.id
  into v_generated, v_new_ended_at, v_new_call_id from last_selected l;

  if v_new_ended_at is not null then
    update public.integration_feedback_checkpoints c
    set last_ended_at = v_new_ended_at, last_call_id = v_new_call_id, updated_at = now()
    where c.destination_source_id = v_source_id and c.feed_type = 'operation.feedback.v1'
      and (c.last_ended_at, c.last_call_id) < (v_new_ended_at, v_new_call_id);
  end if;
  return jsonb_build_object('generated', coalesce(v_generated,0),
    'checkpoint_ended_at', coalesce(v_new_ended_at,v_last_ended_at),
    'checkpoint_call_id', coalesce(v_new_call_id,v_last_call_id));
end;
$$;

-- One SQL statement projects every Bigdata decision in the claim. A stale
-- event remains audited but cannot overwrite a newer priority.
create or replace function public.apply_intelligence_decisions_v2(
  p_worker_id text, p_item_ids uuid[]
)
returns table (item_id uuid, success boolean, error_code text)
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(cardinality(p_item_ids), 0) > 500 then raise exception 'integration_v2_batch_limit'; end if;
  return query
  with input as (
    select i.id, i.source_id, s.code as source_code, i.external_key, i.occurred_at, i.payload,
      b.campaign_id,
      case when coalesce(i.payload->>'priority_rank', '') ~ '^[0-9]{1,3}$'
        then (i.payload->>'priority_rank')::integer end as priority_rank,
      nullif(left(btrim(i.payload->>'priority_reason'), 500), '') as priority_reason
    from public.integration_inbox_items i
    join public.integration_inbox_batches b on b.id = i.batch_id
    join public.integration_sources s on s.id = i.source_id
    where i.id = any(coalesce(p_item_ids, array[]::uuid[]))
      and i.status = 'processing' and i.lease_owner = btrim(p_worker_id)
      and i.event_type = 'intelligence.decision.v1'
  ), rut_matches as (
    select x.id, (array_agg(l.id order by l.id))[1] as lead_id, count(*) as matches
    from input x join public.leads l on l.campaign_id = x.campaign_id
      and x.source_code = 'bigdata'
      and public.atlas_normalize_rut(l.rut) = public.atlas_normalize_rut(x.external_key)
    where public.atlas_normalize_rut(x.external_key) is not null
    group by x.id
  ), resolved as (
    select x.*, r.id as ref_id,
      coalesce(r.lead_id, case when rm.matches = 1 then rm.lead_id end) as lead_id,
      coalesce(rm.matches,0) as rut_match_count
    from input x left join public.lead_external_refs r
      on r.source_id = x.source_id and r.campaign_id = x.campaign_id
      and r.external_key = x.external_key
    left join rut_matches rm on rm.id = x.id
  ), valid as (
    select * from resolved where lead_id is not null and priority_rank between 0 and 999
  ), new_refs as (
    insert into public.lead_external_refs (
      source_id,campaign_id,lead_id,external_key,last_seen_at,source_payload
    ) select v.source_id,v.campaign_id,v.lead_id,v.external_key,v.occurred_at,
      jsonb_build_object('matched_by','rut_fallback_v2')
    from valid v where v.ref_id is null and v.rut_match_count = 1
    on conflict (source_id,campaign_id,external_key) do update set
      lead_id=excluded.lead_id,last_seen_at=greatest(public.lead_external_refs.last_seen_at,excluded.last_seen_at)
    returning id
  ), refs as (
    update public.lead_external_refs r set last_seen_at = greatest(r.last_seen_at, v.occurred_at)
    from valid v where r.id = v.ref_id returning r.id
  ), leads as (
    update public.leads l set external_priority_rank = v.priority_rank,
      external_priority_reason = coalesce(v.priority_reason, 'Decision de prioridad Bigdata'),
      external_last_source_code = s.code, external_last_seen_at = v.occurred_at,
      updated_at = now()
    from valid v join public.integration_sources s on s.id = v.source_id
    where l.id = v.lead_id
      and v.occurred_at >= coalesce(l.external_last_seen_at, '-infinity'::timestamptz)
    returning l.id
  ), decision_events as (
    insert into public.external_lead_events (
      source_id, campaign_id, lead_id, external_key, event_type, event_score,
      occurred_at, payload, integration_item_id
    ) select v.source_id, v.campaign_id, v.lead_id, v.external_key,
      'intelligence.decision.v1', v.priority_rank, v.occurred_at,
      jsonb_build_object('priority_rank', v.priority_rank,
        'priority_reason', v.priority_reason), v.id
    from valid v on conflict (integration_item_id) where integration_item_id is not null do nothing
    returning integration_item_id
  )
  select r.id, (r.lead_id is not null and r.priority_rank between 0 and 999),
    case when r.lead_id is null and r.rut_match_count > 1 then 'rut_match_ambiguous'
      when r.lead_id is null then 'external_ref_not_found'
      when r.priority_rank is null or r.priority_rank not between 0 and 999 then 'invalid_priority_rank'
      else null end
  from resolved r;
end;
$$;

-- Atlas Lead events update both existing mail projections in bulk. The v2
-- inbox item is the raw audit record, so the legacy row trigger is bypassed.
create or replace function public.apply_engagement_events_v2(
  p_worker_id text, p_item_ids uuid[]
)
returns table (item_id uuid, success boolean, error_code text)
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(cardinality(p_item_ids), 0) > 500 then raise exception 'integration_v2_batch_limit'; end if;
  return query
  with input as (
    select i.id, i.source_id, i.external_key, i.occurred_at, i.payload, b.campaign_id,
      public.atlas_normalize_email(i.payload->>'email') as email_normalized,
      public.atlas_boolish(i.payload->>'sent') as sent,
      public.atlas_boolish(i.payload->>'delivered') as delivered,
      public.atlas_boolish(i.payload->>'bounced') as bounced,
      public.atlas_boolish(i.payload->>'opened') as opened,
      public.atlas_boolish(i.payload->>'clicked') as clicked,
      public.atlas_boolish(i.payload->>'complained') as complained,
      public.atlas_boolish(i.payload->>'unsubscribed') as unsubscribed,
      nullif(btrim(i.payload->>'external_campaign_key'), '') as external_campaign_key
    from public.integration_inbox_items i
    join public.integration_inbox_batches b on b.id = i.batch_id
    where i.id = any(coalesce(p_item_ids, array[]::uuid[]))
      and i.status = 'processing' and i.lease_owner = btrim(p_worker_id)
      and i.event_type = 'engagement.event.v1'
  ), email_matches as (
    select x.id, (array_agg(l.id order by l.id))[1] as lead_id, count(*) as matches
    from input x join public.leads l on l.campaign_id = x.campaign_id
      and public.atlas_normalize_email(l.email) = x.email_normalized
    where x.email_normalized is not null group by x.id
  ), resolved as (
    select x.*, coalesce(r.lead_id,
      case when em.matches = 1 then em.lead_id end) as lead_id,
      mc.id as mail_campaign_id, projected.integration_item_id as projected_item_id
    from input x
    left join public.lead_external_refs r on r.source_id = x.source_id
      and r.campaign_id = x.campaign_id and r.external_key = x.external_key
    left join email_matches em on em.id = x.id
    left join public.mail_campaigns mc on mc.source_id = x.source_id
      and mc.campaign_id = x.campaign_id
      and mc.external_campaign_key = x.external_campaign_key
    left join public.external_lead_events projected on projected.integration_item_id = x.id
  ), valid as (
    select *, public.atlas_mail_priority_bucket(clicked, opened, bounced,
      complained, unsubscribed, delivered, sent) as bucket
    from resolved where lead_id is not null and mail_campaign_id is not null
      and projected_item_id is null
  ), grouped as (
    select campaign_id, lead_id, min(occurred_at) as first_seen_at,
      max(occurred_at) as last_seen_at, max(email_normalized) as email_normalized,
      bool_or(sent) sent, bool_or(delivered) delivered, bool_or(bounced) bounced,
      bool_or(opened) opened, bool_or(clicked) clicked,
      bool_or(complained) complained, bool_or(unsubscribed) unsubscribed,
      count(*) filter (where sent)::integer sent_count,
      count(*) filter (where delivered)::integer delivered_count,
      count(*) filter (where bounced)::integer bounced_count,
      count(*) filter (where opened)::integer opened_count,
      count(*) filter (where clicked)::integer clicked_count,
      count(*) filter (where complained)::integer complained_count,
      count(*) filter (where unsubscribed)::integer unsubscribed_count
    from valid group by campaign_id, lead_id
  ), lead_projection as (
    insert into public.lead_mail_status (
      campaign_id, lead_id, email_normalized, first_seen_at, last_seen_at,
      sent, delivered, bounced, opened, clicked, complained, unsubscribed,
      sent_count, delivered_count, bounced_count, opened_count, clicked_count,
      complained_count, unsubscribed_count, priority_bucket, priority_rank, priority_reason
    ) select g.campaign_id, g.lead_id, g.email_normalized, g.first_seen_at, g.last_seen_at,
      g.sent, g.delivered, g.bounced, g.opened, g.clicked, g.complained, g.unsubscribed,
      g.sent_count, g.delivered_count, g.bounced_count, g.opened_count, g.clicked_count,
      g.complained_count, g.unsubscribed_count,
      public.atlas_mail_priority_bucket(g.clicked,g.opened,g.bounced,g.complained,g.unsubscribed,g.delivered,g.sent),
      public.atlas_mail_priority_rank(public.atlas_mail_priority_bucket(g.clicked,g.opened,g.bounced,g.complained,g.unsubscribed,g.delivered,g.sent)),
      public.atlas_mail_priority_reason(public.atlas_mail_priority_bucket(g.clicked,g.opened,g.bounced,g.complained,g.unsubscribed,g.delivered,g.sent))
    from grouped g on conflict (campaign_id, lead_id) do update set
      email_normalized = coalesce(excluded.email_normalized, public.lead_mail_status.email_normalized),
      first_seen_at = least(public.lead_mail_status.first_seen_at, excluded.first_seen_at),
      last_seen_at = greatest(public.lead_mail_status.last_seen_at, excluded.last_seen_at),
      sent = public.lead_mail_status.sent or excluded.sent,
      delivered = public.lead_mail_status.delivered or excluded.delivered,
      bounced = public.lead_mail_status.bounced or excluded.bounced,
      opened = public.lead_mail_status.opened or excluded.opened,
      clicked = public.lead_mail_status.clicked or excluded.clicked,
      complained = public.lead_mail_status.complained or excluded.complained,
      unsubscribed = public.lead_mail_status.unsubscribed or excluded.unsubscribed,
      sent_count = public.lead_mail_status.sent_count + excluded.sent_count,
      delivered_count = public.lead_mail_status.delivered_count + excluded.delivered_count,
      bounced_count = public.lead_mail_status.bounced_count + excluded.bounced_count,
      opened_count = public.lead_mail_status.opened_count + excluded.opened_count,
      clicked_count = public.lead_mail_status.clicked_count + excluded.clicked_count,
      complained_count = public.lead_mail_status.complained_count + excluded.complained_count,
      unsubscribed_count = public.lead_mail_status.unsubscribed_count + excluded.unsubscribed_count,
      priority_bucket = public.atlas_mail_priority_bucket(public.lead_mail_status.clicked or excluded.clicked, public.lead_mail_status.opened or excluded.opened, public.lead_mail_status.bounced or excluded.bounced, public.lead_mail_status.complained or excluded.complained, public.lead_mail_status.unsubscribed or excluded.unsubscribed, public.lead_mail_status.delivered or excluded.delivered, public.lead_mail_status.sent or excluded.sent),
      priority_rank = public.atlas_mail_priority_rank(public.atlas_mail_priority_bucket(public.lead_mail_status.clicked or excluded.clicked, public.lead_mail_status.opened or excluded.opened, public.lead_mail_status.bounced or excluded.bounced, public.lead_mail_status.complained or excluded.complained, public.lead_mail_status.unsubscribed or excluded.unsubscribed, public.lead_mail_status.delivered or excluded.delivered, public.lead_mail_status.sent or excluded.sent)),
      priority_reason = public.atlas_mail_priority_reason(public.atlas_mail_priority_bucket(public.lead_mail_status.clicked or excluded.clicked, public.lead_mail_status.opened or excluded.opened, public.lead_mail_status.bounced or excluded.bounced, public.lead_mail_status.complained or excluded.complained, public.lead_mail_status.unsubscribed or excluded.unsubscribed, public.lead_mail_status.delivered or excluded.delivered, public.lead_mail_status.sent or excluded.sent)), updated_at = now()
    returning campaign_id, lead_id, priority_bucket, priority_rank, priority_reason, last_seen_at
  ), mail_grouped as (
    select mail_campaign_id, campaign_id, lead_id, min(occurred_at) first_seen_at,
      max(occurred_at) last_seen_at, max(email_normalized) email_normalized,
      bool_or(sent) sent, bool_or(delivered) delivered, bool_or(bounced) bounced,
      bool_or(opened) opened, bool_or(clicked) clicked, bool_or(complained) complained,
      bool_or(unsubscribed) unsubscribed,
      count(*) filter (where sent)::integer sent_count,
      count(*) filter (where delivered)::integer delivered_count,
      count(*) filter (where bounced)::integer bounced_count,
      count(*) filter (where opened)::integer opened_count,
      count(*) filter (where clicked)::integer clicked_count,
      count(*) filter (where complained)::integer complained_count,
      count(*) filter (where unsubscribed)::integer unsubscribed_count
    from valid group by mail_campaign_id, campaign_id, lead_id
  ), campaign_projection as (
    insert into public.mail_campaign_lead_status (
      mail_campaign_id,campaign_id,lead_id,email_normalized,first_seen_at,last_seen_at,
      sent,delivered,bounced,opened,clicked,complained,unsubscribed,sent_count,
      delivered_count,bounced_count,opened_count,clicked_count,complained_count,
      unsubscribed_count,priority_bucket,priority_rank,priority_reason
    ) select g.mail_campaign_id,g.campaign_id,g.lead_id,g.email_normalized,g.first_seen_at,g.last_seen_at,
      g.sent,g.delivered,g.bounced,g.opened,g.clicked,g.complained,g.unsubscribed,g.sent_count,
      g.delivered_count,g.bounced_count,g.opened_count,g.clicked_count,g.complained_count,g.unsubscribed_count,
      public.atlas_mail_priority_bucket(g.clicked,g.opened,g.bounced,g.complained,g.unsubscribed,g.delivered,g.sent),
      public.atlas_mail_priority_rank(public.atlas_mail_priority_bucket(g.clicked,g.opened,g.bounced,g.complained,g.unsubscribed,g.delivered,g.sent)),
      public.atlas_mail_priority_reason(public.atlas_mail_priority_bucket(g.clicked,g.opened,g.bounced,g.complained,g.unsubscribed,g.delivered,g.sent))
    from mail_grouped g on conflict (mail_campaign_id, lead_id) do update set
      email_normalized=coalesce(excluded.email_normalized,public.mail_campaign_lead_status.email_normalized),
      first_seen_at=least(public.mail_campaign_lead_status.first_seen_at,excluded.first_seen_at),
      last_seen_at=greatest(public.mail_campaign_lead_status.last_seen_at,excluded.last_seen_at),
      sent=public.mail_campaign_lead_status.sent or excluded.sent,
      delivered=public.mail_campaign_lead_status.delivered or excluded.delivered,
      bounced=public.mail_campaign_lead_status.bounced or excluded.bounced,
      opened=public.mail_campaign_lead_status.opened or excluded.opened,
      clicked=public.mail_campaign_lead_status.clicked or excluded.clicked,
      complained=public.mail_campaign_lead_status.complained or excluded.complained,
      unsubscribed=public.mail_campaign_lead_status.unsubscribed or excluded.unsubscribed,
      sent_count=public.mail_campaign_lead_status.sent_count+excluded.sent_count,
      delivered_count=public.mail_campaign_lead_status.delivered_count+excluded.delivered_count,
      bounced_count=public.mail_campaign_lead_status.bounced_count+excluded.bounced_count,
      opened_count=public.mail_campaign_lead_status.opened_count+excluded.opened_count,
      clicked_count=public.mail_campaign_lead_status.clicked_count+excluded.clicked_count,
      complained_count=public.mail_campaign_lead_status.complained_count+excluded.complained_count,
      unsubscribed_count=public.mail_campaign_lead_status.unsubscribed_count+excluded.unsubscribed_count,
      priority_bucket=public.atlas_mail_priority_bucket(public.mail_campaign_lead_status.clicked or excluded.clicked,public.mail_campaign_lead_status.opened or excluded.opened,public.mail_campaign_lead_status.bounced or excluded.bounced,public.mail_campaign_lead_status.complained or excluded.complained,public.mail_campaign_lead_status.unsubscribed or excluded.unsubscribed,public.mail_campaign_lead_status.delivered or excluded.delivered,public.mail_campaign_lead_status.sent or excluded.sent),
      priority_rank=public.atlas_mail_priority_rank(public.atlas_mail_priority_bucket(public.mail_campaign_lead_status.clicked or excluded.clicked,public.mail_campaign_lead_status.opened or excluded.opened,public.mail_campaign_lead_status.bounced or excluded.bounced,public.mail_campaign_lead_status.complained or excluded.complained,public.mail_campaign_lead_status.unsubscribed or excluded.unsubscribed,public.mail_campaign_lead_status.delivered or excluded.delivered,public.mail_campaign_lead_status.sent or excluded.sent)),
      priority_reason=public.atlas_mail_priority_reason(public.atlas_mail_priority_bucket(public.mail_campaign_lead_status.clicked or excluded.clicked,public.mail_campaign_lead_status.opened or excluded.opened,public.mail_campaign_lead_status.bounced or excluded.bounced,public.mail_campaign_lead_status.complained or excluded.complained,public.mail_campaign_lead_status.unsubscribed or excluded.unsubscribed,public.mail_campaign_lead_status.delivered or excluded.delivered,public.mail_campaign_lead_status.sent or excluded.sent)),updated_at=now()
    returning mail_campaign_id, lead_id
  ), leads_updated as (
    update public.leads l set mail_priority_bucket = p.priority_bucket,
      mail_priority_rank = p.priority_rank, mail_priority_reason = p.priority_reason,
      mail_last_event_at = p.last_seen_at, updated_at = now()
    from lead_projection p where l.id = p.lead_id
      and p.last_seen_at >= coalesce(l.mail_last_event_at, '-infinity'::timestamptz)
    returning l.id
  ), engagement_events as (
    insert into public.external_lead_events (
      source_id,campaign_id,lead_id,external_key,event_type,event_score,
      occurred_at,payload,integration_item_id
    ) select v.source_id,v.campaign_id,v.lead_id,v.external_key,
      'engagement.event.v1',public.atlas_mail_priority_rank(v.bucket),v.occurred_at,
      jsonb_build_object('bucket',v.bucket,'external_campaign_key',v.external_campaign_key),v.id
    from valid v on conflict (integration_item_id) where integration_item_id is not null do nothing
    returning integration_item_id
  )
  select r.id, (r.projected_item_id is not null or (r.lead_id is not null and r.mail_campaign_id is not null)),
    case when r.projected_item_id is not null then null
      when r.lead_id is null then 'lead_not_found_or_ambiguous'
      when r.mail_campaign_id is null then 'mail_campaign_not_found' else null end
  from resolved r;
end;
$$;

revoke all on function public.integration_v2_refresh_batch_status(uuid[]) from public, anon, authenticated;
revoke all on function public.accept_integration_batch_v2(text,uuid,text,text,text,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.claim_integration_items_v2(text,integer,integer) from public, anon, authenticated;
revoke all on function public.ack_integration_items_v2(text,uuid[],jsonb) from public, anon, authenticated;
revoke all on function public.nack_integration_items_v2(text,uuid[],text,text,boolean,integer) from public, anon, authenticated;
revoke all on function public.enqueue_integration_outbox_v2(text,text,text,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.upsert_integration_campaign_mapping_v2(text,text,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.claim_integration_outbox_v2(text,integer,integer) from public, anon, authenticated;
revoke all on function public.ack_integration_outbox_v2(text,uuid[],text,integer) from public, anon, authenticated;
revoke all on function public.nack_integration_outbox_v2(text,uuid[],text,text,boolean,integer,integer) from public, anon, authenticated;
revoke all on function public.apply_intelligence_decisions_v2(text,uuid[]) from public, anon, authenticated;
revoke all on function public.apply_engagement_events_v2(text,uuid[]) from public, anon, authenticated;
revoke all on function public.generate_operation_feedback_v2(text,integer) from public, anon, authenticated;

grant execute on function public.accept_integration_batch_v2(text,uuid,text,text,text,text,jsonb,jsonb) to service_role;
grant execute on function public.claim_integration_items_v2(text,integer,integer) to service_role;
grant execute on function public.ack_integration_items_v2(text,uuid[],jsonb) to service_role;
grant execute on function public.nack_integration_items_v2(text,uuid[],text,text,boolean,integer) to service_role;
grant execute on function public.enqueue_integration_outbox_v2(text,text,text,jsonb,text,text) to service_role;
grant execute on function public.upsert_integration_campaign_mapping_v2(text,text,uuid,jsonb) to service_role;
grant execute on function public.claim_integration_outbox_v2(text,integer,integer) to service_role;
grant execute on function public.ack_integration_outbox_v2(text,uuid[],text,integer) to service_role;
grant execute on function public.nack_integration_outbox_v2(text,uuid[],text,text,boolean,integer,integer) to service_role;
grant execute on function public.apply_intelligence_decisions_v2(text,uuid[]) to service_role;
grant execute on function public.apply_engagement_events_v2(text,uuid[]) to service_role;
grant execute on function public.generate_operation_feedback_v2(text,integer) to service_role;

commit;
