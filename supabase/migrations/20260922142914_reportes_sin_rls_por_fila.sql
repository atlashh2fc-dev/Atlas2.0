-- Reportes de Geimser no cargaban: "canceling statement due to statement timeout".
--
-- Causa 1 (sistémica): las políticas *_organization_isolation comparaban contra
-- current_org_ids() sin envolverla en un SELECT. Postgres no la trata como
-- InitPlan y la ejecuta por cada fila leída; con los 84 mil leads de Geimser,
-- cualquier lectura amplia pagaba decenas de segundos sólo en RLS. Se reescriben
-- todas para evaluarla una vez por consulta. El cast a uuid[] es necesario: sin
-- él, ANY ((SELECT ...)) se interpreta como subconsulta y no como arreglo.
--
-- Causa 2: get_campaign_dashboard_summary cruzaba las llamadas contra el CTE con
-- todos los leads de la campaña. Los filtros RLS de calls hacen que el
-- planificador estime una sola fila y elija un nested loop: 55 mil leads contra
-- 2 mil llamadas en Equifax. Ahora cada llamada busca su lead por llave primaria
-- y el origen sale de una función pura, sin volver a cruzar el CTE.
--
-- Causa 3: get_crm_dashboard_summary llamaba a la función de campaña una vez por
-- campaña (19 en Geimser), y cada una recorría todas las llamadas del período
-- con RLS. Como cada lead pertenece a una sola campaña, sumar por campaña es lo
-- mismo que contar una vez: ahora es una sola pasada, y la ficha de campaña es
-- ese mismo cálculo acotado a una campaña.
--
-- De paso vuelve el corte de días en hora de Chile de 20260807174500, que la
-- reescritura del embudo por origen (20260910120000) había perdido.

do $$
declare
  policy record;
  new_using text;
  new_check text;
begin
  for policy in
    select *
    from pg_policies
    where schemaname = 'public'
      and (
        qual ~ '(?<!SELECT )current_org_ids\(\)'
        or with_check ~ '(?<!SELECT )current_org_ids\(\)'
      )
  loop
    new_using := regexp_replace(policy.qual, '(?<!SELECT )current_org_ids\(\)', '(SELECT current_org_ids())::uuid[]', 'g');
    new_check := regexp_replace(policy.with_check, '(?<!SELECT )current_org_ids\(\)', '(SELECT current_org_ids())::uuid[]', 'g');
    execute format(
      'alter policy %I on %I.%I %s %s',
      policy.policyname,
      policy.schemaname,
      policy.tablename,
      case when new_using is not null then 'using (' || new_using || ')' else '' end,
      case when new_check is not null then 'with check (' || new_check || ')' else '' end
    );
  end loop;
end $$;

-- Procedencia del lead, en orden: integración externa, columnas de origen
-- conservadas en leads.extra y marca de legado. Sin señal se dice explícitamente.
-- Es pura a propósito: si leyera integration_sources, cada invocación volvería a
-- evaluar las políticas RLS de esa tabla, una vez por lead.
create or replace function public.lead_origin_name(
  p_source_name text,
  p_source_code text,
  p_extra jsonb,
  p_is_legacy boolean
)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_code text := lower(btrim(coalesce(p_source_code, '')));
  v_extra_origin text;
begin
  if nullif(btrim(p_source_name), '') is not null then
    return btrim(p_source_name);
  end if;
  if v_code = 'atlas_lead' then return 'Atlas Lead'; end if;
  if v_code = 'bigdata' then return 'Bigdata'; end if;
  if v_code = 'meta_whatsapp' then return 'WhatsApp Business'; end if;
  if v_code <> '' then
    return initcap(replace(btrim(p_source_code), '_', ' '));
  end if;

  if jsonb_typeof(p_extra) = 'object' then
    select candidate.value
    into v_extra_origin
    from (
      select
        entry.value,
        lower(regexp_replace(
          translate(entry.key, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'),
          '[^a-zA-Z0-9]',
          '',
          'g'
        )) as source_key
      from jsonb_each_text(p_extra) entry
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
    limit 1;
  end if;

  if lower(btrim(coalesce(v_extra_origin, ''))) in (
    'manual', 'manual_supervisor_record', 'dashboard.leads.new'
  ) then
    return 'Registro manual';
  end if;
  if lower(btrim(coalesce(v_extra_origin, ''))) in ('cti_manual', 'cti.manual_call') then
    return 'Llamada manual';
  end if;
  if lower(btrim(coalesce(v_extra_origin, ''))) in ('meta_whatsapp', 'whatsapp', 'whatsapp_business') then
    return 'WhatsApp Business';
  end if;
  if nullif(btrim(v_extra_origin), '') is not null then
    return left(btrim(v_extra_origin), 120);
  end if;
  if p_is_legacy then
    return 'Migración histórica';
  end if;
  return 'Sin origen registrado';
end;
$function$;

grant execute on function public.lead_origin_name(text, text, jsonb, boolean) to authenticated;

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
      p_campaign_id as campaign_id,
      p_from as from_at,
      p_to as to_at,
      coalesce(p_previous_from, p_from - (p_to - p_from) - interval '1 millisecond') as previous_from_at,
      coalesce(p_previous_to, p_from - interval '1 millisecond') as previous_to_at
  ),
  -- Campañas visibles para quien consulta; sin filtro, todas las de su empresa.
  scope_campaigns as (
    select c.id
    from public.campaigns c
    join params p on p.campaign_id is null or c.id = p.campaign_id
  ),
  campaign_leads as (
    select
      l.id,
      public.lead_origin_name(
        source_catalog.name,
        l.external_last_source_code,
        l.extra,
        l.legacy_lead_id is not null
      ) as origin_name
    from public.leads l
    join scope_campaigns sc on sc.id = l.campaign_id
    left join public.integration_sources source_catalog
      on source_catalog.code = lower(btrim(l.external_last_source_code))
  ),
  -- Las llamadas del período buscan su lead por llave primaria. Cruzarlas contra
  -- campaign_leads llevaba al planificador a un nested loop sobre toda la base.
  current_calls as (
    select
      c.id,
      c.lead_id,
      l.full_name as lead_full_name,
      public.lead_origin_name(
        source_catalog.name,
        l.external_last_source_code,
        l.extra,
        l.legacy_lead_id is not null
      ) as origin_name,
      c.agent_id,
      coalesce(pr.full_name, 'Sin ejecutivo') as agent_name,
      c.status,
      c.reason,
      c.equifax_products,
      c.equifax_uf_amount,
      c.next_action_at,
      c.started_at
    from public.calls c
    join params p
      on c.started_at >= p.from_at
     and c.started_at <= p.to_at
    join public.leads l on l.id = c.lead_id
    join scope_campaigns sc on sc.id = l.campaign_id
    left join public.integration_sources source_catalog
      on source_catalog.code = lower(btrim(l.external_last_source_code))
    left join public.profiles pr on pr.id = c.agent_id
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
    join params p
      on c.started_at >= p.previous_from_at
     and c.started_at <= p.previous_to_at
    join public.leads l on l.id = c.lead_id
    join scope_campaigns sc on sc.id = l.campaign_id
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
      jsonb_agg(jsonb_build_object('reason', reason, 'count', total) order by total desc, reason),
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
      jsonb_agg(jsonb_build_object('product', product, 'count', total, 'uf', uf_total) order by total desc, product),
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
      (select (from_at at time zone 'America/Santiago')::date from params),
      (select (to_at at time zone 'America/Santiago')::date from params),
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
        (started_at at time zone 'America/Santiago')::date as day,
        count(*)::int as gestiones,
        count(*) filter (where reason = 'VENTA EN VALIDACION')::int as ventas
      from current_calls
      group by (started_at at time zone 'America/Santiago')::date
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
        order by next_action_at, id
      ),
      '[]'::jsonb
    ) as data
    from (
      select *
      from current_calls
      where next_action_at is not null
      order by next_action_at, id
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

revoke all on function public.get_crm_dashboard_summary(timestamptz, timestamptz, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_crm_dashboard_summary(timestamptz, timestamptz, timestamptz, timestamptz, uuid) to authenticated;

-- La ficha de una campaña es el mismo cálculo acotado a ella.
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
  select public.get_crm_dashboard_summary(p_from, p_to, p_previous_from, p_previous_to, p_campaign_id);
$function$;

revoke all on function public.get_campaign_dashboard_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_campaign_dashboard_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz)
  to authenticated;
