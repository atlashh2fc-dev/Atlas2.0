-- Registros sin gestionar de Eduardo Pérez, desactivado el 05-10-2026.
--
-- Lo de Secretaria Virtual pasa a Emily Gimenez (mismo criterio que
-- 20261005150000); lo de Equifax queda sin dueño para que lo tome el reparto.
-- No se tocan los registros ya gestionados: su historial sigue a su nombre.
-- Cada cambio queda en crm_audit_events con el dueño anterior.

create temporary table _personas on commit drop as
select
  (select id from public.profiles where email = 'eperezm@geoinfobusiness.cl') as eduardo_id,
  (select id from public.profiles where email = 'egimenezm@geimser.cl') as emily_id;

create temporary table _objetivo on commit drop as
select
  l.id, l.crm_entity_id, l.campaign_id, l.team_id, l.assigned_to, l.assignment_status,
  case when c.name ilike '%secretaria%' then 'a_emily' else 'liberar' end as accion
from public.leads l
cross join _personas k
left join public.campaigns c on c.id = l.campaign_id
where l.assigned_to = k.eduardo_id
  and coalesce(l.workflow_status, '') not in ('managed', 'exception')
  and not exists (
    select 1 from public.dial_attempts en_curso
    where en_curso.lead_id = l.id
      and en_curso.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
  );

insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
select o.id, o.crm_entity_id, null,
  case when o.accion = 'a_emily' then 'lead.assigned' else 'lead.unassigned' end,
  jsonb_build_object(
    'source', 'migration_20261005160000',
    'reason', 'Eduardo Pérez desactivado el 05-10-2026',
    'old_assigned_to', o.assigned_to,
    'old_assignment_status', o.assignment_status,
    'new_assigned_to', case when o.accion = 'a_emily' then k.emily_id end,
    'campaign_id', o.campaign_id
  )
from _objetivo o cross join _personas k;

update public.lead_assignments a
set is_active = false, ends_at = now(), updated_at = now()
from _objetivo o
where a.lead_id = o.id and a.is_active;

insert into public.lead_assignments
  (lead_id, assigned_to, assigned_by, team_id, campaign_id, reason, source, is_active, starts_at)
select o.id, k.emily_id, null, o.team_id, o.campaign_id,
  'Eduardo Pérez desactivado; Secretaria Virtual pasa a Emily', 'migration_20261005160000', true, now()
from _objetivo o cross join _personas k
where o.accion = 'a_emily';

update public.leads l set
  assigned_to = case when o.accion = 'a_emily' then k.emily_id else null end,
  assignment_status = case when o.accion = 'a_emily' then 'assigned' else 'unassigned' end,
  updated_at = now()
from _objetivo o cross join _personas k
where l.id = o.id;
