-- Una fecha de agenda no puede sobrevivir a una tipificación final que no
-- admite seguimiento. La UI también limpia el campo, pero este trigger protege
-- todos los clientes presentes y futuros que escriban una llamada cerrada.
-- Las llamadas abiertas conservan la posibilidad de guardar una fecha antes
-- del cierre, y los descartes técnicos no se consideran gestiones finales.

create or replace function public.enforce_closed_call_agenda_consistency()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_reason_norm text := public.normalize_management_text(new.reason);
  v_allows_agenda boolean :=
    coalesce(new.outcome = 'callback', false)
    or coalesce(v_reason_norm = 'COTIZACION ENVIADA', false);
begin
  if new.ended_at is null or new.discarded_reason is not null then
    return new;
  end if;

  if v_allows_agenda and new.next_action_at is null then
    raise exception 'Esta tipificación requiere fecha y hora de agenda.';
  end if;

  if not v_allows_agenda and new.next_action_at is not null then
    raise exception 'Esta tipificación no admite una agenda.';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_closed_call_agenda_consistency() from public, anon, authenticated;

drop trigger if exists calls_enforce_closed_agenda_consistency on public.calls;
create trigger calls_enforce_closed_agenda_consistency
  before insert or update of ended_at, outcome, reason, next_action_at, discarded_reason
  on public.calls
  for each row
  execute function public.enforce_closed_call_agenda_consistency();

comment on function public.enforce_closed_call_agenda_consistency()
is 'Impide agendas residuales o ausentes en gestiones cerradas según su tipificación.';

-- Reparación idempotente del incidente que reveló la brecha: una corrección
-- desde Mis registros cambió VOLVER A LLAMAR por NO INTERESA, pero conservó
-- ocultamente la fecha anterior. Cada predicado vuelve la reparación un no-op
-- en cualquier otra base y los eventos dejan trazabilidad del saneamiento.
with repaired_call as (
  update public.calls
  set next_action_at = null,
      next_action_window = null,
      callback_owner_user_id = null,
      updated_at = now()
  where id = '3e386e43-dedf-419e-ac32-e5e1b503b9e1'::uuid
    and lead_id = 'fac67f07-74fc-4ebf-94df-fad49d820a91'::uuid
    and public.normalize_management_text(reason) = 'NO INTERESA'
    and outcome = 'not_interested'
    and next_action_at = '2026-08-10T16:00:00+00:00'::timestamptz
  returning id, lead_id, agent_id
)
insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
select
  id,
  lead_id,
  agent_id,
  'call.agenda_consistency_repaired',
  jsonb_build_object(
    'source', 'migration_20260810165250',
    'reason', 'stale_schedule_after_non_agenda_revision',
    'previous_next_action_at', '2026-08-10T16:00:00+00:00'
  )
from repaired_call;

with repaired_lead as (
  update public.leads
  set next_action_at = null,
      workflow_status = 'managed',
      assignment_status = 'managed',
      updated_at = now()
  where id = 'fac67f07-74fc-4ebf-94df-fad49d820a91'::uuid
    and public.normalize_management_text(tipificacion_actual) = 'NO INTERESA'
    and workflow_status = 'callback'
    and next_action_at = '2026-08-10T16:00:00+00:00'::timestamptz
  returning id, crm_entity_id, managed_by
)
insert into public.crm_audit_events
  (lead_id, crm_entity_id, actor_id, event_type, payload)
select
  id,
  crm_entity_id,
  managed_by,
  'lead.agenda_consistency_repaired',
  jsonb_build_object(
    'source', 'migration_20260810165250',
    'reason', 'stale_schedule_after_non_agenda_revision',
    'previous_next_action_at', '2026-08-10T16:00:00+00:00',
    'current_tipificacion', 'NO INTERESA'
  )
from repaired_lead;
