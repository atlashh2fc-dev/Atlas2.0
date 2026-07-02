-- Vocalcom daily imports.
-- The source file is cumulative, so every call event gets a deterministic key
-- and repeated daily uploads only store previously unseen events.

alter table public.leads
  add column if not exists vocalcom_last_touched_at timestamptz,
  add column if not exists vocalcom_last_connected_at timestamptz,
  add column if not exists vocalcom_last_connection_status text,
  add column if not exists vocalcom_last_duration_seconds integer,
  add column if not exists vocalcom_last_import_batch_id uuid;

create index if not exists leads_vocalcom_last_touched_at_idx
  on public.leads (vocalcom_last_touched_at desc)
  where vocalcom_last_touched_at is not null;

create table if not exists public.vocalcom_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_size bigint,
  source_row_count integer not null default 0,
  inserted_count integer not null default 0,
  duplicate_count integer not null default 0,
  matched_count integer not null default 0,
  ambiguous_count integer not null default 0,
  unmatched_count integer not null default 0,
  connected_count integer not null default 0,
  not_connected_count integer not null default 0,
  indeterminate_count integer not null default 0,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists vocalcom_import_batches_created_at_idx
  on public.vocalcom_import_batches (created_at desc);

create table if not exists public.vocalcom_call_events (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references public.vocalcom_import_batches(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  row_number integer,
  event_key text not null,
  rut text,
  normalized_rut text,
  telefono_original text,
  telefono_vocalcom text,
  phone_normalized text,
  called_at timestamptz,
  stats_date text,
  stats_hour text,
  stats_datetime text,
  stats_utc_datetime timestamptz,
  agent_external_id text,
  agent_name text,
  duration_seconds integer,
  wrapup text,
  status_group text,
  status_code text,
  status_detail text,
  status_text text,
  status_text_detail text,
  comments text,
  touched boolean not null default true,
  connected boolean,
  connection_status text not null check (connection_status in ('connected', 'not_connected', 'indeterminate')),
  connection_rule text not null,
  matched_by text,
  match_status text not null default 'pending' check (match_status in ('pending', 'matched', 'ambiguous', 'unmatched')),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint vocalcom_call_events_duration_nonnegative check (duration_seconds is null or duration_seconds >= 0)
);

create unique index if not exists vocalcom_call_events_event_key_uidx
  on public.vocalcom_call_events (event_key);

create index if not exists vocalcom_call_events_called_at_idx
  on public.vocalcom_call_events (called_at desc);

create index if not exists vocalcom_call_events_lead_called_idx
  on public.vocalcom_call_events (lead_id, called_at desc)
  where lead_id is not null;

create index if not exists vocalcom_call_events_phone_idx
  on public.vocalcom_call_events (phone_normalized)
  where phone_normalized is not null;

create index if not exists vocalcom_call_events_rut_idx
  on public.vocalcom_call_events (normalized_rut)
  where normalized_rut is not null;

alter table public.vocalcom_import_batches enable row level security;
alter table public.vocalcom_call_events enable row level security;

drop policy if exists vocalcom_import_batches_select_admin on public.vocalcom_import_batches;
create policy vocalcom_import_batches_select_admin
on public.vocalcom_import_batches
for select
to authenticated
using ((select public.current_role_name()) = 'admin');

drop policy if exists vocalcom_call_events_select on public.vocalcom_call_events;
create policy vocalcom_call_events_select
on public.vocalcom_call_events
for select
to authenticated
using (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'supervisor'
    and exists (
      select 1
      from public.leads l
      where l.id = lead_id
        and l.team_id = (select public.current_team_id())
    )
  )
);

grant select on public.vocalcom_import_batches to authenticated;
grant select on public.vocalcom_call_events to authenticated;
revoke insert, update, delete on public.vocalcom_import_batches from anon, authenticated;
revoke insert, update, delete on public.vocalcom_call_events from anon, authenticated;

create or replace function public.import_vocalcom_events(
  p_file_name text,
  p_file_size bigint,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_role text := coalesce((select public.current_role_name())::text, '');
  v_batch_id uuid;
  v_source_count integer := coalesce(jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), 0);
  v_inserted_count integer := 0;
  v_matched_count integer := 0;
  v_ambiguous_count integer := 0;
  v_unmatched_count integer := 0;
  v_connected_count integer := 0;
  v_not_connected_count integer := 0;
  v_indeterminate_count integer := 0;
begin
  if v_actor_id is null then
    raise exception 'No autenticado.';
  end if;

  if v_role <> 'admin' then
    raise exception 'Solo un administrador puede cargar archivos Vocalcom.';
  end if;

  if v_source_count = 0 then
    raise exception 'El archivo no trae filas Vocalcom para procesar.';
  end if;

  insert into public.vocalcom_import_batches (
    file_name,
    file_size,
    source_row_count,
    uploaded_by
  )
  values (
    coalesce(nullif(btrim(p_file_name), ''), 'vocalcom.csv'),
    p_file_size,
    v_source_count,
    v_actor_id
  )
  returning id into v_batch_id;

  with source_rows as (
    select
      value as row_data,
      coalesce((value->>'row_number')::integer, ordinality::integer + 1) as row_number,
      nullif(value->>'event_key', '') as event_key,
      nullif(value->>'rut', '') as rut,
      nullif(value->>'normalized_rut', '') as normalized_rut,
      nullif(value->>'telefono_original', '') as telefono_original,
      nullif(value->>'telefono_vocalcom', '') as telefono_vocalcom,
      nullif(value->>'phone_normalized', '') as phone_normalized,
      nullif(value->>'called_at', '')::timestamptz as called_at,
      nullif(value->>'stats_date', '') as stats_date,
      nullif(value->>'stats_hour', '') as stats_hour,
      nullif(value->>'stats_datetime', '') as stats_datetime,
      nullif(value->>'stats_utc_datetime', '')::timestamptz as stats_utc_datetime,
      nullif(value->>'agent_external_id', '') as agent_external_id,
      nullif(value->>'agent_name', '') as agent_name,
      nullif(value->>'duration_seconds', '')::integer as duration_seconds,
      nullif(value->>'wrapup', '') as wrapup,
      nullif(value->>'status_group', '') as status_group,
      nullif(value->>'status_code', '') as status_code,
      nullif(value->>'status_detail', '') as status_detail,
      nullif(value->>'status_text', '') as status_text,
      nullif(value->>'status_text_detail', '') as status_text_detail,
      nullif(value->>'comments', '') as comments,
      case when value ? 'connected' then (value->>'connected')::boolean else null end as connected,
      coalesce(nullif(value->>'connection_status', ''), 'indeterminate') as connection_status,
      coalesce(nullif(value->>'connection_rule', ''), 'sin_regla') as connection_rule
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality
  ),
  prepared_rows as (
    select
      *,
      coalesce(
        event_key,
        md5(concat_ws('|',
          coalesce(normalized_rut, ''),
          coalesce(phone_normalized, ''),
          coalesce(stats_datetime, ''),
          coalesce(agent_external_id, ''),
          coalesce(agent_name, ''),
          coalesce(duration_seconds::text, ''),
          coalesce(wrapup, ''),
          coalesce(status_code, ''),
          coalesce(status_text, '')
        ))
      ) as effective_event_key
    from source_rows
    where coalesce(phone_normalized, normalized_rut, stats_datetime) is not null
  ),
  inserted as (
    insert into public.vocalcom_call_events (
      import_batch_id,
      row_number,
      event_key,
      rut,
      normalized_rut,
      telefono_original,
      telefono_vocalcom,
      phone_normalized,
      called_at,
      stats_date,
      stats_hour,
      stats_datetime,
      stats_utc_datetime,
      agent_external_id,
      agent_name,
      duration_seconds,
      wrapup,
      status_group,
      status_code,
      status_detail,
      status_text,
      status_text_detail,
      comments,
      touched,
      connected,
      connection_status,
      connection_rule,
      raw
    )
    select
      v_batch_id,
      row_number,
      effective_event_key,
      rut,
      normalized_rut,
      telefono_original,
      telefono_vocalcom,
      phone_normalized,
      called_at,
      stats_date,
      stats_hour,
      stats_datetime,
      stats_utc_datetime,
      agent_external_id,
      agent_name,
      duration_seconds,
      wrapup,
      status_group,
      status_code,
      status_detail,
      status_text,
      status_text_detail,
      comments,
      true,
      connected,
      case
        when connection_status in ('connected', 'not_connected', 'indeterminate') then connection_status
        else 'indeterminate'
      end,
      connection_rule,
      row_data
    from prepared_rows
    on conflict (event_key) do nothing
    returning *
  ),
  matched as (
    select
      i.id as event_id,
      m.lead_id,
      m.matched_by,
      m.match_status
    from inserted i
    left join lateral (
      with candidates as (
        select distinct l.id, 'rut_phone'::text as matched_by, 1 as priority
        from public.leads l
        where i.normalized_rut is not null
          and i.phone_normalized is not null
          and public.normalize_lead_rut(l.rut) = i.normalized_rut
          and (
            public.normalize_lead_contact('phone', l.phone) = i.phone_normalized
            or exists (
              select 1
              from public.lead_contacts lc
              where lc.lead_id = l.id
                and lc.contact_type = 'phone'
                and lc.normalized_value = i.phone_normalized
            )
          )
        union
        select distinct l.id, 'rut'::text as matched_by, 2 as priority
        from public.leads l
        where i.normalized_rut is not null
          and public.normalize_lead_rut(l.rut) = i.normalized_rut
        union
        select distinct l.id, 'phone'::text as matched_by, 3 as priority
        from public.leads l
        where i.phone_normalized is not null
          and (
            public.normalize_lead_contact('phone', l.phone) = i.phone_normalized
            or exists (
              select 1
              from public.lead_contacts lc
              where lc.lead_id = l.id
                and lc.contact_type = 'phone'
                and lc.normalized_value = i.phone_normalized
            )
          )
      ),
      top_priority as (
        select min(priority) as priority from candidates
      ),
      top_candidates as (
        select c.*
        from candidates c
        join top_priority tp on tp.priority = c.priority
      )
      select
        case when count(*) = 1 then min(id) else null end as lead_id,
        case when count(*) = 1 then min(matched_by) else null end as matched_by,
        case
          when count(*) = 1 then 'matched'
          when count(*) > 1 then 'ambiguous'
          else 'unmatched'
        end as match_status
      from top_candidates
    ) m on true
  ),
  updated_events as (
    update public.vocalcom_call_events e
    set
      lead_id = matched.lead_id,
      matched_by = matched.matched_by,
      match_status = coalesce(matched.match_status, 'unmatched')
    from matched
    where e.id = matched.event_id
    returning e.*
  ),
  latest_by_lead as (
    select distinct on (lead_id)
      lead_id,
      called_at,
      connection_status,
      duration_seconds,
      import_batch_id
    from updated_events
    where lead_id is not null
      and called_at is not null
    order by lead_id, called_at desc, created_at desc
  )
  update public.leads l
  set
    vocalcom_last_touched_at = greatest(
      coalesce(l.vocalcom_last_touched_at, '-infinity'::timestamptz),
      latest_by_lead.called_at
    ),
    vocalcom_last_connected_at = case
      when latest_by_lead.connection_status = 'connected' then greatest(
        coalesce(l.vocalcom_last_connected_at, '-infinity'::timestamptz),
        latest_by_lead.called_at
      )
      else l.vocalcom_last_connected_at
    end,
    vocalcom_last_connection_status = latest_by_lead.connection_status,
    vocalcom_last_duration_seconds = latest_by_lead.duration_seconds,
    vocalcom_last_import_batch_id = latest_by_lead.import_batch_id
  from latest_by_lead
  where l.id = latest_by_lead.lead_id
    and (
      l.vocalcom_last_touched_at is null
      or latest_by_lead.called_at >= l.vocalcom_last_touched_at
    );

  select count(*)
  into v_inserted_count
  from public.vocalcom_call_events
  where import_batch_id = v_batch_id;

  select
    count(*) filter (where match_status = 'matched'),
    count(*) filter (where match_status = 'ambiguous'),
    count(*) filter (where match_status = 'unmatched'),
    count(*) filter (where connection_status = 'connected'),
    count(*) filter (where connection_status = 'not_connected'),
    count(*) filter (where connection_status = 'indeterminate')
  into
    v_matched_count,
    v_ambiguous_count,
    v_unmatched_count,
    v_connected_count,
    v_not_connected_count,
    v_indeterminate_count
  from public.vocalcom_call_events
  where import_batch_id = v_batch_id;

  update public.vocalcom_import_batches
  set
    inserted_count = v_inserted_count,
    duplicate_count = greatest(v_source_count - v_inserted_count, 0),
    matched_count = v_matched_count,
    ambiguous_count = v_ambiguous_count,
    unmatched_count = v_unmatched_count,
    connected_count = v_connected_count,
    not_connected_count = v_not_connected_count,
    indeterminate_count = v_indeterminate_count
  where id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'source_rows', v_source_count,
    'inserted', v_inserted_count,
    'duplicates', greatest(v_source_count - v_inserted_count, 0),
    'matched', v_matched_count,
    'ambiguous', v_ambiguous_count,
    'unmatched', v_unmatched_count,
    'connected', v_connected_count,
    'not_connected', v_not_connected_count,
    'indeterminate', v_indeterminate_count
  );
end;
$function$;

revoke all on function public.import_vocalcom_events(text, bigint, jsonb) from public, anon;
grant execute on function public.import_vocalcom_events(text, bigint, jsonb) to authenticated;

create or replace function public.get_vocalcom_import_admin_summary()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with totals as (
  select
    count(*)::int as total_imports,
    coalesce(sum(source_row_count), 0)::int as source_rows,
    coalesce(sum(inserted_count), 0)::int as stored_events,
    coalesce(sum(duplicate_count), 0)::int as duplicate_events,
    coalesce(sum(matched_count), 0)::int as matched_events,
    coalesce(sum(connected_count), 0)::int as connected_events,
    coalesce(sum(not_connected_count), 0)::int as not_connected_events,
    coalesce(sum(indeterminate_count), 0)::int as indeterminate_events
  from public.vocalcom_import_batches
),
recent as (
  select
    b.id,
    b.file_name,
    b.source_row_count,
    b.inserted_count,
    b.duplicate_count,
    b.matched_count,
    b.ambiguous_count,
    b.unmatched_count,
    b.connected_count,
    b.not_connected_count,
    b.indeterminate_count,
    b.created_at,
    p.full_name as uploaded_by_name
  from public.vocalcom_import_batches b
  left join public.profiles p on p.id = b.uploaded_by
  order by b.created_at desc
  limit 10
)
select case
  when (select public.current_role_name()) <> 'admin' then
    jsonb_build_object('totals', jsonb_build_object(), 'recent', '[]'::jsonb)
  else
    jsonb_build_object(
      'totals', (select to_jsonb(totals) from totals),
      'recent', coalesce((select jsonb_agg(to_jsonb(recent)) from recent), '[]'::jsonb)
    )
end;
$$;

revoke all on function public.get_vocalcom_import_admin_summary() from public, anon;
grant execute on function public.get_vocalcom_import_admin_summary() to authenticated;

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
  crm_touched_days as (
    select distinct i.created_at::date as day, i.lead_id
    from public.interactions i
    join public.leads l on l.id = i.lead_id
    where i.created_at >= v_from
      and i.created_at <= v_to
      and (v_team_id is null or l.team_id = v_team_id)
    union
    select distinct coalesce(c.ended_at, c.updated_at, c.created_at)::date as day, c.lead_id
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where c.discarded_reason is null
      and c.ended_at is not null
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= v_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) <= v_to
      and (v_team_id is null or l.team_id = v_team_id)
  ),
  vocalcom_events as (
    select
      coalesce(v.called_at, v.created_at)::date as day,
      v.lead_id,
      v.connection_status,
      v.duration_seconds
    from public.vocalcom_call_events v
    join public.leads l on l.id = v.lead_id
    where v.match_status = 'matched'
      and v.lead_id is not null
      and coalesce(v.called_at, v.created_at) >= v_from
      and coalesce(v.called_at, v.created_at) <= v_to
      and (v_team_id is null or l.team_id = v_team_id)
  ),
  vocalcom_touched_days as (
    select distinct day, lead_id
    from vocalcom_events
  ),
  all_touched_days as (
    select day, lead_id from crm_touched_days
    union
    select day, lead_id from vocalcom_touched_days
  ),
  all_connected_days as (
    select distinct coalesce(c.ended_at, c.updated_at, c.created_at)::date as day, c.lead_id
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where c.discarded_reason is null
      and c.status = 'connected'
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= v_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) <= v_to
      and (v_team_id is null or l.team_id = v_team_id)
    union
    select distinct day, lead_id
    from vocalcom_events
    where connection_status = 'connected'
  ),
  all_no_contact_days as (
    select distinct coalesce(c.ended_at, c.updated_at, c.created_at)::date as day, c.lead_id
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where c.discarded_reason is null
      and c.status in ('no_answer', 'busy', 'voicemail', 'out_of_service')
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= v_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) <= v_to
      and (v_team_id is null or l.team_id = v_team_id)
    union
    select distinct day, lead_id
    from vocalcom_events
    where connection_status = 'not_connected'
  ),
  vocalcom_tmo as (
    select
      coalesce(sum(duration_seconds), 0)::numeric as tmo_sum_seconds,
      count(*)::int as tmo_count
    from vocalcom_events
    where connection_status = 'connected'
      and duration_seconds is not null
      and duration_seconds > 0
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
      d.day,
      coalesce(m.crm_gestiones, 0)::int as crm_gestiones,
      coalesce(c.contactos_efectivos, 0)::int as contactos_efectivos,
      coalesce(m.agendas, 0)::int as agendas
    from (
      select day from all_touched_days
      union
      select metric_day as day from metric_rows
    ) d
    left join (
      select
        metric_day as day,
        coalesce(sum(crm_gestiones), 0)::int as crm_gestiones,
        coalesce(sum(agendas), 0)::int as agendas
      from metric_rows
      group by metric_day
    ) m on m.day = d.day
    left join (
      select day, count(*)::int as contactos_efectivos
      from all_connected_days
      group by day
    ) c on c.day = d.day
    where coalesce(m.crm_gestiones, 0) > 0
       or coalesce(c.contactos_efectivos, 0) > 0
       or coalesce(m.agendas, 0) > 0
    order by d.day
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
      (select count(*)::int from all_touched_days) as recorridos,
      (select count(*)::int from vocalcom_touched_days) as vocalcom_recorridos,
      coalesce(sum(llamadas_cerradas), 0)::int as llamadas_cerradas,
      (select count(*)::int from all_connected_days) as contactados,
      (select count(*)::int from vocalcom_events where connection_status = 'connected') as vocalcom_contactados,
      (select count(*)::int from all_no_contact_days) as no_contacto,
      coalesce(sum(agendas), 0)::int as agendas_creadas,
      (select count(*)::int from team_leads where next_action_at is not null and next_action_at < now()) as agendas_vencidas,
      (select count(*)::int from team_leads where next_action_at is not null and next_action_at >= now()) as agendas_pendientes,
      coalesce(sum(cotizaciones), 0)::int as cotizaciones,
      coalesce(sum(ventas), 0)::int as ventas,
      coalesce(sum(uf), 0)::numeric as uf,
      coalesce(sum(tmo_sum_seconds), 0)::numeric + (select tmo_sum_seconds from vocalcom_tmo) as tmo_sum_seconds,
      coalesce(sum(tmo_count), 0)::int + (select tmo_count from vocalcom_tmo) as tmo_count
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
      'vocalcom_recorridos', totals.vocalcom_recorridos,
      'contactados', totals.contactados,
      'vocalcom_contactados', totals.vocalcom_contactados,
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

revoke all on function public.get_supervisor_report_summary(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_supervisor_report_summary(timestamptz, timestamptz, uuid) to authenticated;
