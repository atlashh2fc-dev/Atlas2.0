-- La base Equifax de octubre (20261001182913) reabrió leads según
-- leads.tipificacion_actual. En cuatro de ellos la ficha decía «NO CONTESTA»
-- pero la última llamada tipificada antes de la carga era CLIENTE MOLESTO,
-- CLIENTE CARTERIZADO o quiebra: con el teléfono nuevo no los frenaba la lista
-- de no llamar (que es por número). El 07-10 los ejecutivos reclamaron que
-- caían registros de mayo marcados como molestos o «no llamar».
--
-- Se cierran como dice esa llamada, quedan fuera de la cola y el teléfono
-- actual entra a la lista de no llamar. Se audita con lo que se deshizo.

create temp table _reabiertos on commit drop as
with ultima as (
  select distinct on (ca.lead_id) ca.lead_id, ca.id as call_id, ca.reason, ca.phone_status, ca.created_at
  from public.calls ca
  join public.leads l on l.id = ca.lead_id
  join public.campaigns c on c.id = l.campaign_id
  where c.dialer_client_key = 'equifax'
    and ca.created_at < '2026-10-01 21:00+00'
    and ca.reason is not null
  order by ca.lead_id, ca.created_at desc
)
select l.id as lead_id, l.organization_id, l.crm_entity_id, l.phone,
  l.workflow_status, l.assignment_status, l.tipificacion_actual, l.dialer_retry_at, l.dialer_hold_reason,
  u.call_id, u.reason,
  public.dialer_suppression_reason(u.reason, u.phone_status) as motivo
from ultima u
join public.leads l on l.id = u.lead_id
where l.dialer_cycle_started_at >= '2026-10-01'
  and l.workflow_status = 'pending'
  and public.dialer_suppression_reason(u.reason, u.phone_status)
      in ('cliente_molesto', 'cliente_carterizado', 'quiebra_o_cierre', 'no_sujeto_a_venta')
  and not exists (
    select 1 from public.calls c2
    where c2.lead_id = l.id and c2.created_at >= '2026-10-01 21:00+00'
  );

insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
select lead_id, crm_entity_id, null, 'lead.reabierto_por_error_cerrado',
  jsonb_build_object(
    'motivo', reason,
    'call_id', call_id,
    'deshecho', jsonb_build_object(
      'workflow_status', workflow_status,
      'assignment_status', assignment_status,
      'tipificacion_actual', tipificacion_actual,
      'dialer_retry_at', dialer_retry_at,
      'dialer_hold_reason', dialer_hold_reason
    )
  )
from _reabiertos;

update public.leads l set
  workflow_status = 'managed',
  assignment_status = 'managed',
  tipificacion_actual = r.reason,
  dialer_retry_at = 'infinity',
  dialer_hold_reason = 'no_llamar',
  updated_at = now()
from _reabiertos r
where l.id = r.lead_id;

insert into public.dialer_phone_suppressions (
  organization_id, client_key, phone, reason, source, source_lead_id, source_reason, notes
)
select r.organization_id,
  case when public.dialer_suppression_is_campaign_scoped(r.motivo) then 'equifax' end,
  public.canonical_chile_phone(r.phone), r.motivo, 'manual', r.lead_id, r.reason,
  'Reabierto por la base de octubre con teléfono nuevo; la última llamada antes de la carga lo había cerrado así.'
from _reabiertos r
where public.canonical_chile_phone(r.phone) ~ '^[0-9]{8,15}$'
on conflict do nothing;
