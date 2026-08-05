-- Restaura gestiones reales que quedaron fuera de "Mis registros" por
-- saneamientos técnicos anteriores. La reparación es deliberadamente
-- conservadora:
--   1. llamadas huérfanas con AgentConnect/bridge confirmado por al menos
--      15 segundos y con el mismo ejecutivo en calls, dial_attempts y leads;
--   2. gestiones ya tipificadas como connected que fueron descartadas sólo
--      al reconciliar una fila abierta duplicada.
--
-- No repara llamadas sin bridge, conexiones menores a 15 segundos ni
-- duplicados automáticos descartados por elegibilidad.

create temporary table atlas_confirmed_call_history_repair
on commit drop
as
select
  c.id as call_id,
  c.lead_id,
  c.agent_id,
  attempt.id as dial_attempt_id,
  c.discarded_reason as previous_discarded_reason,
  attempt.bridged_at,
  attempt.ended_at,
  extract(epoch from (attempt.ended_at - attempt.bridged_at))::integer as bridged_seconds,
  'confirmed_bridge_after_orphan_cleanup'::text as repair_reason
from public.calls c
join public.dial_attempts attempt
  on attempt.call_id = c.id
 and attempt.lead_id = c.lead_id
 and attempt.agent_id = c.agent_id
join public.leads lead on lead.id = c.lead_id
where c.discarded_reason = 'Gestión huérfana terminal saneada durante incidente 2026-08-05'
  and c.status is null
  and c.outcome is null
  and c.reason is null
  and c.ended_at is not null
  and attempt.status = 'completed'
  and attempt.bridged_at is not null
  and attempt.ended_at is not null
  and attempt.ended_at - attempt.bridged_at >= interval '15 seconds'
  and lead.assigned_to = c.agent_id
  and (lead.managed_by is null or lead.managed_by = c.agent_id)

union all

select
  c.id as call_id,
  c.lead_id,
  c.agent_id,
  null::uuid as dial_attempt_id,
  c.discarded_reason as previous_discarded_reason,
  c.started_at as bridged_at,
  c.ended_at,
  extract(epoch from (c.ended_at - c.started_at))::integer as bridged_seconds,
  'typed_connected_management_after_duplicate_cleanup'::text as repair_reason
from public.calls c
join public.leads lead on lead.id = c.lead_id
where c.discarded_reason = 'Gestión abierta duplicada; reconciliada al restaurar unicidad por ejecutivo'
  and c.status = 'connected'
  and c.outcome is not null
  and c.reason is not null
  and c.ended_at is not null
  and lead.assigned_to = c.agent_id
  and lead.managed_by = c.agent_id;

update public.calls call
set status = 'connected',
    discarded_reason = null,
    updated_at = now()
from atlas_confirmed_call_history_repair repair
where call.id = repair.call_id;

with latest_repair as (
  select distinct on (lead_id)
    lead_id,
    agent_id,
    ended_at
  from atlas_confirmed_call_history_repair
  order by lead_id, ended_at desc
)
update public.leads lead
set managed_by = repair.agent_id,
    managed_at = case
      when lead.managed_at is null then repair.ended_at
      else greatest(lead.managed_at, repair.ended_at)
    end,
    updated_at = now()
from latest_repair repair
where lead.id = repair.lead_id
  and lead.assigned_to = repair.agent_id
  and (lead.managed_by is null or lead.managed_by = repair.agent_id);

insert into public.call_events
  (call_id, lead_id, agent_id, event_type, payload)
select
  repair.call_id,
  repair.lead_id,
  repair.agent_id,
  'call.history_repaired',
  jsonb_build_object(
    'source', 'incident_repair_20260805_history',
    'repair_reason', repair.repair_reason,
    'previous_discarded_reason', repair.previous_discarded_reason,
    'dial_attempt_id', repair.dial_attempt_id,
    'bridged_at', repair.bridged_at,
    'ended_at', repair.ended_at,
    'bridged_seconds', repair.bridged_seconds
  )
from atlas_confirmed_call_history_repair repair
where not exists (
  select 1
  from public.call_events event
  where event.call_id = repair.call_id
    and event.event_type = 'call.history_repaired'
    and event.payload->>'source' = 'incident_repair_20260805_history'
);

insert into public.crm_audit_events
  (lead_id, crm_entity_id, actor_id, event_type, payload)
select
  repair.lead_id,
  lead.crm_entity_id,
  null,
  'lead.history_repaired',
  jsonb_build_object(
    'source', 'incident_repair_20260805_history',
    'call_id', repair.call_id,
    'dial_attempt_id', repair.dial_attempt_id,
    'agent_id', repair.agent_id,
    'repair_reason', repair.repair_reason,
    'bridged_seconds', repair.bridged_seconds
  )
from atlas_confirmed_call_history_repair repair
join public.leads lead on lead.id = repair.lead_id
where not exists (
  select 1
  from public.crm_audit_events event
  where event.lead_id = repair.lead_id
    and event.event_type = 'lead.history_repaired'
    and event.payload->>'call_id' = repair.call_id::text
    and event.payload->>'source' = 'incident_repair_20260805_history'
);
