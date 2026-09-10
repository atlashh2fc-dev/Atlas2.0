-- Evalúa el permiso de supervisión de Mail una vez por alcance, no por fila.
--
-- `can_supervise_mail_lead(campaign_id, team_id)` estaba en el WHERE, así que
-- corría una vez por cada fila de mail_campaign_lead_status: 8.210 veces. Y
-- cada una de esas ejecuciones vuelve a resolver el contexto del actor, que no
-- cambia: `current_role_name()` (que a su vez consulta profiles y auth.sessions)
-- y `supervised_team_ids()` (que cruza teams, profiles y team_supervisors).
--
-- Sobre los datos actuales esas 8.210 filas contienen apenas 8 combinaciones
-- distintas de campaña y equipo. Se resuelve el permiso para esas 8 y se une
-- por ellas.
--
-- La decisión la sigue tomando exactamente la misma función con exactamente
-- los mismos argumentos: no se reescribió ni se duplicó ninguna regla de
-- acceso, sólo se dejó de repetir la pregunta. Es deliberado: es una función
-- de control de acceso sobre datos personales de clientes y no es lugar para
-- reimplementar la lógica en línea.
--
-- La reestructuración del join se verificó por separado, forzando el permiso a
-- true en ambas versiones y comparando la salida completa en tres alcances
-- (sin filtros, por campaña de mail y por campaña): idénticas las tres.
--
-- Se elimina además el `cross join access_check`, un CTE de una fila cuyas dos
-- columnas no las leía nadie.

create or replace function public.get_mail_engagement_report_read_model(
  p_mail_campaign_id uuid default null,
  p_campaign_id uuid default null
)
returns table(
  mail_campaign_id uuid, mail_campaign_name text, campaign_id uuid, campaign_name text,
  sent_leads integer, delivered_leads integer, opened_leads integer, clicked_leads integer,
  hot_leads integer, assigned_hot_leads integer, managed_hot_leads integer,
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
    where (p_mail_campaign_id is null or s.mail_campaign_id = p_mail_campaign_id)
      and (p_campaign_id is null or s.campaign_id = p_campaign_id)
  ),
  permitidos as (
    select camp, equipo
    from alcance
    where public.can_supervise_mail_lead(camp, equipo)
  )
  select mc.id, coalesce(mc.name, c.name), s.campaign_id, c.name,
    count(*) filter (where s.sent)::integer,
    count(*) filter (where s.delivered)::integer,
    count(*) filter (where s.opened)::integer,
    count(*) filter (where s.clicked)::integer,
    count(*) filter (where s.opened or s.clicked)::integer,
    count(*) filter (where (s.opened or s.clicked) and l.assigned_to is not null)::integer,
    count(*) filter (where (s.opened or s.clicked) and (l.assignment_status = 'managed' or l.workflow_status = 'managed'))::integer,
    max(s.last_seen_at)
  from public.mail_campaign_lead_status s
  join public.mail_campaigns mc on mc.id = s.mail_campaign_id
  join public.leads l on l.id = s.lead_id
  join public.campaigns c on c.id = s.campaign_id
  join permitidos pm
    on pm.camp = s.campaign_id
   and pm.equipo is not distinct from l.team_id
  where (p_mail_campaign_id is null or mc.id = p_mail_campaign_id)
    and (p_campaign_id is null or s.campaign_id = p_campaign_id)
  group by mc.id, mc.name, s.campaign_id, c.name
  order by max(s.last_seen_at) desc nulls last, coalesce(mc.name, c.name);
$function$;
