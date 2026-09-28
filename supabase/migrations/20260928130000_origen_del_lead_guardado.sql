-- Reportes > Gestión de Geimser volvió a caer con "canceling statement due to
-- statement timeout" (28-09-2026).
--
-- Medido como admin real, sin filtro de campaña, últimos 30 días: la RPC tardaba
-- 7,8 s contra el tope de 8 s del rol authenticated. De eso, 6,4 s eran
-- lead_origin_name() evaluada sobre los 166 mil leads de la empresa; las llamadas
-- del período y el período anterior suman menos de 0,6 s. 111 mil leads no traen
-- código de origen y la función recorre todo leads.extra con expresiones
-- regulares para buscar la columna de origen.
--
-- Causa raíz: el origen es un dato derivado del lead, pero se recalculaba para
-- toda la base en cada consulta del reporte. El costo crece con la base y no con
-- el período elegido; el arreglo de 20260922142914 alcanzaba con 84 mil leads y
-- dejó de alcanzar cuando la carga de Equifax la duplicó.
--
-- Solución: el origen se calcula una vez, al escribir el lead, y se guarda en
-- lead_origins. Es una tabla aparte y no una columna de leads para no reescribir
-- 166 mil leads en caliente: eso movería updated_at de toda la base y competiría
-- por filas que la operación está usando. El reporte lee el valor guardado y
-- sólo recalcula si a un lead le faltara su fila.
--
-- Lo que se guarda es el origen sin el nombre del catálogo integration_sources:
-- ese nombre se puede editar y lead_origin_name() lo antepone a todo lo demás,
-- así que el reporte lo sigue resolviendo al vuelo con el mismo orden.

create table if not exists public.lead_origins (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  organization_id uuid not null,
  origin_name text not null
);

alter table public.lead_origins enable row level security;

drop policy if exists lead_origins_organization_isolation on public.lead_origins;
create policy lead_origins_organization_isolation on public.lead_origins
  for select to authenticated
  using (organization_id = any ((select public.current_org_ids())::uuid[]));

revoke all on public.lead_origins from public, anon;
grant select on public.lead_origins to authenticated;

-- Las cargas masivas insertan miles de leads por sentencia: se resuelven en una
-- sola pasada con la tabla de transición en vez de una fila a la vez.
create or replace function public.lead_origins_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.lead_origins (lead_id, organization_id, origin_name)
  select
    n.id,
    n.organization_id,
    public.lead_origin_name(null, n.external_last_source_code, n.extra, n.legacy_lead_id is not null)
  from nuevos n
  on conflict (lead_id) do update
    set organization_id = excluded.organization_id,
        origin_name = excluded.origin_name;
  return null;
end;
$$;

create or replace function public.lead_origins_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.lead_origins (lead_id, organization_id, origin_name)
  values (
    new.id,
    new.organization_id,
    public.lead_origin_name(null, new.external_last_source_code, new.extra, new.legacy_lead_id is not null)
  )
  on conflict (lead_id) do update
    set organization_id = excluded.organization_id,
        origin_name = excluded.origin_name;
  return null;
end;
$$;

revoke all on function public.lead_origins_on_insert() from public, anon, authenticated;
revoke all on function public.lead_origins_on_update() from public, anon, authenticated;

drop trigger if exists leads_guardan_origen_al_crear on public.leads;
create trigger leads_guardan_origen_al_crear
  after insert on public.leads
  referencing new table as nuevos
  for each statement
  execute function public.lead_origins_on_insert();

-- Postgres no admite tablas de transición con lista de columnas, así que la
-- edición va fila a fila y sólo cuando cambia algo que define el origen.
drop trigger if exists leads_guardan_origen_al_editar on public.leads;
create trigger leads_guardan_origen_al_editar
  after update of external_last_source_code, extra, legacy_lead_id, organization_id on public.leads
  for each row
  when (
    old.external_last_source_code is distinct from new.external_last_source_code
    or old.extra is distinct from new.extra
    or old.legacy_lead_id is distinct from new.legacy_lead_id
    or old.organization_id is distinct from new.organization_id
  )
  execute function public.lead_origins_on_update();

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
set search_path = public
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
  -- El origen viene guardado en lead_origins. El nombre del catálogo manda si
  -- existe, igual que en lead_origin_name(); el cálculo al vuelo sólo corre para
  -- un lead que todavía no tenga su fila.
  campaign_leads as (
    select
      l.id,
      coalesce(
        nullif(btrim(source_catalog.name), ''),
        lo.origin_name,
        public.lead_origin_name(null, l.external_last_source_code, l.extra, l.legacy_lead_id is not null)
      ) as origin_name
    from public.leads l
    join scope_campaigns sc on sc.id = l.campaign_id
    left join public.lead_origins lo on lo.lead_id = l.id
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
      coalesce(
        nullif(btrim(source_catalog.name), ''),
        lo.origin_name,
        public.lead_origin_name(null, l.external_last_source_code, l.extra, l.legacy_lead_id is not null)
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
    left join public.lead_origins lo on lo.lead_id = l.id
    left join public.integration_sources source_catalog
      on source_catalog.code = lower(btrim(l.external_last_source_code))
    left join public.profiles pr on pr.id = c.agent_id
    where c.discarded_reason is null
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
    where c.discarded_reason is null
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
