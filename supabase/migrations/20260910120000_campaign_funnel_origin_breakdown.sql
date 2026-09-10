-- Desglosa cada etapa del embudo por el origen ya registrado en el lead.
-- La procedencia se resuelve, en orden, desde la integración externa, desde
-- columnas de origen conservadas en leads.extra y desde la marca de legado.
-- Si ninguna señal existe se informa explícitamente; no se inventa un origen.

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
    select
      l.id,
      l.full_name,
      case
        when nullif(btrim(source_catalog.name), '') is not null then btrim(source_catalog.name)
        when lower(btrim(coalesce(l.external_last_source_code, ''))) = 'atlas_lead' then 'Atlas Lead'
        when lower(btrim(coalesce(l.external_last_source_code, ''))) = 'bigdata' then 'Bigdata'
        when lower(btrim(coalesce(l.external_last_source_code, ''))) = 'meta_whatsapp' then 'WhatsApp Business'
        when nullif(btrim(l.external_last_source_code), '') is not null then
          initcap(replace(btrim(l.external_last_source_code), '_', ' '))
        when lower(btrim(coalesce(extra_origin.value, ''))) in (
          'manual', 'manual_supervisor_record', 'dashboard.leads.new'
        ) then 'Registro manual'
        when lower(btrim(coalesce(extra_origin.value, ''))) in (
          'cti_manual', 'cti.manual_call'
        ) then 'Llamada manual'
        when lower(btrim(coalesce(extra_origin.value, ''))) in (
          'meta_whatsapp', 'whatsapp', 'whatsapp_business'
        ) then 'WhatsApp Business'
        when nullif(btrim(extra_origin.value), '') is not null then left(btrim(extra_origin.value), 120)
        when l.legacy_lead_id is not null then 'Migración histórica'
        else 'Sin origen registrado'
      end as origin_name
    from public.leads l
    join params p on l.campaign_id = p.campaign_id
    left join public.integration_sources source_catalog
      on source_catalog.code = lower(btrim(l.external_last_source_code))
    left join lateral (
      select candidate.value
      from (
        select
          entry.value,
          lower(regexp_replace(
            translate(entry.key, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'),
            '[^a-zA-Z0-9]',
            '',
            'g'
          )) as source_key
        from jsonb_each_text(coalesce(l.extra, '{}'::jsonb)) entry
      ) candidate
      where candidate.source_key in (
        'origen', 'fuente', 'utmsource', 'leadsource', 'source', 'canalorigen', 'canal'
      )
        and lower(btrim(candidate.value)) not in ('', '-', 'null', 'n/a', 'na', 'sin dato')
      order by case candidate.source_key
        when 'origen' then 1
        when 'fuente' then 2
        when 'utmsource' then 3
        when 'leadsource' then 4
        when 'source' then 5
        when 'canalorigen' then 6
        else 7
      end
      limit 1
    ) extra_origin on true
  ),
  current_calls as (
    select
      c.id,
      c.lead_id,
      cl.full_name as lead_full_name,
      cl.origin_name,
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
  funnel_origin_counts as (
    select 1 as stage_order, 'BBDD asignada'::text as stage_name, origin_name, count(*)::int as value
    from campaign_leads
    group by origin_name

    union all

    select 2, 'Gestionados', origin_name, count(distinct lead_id)::int
    from current_calls
    group by origin_name

    union all

    select 3, 'Contactados', origin_name, count(distinct lead_id)::int
    from current_calls
    where status = 'connected'
    group by origin_name

    union all

    select 4, 'Con resultado', origin_name, count(distinct lead_id)::int
    from current_calls
    where status = 'connected'
      and reason is not null
      and reason <> 'GESTION EN CURSO'
    group by origin_name

    union all

    select 5, 'Venta en validación', origin_name, count(distinct lead_id)::int
    from current_calls
    where reason = 'VENTA EN VALIDACION'
    group by origin_name
  ),
  funnel_origins as (
    select
      stage_order,
      stage_name,
      jsonb_agg(
        jsonb_build_object('name', origin_name, 'value', value)
        order by value desc, origin_name
      ) as data
    from funnel_origin_counts
    group by stage_order, stage_name
  ),
  funnel as (
    select jsonb_build_array(
      jsonb_build_object(
        'name', 'BBDD asignada',
        'value', (select total_leads from totals),
        'origins', coalesce((select data from funnel_origins where stage_order = 1), '[]'::jsonb)
      ),
      jsonb_build_object(
        'name', 'Gestionados',
        'value', count(distinct lead_id),
        'origins', coalesce((select data from funnel_origins where stage_order = 2), '[]'::jsonb)
      ),
      jsonb_build_object(
        'name', 'Contactados',
        'value', count(distinct lead_id) filter (where status = 'connected'),
        'origins', coalesce((select data from funnel_origins where stage_order = 3), '[]'::jsonb)
      ),
      jsonb_build_object(
        'name', 'Con resultado',
        'value', count(distinct lead_id) filter (
          where status = 'connected' and reason is not null and reason <> 'GESTION EN CURSO'
        ),
        'origins', coalesce((select data from funnel_origins where stage_order = 4), '[]'::jsonb)
      ),
      jsonb_build_object(
        'name', 'Venta en validación',
        'value', count(distinct lead_id) filter (where reason = 'VENTA EN VALIDACION'),
        'origins', coalesce((select data from funnel_origins where stage_order = 5), '[]'::jsonb)
      )
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
  to authenticated;

-- Conserva el mismo contrato en la vista consolidada de reportes. Cuando se
-- filtra una campaña, sus orígenes llegan intactos; al consolidar, se suman por
-- nombre de etapa y origen.
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
    from campaign_summaries
    cross join lateral jsonb_array_elements(summary->'funnel') as item
    group by item->>'name'
  ),
  funnel_origin_values as (
    select
      stage->>'name' as stage_name,
      origin->>'name' as origin_name,
      coalesce(sum((origin->>'value')::int), 0)::int as value
    from campaign_summaries
    cross join lateral jsonb_array_elements(summary->'funnel') as stage
    cross join lateral jsonb_array_elements(coalesce(stage->'origins', '[]'::jsonb)) as origin
    group by stage->>'name', origin->>'name'
  ),
  funnel_origins as (
    select
      stage_name,
      jsonb_agg(
        jsonb_build_object('name', origin_name, 'value', value)
        order by value desc, origin_name
      ) as data
    from funnel_origin_values
    group by stage_name
  ),
  funnel as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', funnel_value.name,
          'value', funnel_value.value,
          'origins', coalesce(origins.data, '[]'::jsonb)
        )
        order by case funnel_value.name
          when 'BBDD asignada' then 1
          when 'Gestionados' then 2
          when 'Contactados' then 3
          when 'Con resultado' then 4
          when 'Venta en validación' then 5
          else 99
        end
      ),
      '[]'::jsonb
    ) as data
    from funnel_values funnel_value
    left join funnel_origins origins on origins.stage_name = funnel_value.name
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

