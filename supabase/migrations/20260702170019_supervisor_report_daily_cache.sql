create table if not exists public.supervisor_report_daily_metrics (
  metric_day date not null,
  team_id uuid not null references public.teams(id) on delete cascade,
  agent_id uuid not null references public.profiles(id) on delete cascade,
  crm_gestiones integer not null default 0,
  leads_gestionados integer not null default 0,
  llamadas_cerradas integer not null default 0,
  contactos_efectivos integer not null default 0,
  no_contacto integer not null default 0,
  agendas integer not null default 0,
  cotizaciones integer not null default 0,
  ventas integer not null default 0,
  uf numeric not null default 0,
  tmo_sum_seconds numeric not null default 0,
  tmo_count integer not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (metric_day, team_id, agent_id)
);

create index if not exists supervisor_report_daily_team_day_idx
  on public.supervisor_report_daily_metrics (team_id, metric_day desc);

create index if not exists supervisor_report_daily_agent_day_idx
  on public.supervisor_report_daily_metrics (agent_id, metric_day desc);

alter table public.supervisor_report_daily_metrics enable row level security;

drop policy if exists supervisor_report_daily_metrics_select on public.supervisor_report_daily_metrics;
create policy supervisor_report_daily_metrics_select
on public.supervisor_report_daily_metrics
for select
to authenticated
using (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'supervisor'
    and team_id = (select public.current_team_id())
  )
);

revoke insert, update, delete on public.supervisor_report_daily_metrics from anon, authenticated;

create or replace function public.refresh_supervisor_report_metric_row(
  p_day date,
  p_team_id uuid,
  p_agent_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_agent_exists boolean;
  v_team_id uuid;
begin
  if p_day is null or p_team_id is null or p_agent_id is null then
    return;
  end if;

  select exists (
    select 1
    from public.profiles p
    where p.id = p_agent_id
      and p.team_id = p_team_id
      and p.role = 'agente'
  )
  into v_agent_exists;

  if not v_agent_exists then
    delete from public.supervisor_report_daily_metrics
    where metric_day = p_day
      and team_id = p_team_id
      and agent_id = p_agent_id;
    return;
  end if;

  v_from := p_day::timestamptz;
  v_to := (p_day + 1)::timestamptz;

  with
  day_interactions as (
    select i.lead_id
    from public.interactions i
    join public.leads l on l.id = i.lead_id
    where i.agent_id = p_agent_id
      and l.team_id = p_team_id
      and i.created_at >= v_from
      and i.created_at < v_to
  ),
  day_calls as (
    select c.*
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where c.agent_id = p_agent_id
      and l.team_id = p_team_id
      and c.discarded_reason is null
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= v_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) < v_to
  ),
  touched_leads as (
    select lead_id from day_interactions
    union
    select lead_id from day_calls where ended_at is not null
  ),
  metrics as (
    select
      (select count(*)::int from day_interactions) as crm_gestiones,
      (select count(*)::int from touched_leads) as leads_gestionados,
      (select count(*)::int from day_calls where ended_at is not null) as llamadas_cerradas,
      (select count(distinct lead_id)::int from day_calls where status = 'connected') as contactos_efectivos,
      (select count(*)::int from day_calls where status in ('no_answer', 'busy', 'voicemail', 'out_of_service')) as no_contacto,
      (select count(*)::int from day_calls where next_action_at is not null) as agendas,
      (select count(*)::int from day_calls where reason ilike '%COTIZACION%') as cotizaciones,
      (select count(*)::int from day_calls where outcome = 'sale' or reason ilike '%VENTA%') as ventas,
      (select coalesce(sum(equifax_uf_amount), 0)::numeric from day_calls where outcome = 'sale' or reason ilike '%VENTA%' or reason ilike '%COTIZACION%' or equifax_uf_amount is not null) as uf,
      (select coalesce(sum(extract(epoch from (ended_at - started_at))), 0)::numeric from day_calls where ended_at is not null and started_at is not null) as tmo_sum_seconds,
      (select count(*)::int from day_calls where ended_at is not null and started_at is not null) as tmo_count
  )
  insert into public.supervisor_report_daily_metrics (
    metric_day,
    team_id,
    agent_id,
    crm_gestiones,
    leads_gestionados,
    llamadas_cerradas,
    contactos_efectivos,
    no_contacto,
    agendas,
    cotizaciones,
    ventas,
    uf,
    tmo_sum_seconds,
    tmo_count,
    refreshed_at
  )
  select
    p_day,
    p_team_id,
    p_agent_id,
    crm_gestiones,
    leads_gestionados,
    llamadas_cerradas,
    contactos_efectivos,
    no_contacto,
    agendas,
    cotizaciones,
    ventas,
    uf,
    tmo_sum_seconds,
    tmo_count,
    now()
  from metrics
  on conflict (metric_day, team_id, agent_id) do update
  set
    crm_gestiones = excluded.crm_gestiones,
    leads_gestionados = excluded.leads_gestionados,
    llamadas_cerradas = excluded.llamadas_cerradas,
    contactos_efectivos = excluded.contactos_efectivos,
    no_contacto = excluded.no_contacto,
    agendas = excluded.agendas,
    cotizaciones = excluded.cotizaciones,
    ventas = excluded.ventas,
    uf = excluded.uf,
    tmo_sum_seconds = excluded.tmo_sum_seconds,
    tmo_count = excluded.tmo_count,
    refreshed_at = now();
end;
$function$;

create or replace function public.refresh_supervisor_report_metrics_range(
  p_from date,
  p_to date,
  p_team_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row record;
begin
  delete from public.supervisor_report_daily_metrics m
  where m.metric_day >= p_from
    and m.metric_day <= p_to
    and (p_team_id is null or m.team_id = p_team_id);

  for v_row in
    select distinct
      d.metric_day,
      p.team_id,
      p.id as agent_id
    from public.profiles p
    cross join generate_series(p_from, p_to, interval '1 day') as d(metric_day)
    where p.role = 'agente'
      and p.active
      and p.team_id is not null
      and (p_team_id is null or p.team_id = p_team_id)
  loop
    perform public.refresh_supervisor_report_metric_row(v_row.metric_day::date, v_row.team_id, v_row.agent_id);
  end loop;
end;
$function$;

create or replace function public.touch_supervisor_report_metrics_from_call()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_old_day date;
  v_new_day date;
  v_old_team uuid;
  v_new_team uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select team_id into v_old_team from public.leads where id = old.lead_id;
    v_old_day := coalesce(old.ended_at, old.updated_at, old.created_at)::date;
    perform public.refresh_supervisor_report_metric_row(v_old_day, v_old_team, old.agent_id);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select team_id into v_new_team from public.leads where id = new.lead_id;
    v_new_day := coalesce(new.ended_at, new.updated_at, new.created_at)::date;
    perform public.refresh_supervisor_report_metric_row(v_new_day, v_new_team, new.agent_id);
  end if;

  return coalesce(new, old);
end;
$function$;

create or replace function public.touch_supervisor_report_metrics_from_interaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_old_team uuid;
  v_new_team uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select team_id into v_old_team from public.leads where id = old.lead_id;
    perform public.refresh_supervisor_report_metric_row(old.created_at::date, v_old_team, old.agent_id);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select team_id into v_new_team from public.leads where id = new.lead_id;
    perform public.refresh_supervisor_report_metric_row(new.created_at::date, v_new_team, new.agent_id);
  end if;

  return coalesce(new, old);
end;
$function$;

drop trigger if exists calls_touch_supervisor_report_metrics on public.calls;
create trigger calls_touch_supervisor_report_metrics
after insert or update or delete on public.calls
for each row execute function public.touch_supervisor_report_metrics_from_call();

drop trigger if exists interactions_touch_supervisor_report_metrics on public.interactions;
create trigger interactions_touch_supervisor_report_metrics
after insert or update or delete on public.interactions
for each row execute function public.touch_supervisor_report_metrics_from_interaction();

select public.refresh_supervisor_report_metrics_range(
  (current_date - interval '180 days')::date,
  current_date,
  null
);

revoke all on function public.refresh_supervisor_report_metric_row(date, uuid, uuid) from public, anon, authenticated;
revoke all on function public.refresh_supervisor_report_metrics_range(date, date, uuid) from public, anon, authenticated;
revoke all on function public.touch_supervisor_report_metrics_from_call() from public, anon, authenticated;
revoke all on function public.touch_supervisor_report_metrics_from_interaction() from public, anon, authenticated;

create or replace function public.get_supervisor_report_summary(
  p_from timestamptz default (now() - interval '30 days'),
  p_to timestamptz default now(),
  p_team_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  v_role text := coalesce((select public.current_role_name())::text, '');
  v_current_team_id uuid := (select public.current_team_id());
  v_team_id uuid;
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_from_date date := coalesce(p_from, now() - interval '30 days')::date;
  v_to_date date := coalesce(p_to, now())::date;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado.';
  end if;

  if v_role not in ('admin', 'supervisor') then
    raise exception 'No tienes permisos para ver este reporte.';
  end if;

  v_team_id := case
    when v_role = 'supervisor' then v_current_team_id
    else p_team_id
  end;

  if v_role = 'supervisor' and v_team_id is null then
    raise exception 'Tu supervisor no tiene equipo asignado.';
  end if;

  with
  team_leads as (
    select l.id, l.assigned_to, l.next_action_at
    from public.leads l
    where v_team_id is null or l.team_id = v_team_id
  ),
  team_agents as (
    select p.id, p.full_name, p.team_id, t.name as team_name
    from public.profiles p
    left join public.teams t on t.id = p.team_id
    where p.role = 'agente'
      and p.active
      and (v_team_id is null or p.team_id = v_team_id)
  ),
  metric_rows as (
    select m.*
    from public.supervisor_report_daily_metrics m
    where m.metric_day >= v_from_date
      and m.metric_day <= v_to_date
      and (v_team_id is null or m.team_id = v_team_id)
  ),
  agent_rows as (
    select
      a.id as agent_id,
      a.full_name,
      a.team_name,
      coalesce(sum(m.crm_gestiones), 0)::int as crm_gestiones,
      coalesce(sum(m.llamadas_cerradas), 0)::int as llamadas_cerradas,
      coalesce(sum(m.leads_gestionados), 0)::int as leads_gestionados,
      coalesce(sum(m.contactos_efectivos), 0)::int as contactos_efectivos,
      coalesce(sum(m.no_contacto), 0)::int as no_contacto,
      coalesce(sum(m.agendas), 0)::int as agendas,
      coalesce(sum(m.cotizaciones), 0)::int as cotizaciones,
      coalesce(sum(m.ventas), 0)::int as ventas,
      coalesce(sum(m.uf), 0)::numeric as uf,
      coalesce(sum(m.tmo_sum_seconds), 0)::numeric as tmo_sum_seconds,
      coalesce(sum(m.tmo_count), 0)::int as tmo_count
    from team_agents a
    left join metric_rows m on m.agent_id = a.id
    group by a.id, a.full_name, a.team_name
  ),
  daily_rows as (
    select
      metric_day as day,
      coalesce(sum(crm_gestiones), 0)::int as crm_gestiones,
      coalesce(sum(contactos_efectivos), 0)::int as contactos_efectivos,
      coalesce(sum(agendas), 0)::int as agendas
    from metric_rows
    group by metric_day
    having coalesce(sum(crm_gestiones), 0) > 0
        or coalesce(sum(contactos_efectivos), 0) > 0
        or coalesce(sum(agendas), 0) > 0
    order by metric_day
  ),
  tipification_events as (
    select nullif(btrim(c.reason), '') as label
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where (v_team_id is null or l.team_id = v_team_id)
      and c.discarded_reason is null
      and c.reason is not null
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= v_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) <= v_to
    union all
    select nullif(btrim(i.result), '') as label
    from public.interactions i
    join public.leads l on l.id = i.lead_id
    where (v_team_id is null or l.team_id = v_team_id)
      and i.created_at >= v_from
      and i.created_at <= v_to
  ),
  top_tipifications as (
    select label, count(*)::int as count
    from tipification_events
    where label is not null
    group by label
    order by count(*) desc, label
    limit 10
  ),
  totals as (
    select
      (select count(*)::int from team_leads) as base_total,
      (select count(*)::int from team_leads where assigned_to is not null) as asignados,
      (select count(*)::int from team_leads where assigned_to is null) as sin_asignar,
      coalesce(sum(crm_gestiones), 0)::int as crm_gestiones,
      coalesce(sum(leads_gestionados), 0)::int as recorridos,
      coalesce(sum(llamadas_cerradas), 0)::int as llamadas_cerradas,
      coalesce(sum(contactos_efectivos), 0)::int as contactados,
      coalesce(sum(no_contacto), 0)::int as no_contacto,
      coalesce(sum(agendas), 0)::int as agendas_creadas,
      (select count(*)::int from team_leads where next_action_at is not null and next_action_at < now()) as agendas_vencidas,
      (select count(*)::int from team_leads where next_action_at is not null and next_action_at >= now()) as agendas_pendientes,
      coalesce(sum(cotizaciones), 0)::int as cotizaciones,
      coalesce(sum(ventas), 0)::int as ventas,
      coalesce(sum(uf), 0)::numeric as uf,
      coalesce(sum(tmo_sum_seconds), 0)::numeric as tmo_sum_seconds,
      coalesce(sum(tmo_count), 0)::int as tmo_count
    from metric_rows
  )
  select jsonb_build_object(
    'range', jsonb_build_object(
      'from', v_from,
      'to', v_to,
      'team_id', v_team_id
    ),
    'kpis', jsonb_build_object(
      'base_total', totals.base_total,
      'asignados', totals.asignados,
      'sin_asignar', totals.sin_asignar,
      'recorridos', totals.recorridos,
      'contactados', totals.contactados,
      'contactabilidad', case when totals.recorridos > 0 then round((totals.contactados::numeric / totals.recorridos::numeric) * 100, 1) else null end,
      'crm_gestiones', totals.crm_gestiones,
      'llamadas_cerradas', totals.llamadas_cerradas,
      'no_contacto', totals.no_contacto,
      'agendas_creadas', totals.agendas_creadas,
      'agendas_vencidas', totals.agendas_vencidas,
      'agendas_pendientes', totals.agendas_pendientes,
      'cotizaciones', totals.cotizaciones,
      'ventas', totals.ventas,
      'uf', totals.uf,
      'tmo_seconds', case when totals.tmo_count > 0 then totals.tmo_sum_seconds / totals.tmo_count else null end
    ),
    'agents', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'agent_id', agent_id,
          'full_name', full_name,
          'team_name', team_name,
          'crm_gestiones', crm_gestiones,
          'llamadas_cerradas', llamadas_cerradas,
          'leads_gestionados', leads_gestionados,
          'contactos_efectivos', contactos_efectivos,
          'contactabilidad', case when leads_gestionados > 0 then round((contactos_efectivos::numeric / leads_gestionados::numeric) * 100, 1) else null end,
          'no_contacto', no_contacto,
          'agendas', agendas,
          'cotizaciones', cotizaciones,
          'ventas', ventas,
          'uf', uf,
          'tmo_seconds', case when tmo_count > 0 then tmo_sum_seconds / tmo_count else null end
        )
        order by crm_gestiones desc, contactos_efectivos desc, full_name
      )
      from agent_rows
    ), '[]'::jsonb),
    'tipifications', coalesce((
      select jsonb_agg(
        jsonb_build_object('label', label, 'count', count)
        order by count desc, label
      )
      from top_tipifications
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'day', day,
          'crm_gestiones', crm_gestiones,
          'contactos_efectivos', contactos_efectivos,
          'agendas', agendas
        )
        order by day
      )
      from daily_rows
    ), '[]'::jsonb)
  )
  into v_result
  from totals;

  return v_result;
end;
$function$;

revoke all on function public.get_supervisor_report_summary(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_supervisor_report_summary(timestamptz, timestamptz, uuid) to authenticated;
