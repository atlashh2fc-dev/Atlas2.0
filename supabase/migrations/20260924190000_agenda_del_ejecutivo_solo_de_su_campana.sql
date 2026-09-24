-- La agenda del ejecutivo muestra solo la campaña en la que está trabajando.
--
-- El discador ya respetaba el multiskill (claim_due_personal_callbacks solo
-- marca agendas de la campaña activa del dueño), pero las pantallas no: "Mi
-- agenda", la campana, el aviso de vencidas, el contador del menú, "Mis
-- agendas de hoy" y la cola de voz filtraban solo por dueño. Al encender
-- Equifax (24-09-2026) a Ana, José y Eduardo les aparecían sus agendas viejas
-- de Secretaria Virtual mientras discaban Equifax.
--
-- my_agenda_campaign_id() es la campaña que manda: la que eligió el ejecutivo
-- o le fijó su supervisor (agent_active_campaigns), si todavía pertenece a
-- ella; si no eligió y pertenece a una sola campaña, esa. Si no hay cómo
-- saberlo (varias campañas y ninguna elegida) devuelve null y las pantallas
-- muestran todo, como antes.

create or replace function public.my_agenda_campaign_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (
      select active.campaign_id
      from public.agent_active_campaigns active
      where active.profile_id = (select auth.uid())
        and exists (
          select 1 from public.campaign_agents membership
          where membership.profile_id = active.profile_id
            and membership.campaign_id = active.campaign_id
        )
    ),
    (
      select (array_agg(membership.campaign_id))[1]
      from public.campaign_agents membership
      where membership.profile_id = (select auth.uid())
      having count(*) = 1
    )
  );
$function$;

revoke all on function public.my_agenda_campaign_id() from public, anon;
grant execute on function public.my_agenda_campaign_id() to authenticated;

create or replace function public.get_home_dashboard_summary()
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with
  bounds as (
    select date_trunc('day', now()) + interval '1 day' - interval '1 millisecond' as end_of_today
  ),
  scope as (
    select public.my_agenda_campaign_id() as campaign_id
  ),
  recent as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'result', r.result,
          'created_at', r.created_at,
          'lead_name', coalesce(l.full_name, 'Lead')
        )
        order by r.created_at desc
      ),
      '[]'::jsonb
    ) as data
    from (
      select id, lead_id, result, created_at
      from public.interactions
      order by created_at desc
      limit 5
    ) r
    left join public.leads l on l.id = r.lead_id
  ),
  agenda as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'full_name', a.full_name,
          'rut', a.rut,
          'phone', a.phone,
          'next_action_at', a.next_action_at
        )
        order by a.next_action_at
      ),
      '[]'::jsonb
    ) as data
    from (
      select l.id, l.full_name, l.rut, l.phone, l.next_action_at
      from public.leads l, bounds b, scope s
      where l.managed_by = (select auth.uid())
        and l.next_action_at is not null
        and l.next_action_at <= b.end_of_today
        -- Solo la campaña en la que está trabajando (multiskill).
        and (s.campaign_id is null or l.campaign_id = s.campaign_id)
      order by l.next_action_at
      limit 20
    ) a
  )
  select jsonb_build_object(
    'stats', jsonb_build_object(
      'total', 0,
      'enGestion', 0,
      'convertidos', 0
    ),
    'recent', recent.data,
    'agenda', agenda.data
  )
  from recent
  cross join agenda;
$function$;

revoke all on function public.get_home_dashboard_summary() from public, anon;
grant execute on function public.get_home_dashboard_summary() to authenticated;
