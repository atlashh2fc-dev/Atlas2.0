-- Resumen reutilizable para una campaña o para toda la operación. Mantiene
-- RLS mediante SECURITY INVOKER y delega el cálculo base por campaña al RPC
-- existente, para que todas las vistas compartan los mismos indicadores.
create or replace function public.get_crm_dashboard_summary(
  p_from timestamptz,
  p_to timestamptz,
  p_previous_from timestamptz default null,
  p_previous_to timestamptz default null,
  p_campaign_id uuid default null
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
      p_from as from_at,
      p_to as to_at,
      coalesce(p_previous_from, p_from - (p_to - p_from) - interval '1 millisecond') as previous_from_at,
      coalesce(p_previous_to, p_from - interval '1 millisecond') as previous_to_at
  ),
  campaign_summaries as (
    select public.get_campaign_dashboard_summary(c.id, p_from, p_to, p_previous_from, p_previous_to) as summary
    from public.campaigns c
    where p_campaign_id is null or c.id = p_campaign_id
  ),
  metrics as (
    select
      coalesce(sum((summary #>> '{total_leads}')::int), 0)::int as total_leads,
      coalesce(sum((summary #>> '{kpis,gestionadas,current}')::int), 0)::int as gestionadas_current,
      coalesce(sum((summary #>> '{kpis,gestionadas,previous}')::int), 0)::int as gestionadas_previous,
      coalesce(sum((summary #>> '{kpis,contactadas,current}')::int), 0)::int as contactadas_current,
      coalesce(sum((summary #>> '{kpis,contactadas,previous}')::int), 0)::int as contactadas_previous,
      coalesce(sum((summary #>> '{kpis,ventas,current}')::int), 0)::int as ventas_current,
      coalesce(sum((summary #>> '{kpis,ventas,previous}')::int), 0)::int as ventas_previous,
      coalesce(sum((summary #>> '{kpis,uf_total,current}')::numeric), 0)::numeric as uf_current,
      coalesce(sum((summary #>> '{kpis,uf_total,previous}')::numeric), 0)::numeric as uf_previous,
      coalesce(sum((summary #>> '{kpis,cotizaciones}')::int), 0)::int as cotizaciones_current
    from campaign_summaries
  ),
  funnel_values as (
    select item->>'name' as name, coalesce(sum((item->>'value')::int), 0)::int as value
    from campaign_summaries cross join lateral jsonb_array_elements(summary->'funnel') as item
    group by item->>'name'
  ),
  funnel as (
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'value', value) order by case name
      when 'BBDD asignada' then 1 when 'Gestionados' then 2 when 'Contactados' then 3
      when 'Con resultado' then 4 when 'Venta en validación' then 5 else 99 end), '[]'::jsonb) as data
    from funnel_values
  ),
  reason_values as (
    select item->>'reason' as reason, coalesce(sum((item->>'count')::int), 0)::int as total
    from campaign_summaries cross join lateral jsonb_array_elements(summary->'reasons') as item
    group by item->>'reason'
  ),
  reasons as (
    select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'count', total) order by total desc, reason), '[]'::jsonb) as data
    from reason_values
  ),
  product_values as (
    select item->>'product' as product, coalesce(sum((item->>'count')::int), 0)::int as total,
      coalesce(sum((item->>'uf')::numeric), 0)::numeric as uf_total
    from campaign_summaries cross join lateral jsonb_array_elements(summary->'products') as item
    group by item->>'product'
  ),
  products as (
    select coalesce(jsonb_agg(jsonb_build_object('product', product, 'count', total, 'uf', uf_total) order by total desc, product), '[]'::jsonb) as data
    from product_values
  ),
  series_days as (
    select generate_series((select from_at::date from params), (select to_at::date from params), interval '1 day')::date as day
  ),
  time_values as (
    select (item->>'date')::date as day, coalesce(sum((item->>'gestiones')::int), 0)::int as gestiones,
      coalesce(sum((item->>'ventas')::int), 0)::int as ventas
    from campaign_summaries cross join lateral jsonb_array_elements(summary->'time_series') as item
    group by (item->>'date')::date
  ),
  time_series as (
    select coalesce(jsonb_agg(jsonb_build_object('date', to_char(series_days.day, 'YYYY-MM-DD'),
      'gestiones', coalesce(time_values.gestiones, 0), 'ventas', coalesce(time_values.ventas, 0)) order by series_days.day), '[]'::jsonb) as data
    from series_days left join time_values using (day)
  ),
  agenda_candidates as (
    select item from campaign_summaries cross join lateral jsonb_array_elements(summary->'agenda') as item
    order by (item->>'next_action_at')::timestamptz limit 100
  ),
  agenda as (
    select coalesce(jsonb_agg(item order by (item->>'next_action_at')::timestamptz), '[]'::jsonb) as data from agenda_candidates
  ),
  agent_values as (
    select item->>'agent_id' as agent_id, item->>'name' as name,
      coalesce(sum((item->>'gestiones')::int), 0)::int as gestiones,
      coalesce(sum((item->>'contactos')::int), 0)::int as contactos,
      coalesce(sum((item->>'ventas')::int), 0)::int as ventas,
      coalesce(sum((item->>'uf')::numeric), 0)::numeric as uf_total
    from campaign_summaries cross join lateral jsonb_array_elements(summary->'agents') as item
    group by item->>'agent_id', item->>'name'
  ),
  agents as (
    select coalesce(jsonb_agg(jsonb_build_object('agent_id', agent_id, 'name', name, 'gestiones', gestiones,
      'contactos', contactos, 'ventas', ventas, 'uf', uf_total) order by ventas desc, gestiones desc, name), '[]'::jsonb) as data
    from agent_values
  )
  select jsonb_build_object(
    'total_leads', metrics.total_leads,
    'range', jsonb_build_object('from', params.from_at, 'to', params.to_at, 'previous_from', params.previous_from_at, 'previous_to', params.previous_to_at),
    'kpis', jsonb_build_object(
      'gestionadas', jsonb_build_object('current', metrics.gestionadas_current, 'previous', metrics.gestionadas_previous),
      'contactadas', jsonb_build_object('current', metrics.contactadas_current, 'previous', metrics.contactadas_previous),
      'ventas', jsonb_build_object('current', metrics.ventas_current, 'previous', metrics.ventas_previous),
      'uf_total', jsonb_build_object('current', metrics.uf_current, 'previous', metrics.uf_previous),
      'cotizaciones', metrics.cotizaciones_current),
    'funnel', funnel.data, 'reasons', reasons.data, 'products', products.data, 'time_series', time_series.data,
    'agenda', agenda.data, 'agents', agents.data)
  from metrics cross join params cross join funnel cross join reasons cross join products cross join time_series cross join agenda cross join agents;
$function$;

revoke all on function public.get_crm_dashboard_summary(timestamptz, timestamptz, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_crm_dashboard_summary(timestamptz, timestamptz, timestamptz, timestamptz, uuid) to authenticated;
