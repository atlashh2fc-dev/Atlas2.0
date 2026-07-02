create index if not exists calls_report_historical_range_idx
  on public.calls (
    historical_agent_id,
    (coalesce(ended_at, updated_at, created_at)),
    lead_id
  )
  where discarded_reason is null
    and historical_agent_id is not null;

create index if not exists calls_report_agent_direct_range_idx
  on public.calls (
    agent_id,
    (coalesce(ended_at, updated_at, created_at)),
    lead_id
  )
  where discarded_reason is null
    and historical_agent_id is null;

create index if not exists interactions_report_historical_created_idx
  on public.interactions (historical_agent_id, created_at, lead_id)
  where historical_agent_id is not null;

create index if not exists interactions_report_agent_direct_created_idx
  on public.interactions (agent_id, created_at, lead_id)
  where historical_agent_id is null;

create index if not exists historical_agents_linked_profile_id_idx
  on public.historical_agents (linked_profile_id)
  where linked_profile_id is not null;

create table if not exists public.supervisor_report_daily_agent_metrics (
  metric_day date not null,
  team_id uuid not null references public.teams(id) on delete cascade,
  report_agent_key text not null,
  profile_id uuid references public.profiles(id) on delete set null,
  historical_agent_id uuid references public.historical_agents(id) on delete set null,
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
  primary key (metric_day, team_id, report_agent_key)
);

create index if not exists supervisor_report_agent_metrics_team_day_idx
  on public.supervisor_report_daily_agent_metrics (team_id, metric_day desc);

create index if not exists supervisor_report_agent_metrics_profile_day_idx
  on public.supervisor_report_daily_agent_metrics (profile_id, metric_day desc)
  where profile_id is not null;

create index if not exists supervisor_report_agent_metrics_historical_day_idx
  on public.supervisor_report_daily_agent_metrics (historical_agent_id, metric_day desc)
  where historical_agent_id is not null;

alter table public.supervisor_report_daily_agent_metrics enable row level security;

drop policy if exists supervisor_report_daily_agent_metrics_select on public.supervisor_report_daily_agent_metrics;
create policy supervisor_report_daily_agent_metrics_select
on public.supervisor_report_daily_agent_metrics
for select
to authenticated
using (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'supervisor'
    and team_id = (select public.current_team_id())
  )
);

grant select on public.supervisor_report_daily_agent_metrics to authenticated;
revoke insert, update, delete on public.supervisor_report_daily_agent_metrics from anon, authenticated;

create table if not exists public.supervisor_report_daily_agent_tipifications (
  metric_day date not null,
  team_id uuid not null references public.teams(id) on delete cascade,
  report_agent_key text not null,
  profile_id uuid references public.profiles(id) on delete set null,
  historical_agent_id uuid references public.historical_agents(id) on delete set null,
  label text not null,
  count integer not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (metric_day, team_id, report_agent_key, label)
);

create index if not exists supervisor_report_agent_tipifications_team_day_idx
  on public.supervisor_report_daily_agent_tipifications (team_id, metric_day desc, count desc);

create index if not exists supervisor_report_agent_tipifications_profile_day_idx
  on public.supervisor_report_daily_agent_tipifications (profile_id, metric_day desc)
  where profile_id is not null;

create index if not exists supervisor_report_agent_tipifications_historical_day_idx
  on public.supervisor_report_daily_agent_tipifications (historical_agent_id, metric_day desc)
  where historical_agent_id is not null;

alter table public.supervisor_report_daily_agent_tipifications enable row level security;

drop policy if exists supervisor_report_daily_agent_tipifications_select on public.supervisor_report_daily_agent_tipifications;
create policy supervisor_report_daily_agent_tipifications_select
on public.supervisor_report_daily_agent_tipifications
for select
to authenticated
using (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'supervisor'
    and team_id = (select public.current_team_id())
  )
);

grant select on public.supervisor_report_daily_agent_tipifications to authenticated;
revoke insert, update, delete on public.supervisor_report_daily_agent_tipifications from anon, authenticated;

create or replace function public.resolve_supervisor_report_agent_key(
  p_agent_id uuid,
  p_historical_agent_id uuid
)
returns text
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(
    (
      select ha.linked_profile_id::text
      from public.historical_agents ha
      where ha.id = p_historical_agent_id
        and ha.linked_profile_id is not null
    ),
    p_historical_agent_id::text,
    p_agent_id::text
  );
$function$;

create or replace function public.refresh_supervisor_report_agent_metric_row(
  p_day date,
  p_team_id uuid,
  p_report_agent_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_profile_id uuid;
  v_historical_agent_id uuid;
begin
  if p_day is null or p_team_id is null or nullif(btrim(p_report_agent_key), '') is null then
    return;
  end if;

  select p.id
  into v_profile_id
  from public.profiles p
  where p.id::text = p_report_agent_key;

  select ha.id
  into v_historical_agent_id
  from public.historical_agents ha
  where ha.id::text = p_report_agent_key
    and ha.linked_profile_id is null;

  if v_profile_id is null and v_historical_agent_id is null then
    delete from public.supervisor_report_daily_agent_metrics
    where metric_day = p_day
      and team_id = p_team_id
      and report_agent_key = p_report_agent_key;
    return;
  end if;

  v_from := p_day::timestamptz;
  v_to := (p_day + 1)::timestamptz;

  with
  linked_historical_agents as (
    select ha.id
    from public.historical_agents ha
    where ha.linked_profile_id = v_profile_id
  ),
  day_interactions as (
    select i.lead_id
    from public.interactions i
    join public.leads l on l.id = i.lead_id
    where l.team_id = p_team_id
      and i.created_at >= v_from
      and i.created_at < v_to
      and (
        (
          v_profile_id is not null
          and (
            (i.agent_id = v_profile_id and i.historical_agent_id is null)
            or i.historical_agent_id in (select id from linked_historical_agents)
          )
        )
        or (
          v_historical_agent_id is not null
          and i.historical_agent_id = v_historical_agent_id
        )
      )
  ),
  day_calls as (
    select c.*
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where l.team_id = p_team_id
      and c.discarded_reason is null
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= v_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) < v_to
      and (
        (
          v_profile_id is not null
          and (
            (c.agent_id = v_profile_id and c.historical_agent_id is null)
            or c.historical_agent_id in (select id from linked_historical_agents)
          )
        )
        or (
          v_historical_agent_id is not null
          and c.historical_agent_id = v_historical_agent_id
        )
      )
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
  insert into public.supervisor_report_daily_agent_metrics (
    metric_day,
    team_id,
    report_agent_key,
    profile_id,
    historical_agent_id,
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
    p_report_agent_key,
    v_profile_id,
    v_historical_agent_id,
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
  where crm_gestiones > 0
     or leads_gestionados > 0
     or llamadas_cerradas > 0
     or contactos_efectivos > 0
     or no_contacto > 0
     or agendas > 0
     or cotizaciones > 0
     or ventas > 0
     or uf <> 0
     or tmo_count > 0
  on conflict (metric_day, team_id, report_agent_key) do update
  set
    profile_id = excluded.profile_id,
    historical_agent_id = excluded.historical_agent_id,
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

  if not found then
    delete from public.supervisor_report_daily_agent_metrics
    where metric_day = p_day
      and team_id = p_team_id
      and report_agent_key = p_report_agent_key;
  end if;
end;
$function$;

create or replace function public.refresh_supervisor_report_agent_tipification_rows(
  p_day date,
  p_team_id uuid,
  p_report_agent_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_profile_id uuid;
  v_historical_agent_id uuid;
begin
  if p_day is null or p_team_id is null or nullif(btrim(p_report_agent_key), '') is null then
    return;
  end if;

  select p.id
  into v_profile_id
  from public.profiles p
  where p.id::text = p_report_agent_key;

  select ha.id
  into v_historical_agent_id
  from public.historical_agents ha
  where ha.id::text = p_report_agent_key
    and ha.linked_profile_id is null;

  delete from public.supervisor_report_daily_agent_tipifications
  where metric_day = p_day
    and team_id = p_team_id
    and report_agent_key = p_report_agent_key;

  if v_profile_id is null and v_historical_agent_id is null then
    return;
  end if;

  v_from := p_day::timestamptz;
  v_to := (p_day + 1)::timestamptz;

  with
  linked_historical_agents as (
    select ha.id
    from public.historical_agents ha
    where ha.linked_profile_id = v_profile_id
  ),
  tipification_events as (
    select nullif(btrim(c.reason), '') as label
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where l.team_id = p_team_id
      and c.discarded_reason is null
      and c.reason is not null
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= v_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) < v_to
      and (
        (
          v_profile_id is not null
          and (
            (c.agent_id = v_profile_id and c.historical_agent_id is null)
            or c.historical_agent_id in (select id from linked_historical_agents)
          )
        )
        or (
          v_historical_agent_id is not null
          and c.historical_agent_id = v_historical_agent_id
        )
      )
    union all
    select nullif(btrim(i.result), '') as label
    from public.interactions i
    join public.leads l on l.id = i.lead_id
    where l.team_id = p_team_id
      and i.created_at >= v_from
      and i.created_at < v_to
      and (
        (
          v_profile_id is not null
          and (
            (i.agent_id = v_profile_id and i.historical_agent_id is null)
            or i.historical_agent_id in (select id from linked_historical_agents)
          )
        )
        or (
          v_historical_agent_id is not null
          and i.historical_agent_id = v_historical_agent_id
        )
      )
  )
  insert into public.supervisor_report_daily_agent_tipifications (
    metric_day,
    team_id,
    report_agent_key,
    profile_id,
    historical_agent_id,
    label,
    count,
    refreshed_at
  )
  select
    p_day,
    p_team_id,
    p_report_agent_key,
    v_profile_id,
    v_historical_agent_id,
    label,
    count(*)::int,
    now()
  from tipification_events
  where label is not null
  group by label;
end;
$function$;

create or replace function public.refresh_supervisor_report_agent_metrics_range(
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
  delete from public.supervisor_report_daily_agent_metrics m
  where m.metric_day >= p_from
    and m.metric_day <= p_to
    and (p_team_id is null or m.team_id = p_team_id);

  delete from public.supervisor_report_daily_agent_tipifications t
  where t.metric_day >= p_from
    and t.metric_day <= p_to
    and (p_team_id is null or t.team_id = p_team_id);

  for v_row in
    with
    profile_keys as (
      select
        d.metric_day::date as metric_day,
        p.team_id,
        p.id::text as report_agent_key
      from public.profiles p
      cross join generate_series(p_from, p_to, interval '1 day') as d(metric_day)
      where p.role = 'agente'
        and p.active
        and p.team_id is not null
        and (p_team_id is null or p.team_id = p_team_id)
    ),
    call_keys as (
      select distinct
        coalesce(c.ended_at, c.updated_at, c.created_at)::date as metric_day,
        l.team_id,
        public.resolve_supervisor_report_agent_key(c.agent_id, c.historical_agent_id) as report_agent_key
      from public.calls c
      join public.leads l on l.id = c.lead_id
      where c.discarded_reason is null
        and coalesce(c.ended_at, c.updated_at, c.created_at)::date >= p_from
        and coalesce(c.ended_at, c.updated_at, c.created_at)::date <= p_to
        and l.team_id is not null
        and (p_team_id is null or l.team_id = p_team_id)
    ),
    interaction_keys as (
      select distinct
        i.created_at::date as metric_day,
        l.team_id,
        public.resolve_supervisor_report_agent_key(i.agent_id, i.historical_agent_id) as report_agent_key
      from public.interactions i
      join public.leads l on l.id = i.lead_id
      where i.created_at::date >= p_from
        and i.created_at::date <= p_to
        and l.team_id is not null
        and (p_team_id is null or l.team_id = p_team_id)
    )
    select distinct metric_day, team_id, report_agent_key
    from (
      select * from profile_keys
      union all
      select * from call_keys
      union all
      select * from interaction_keys
    ) keys
    where report_agent_key is not null
  loop
    perform public.refresh_supervisor_report_agent_metric_row(v_row.metric_day, v_row.team_id, v_row.report_agent_key);
    perform public.refresh_supervisor_report_agent_tipification_rows(v_row.metric_day, v_row.team_id, v_row.report_agent_key);
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
  v_old_key text;
  v_new_key text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select team_id into v_old_team from public.leads where id = old.lead_id;
    v_old_day := coalesce(old.ended_at, old.updated_at, old.created_at)::date;
    v_old_key := public.resolve_supervisor_report_agent_key(old.agent_id, old.historical_agent_id);
    perform public.refresh_supervisor_report_metric_row(v_old_day, v_old_team, old.agent_id);
    perform public.refresh_supervisor_report_tipification_rows(v_old_day, v_old_team, old.agent_id);
    perform public.refresh_supervisor_report_agent_metric_row(v_old_day, v_old_team, v_old_key);
    perform public.refresh_supervisor_report_agent_tipification_rows(v_old_day, v_old_team, v_old_key);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select team_id into v_new_team from public.leads where id = new.lead_id;
    v_new_day := coalesce(new.ended_at, new.updated_at, new.created_at)::date;
    v_new_key := public.resolve_supervisor_report_agent_key(new.agent_id, new.historical_agent_id);
    perform public.refresh_supervisor_report_metric_row(v_new_day, v_new_team, new.agent_id);
    perform public.refresh_supervisor_report_tipification_rows(v_new_day, v_new_team, new.agent_id);
    perform public.refresh_supervisor_report_agent_metric_row(v_new_day, v_new_team, v_new_key);
    perform public.refresh_supervisor_report_agent_tipification_rows(v_new_day, v_new_team, v_new_key);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
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
  v_old_key text;
  v_new_key text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select team_id into v_old_team from public.leads where id = old.lead_id;
    v_old_key := public.resolve_supervisor_report_agent_key(old.agent_id, old.historical_agent_id);
    perform public.refresh_supervisor_report_metric_row(old.created_at::date, v_old_team, old.agent_id);
    perform public.refresh_supervisor_report_tipification_rows(old.created_at::date, v_old_team, old.agent_id);
    perform public.refresh_supervisor_report_agent_metric_row(old.created_at::date, v_old_team, v_old_key);
    perform public.refresh_supervisor_report_agent_tipification_rows(old.created_at::date, v_old_team, v_old_key);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select team_id into v_new_team from public.leads where id = new.lead_id;
    v_new_key := public.resolve_supervisor_report_agent_key(new.agent_id, new.historical_agent_id);
    perform public.refresh_supervisor_report_metric_row(new.created_at::date, v_new_team, new.agent_id);
    perform public.refresh_supervisor_report_tipification_rows(new.created_at::date, v_new_team, new.agent_id);
    perform public.refresh_supervisor_report_agent_metric_row(new.created_at::date, v_new_team, v_new_key);
    perform public.refresh_supervisor_report_agent_tipification_rows(new.created_at::date, v_new_team, v_new_key);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

create or replace function public.touch_supervisor_report_metrics_from_historical_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row record;
  v_old_key text;
  v_new_key text;
begin
  if tg_op <> 'UPDATE' or old.linked_profile_id is not distinct from new.linked_profile_id then
    return new;
  end if;

  v_old_key := old.id::text;
  v_new_key := coalesce(new.linked_profile_id::text, new.id::text);

  for v_row in
    select distinct
      activity_day,
      team_id
    from (
      select coalesce(c.ended_at, c.updated_at, c.created_at)::date as activity_day, l.team_id
      from public.calls c
      join public.leads l on l.id = c.lead_id
      where c.historical_agent_id = new.id
      union
      select i.created_at::date as activity_day, l.team_id
      from public.interactions i
      join public.leads l on l.id = i.lead_id
      where i.historical_agent_id = new.id
    ) activity
    where team_id is not null
  loop
    delete from public.supervisor_report_daily_agent_metrics
    where metric_day = v_row.activity_day
      and team_id = v_row.team_id
      and report_agent_key = v_old_key;

    delete from public.supervisor_report_daily_agent_tipifications
    where metric_day = v_row.activity_day
      and team_id = v_row.team_id
      and report_agent_key = v_old_key;

    perform public.refresh_supervisor_report_agent_metric_row(v_row.activity_day, v_row.team_id, v_new_key);
    perform public.refresh_supervisor_report_agent_tipification_rows(v_row.activity_day, v_row.team_id, v_new_key);
  end loop;

  return new;
end;
$function$;

drop trigger if exists historical_agents_touch_supervisor_report_metrics on public.historical_agents;
create trigger historical_agents_touch_supervisor_report_metrics
after update of linked_profile_id on public.historical_agents
for each row execute function public.touch_supervisor_report_metrics_from_historical_agent();

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
  metric_rows as (
    select m.*
    from public.supervisor_report_daily_agent_metrics m
    where m.metric_day >= v_from_date
      and m.metric_day <= v_to_date
      and (v_team_id is null or m.team_id = v_team_id)
  ),
  agent_catalog as (
    select
      p.id::text as report_agent_key,
      p.id as profile_id,
      null::uuid as historical_agent_id,
      p.full_name,
      t.name as team_name,
      false as is_historical_only
    from public.profiles p
    left join public.teams t on t.id = p.team_id
    where p.role = 'agente'
      and p.active
      and (v_team_id is null or p.team_id = v_team_id)
    union
    select distinct
      m.report_agent_key,
      m.profile_id,
      m.historical_agent_id,
      coalesce(p.full_name, ha.full_name, 'Ejecutivo histórico') as full_name,
      t.name as team_name,
      (m.profile_id is null and m.historical_agent_id is not null) as is_historical_only
    from metric_rows m
    left join public.profiles p on p.id = m.profile_id
    left join public.historical_agents ha on ha.id = m.historical_agent_id
    left join public.teams t on t.id = m.team_id
  ),
  agent_rows as (
    select
      a.report_agent_key,
      max(a.profile_id) as profile_id,
      max(a.historical_agent_id) as historical_agent_id,
      max(a.full_name) as full_name,
      max(a.team_name) as team_name,
      bool_or(a.is_historical_only) as is_historical_only,
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
    from agent_catalog a
    left join metric_rows m on m.report_agent_key = a.report_agent_key
    group by a.report_agent_key
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
  tipification_rows as (
    select t.label, sum(t.count)::int as count
    from public.supervisor_report_daily_agent_tipifications t
    where t.metric_day >= v_from_date
      and t.metric_day <= v_to_date
      and (v_team_id is null or t.team_id = v_team_id)
    group by t.label
    order by sum(t.count) desc, t.label
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
          'agent_id', report_agent_key,
          'profile_id', profile_id,
          'historical_agent_id', historical_agent_id,
          'full_name', full_name,
          'team_name', team_name,
          'is_historical_only', is_historical_only,
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
      where crm_gestiones > 0
         or llamadas_cerradas > 0
         or leads_gestionados > 0
         or contactos_efectivos > 0
         or agendas > 0
         or not is_historical_only
    ), '[]'::jsonb),
    'tipifications', coalesce((
      select jsonb_agg(
        jsonb_build_object('label', label, 'count', count)
        order by count desc, label
      )
      from tipification_rows
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

select public.refresh_supervisor_report_agent_metrics_range(
  (current_date - interval '180 days')::date,
  current_date,
  null
);

revoke all on function public.resolve_supervisor_report_agent_key(uuid, uuid) from public, anon, authenticated;
revoke all on function public.refresh_supervisor_report_agent_metric_row(date, uuid, text) from public, anon, authenticated;
revoke all on function public.refresh_supervisor_report_agent_tipification_rows(date, uuid, text) from public, anon, authenticated;
revoke all on function public.refresh_supervisor_report_agent_metrics_range(date, date, uuid) from public, anon, authenticated;
revoke all on function public.touch_supervisor_report_metrics_from_call() from public, anon, authenticated;
revoke all on function public.touch_supervisor_report_metrics_from_interaction() from public, anon, authenticated;
revoke all on function public.touch_supervisor_report_metrics_from_historical_agent() from public, anon, authenticated;
revoke all on function public.get_supervisor_report_summary(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_supervisor_report_summary(timestamptz, timestamptz, uuid) to authenticated;
