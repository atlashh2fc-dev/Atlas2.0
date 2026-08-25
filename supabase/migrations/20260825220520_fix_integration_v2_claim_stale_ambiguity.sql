-- Follow-up for the already-applied contract migration: qualify the stale CTE
-- output because RETURNS TABLE exposes batch_id as a PL/pgSQL output variable.
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

revoke all on function public.claim_integration_items_v2(text,integer,integer) from public, anon, authenticated;
grant execute on function public.claim_integration_items_v2(text,integer,integer) to service_role;
