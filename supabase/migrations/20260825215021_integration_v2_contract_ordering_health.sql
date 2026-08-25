-- Integration contract v2: canonical event metadata, deterministic ordering,
-- circuit state, and a local operational snapshot. No network I/O occurs in
-- PostgreSQL; HTTP doorbells are issued by route handlers after commit.

begin;

alter table public.integration_inbox_items
  add column if not exists event_source text,
  add column if not exists subject text,
  add column if not exists data_schema text,
  add column if not exists tenant_id text,
  add column if not exists entity_version bigint,
  add column if not exists correlation_id text,
  add column if not exists causation_id text;

alter table public.integration_inbox_batches
  alter column campaign_id drop not null;
alter table public.integration_inbox_items
  drop constraint if exists integration_inbox_items_event_type_check;
alter table public.integration_inbox_items
  add constraint integration_inbox_items_event_type_check
    check (event_type in ('intelligence.decision.v1', 'engagement.event.v1', 'integration.canary.v1'));

update public.integration_inbox_items i
set event_source = coalesce(i.event_source,
      'urn:geimser:' || case when s.code = 'atlas_lead' then 'atlas-lead' else replace(s.code, '_', '-') end),
    subject = coalesce(i.subject,
      'urn:geimser:legacy:' || replace(s.code, '_', '-') || ':' || i.external_key),
    data_schema = coalesce(i.data_schema, 'urn:geimser:schema:' || i.event_type),
    tenant_id = coalesce(i.tenant_id, 'geimser'),
    entity_version = coalesce(i.entity_version, 1),
    correlation_id = coalesce(i.correlation_id, i.event_id)
from public.integration_sources s
where s.id = i.source_id
  and (i.event_source is null or i.subject is null or i.data_schema is null
    or i.tenant_id is null or i.entity_version is null or i.correlation_id is null);

alter table public.integration_inbox_items
  alter column event_source set not null,
  alter column subject set not null,
  alter column data_schema set not null,
  alter column tenant_id set not null,
  alter column tenant_id set default 'geimser',
  alter column entity_version set not null,
  alter column entity_version set default 1,
  alter column correlation_id set not null;

alter table public.integration_inbox_items
  add constraint integration_inbox_items_event_source_check
    check (event_source ~ '^urn:geimser:(atlas2|atlas-lead|bigdata)$'),
  add constraint integration_inbox_items_subject_check
    check (btrim(subject) <> '' and length(subject) <= 500),
  add constraint integration_inbox_items_data_schema_check
    check (btrim(data_schema) <> '' and length(data_schema) <= 500),
  add constraint integration_inbox_items_tenant_check
    check (btrim(tenant_id) <> '' and length(tenant_id) <= 100),
  add constraint integration_inbox_items_entity_version_check
    check (entity_version >= 1),
  add constraint integration_inbox_items_correlation_check
    check (btrim(correlation_id) <> '' and length(correlation_id) <= 200),
  add constraint integration_inbox_items_causation_check
    check (causation_id is null or (btrim(causation_id) <> '' and length(causation_id) <= 200));

create unique index if not exists integration_inbox_items_source_event_uidx
  on public.integration_inbox_items (event_source, event_id);
create index if not exists integration_inbox_items_entity_order_idx
  on public.integration_inbox_items (tenant_id, subject, entity_version, created_at, id)
  where status in ('pending', 'processing');

create table public.integration_entity_versions (
  tenant_id text not null,
  subject text not null,
  last_entity_version bigint not null check (last_entity_version >= 1),
  last_event_source text not null,
  last_event_id text not null,
  last_occurred_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, subject),
  constraint integration_entity_versions_tenant_check check (btrim(tenant_id) <> ''),
  constraint integration_entity_versions_subject_check check (btrim(subject) <> '')
);

create table public.integration_circuit_states (
  destination_source_id uuid primary key references public.integration_sources(id) on delete cascade,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  state text not null default 'closed' check (state in ('closed', 'open')),
  opened_until timestamptz,
  last_failure_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null default now()
);

create table public.integration_canary_runs (
  id uuid primary key default gen_random_uuid(),
  canary_key text not null unique,
  status text not null check (status in ('healthy', 'degraded')),
  latency_ms integer not null check (latency_ms >= 0),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index integration_canary_runs_created_idx
  on public.integration_canary_runs (created_at desc);

alter table public.integration_entity_versions enable row level security;
alter table public.integration_circuit_states enable row level security;
alter table public.integration_canary_runs enable row level security;

revoke all on table public.integration_entity_versions from public, anon, authenticated;
revoke all on table public.integration_circuit_states from public, anon, authenticated;
revoke all on table public.integration_canary_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.integration_entity_versions to service_role;
grant select, insert, update, delete on table public.integration_circuit_states to service_role;
grant select, insert, update, delete on table public.integration_canary_runs to service_role;

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
  v_expected_event_source text;
  v_resolved_campaign_id uuid;
  v_campaign_key text := nullif(btrim(coalesce(p_campaign_key, '')), '');
  v_batch_id uuid;
  v_existing_hash text;
  v_total integer;
  v_replayed integer := 0;
  v_is_canary boolean := false;
begin
  select s.id, s.code into v_source_id, v_source_code
  from public.integration_sources s
  where s.code = lower(btrim(p_source_code)) and s.is_active;
  if v_source_id is null then raise exception 'integration_v2_source_not_active'; end if;
  v_expected_event_source := 'urn:geimser:' ||
    case when v_source_code = 'atlas_lead' then 'atlas-lead' else replace(v_source_code, '_', '-') end;

  if jsonb_typeof(p_items) <> 'array' then raise exception 'integration_v2_items_must_be_array'; end if;
  v_total := jsonb_array_length(p_items);
  if v_total < 1 or v_total > 500 then raise exception 'integration_v2_batch_limit'; end if;
  v_is_canary := not exists (
    select 1 from jsonb_array_elements(p_items) x
    where x->>'event_type' is distinct from 'integration.canary.v1'
  );

  if v_is_canary then
    v_resolved_campaign_id := null;
    v_campaign_key := null;
  elsif v_campaign_key is not null then
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
  if not v_is_canary and (v_resolved_campaign_id is null or not exists (
    select 1 from public.campaigns c where c.id = v_resolved_campaign_id
  )) then raise exception 'integration_v2_campaign_not_found'; end if;
  if nullif(btrim(p_idempotency_key), '') is null then raise exception 'integration_v2_idempotency_required'; end if;
  if coalesce(p_content_sha256, '') !~ '^[0-9a-f]{64}$' then raise exception 'integration_v2_invalid_sha256'; end if;
  if coalesce(nullif(btrim(p_schema_version), ''), '1') not in ('1', '2') then
    raise exception 'integration_v2_schema_not_supported';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) x
    group by x->>'event_id' having count(*) > 1
  ) then raise exception 'integration_v2_duplicate_event_id'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) x
    where coalesce(x->>'event_source', v_expected_event_source) <> v_expected_event_source
      or coalesce((x->>'entity_version')::bigint, 0) < 1
      or nullif(btrim(coalesce(x->>'subject', '')), '') is null
      or nullif(btrim(coalesce(x->>'data_schema', '')), '') is null
      or nullif(btrim(coalesce(x->>'tenant_id', '')), '') is null
      or nullif(btrim(coalesce(x->>'correlation_id', '')), '') is null
  ) then raise exception 'integration_v2_invalid_canonical_metadata'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) x
    join public.integration_inbox_items i
      on i.event_source = coalesce(x->>'event_source', v_expected_event_source)
      and i.event_id = btrim(x->>'event_id')
    join public.integration_inbox_batches existing_batch on existing_batch.id = i.batch_id
    where existing_batch.campaign_id is distinct from v_resolved_campaign_id
       or i.event_type <> btrim(x->>'event_type')
       or i.external_key <> btrim(x->>'external_key')
       or i.occurred_at <> (x->>'occurred_at')::timestamptz
       or i.payload <> coalesce(x->'payload', '{}'::jsonb)
       or i.subject <> btrim(x->>'subject')
       or i.tenant_id <> btrim(x->>'tenant_id')
       or i.entity_version <> (x->>'entity_version')::bigint
  ) then raise exception 'integration_v2_event_id_conflict'; end if;

  select count(*)::integer into v_replayed
  from jsonb_array_elements(p_items) x
  join public.integration_inbox_items i
    on i.event_source = coalesce(x->>'event_source', v_expected_event_source)
    and i.event_id = btrim(x->>'event_id');

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
    batch_id, source_id, sequence, event_id, event_type, event_source, subject,
    external_key, occurred_at, data_schema, tenant_id, entity_version,
    correlation_id, causation_id, payload, status, processed_at, result
  )
  select v_batch_id, v_source_id, x.ordinality::integer,
    btrim(x.item->>'event_id'), btrim(x.item->>'event_type'),
    coalesce(x.item->>'event_source', v_expected_event_source), btrim(x.item->>'subject'),
    btrim(x.item->>'external_key'), (x.item->>'occurred_at')::timestamptz,
    btrim(x.item->>'data_schema'), btrim(x.item->>'tenant_id'),
    (x.item->>'entity_version')::bigint, btrim(x.item->>'correlation_id'),
    nullif(btrim(coalesce(x.item->>'causation_id', '')), ''),
    coalesce(x.item->'payload', '{}'::jsonb),
    case when v_is_canary then 'succeeded' else 'pending' end,
    case when v_is_canary then now() else null end,
    case when v_is_canary then jsonb_build_object('canary', true, 'action', 'none') else null end
  from jsonb_array_elements(p_items) with ordinality as x(item, ordinality)
  on conflict (event_source, event_id) do nothing;

  if exists (
    select 1
    from jsonb_array_elements(p_items) x
    join public.integration_inbox_items i
      on i.event_source = coalesce(x->>'event_source', v_expected_event_source)
      and i.event_id = btrim(x->>'event_id')
    join public.integration_inbox_batches existing_batch on existing_batch.id = i.batch_id
    where existing_batch.campaign_id is distinct from v_resolved_campaign_id
       or i.event_type <> btrim(x->>'event_type')
       or i.external_key <> btrim(x->>'external_key')
       or i.occurred_at <> (x->>'occurred_at')::timestamptz
       or i.payload <> coalesce(x->'payload', '{}'::jsonb)
       or i.subject <> btrim(x->>'subject')
       or i.tenant_id <> btrim(x->>'tenant_id')
       or i.entity_version <> (x->>'entity_version')::bigint
  ) then raise exception 'integration_v2_event_id_conflict'; end if;

  select count(*)::integer into v_replayed
  from jsonb_array_elements(p_items) x
  join public.integration_inbox_items i
    on i.event_source = coalesce(x->>'event_source', v_expected_event_source)
    and i.event_id = btrim(x->>'event_id') and i.batch_id <> v_batch_id;
  update public.integration_inbox_batches set rows_replayed = v_replayed,
    updated_at = now() where id = v_batch_id;
  if v_is_canary then
    insert into public.integration_canary_runs (canary_key, status, latency_ms, details)
    select left(v_expected_event_source || ':' || btrim(x->>'event_id'), 200),
      'healthy',
      least(2147483647, greatest(0,
        round(extract(epoch from now() - (x->>'occurred_at')::timestamptz) * 1000)::bigint))::integer,
      jsonb_build_object('event_source', v_expected_event_source, 'event_id', btrim(x->>'event_id'),
        'action', 'none', 'transport', 'inbox')
    from jsonb_array_elements(p_items) x
    on conflict (canary_key) do update set latency_ms = excluded.latency_ms,
      details = excluded.details;
    update public.integration_inbox_batches
    set status = 'succeeded', rows_succeeded = v_total - v_replayed,
      completed_at = now(), updated_at = now()
    where id = v_batch_id;
    return jsonb_build_object('batch_id', v_batch_id, 'accepted', true,
      'replayed', false, 'rows_total', v_total, 'rows_replayed', v_replayed,
      'canary', true);
  end if;
  if v_replayed = v_total then
    update public.integration_inbox_batches set status = 'succeeded', rows_succeeded = 0,
      completed_at = now(), updated_at = now() where id = v_batch_id;
  end if;
  return jsonb_build_object('batch_id', v_batch_id, 'accepted', true,
    'replayed', false, 'rows_total', v_total, 'rows_replayed', v_replayed);
exception when unique_violation then
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
declare v_stale_batches uuid[];
begin
  if nullif(btrim(p_worker_id), '') is null then raise exception 'integration_v2_worker_required'; end if;

  with stale as (
    update public.integration_inbox_items i
    set status = 'succeeded', processed_at = now(),
        result = jsonb_build_object('ignored', true, 'reason', 'stale_entity_version',
          'last_entity_version', v.last_entity_version),
        lease_owner = null, lease_expires_at = null, last_error_code = null,
        last_error_detail = null, updated_at = now()
    from public.integration_entity_versions v
    where v.tenant_id = i.tenant_id and v.subject = i.subject
      and v.last_entity_version >= i.entity_version
      and ((i.status = 'pending' and i.available_at <= now())
        or (i.status = 'processing' and i.lease_expires_at < now()))
    returning i.batch_id
  ) select array_agg(distinct stale.batch_id) into v_stale_batches from stale;
  perform public.integration_v2_refresh_batch_status(coalesce(v_stale_batches, array[]::uuid[]));

  return query
  with candidates as (
    select i.id
    from public.integration_inbox_items i
    where ((i.status = 'pending' and i.available_at <= now())
       or (i.status = 'processing' and i.lease_expires_at < now()))
      and not exists (
        select 1 from public.integration_entity_versions v
        where v.tenant_id = i.tenant_id and v.subject = i.subject
          and v.last_entity_version >= i.entity_version
      )
      and not exists (
        select 1 from public.integration_inbox_items active
        where active.id <> i.id and active.tenant_id = i.tenant_id and active.subject = i.subject
          and active.status = 'processing' and active.lease_expires_at >= now()
      )
      and not exists (
        select 1 from public.integration_inbox_items earlier
        where earlier.id <> i.id and earlier.tenant_id = i.tenant_id and earlier.subject = i.subject
          and earlier.status in ('pending', 'processing')
          and (earlier.entity_version < i.entity_version
            or (earlier.entity_version = i.entity_version
              and (earlier.created_at, earlier.id) < (i.created_at, i.id)))
      )
    order by i.available_at, i.entity_version, i.created_at, i.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ), claimed as (
    update public.integration_inbox_items i
    set status = 'processing', attempts = i.attempts + 1,
        lease_owner = btrim(p_worker_id),
        lease_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 60), 15), 900)),
        updated_at = now()
    from candidates c where i.id = c.id returning i.*
  ), started as (
    update public.integration_inbox_batches b
    set status = 'processing', started_at = coalesce(b.started_at, now()),
        completed_at = null, updated_at = now()
    where b.id in (select distinct c.batch_id from claimed c) returning b.id
  )
  select c.id, c.batch_id, s.code, b.campaign_id, c.event_id, c.event_type,
    c.external_key, c.occurred_at, c.payload, c.attempts
  from claimed c
  join public.integration_inbox_batches b on b.id = c.batch_id
  join public.integration_sources s on s.id = c.source_id
  order by c.entity_version, c.created_at, c.id;
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
    returning i.*
  ), versions as (
    insert into public.integration_entity_versions (
      tenant_id, subject, last_entity_version, last_event_source,
      last_event_id, last_occurred_at, updated_at
    ) select c.tenant_id, c.subject, c.entity_version, c.event_source,
        c.event_id, c.occurred_at, now()
      from changed c
    on conflict (tenant_id, subject) do update set
      last_entity_version = excluded.last_entity_version,
      last_event_source = excluded.last_event_source,
      last_event_id = excluded.last_event_id,
      last_occurred_at = excluded.last_occurred_at,
      updated_at = now()
    where excluded.last_entity_version > public.integration_entity_versions.last_entity_version
    returning tenant_id
  )
  select array_agg(distinct batch_id) into v_batches from changed;
  perform public.integration_v2_refresh_batch_status(coalesce(v_batches, array[]::uuid[]));
  select count(*)::integer into v_count
  from public.integration_inbox_items i
  where i.id = any(coalesce(p_item_ids, array[]::uuid[])) and i.status = 'succeeded';
  return coalesce(v_count, 0);
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
    left join public.integration_circuit_states circuit
      on circuit.destination_source_id = o.destination_source_id
    where ((o.status = 'pending' and o.available_at <= now())
       or (o.status = 'processing' and o.lease_expires_at < now()))
      and (circuit.opened_until is null or circuit.opened_until <= now())
    order by o.available_at, o.created_at, o.id
    for update of o skip locked
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ), claimed as (
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
    set status = 'delivered', delivered_at = coalesce(o.delivered_at, now()),
        provider_ack = left(p_provider_ack, 1000), last_http_status = p_http_status,
        lease_owner = null, lease_expires_at = null, last_error_code = null,
        last_error_detail = null, updated_at = now()
    where o.id = any(coalesce(p_event_ids, array[]::uuid[]))
      and o.status = 'processing' and o.lease_owner = btrim(p_worker_id)
    returning o.destination_source_id
  ), circuits as (
    insert into public.integration_circuit_states (
      destination_source_id, consecutive_failures, state, opened_until,
      last_success_at, last_error_code, updated_at
    ) select distinct c.destination_source_id, 0, 'closed', null, now(), null, now()
      from changed c
    on conflict (destination_source_id) do update set
      consecutive_failures = 0, state = 'closed', opened_until = null,
      last_success_at = now(), last_error_code = null, updated_at = now()
    returning destination_source_id
  )
  select count(*)::integer into v_count
  from public.integration_outbox_events o
  where o.id = any(coalesce(p_event_ids, array[]::uuid[])) and o.status = 'delivered';
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
    do update set attempts = excluded.attempts, error_code = excluded.error_code,
      error_detail = excluded.error_detail, failed_at = now()
    returning outbox_event_id
  ), failed_destinations as (
    select distinct c.destination_source_id from changed c where p_retryable
  ), circuits as (
    insert into public.integration_circuit_states (
      destination_source_id, consecutive_failures, state, opened_until,
      last_failure_at, last_error_code, updated_at
    ) select f.destination_source_id, 1, 'closed', null, now(),
        coalesce(nullif(btrim(p_error_code), ''), 'delivery_error'), now()
      from failed_destinations f
    on conflict (destination_source_id) do update set
      consecutive_failures = public.integration_circuit_states.consecutive_failures + 1,
      state = case when public.integration_circuit_states.consecutive_failures + 1 >= 5 then 'open' else 'closed' end,
      opened_until = case when public.integration_circuit_states.consecutive_failures + 1 >= 5
        then now() + make_interval(secs => least(1800,
          30 * (2 ^ least(public.integration_circuit_states.consecutive_failures - 3, 6))::integer))
        else null end,
      last_failure_at = now(),
      last_error_code = excluded.last_error_code,
      updated_at = now()
    returning destination_source_id
  )
  select count(*) filter (where status = 'pending')::integer,
    count(*) filter (where status = 'dead_letter')::integer
  into v_retried, v_dead from changed;
  return jsonb_build_object('retried', coalesce(v_retried, 0), 'dead_lettered', coalesce(v_dead, 0));
end;
$$;

create or replace function public.integration_v2_health_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'captured_at', now(),
    'inbox', (select jsonb_build_object(
      'pending', count(*) filter (where status = 'pending'),
      'processing', count(*) filter (where status = 'processing'),
      'dead_letter', count(*) filter (where status = 'dead_letter'),
      'oldest_queue_age_seconds', extract(epoch from now() - (min(created_at) filter (where status in ('pending','processing')))),
      'p95_e2e_seconds', percentile_cont(0.95) within group (
        order by extract(epoch from processed_at - created_at)
      ) filter (where status = 'succeeded' and processed_at is not null and created_at >= now() - interval '24 hours')
    ) from public.integration_inbox_items),
    'outbox', (select jsonb_build_object(
      'pending', count(*) filter (where status = 'pending'),
      'processing', count(*) filter (where status = 'processing'),
      'dead_letter', count(*) filter (where status = 'dead_letter'),
      'oldest_queue_age_seconds', extract(epoch from now() - (min(created_at) filter (where status in ('pending','processing')))),
      'p95_e2e_seconds', percentile_cont(0.95) within group (
        order by extract(epoch from delivered_at - created_at)
      ) filter (where status = 'delivered' and delivered_at is not null and created_at >= now() - interval '24 hours')
    ) from public.integration_outbox_events),
    'dlq', (select jsonb_build_object(
      'total', count(*), 'last_24h', count(*) filter (where failed_at >= now() - interval '24 hours')
    ) from public.integration_dead_letters),
    'customer360', (select jsonb_build_object(
      'external_refs', count(*),
      'stale_over_24h', count(*) filter (where last_seen_at < now() - interval '24 hours')
    ) from public.lead_external_refs),
    'circuits', (select coalesce(jsonb_agg(jsonb_build_object(
      'destination', s.code, 'state', c.state, 'consecutive_failures', c.consecutive_failures,
      'opened_until', c.opened_until, 'last_success_at', c.last_success_at,
      'last_failure_at', c.last_failure_at
    ) order by s.code), '[]'::jsonb)
      from public.integration_circuit_states c
      join public.integration_sources s on s.id = c.destination_source_id),
    'canary', (select coalesce(to_jsonb(c), '{}'::jsonb) from (
      select status, latency_ms, created_at from public.integration_canary_runs
      order by created_at desc limit 1
    ) c)
  );
$$;

create or replace function public.record_integration_canary_v2(
  p_canary_key text, p_status text, p_latency_ms integer, p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if nullif(btrim(p_canary_key), '') is null or length(p_canary_key) > 200 then
    raise exception 'integration_v2_canary_key_invalid';
  end if;
  if p_status not in ('healthy', 'degraded') or p_latency_ms < 0 then
    raise exception 'integration_v2_canary_result_invalid';
  end if;
  insert into public.integration_canary_runs (canary_key, status, latency_ms, details)
  values (btrim(p_canary_key), p_status, p_latency_ms, coalesce(p_details, '{}'::jsonb))
  on conflict (canary_key) do update set status = excluded.status,
    latency_ms = excluded.latency_ms, details = excluded.details
  returning id into v_id;
  return v_id;
end;
$$;

-- Legitimate advisor remediation: immutable lookup helpers do not need a
-- caller-controlled search_path, and trigger functions need no API execute.
alter function public.atlas_mail_priority_reason(text) set search_path = '';
alter function public.atlas_normalize_email(text) set search_path = '';
alter function public.atlas_normalize_rut(text) set search_path = '';
alter function public.atlas_normalize_phone(text) set search_path = '';
alter function public.atlas_boolish(text) set search_path = '';
alter function public.atlas_mail_priority_bucket(boolean,boolean,boolean,boolean,boolean,boolean,boolean) set search_path = '';
alter function public.atlas_mail_priority_rank(text) set search_path = '';
alter function public.request_is_service_role() set search_path = '';
alter function public.normalize_ami_unique_id(text) set search_path = '';
alter function public.canonical_chile_phone(text) set search_path = '';
revoke execute on function public.project_mail_campaign_lead_status() from public, anon, authenticated;
revoke execute on function public.reject_overlapping_campaign_agent_schedule() from public, anon, authenticated;

revoke all on function public.integration_v2_health_snapshot() from public, anon, authenticated;
revoke all on function public.record_integration_canary_v2(text,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.integration_v2_health_snapshot() to service_role;
grant execute on function public.record_integration_canary_v2(text,text,integer,jsonb) to service_role;

-- Re-assert least privilege for every replaced SECURITY DEFINER function.
revoke all on function public.accept_integration_batch_v2(text,uuid,text,text,text,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.claim_integration_items_v2(text,integer,integer) from public, anon, authenticated;
revoke all on function public.ack_integration_items_v2(text,uuid[],jsonb) from public, anon, authenticated;
revoke all on function public.claim_integration_outbox_v2(text,integer,integer) from public, anon, authenticated;
revoke all on function public.ack_integration_outbox_v2(text,uuid[],text,integer) from public, anon, authenticated;
revoke all on function public.nack_integration_outbox_v2(text,uuid[],text,text,boolean,integer,integer) from public, anon, authenticated;
grant execute on function public.accept_integration_batch_v2(text,uuid,text,text,text,text,jsonb,jsonb) to service_role;
grant execute on function public.claim_integration_items_v2(text,integer,integer) to service_role;
grant execute on function public.ack_integration_items_v2(text,uuid[],jsonb) to service_role;
grant execute on function public.claim_integration_outbox_v2(text,integer,integer) to service_role;
grant execute on function public.ack_integration_outbox_v2(text,uuid[],text,integer) to service_role;
grant execute on function public.nack_integration_outbox_v2(text,uuid[],text,text,boolean,integer,integer) to service_role;

commit;
