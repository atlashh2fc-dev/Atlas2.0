-- Agendas vencidas: se cierran las que el equipo ya revisó, y las de
-- Secretaria Virtual pasan a Emily Gimenez.
--
-- Pedido del 02-10-2026 (nota de voz, 15:38): el equipo revisó las agendas
-- vencidas y los ejecutivos ya habían dado de baja lo que aparecía, así que
-- todas las vencidas se borran. Excepción: quienes estuvieron en Secretaria
-- Virtual (José Sanhueza, Ana Morales) seguían viendo vencidas de esa campaña;
-- esas no se borran, se le pasan a Emily, que es quien atiende Secretaria.
-- Eduardo Pérez ya no está y también estuvo en Secretaria: sus agendas pasan a
-- Emily.
--
-- Corte: lo vencido a la hora de la nota (02-10-2026 15:38 Chile = 18:38 UTC).
-- Lo que venció después nadie lo revisó y queda como está. Tampoco se toca un
-- registro con un intento de discado vivo, ni las agendas de la propia Emily.
-- Cada cambio queda en crm_audit_events con el valor anterior.

create temporary table _corte on commit drop as
select
  '2026-10-02 18:38:00+00'::timestamptz as hasta,
  (select id from public.profiles where email = 'egimenezm@geimser.cl') as emily_id,
  (select id from public.profiles where email = 'eperezm@geoinfobusiness.cl') as eduardo_id;

do $$
begin
  if (select emily_id from _corte) is null then
    raise exception 'No se encontró el perfil de Emily Gimenez.';
  end if;
end;
$$;

create temporary table _objetivo on commit drop as
select
  l.id,
  l.crm_entity_id,
  l.campaign_id,
  l.team_id,
  l.assigned_to,
  l.managed_by,
  l.workflow_status,
  l.assignment_status,
  l.next_action_at,
  l.next_action_channel,
  l.callback_mode,
  case
    when l.managed_by = k.eduardo_id then 'a_emily'
    when c.name ilike '%secretaria%' then 'a_emily'
    else 'cerrar'
  end as accion
from public.leads l
cross join _corte k
join public.profiles owner on owner.id = l.managed_by
left join public.campaigns c on c.id = l.campaign_id
where l.next_action_at is not null
  and l.managed_by is distinct from k.emily_id
  and (
    l.managed_by = k.eduardo_id
    or l.next_action_at <= k.hasta
  )
  and owner.organization_id = (select organization_id from public.profiles where id = k.emily_id)
  and not exists (
    select 1 from public.dial_attempts en_curso
    where en_curso.lead_id = l.id
      and en_curso.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
  );

insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
select
  o.id,
  o.crm_entity_id,
  null,
  case when o.accion = 'a_emily' then 'lead.agenda_vencida_reasignada' else 'lead.agenda_vencida_cerrada' end,
  jsonb_build_object(
    'source', 'migration_20261005150000',
    'motivo', case
      when o.accion = 'a_emily' then 'Agenda de Secretaria Virtual (o de Eduardo Pérez) pasa a Emily Gimenez.'
      else 'Agenda vencida revisada por el equipo el 02-10-2026; se da de baja.'
    end,
    'nuevo_managed_by', case when o.accion = 'a_emily' then (select emily_id from _corte) end,
    'previo', jsonb_build_object(
      'assigned_to', o.assigned_to,
      'managed_by', o.managed_by,
      'workflow_status', o.workflow_status,
      'assignment_status', o.assignment_status,
      'next_action_at', o.next_action_at,
      'next_action_channel', o.next_action_channel,
      'callback_mode', o.callback_mode
    )
  )
from _objetivo o;

-- Traspaso a Emily: igual que assign_lead con p_set_managed_by, la agenda
-- sigue a managed_by y conserva su fecha (queda en "Vencidas por recuperar").
update public.lead_assignments a
set is_active = false, ends_at = now(), updated_at = now()
from _objetivo o
where a.lead_id = o.id and a.is_active and o.accion = 'a_emily';

insert into public.lead_assignments
  (lead_id, assigned_to, assigned_by, team_id, campaign_id, reason, source, is_active, starts_at)
select o.id, k.emily_id, null, o.team_id, o.campaign_id,
  'Agenda de Secretaria Virtual pasa a Emily (pedido 02-10-2026)', 'migration_20261005150000', true, now()
from _objetivo o cross join _corte k
where o.accion = 'a_emily';

update public.leads l set
  assigned_to = k.emily_id,
  managed_by = k.emily_id,
  assignment_status = 'assigned',
  updated_at = now()
from _objetivo o cross join _corte k
where l.id = o.id and o.accion = 'a_emily';

-- Baja: la agenda desaparece y el registro queda gestionado.
update public.leads l set
  next_action_at = null,
  workflow_status = case when l.workflow_status = 'callback' then 'managed' else l.workflow_status end,
  updated_at = now()
from _objetivo o
where l.id = o.id and o.accion = 'cerrar';
