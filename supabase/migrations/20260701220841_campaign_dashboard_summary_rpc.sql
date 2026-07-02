create or replace function public.get_campaign_dashboard_summary(
  p_campaign_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_previous_from timestamptz default null,
  p_previous_to timestamptz default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with
  params as (
    select
      p_campaign_id as campaign_id,
      p_from as from_at,
      p_to as to_at,
      coalesce(p_previous_from, p_from - (p_to - p_from) - interval '1 millisecond') as previous_from_at,
      coalesce(p_previous_to, p_from - interval '1 millisecond') as previous_to_at
  ),
  campaign_leads as (
    select l.id, l.full_name
    from public.leads l, params p
    where l.campaign_id = p.campaign_id
  ),
  current_calls as (
    select
      c.id,
      c.lead_id,
      cl.full_name as lead_full_name,
      c.agent_id,
      coalesce(pr.full_name, 'Sin ejecutivo') as agent_name,
      c.status,
      c.reason,
      c.equifax_products,
      c.equifax_uf_amount,
      c.next_action_at,
      c.started_at
    from public.calls c
    join campaign_leads cl on cl.id = c.lead_id
    left join public.profiles pr on pr.id = c.agent_id
    join params p on true
    where c.started_at >= p.from_at
      and c.started_at <= p.to_at
  ),
  previous_calls as (
    select
      c.id,
      c.lead_id,
      c.agent_id,
      c.status,
      c.reason,
      c.equifax_uf_amount,
      c.started_at
    from public.calls c
    join campaign_leads cl on cl.id = c.lead_id
    join params p on true
    where c.started_at >= p.previous_from_at
      and c.started_at <= p.previous_to_at
  ),
  totals as (
    select count(*)::int as total_leads
    from campaign_leads
  ),
  kpi_current as (
    select
      count(*)::int as gestiones,
      count(*) filter (where status = 'connected')::int as contactadas,
      count(*) filter (where reason = 'VENTA EN VALIDACION')::int as ventas,
      coalesce(sum(equifax_uf_amount) filter (where reason = 'VENTA EN VALIDACION'), 0)::numeric as uf_total,
      count(*) filter (where reason = 'COTIZACION ENVIADA')::int as cotizaciones
    from current_calls
  ),
  kpi_previous as (
    select
      count(*)::int as gestiones,
      count(*) filter (where status = 'connected')::int as contactadas,
      count(*) filter (where reason = 'VENTA EN VALIDACION')::int as ventas,
      coalesce(sum(equifax_uf_amount) filter (where reason = 'VENTA EN VALIDACION'), 0)::numeric as uf_total
    from previous_calls
  ),
  funnel as (
    select jsonb_build_array(
      jsonb_build_object('name', 'BBDD asignada', 'value', (select total_leads from totals)),
      jsonb_build_object('name', 'Gestionados', 'value', count(distinct lead_id)),
      jsonb_build_object('name', 'Contactados', 'value', count(distinct lead_id) filter (where status = 'connected')),
      jsonb_build_object(
        'name', 'Con resultado',
        'value', count(distinct lead_id) filter (where status = 'connected' and reason is not null and reason <> 'GESTION EN CURSO')
      ),
      jsonb_build_object('name', 'Venta en validación', 'value', count(distinct lead_id) filter (where reason = 'VENTA EN VALIDACION'))
    ) as data
    from current_calls
  ),
  reasons as (
    select coalesce(
      jsonb_agg(jsonb_build_object('reason', reason, 'count', total) order by total desc),
      '[]'::jsonb
    ) as data
    from (
      select reason, count(*)::int as total
      from current_calls
      where reason is not null
        and reason <> 'GESTION EN CURSO'
      group by reason
    ) r
  ),
  products as (
    select coalesce(
      jsonb_agg(jsonb_build_object('product', product, 'count', total, 'uf', uf_total) order by total desc),
      '[]'::jsonb
    ) as data
    from (
      select product, count(*)::int as total, coalesce(sum(equifax_uf_amount), 0)::numeric as uf_total
      from current_calls
      cross join lateral unnest(coalesce(equifax_products, array[]::text[])) as product
      group by product
    ) p
  ),
  series_days as (
    select generate_series(
      (select from_at::date from params),
      (select to_at::date from params),
      interval '1 day'
    )::date as day
  ),
  time_series as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date', to_char(sd.day, 'YYYY-MM-DD'),
          'gestiones', coalesce(d.gestiones, 0),
          'ventas', coalesce(d.ventas, 0)
        )
        order by sd.day
      ),
      '[]'::jsonb
    ) as data
    from series_days sd
    left join (
      select
        started_at::date as day,
        count(*)::int as gestiones,
        count(*) filter (where reason = 'VENTA EN VALIDACION')::int as ventas
      from current_calls
      group by started_at::date
    ) d on d.day = sd.day
  ),
  agenda as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'lead_full_name', lead_full_name,
          'agent_name', agent_name,
          'reason', reason,
          'next_action_at', next_action_at,
          'overdue', next_action_at < now()
        )
        order by next_action_at
      ),
      '[]'::jsonb
    ) as data
    from (
      select *
      from current_calls
      where next_action_at is not null
      order by next_action_at
      limit 100
    ) a
  ),
  agents as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'agent_id', agent_id,
          'name', agent_name,
          'gestiones', gestiones,
          'contactos', contactos,
          'ventas', ventas,
          'uf', uf_total
        )
        order by ventas desc, gestiones desc, agent_name
      ),
      '[]'::jsonb
    ) as data
    from (
      select
        agent_id,
        agent_name,
        count(*)::int as gestiones,
        count(*) filter (where status = 'connected')::int as contactos,
        count(*) filter (where reason = 'VENTA EN VALIDACION')::int as ventas,
        coalesce(sum(equifax_uf_amount) filter (where reason = 'VENTA EN VALIDACION'), 0)::numeric as uf_total
      from current_calls
      group by agent_id, agent_name
    ) a
  )
  select jsonb_build_object(
    'total_leads', (select total_leads from totals),
    'range', jsonb_build_object(
      'from', (select from_at from params),
      'to', (select to_at from params),
      'previous_from', (select previous_from_at from params),
      'previous_to', (select previous_to_at from params)
    ),
    'kpis', jsonb_build_object(
      'gestionadas', jsonb_build_object('current', kc.gestiones, 'previous', kp.gestiones),
      'contactadas', jsonb_build_object('current', kc.contactadas, 'previous', kp.contactadas),
      'ventas', jsonb_build_object('current', kc.ventas, 'previous', kp.ventas),
      'uf_total', jsonb_build_object('current', kc.uf_total, 'previous', kp.uf_total),
      'cotizaciones', kc.cotizaciones
    ),
    'funnel', (select data from funnel),
    'reasons', (select data from reasons),
    'products', (select data from products),
    'time_series', (select data from time_series),
    'agenda', (select data from agenda),
    'agents', (select data from agents)
  )
  from kpi_current kc
  cross join kpi_previous kp;
$function$;

grant execute on function public.get_campaign_dashboard_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz)
  to authenticated;;
