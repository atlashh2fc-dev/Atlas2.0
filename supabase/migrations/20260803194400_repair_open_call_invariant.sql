-- A Server Component used to create a call whenever a lead detail page was
-- rendered. Closing a call revalidated that page and deterministically left a
-- second, empty call open. Reconcile those rows without deleting audit data,
-- then make the operational invariant enforceable by PostgreSQL.

with classified as (
  select
    c.id,
    c.agent_id,
    c.started_at,
    c.updated_at,
    (
      c.status is not null
      or c.outcome is not null
      or c.reason is not null
      or nullif(btrim(coalesce(c.notes, '')), '') is not null
      or exists (select 1 from public.call_events ce where ce.call_id = c.id)
      or exists (select 1 from public.dial_attempts da where da.call_id = c.id)
    ) as has_operational_trace
  from public.calls c
  where c.ended_at is null
    and c.agent_id is not null
), ranked as (
  select
    classified.*,
    row_number() over (
      partition by classified.agent_id
      order by classified.has_operational_trace desc, classified.started_at desc, classified.id desc
    ) as open_rank
  from classified
), repaired as (
  update public.calls c
  set
    ended_at = coalesce(c.updated_at, c.started_at, now()),
    discarded_reason = case
      when not ranked.has_operational_trace
        then 'Gestión vacía creada por render automático; saneada por incidente 2026-08-03'
      else 'Gestión abierta duplicada; reconciliada al restaurar unicidad por ejecutivo'
    end,
    updated_at = now()
  from ranked
  where c.id = ranked.id
    and (not ranked.has_operational_trace or ranked.open_rank > 1)
  returning c.id, c.lead_id, c.agent_id, c.discarded_reason
)
insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
select
  repaired.id,
  repaired.lead_id,
  repaired.agent_id,
  'call.repaired',
  jsonb_build_object(
    'reason', repaired.discarded_reason,
    'source', 'incident_repair_20260803'
  )
from repaired;

create unique index if not exists calls_one_open_per_agent_idx
  on public.calls (agent_id)
  where ended_at is null and agent_id is not null;
