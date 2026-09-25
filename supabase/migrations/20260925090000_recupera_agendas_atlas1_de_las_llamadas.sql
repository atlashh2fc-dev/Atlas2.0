-- Recupera las agendas de Atlas 1 que quedaron solo en la llamada.
--
-- En Atlas 1 la agenda vivía en calls.next_action_at y la daba por cerrada
-- cualquier llamada posterior, incluso un intento vacío (0 s, sin tipificar).
-- La migración 20260924130451 copió el next_action_at del cliente, que en
-- esos casos ya venía vacío, y "Mi agenda" de Atlas 2.0 se arma desde el
-- cliente: el ejecutivo dejó de ver compromisos que nadie volvió a gestionar.
--
-- Criterio: la última gestión tipificada del cliente dejó agenda, el cliente
-- no tiene fecha, el dueño (quien la agendó) es un ejecutivo activo, nadie más
-- lo tiene asignado y la tipificación vigente no es de cierre. Las vencidas no
-- las marca el discador (solo toma agendas dentro de su ventana): quedan en la
-- agenda para llamarlas a mano. Cada cliente deja su estado previo auditado.

with ult as (
  select distinct on (c.lead_id)
    c.lead_id, c.id as call_id, c.next_action_at,
    coalesce(c.callback_owner_user_id, c.agent_id) as owner_id
  from public.calls c
  where c.reason is not null
  order by c.lead_id, c.started_at desc
),
obj as (
  select l.id, l.crm_entity_id, u.call_id, u.next_action_at, u.owner_id,
    l.managed_by as prev_managed_by, l.workflow_status as prev_workflow_status,
    l.next_action_channel as prev_channel, l.callback_mode as prev_mode
  from ult u
  join public.leads l on l.id = u.lead_id
  join public.profiles owner_profile
    on owner_profile.id = u.owner_id and owner_profile.active and owner_profile.role = 'agente'
  where u.next_action_at is not null
    and l.next_action_at is null
    and (l.assigned_to is null or l.assigned_to = u.owner_id)
    and coalesce(l.tipificacion_actual, '') not in (
      'NUMERO ERRONEO / NO CORRESPONDE', 'NO ENTREGA CREDITO / PAGO CONTADO', 'NO DA MOTIVO',
      'TERCERO NO ENTREGA INFORMACION', 'NO CALIFICA', 'CLIENTE MOLESTO', 'CLIENTE CARTERIZADO',
      'SE DECLARA EN QUIEBRA O PROCESO DE CIERRE', 'TIENE CONTRATO CON LA COMPETENCIA',
      'TIENE CONTRATO CON COMPETENCIA', 'CLIENTE NO SUJETO A VENTA', 'PRECIO MUY ALTO',
      'TELEFONO FUERA DE SERVICIO'
    )
),
aud as (
  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  select id, crm_entity_id, null, 'lead.agenda_atlas1_recuperada',
    jsonb_build_object(
      'call_id', call_id,
      'next_action_at', next_action_at,
      'owner_id', owner_id,
      'previo', jsonb_build_object(
        'managed_by', prev_managed_by,
        'workflow_status', prev_workflow_status,
        'next_action_at', null,
        'next_action_channel', prev_channel,
        'callback_mode', prev_mode
      ),
      'motivo', 'Agenda de Atlas 1 guardada solo en la llamada; el cliente migró sin fecha y no aparecía en Mi agenda.'
    )
  from obj
  returning lead_id
)
update public.leads l set
  next_action_at = o.next_action_at,
  next_action_channel = 'phone',
  workflow_status = 'callback',
  callback_mode = 'personal',
  managed_by = o.owner_id,
  updated_at = now()
from obj o
where l.id = o.id
  and exists (select 1 from aud where aud.lead_id = o.id);
