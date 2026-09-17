-- Informes que agregan sin exigir campaña: ahora suman solo lo de la empresa
-- del visitante. Antes, un admin veía el total de todas las empresas.

create or replace function public.get_contactability_by_hour(p_from timestamp with time zone, p_to timestamp with time zone, p_campaign_id uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role text := coalesce(public.current_role_name()::text, '');
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado.';
  end if;

  if v_role not in ('admin', 'supervisor') then
    raise exception 'No tienes permiso para revisar este reporte.';
  end if;

  perform public.assert_org_access(public.org_of_campaign(p_campaign_id));

  with gestiones as (
    select
      extract(hour from (c.started_at at time zone 'America/Santiago'))::int as hora,
      count(*)::int as gestiones,
      count(*) filter (where c.status = 'connected')::int as contactos,
      count(*) filter (where c.outcome = 'sale')::int as ventas
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where c.started_at >= p_from
      and c.started_at <= p_to
      and c.ended_at is not null
      and public.can_access_org(l.organization_id)
      and (p_campaign_id is null or l.campaign_id = p_campaign_id)
    group by 1
  ),
  franjas as (
    select generate_series(0, 23) as hora
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'hora', f.hora,
        'label', lpad(f.hora::text, 2, '0') || ':00',
        'gestiones', coalesce(g.gestiones, 0),
        'contactos', coalesce(g.contactos, 0),
        'ventas', coalesce(g.ventas, 0),
        'contactabilidad',
          case
            when coalesce(g.gestiones, 0) = 0 then null
            else round((g.contactos::numeric / g.gestiones) * 100, 1)
          end
      )
      order by f.hora
    ),
    '[]'::jsonb
  )
  into v_result
  from franjas f
  left join gestiones g on g.hora = f.hora;

  return v_result;
end;
$function$;

create or replace function public.get_workflow_compliance()
 returns TABLE(workflow_id uuid, workflow_name text, total_leads bigint, compliant_leads bigint, compliance_rate numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    m.workflow_id,
    m.workflow_name,
    sum(m.total_leads) as total_leads,
    sum(m.compliant_leads) as compliant_leads,
    case when sum(m.total_leads) > 0
      then round(100.0 * sum(m.compliant_leads) / sum(m.total_leads), 1)
      else null
    end as compliance_rate
  from public.workflow_compliance_mv m
  where
    public.can_access_org(public.org_of_team(m.team_id))
    and (
      (select current_role_name()) = 'admin'
      or ((select current_role_name()) = 'supervisor' and m.team_id = (select current_team_id()))
    )
  group by m.workflow_id, m.workflow_name
  order by m.workflow_name;
$function$;
