-- Las agendas de Atlas 1 que ya se habían atendido vuelven a cerrarse.
--
-- 20260925090000_recupera_agendas_atlas1_de_las_llamadas repuso en "Mi agenda"
-- la agenda de la última llamada tipificada de cada cliente migrado. Pero en
-- Atlas 1 una agenda se daba por cerrada con cualquier llamada posterior,
-- aunque quedara sin tipificar ("GESTION EN CURSO"), y esa recuperación no lo
-- miró: revivió compromisos de junio a septiembre que el ejecutivo ya había
-- llamado. Los ejecutivos los veían como cientos de agendas vencidas (Ana
-- Morales tenía 80 de ellas, de 90 en total).
--
-- Criterio: agenda recuperada que sigue intacta (misma fecha, estado
-- 'callback'), ya vencida, con al menos una llamada del cliente posterior a la
-- que dejó la agenda (la regla de cierre de Atlas 1), sin gestiones nuevas en
-- Atlas 2.0 desde la recuperación y sin un intento de discado en curso. Cada
-- cliente vuelve al estado que tenía antes de la recuperación, auditado con
-- lo que se deshace. Las agendas futuras y las que nadie volvió a llamar
-- quedan como están.

with rec as (
  select distinct on (e.lead_id)
    e.lead_id,
    e.created_at as recuperada_at,
    (e.payload->>'next_action_at')::timestamptz as agenda_at,
    (e.payload->>'call_id')::uuid as agenda_call_id,
    e.payload->'previo' as previo
  from public.crm_audit_events e
  where e.event_type = 'lead.agenda_atlas1_recuperada'
  order by e.lead_id, e.created_at
),
obj as (
  select
    l.id, l.crm_entity_id, l.managed_by, l.next_action_at, l.next_action_channel, l.callback_mode,
    rec.agenda_call_id, rec.previo,
    (
      select min(later.started_at)
      from public.calls later
      where later.lead_id = l.id and later.started_at > agenda_call.started_at
    ) as atendida_at
  from rec
  join public.leads l on l.id = rec.lead_id
  join public.calls agenda_call on agenda_call.id = rec.agenda_call_id
  where l.workflow_status = 'callback'
    and l.next_action_at = rec.agenda_at
    and rec.agenda_at < now()
    and exists (
      select 1 from public.calls later
      where later.lead_id = l.id and later.started_at > agenda_call.started_at
    )
    and not exists (
      select 1 from public.calls nueva
      where nueva.lead_id = l.id
        and nueva.legacy_call_id is null
        and nueva.created_at >= rec.recuperada_at
    )
    and not exists (
      select 1 from public.dial_attempts en_curso
      where en_curso.lead_id = l.id
        and en_curso.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
    )
),
aud as (
  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  select id, crm_entity_id, null, 'lead.agenda_atlas1_revertida',
    jsonb_build_object(
      'agenda_call_id', agenda_call_id,
      'atendida_at', atendida_at,
      'deshecho', jsonb_build_object(
        'managed_by', managed_by,
        'workflow_status', 'callback',
        'next_action_at', next_action_at,
        'next_action_channel', next_action_channel,
        'callback_mode', callback_mode
      ),
      'restaurado', previo,
      'motivo', 'Atlas 1 ya había cerrado esta agenda con una llamada posterior; la recuperación del 25-09 la revivió como vencida.'
    )
  from obj
  returning lead_id
)
update public.leads l set
  managed_by = (o.previo->>'managed_by')::uuid,
  workflow_status = o.previo->>'workflow_status',
  next_action_at = null,
  next_action_channel = o.previo->>'next_action_channel',
  callback_mode = o.previo->>'callback_mode',
  updated_at = now()
from obj o
where l.id = o.id
  and exists (select 1 from aud where aud.lead_id = o.id);
