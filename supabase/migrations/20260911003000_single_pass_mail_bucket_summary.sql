-- Resume las colas de Correo en una pasada y filtra por permiso antes de los laterales.
--
-- Dos problemas independientes en la misma función:
--
-- 1. `can_supervise_mail_lead(campaign_id, team_id)` estaba en el WHERE, junto
--    a dos LATERAL correlacionados. Se evaluaba por fila sobre las 8.210 filas
--    de mail_campaign_lead_status, y los laterales se calculaban también para
--    filas que el permiso iba a descartar. Ahora el permiso se resuelve para
--    las combinaciones distintas de campaña y equipo (8 en los datos actuales)
--    y se une antes, así los laterales sólo corren sobre lo que el actor puede
--    ver. La decisión la sigue tomando la misma función con los mismos
--    argumentos: no se reimplementó ninguna regla de acceso.
--
-- 2. El resultado se armaba con nueve SELECT unidos por UNION ALL, cada uno
--    recorriendo entero el mismo conjunto de 4.379 filas para contar una sola
--    casilla. Ahora es un GROUP BY y un LEFT JOIN contra el catálogo de las
--    nueve colas, que además garantiza que sigan apareciendo todas aunque
--    alguna quede en cero, igual que antes.
--
-- Verificado contra los datos reales casilla por casilla: las nueve coinciden
-- en lead_count, oldest_event_at y nearest_action_at. Las etiquetas y el
-- sort_order se mantienen literales porque la UI los usa tal cual para el
-- nombre y el orden de los chips.

create or replace function public.get_mail_operational_bucket_summary(
  p_mail_campaign_id uuid default null,
  p_campaign_id uuid default null
)
returns table(
  bucket text, label text, sort_order integer,
  lead_count integer, oldest_event_at timestamp with time zone,
  nearest_action_at timestamp with time zone
)
language sql
security definer
set search_path to ''
as $function$
  with clock as (select now() as observed_at),
  alcance as (
    select distinct s.campaign_id as camp, l.team_id as equipo
    from public.mail_campaign_lead_status s
    join public.leads l on l.id = s.lead_id
    where (p_campaign_id is null or s.campaign_id = p_campaign_id)
  ),
  permitidos as (
    select camp, equipo from alcance
    where public.can_supervise_mail_lead(camp, equipo)
  ),
  candidate_leads as (
    select s.opened, s.clicked,
      greatest(s.last_seen_at, mail.last_inbound_at, mail.last_agent_reply_at) as last_event_at,
      l.assigned_to, l.next_action_at, l.assignment_status, l.workflow_status,
      latest.last_interaction_at, mail.last_inbound_at, mail.last_agent_reply_at,
      clock.observed_at
    from public.mail_campaign_lead_status s
    join public.leads l on l.id = s.lead_id
    join public.mail_campaigns mc on mc.id = s.mail_campaign_id
    join permitidos pm
      on pm.camp = s.campaign_id
     and pm.equipo is not distinct from l.team_id
    cross join clock
    left join lateral (
      select
        max(message.occurred_at) filter (where message.direction = 'inbound') as last_inbound_at,
        greatest(
          max(message.occurred_at) filter (
            where message.direction = 'outbound'
              and nullif(message.metadata->>'crm_reply_command_id', '') is not null
          ),
          (select max(command.delivered_at)
           from public.mail_reply_commands command
           where command.lead_id = s.lead_id
             and command.campaign_id = s.campaign_id
             and command.status = 'delivered')
        ) as last_agent_reply_at
      from public.lead_mail_messages message
      where message.lead_id = s.lead_id and message.campaign_id = s.campaign_id
    ) mail on true
    left join lateral (
      select i.created_at as last_interaction_at from public.interactions i
      where i.lead_id = s.lead_id order by i.created_at desc limit 1
    ) latest on true
    where (s.opened or s.clicked or mail.last_inbound_at is not null or mail.last_agent_reply_at is not null)
      and (p_mail_campaign_id is null or mc.id = p_mail_campaign_id)
      and (p_campaign_id is null or s.campaign_id = p_campaign_id)
  ),
  work_items as (
    select cl.*, case
      when cl.last_inbound_at is not null
        and (cl.last_agent_reply_at is null or cl.last_inbound_at > cl.last_agent_reply_at)
        then 'customer_replied'
      when cl.next_action_at is not null and cl.next_action_at <= cl.observed_at then 'overdue'
      when cl.assigned_to is null then 'unassigned'
      when cl.clicked and cl.last_interaction_at is null then 'clicked_uncontacted'
      when cl.opened and not cl.clicked and cl.last_interaction_at is null then 'opened_uncontacted'
      when cl.next_action_at is not null and cl.next_action_at > cl.observed_at then 'next_action'
      when cl.last_agent_reply_at is not null then 'agent_replied'
      when cl.workflow_status = 'managed' or cl.assignment_status = 'managed' then 'managed'
      else 'monitor'
    end as work_bucket
    from candidate_leads cl
  ),
  agregado as (
    select work_bucket,
           count(*)::integer as lead_count,
           min(last_event_at) as oldest_event_at,
           min(next_action_at) as nearest_action_at
    from work_items
    group by work_bucket
  ),
  catalogo(bucket, label, sort_order, usa_next_action) as (values
    ('customer_replied', 'Respuesta cliente pendiente', 10, false),
    ('overdue',          'Agenda vencida',              20, true),
    ('unassigned',       'Sin asignar',                 30, false),
    ('clicked_uncontacted','Click sin gestión',         40, false),
    ('opened_uncontacted', 'Apertura sin gestión',      50, false),
    ('next_action',      'Próxima acción',              60, true),
    ('agent_replied',    'Respondido por agente',       70, false),
    ('managed',          'Gestionados',                 80, false),
    ('monitor',          'En seguimiento',              90, false)
  )
  select cat.bucket::text, cat.label::text, cat.sort_order::integer,
         coalesce(a.lead_count, 0)::integer,
         a.oldest_event_at,
         case when cat.usa_next_action then a.nearest_action_at else null::timestamptz end
  from catalogo cat
  left join agregado a on a.work_bucket = cat.bucket
  order by cat.sort_order;
$function$;
