create or replace function public.get_supervisor_report_drilldown(
  p_from timestamptz,
  p_to timestamptz,
  p_profile_id uuid default null,
  p_historical_agent_id uuid default null,
  p_metric text default 'agendas',
  p_limit int default 100
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  v_role text;
  v_team_id uuid;
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_result jsonb;
begin
  select p.role, p.team_id
  into v_role, v_team_id
  from public.profiles p
  where p.id = auth.uid()
    and p.active
  limit 1;

  if v_role not in ('supervisor', 'admin') then
    raise exception 'No autorizado';
  end if;

  if p_metric not in ('agendas', 'cotizaciones', 'ventas') then
    raise exception 'Métrica no soportada: %', p_metric;
  end if;

  with linked_historical_agents as (
    select ha.id
    from public.historical_agents ha
    where p_profile_id is not null
      and ha.linked_profile_id = p_profile_id
  ),
  base_calls as (
    select
      c.*,
      coalesce(c.ended_at, c.updated_at, c.created_at) as activity_at,
      l.full_name,
      l.rut,
      l.phone,
      l.email,
      l.status as lead_status,
      l.tipificacion_actual,
      l.observacion_actual,
      l.next_action_at as lead_next_action_at,
      l.managed_at,
      camp.name as campaign_name,
      coalesce(p.full_name, ha.full_name, '—') as agent_name
    from public.calls c
    join public.leads l on l.id = c.lead_id
    left join public.campaigns camp on camp.id = l.campaign_id
    left join public.profiles p on p.id = c.agent_id
    left join public.historical_agents ha on ha.id = c.historical_agent_id
    where c.discarded_reason is null
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= p_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) <= p_to
      and (v_role = 'admin' or l.team_id = v_team_id)
      and (
        (
          p_profile_id is not null
          and (
            (c.agent_id = p_profile_id and c.historical_agent_id is null)
            or c.historical_agent_id in (select id from linked_historical_agents)
          )
        )
        or (
          p_historical_agent_id is not null
          and c.historical_agent_id = p_historical_agent_id
        )
      )
      and (
        (p_metric = 'agendas' and c.next_action_at is not null)
        or (p_metric = 'cotizaciones' and c.reason ilike '%COTIZACION%')
        or (p_metric = 'ventas' and (c.outcome = 'sale' or c.reason ilike '%VENTA%'))
      )
  ),
  limited_calls as (
    select *
    from base_calls
    order by activity_at desc
    limit v_limit
  )
  select jsonb_build_object(
    'metric', p_metric,
    'limit', v_limit,
    'items', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'call_id', lc.id,
          'lead_id', lc.lead_id,
          'activity_at', lc.activity_at,
          'started_at', lc.started_at,
          'ended_at', lc.ended_at,
          'status', lc.status,
          'outcome', lc.outcome,
          'reason', lc.reason,
          'notes', lc.notes,
          'next_action_at', lc.next_action_at,
          'equifax_products', lc.equifax_products,
          'equifax_uf_amount', lc.equifax_uf_amount,
          'equifax_recipient_email', lc.equifax_recipient_email,
          'agent_name', lc.agent_name,
          'lead', jsonb_build_object(
            'id', lc.lead_id,
            'full_name', lc.full_name,
            'rut', lc.rut,
            'phone', lc.phone,
            'email', lc.email,
            'status', lc.lead_status,
            'tipificacion_actual', lc.tipificacion_actual,
            'observacion_actual', lc.observacion_actual,
            'next_action_at', lc.lead_next_action_at,
            'managed_at', lc.managed_at,
            'campaign_name', lc.campaign_name
          ),
          'contacts', (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'id', ct.id,
                  'contact_type', ct.contact_type,
                  'value', ct.value,
                  'label', ct.label,
                  'is_primary', ct.is_primary,
                  'is_valid', ct.is_valid
                )
                order by ct.is_primary desc, ct.contact_type, ct.created_at
              ),
              '[]'::jsonb
            )
            from public.lead_contacts ct
            where ct.lead_id = lc.lead_id
          )
        )
        order by lc.activity_at desc
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from limited_calls lc;

  return coalesce(v_result, jsonb_build_object('metric', p_metric, 'limit', v_limit, 'items', '[]'::jsonb));
end;
$function$;

revoke all on function public.get_supervisor_report_drilldown(timestamptz, timestamptz, uuid, uuid, text, int) from public, anon;
grant execute on function public.get_supervisor_report_drilldown(timestamptz, timestamptz, uuid, uuid, text, int) to authenticated;
