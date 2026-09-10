-- Resuelve el permiso una vez por alcance también en el resumen por ejecutivo.
--
-- Cuarta y última función de Correo con el mismo patrón:
-- `can_supervise_mail_lead(campaign_id, team_id)` en el WHERE, evaluada una
-- vez por fila de mail_campaign_lead_status. Pasa a resolverse para las
-- combinaciones distintas de campaña y equipo y a unirse antes.
--
-- Se elimina además el `cross join access_check`, un CTE de una fila que hacía
-- dos llamadas a funciones cuyos resultados no leía nadie.
--
-- Todo lo demás queda igual: el `distinct on (lead_id)` que evita contar dos
-- veces al ejecutivo cuando un lead recibió dos mailings, la resolución del
-- dueño por interacción o por asignación, y las 16 columnas del contrato.

create or replace function public.get_mail_agent_control_summary_read_model(
  p_mail_campaign_id uuid default null,
  p_campaign_id uuid default null
)
returns table(
  agent_id uuid, agent_name text, assigned_leads integer, clicked_leads integer,
  opened_only_leads integer, uncontacted_leads integer, clicked_uncontacted_leads integer,
  contacted_leads integer, interactions integer, agendas integer, pending_agendas integer,
  overdue_agendas integer, no_next_action_leads integer,
  next_agenda_at timestamp with time zone, last_interaction_at timestamp with time zone,
  last_event_at timestamp with time zone
)
language sql
security definer
set search_path to ''
as $function$
  with alcance as (
    select distinct s.campaign_id as camp, l.team_id as equipo
    from public.mail_campaign_lead_status s
    join public.leads l on l.id = s.lead_id
    where (p_campaign_id is null or s.campaign_id = p_campaign_id)
  ), permitidos as (
    select camp, equipo from alcance
    where public.can_supervise_mail_lead(camp, equipo)
  ), candidate_leads_raw as (
    select s.lead_id, s.opened, s.clicked, s.last_seen_at as last_event_at,
      s.priority_rank, l.assigned_to, l.next_action_at
    from public.mail_campaign_lead_status s
    join public.leads l on l.id = s.lead_id
    join public.mail_campaigns mc on mc.id = s.mail_campaign_id
    join permitidos pm
      on pm.camp = s.campaign_id
     and pm.equipo is not distinct from l.team_id
    where (s.opened or s.clicked)
      and (p_mail_campaign_id is null or mc.id = p_mail_campaign_id)
      and (p_campaign_id is null or s.campaign_id = p_campaign_id)
  ), candidate_leads as (
    -- La carga de un ejecutivo es por lead, incluso si recibió dos mailings.
    -- Conservamos la señal más urgente/reciente para no duplicar gestiones.
    select distinct on (lead_id)
      lead_id, opened, clicked, last_event_at, assigned_to, next_action_at
    from candidate_leads_raw
    order by lead_id, priority_rank asc, last_event_at desc
  ), interaction_owners as (
    select cl.lead_id, coalesce(ha.linked_profile_id, i.historical_agent_id, i.agent_id) as owner_id,
      coalesce(linked.full_name, ha.full_name, p.full_name, 'Ejecutivo sin nombre') as owner_name,
      count(i.id)::integer as interaction_count, max(i.created_at) as last_interaction_at
    from candidate_leads cl
    join public.interactions i on i.lead_id = cl.lead_id
    left join public.historical_agents ha on ha.id = i.historical_agent_id
    left join public.profiles linked on linked.id = ha.linked_profile_id
    left join public.profiles p on p.id = i.agent_id
    where coalesce(ha.linked_profile_id, i.historical_agent_id, i.agent_id) is not null
    group by cl.lead_id, coalesce(ha.linked_profile_id, i.historical_agent_id, i.agent_id), coalesce(linked.full_name, ha.full_name, p.full_name, 'Ejecutivo sin nombre')
  ), assignment_owners as (
    select cl.lead_id, cl.assigned_to as owner_id, p.full_name as owner_name,
      0::integer as interaction_count, null::timestamptz as last_interaction_at
    from candidate_leads cl join public.profiles p on p.id = cl.assigned_to
    where cl.assigned_to is not null and not exists (
      select 1 from interaction_owners io where io.lead_id = cl.lead_id and io.owner_id = cl.assigned_to
    )
  ), owner_rows as (
    select * from interaction_owners union all select * from assignment_owners
  )
  select o.owner_id, max(o.owner_name), count(distinct cl.lead_id)::integer,
    count(distinct cl.lead_id) filter (where cl.clicked)::integer,
    count(distinct cl.lead_id) filter (where cl.opened and not cl.clicked)::integer,
    count(distinct cl.lead_id) filter (where coalesce(o.interaction_count, 0) = 0)::integer,
    count(distinct cl.lead_id) filter (where cl.clicked and coalesce(o.interaction_count, 0) = 0)::integer,
    count(distinct cl.lead_id) filter (where coalesce(o.interaction_count, 0) > 0)::integer,
    coalesce(sum(o.interaction_count), 0)::integer,
    count(distinct cl.lead_id) filter (where cl.next_action_at is not null)::integer,
    count(distinct cl.lead_id) filter (where cl.next_action_at is not null and cl.next_action_at > now())::integer,
    count(distinct cl.lead_id) filter (where cl.next_action_at is not null and cl.next_action_at <= now())::integer,
    count(distinct cl.lead_id) filter (where cl.next_action_at is null)::integer,
    min(cl.next_action_at) filter (where cl.next_action_at is not null),
    max(o.last_interaction_at), max(cl.last_event_at)
  from owner_rows o join candidate_leads cl on cl.lead_id = o.lead_id
  group by o.owner_id
  order by count(distinct cl.lead_id) filter (where cl.next_action_at is not null and cl.next_action_at <= now()) desc,
    count(distinct cl.lead_id) filter (where cl.clicked) desc, count(distinct cl.lead_id) desc, max(o.owner_name);
$function$;
