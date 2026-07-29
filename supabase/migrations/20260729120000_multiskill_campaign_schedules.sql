-- Un ejecutivo puede ser multiskill. Los horarios pertenecen a su membresía
-- en una campaña para que el motor lo conecte únicamente a la cola correcta.
-- Las membresías nuevas quedan a la espera de horario; las existentes se
-- conservan disponibles todo el tiempo para no alterar la operación vigente.
alter table public.campaign_agents
  add column schedule_required boolean not null default false;

create table public.campaign_agent_schedules (
  id uuid primary key default gen_random_uuid(),
  campaign_agent_id uuid not null references public.campaign_agents(id) on delete cascade,
  days_of_week smallint[] not null,
  start_time time not null,
  end_time time not null,
  timezone text not null default 'America/Santiago',
  created_at timestamptz not null default now(),
  check (cardinality(days_of_week) between 1 and 7),
  check (days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  check (start_time < end_time)
);

create index campaign_agent_schedules_membership_idx
  on public.campaign_agent_schedules (campaign_agent_id);

alter table public.campaign_agent_schedules enable row level security;

create policy campaign_agent_schedules_select on public.campaign_agent_schedules
  for select to authenticated using (true);

create policy campaign_agent_schedules_admin_insert on public.campaign_agent_schedules
  for insert with check (current_role_name() = 'admin'::app_role);

create policy campaign_agent_schedules_admin_delete on public.campaign_agent_schedules
  for delete using (current_role_name() = 'admin'::app_role);

-- No se permite que dos campañas de un mismo ejecutivo compartan franja. Así
-- nunca queda elegible para dos colas automáticas al mismo tiempo. La UI crea
-- intervalos diurnos (sin cruces de medianoche), validado también arriba.
create or replace function public.reject_overlapping_campaign_agent_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_profile_id uuid;
begin
  select ca.profile_id into v_profile_id
  from public.campaign_agents ca
  where ca.id = new.campaign_agent_id;

  if exists (
    select 1
    from public.campaign_agent_schedules existing_schedule
    join public.campaign_agents existing_membership
      on existing_membership.id = existing_schedule.campaign_agent_id
    where existing_membership.profile_id = v_profile_id
      and existing_schedule.id <> new.id
      and existing_schedule.timezone = new.timezone
      and existing_schedule.days_of_week && new.days_of_week
      and existing_schedule.start_time < new.end_time
      and new.start_time < existing_schedule.end_time
  ) then
    raise exception 'El horario se superpone con otra campaña de este ejecutivo.';
  end if;
  return new;
end;
$function$;

create trigger campaign_agent_schedules_reject_overlap
  before insert or update on public.campaign_agent_schedules
  for each row execute function public.reject_overlapping_campaign_agent_schedule();

-- El motor usa esta función en cada sincronización de colas. Si no hay
-- horarios configurados para una membresía antigua, se considera activa todo
-- el día para conservar las asignaciones preexistentes. Las nuevas quedan
-- inactivas hasta tener horario; al existir horarios, basta que uno cubra el
-- instante local actual.
create or replace function public.get_active_campaign_agent_extensions(p_campaign_id uuid)
returns table (extension text)
language sql
stable
security definer
set search_path = public
as $function$
  select distinct credentials.extension
  from public.campaign_agents membership
  join public.profiles profile
    on profile.id = membership.profile_id
    and profile.active = true
    and profile.role = 'agente'::app_role
  join public.agent_sip_credentials credentials
    on credentials.profile_id = membership.profile_id
    and credentials.is_active = true
  where membership.campaign_id = p_campaign_id
    and (
      not exists (
        select 1
        from public.campaign_agent_schedules schedule
        where schedule.campaign_agent_id = membership.id
      )
      and membership.schedule_required = false
      or exists (
        select 1
        from public.campaign_agent_schedules schedule
        cross join lateral (
          select now() at time zone schedule.timezone as local_now
        ) local_time
        where schedule.campaign_agent_id = membership.id
          and extract(dow from local_time.local_now)::smallint = any(schedule.days_of_week)
          and local_time.local_now::time >= schedule.start_time
          and local_time.local_now::time < schedule.end_time
      )
    );
$function$;

revoke all on function public.get_active_campaign_agent_extensions(uuid) from public, anon, authenticated;
grant execute on function public.get_active_campaign_agent_extensions(uuid) to service_role;
