-- Seleccion operativa para ejecutivos multiskill. Una membresia indica que el
-- ejecutivo puede trabajar una campana; esta tabla indica en cual quiere
-- recibir llamadas ahora. Asi una misma extension nunca queda disponible en
-- dos colas automaticas a la vez.
create table public.agent_active_campaigns (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create index agent_active_campaigns_campaign_idx
  on public.agent_active_campaigns (campaign_id);

alter table public.agent_active_campaigns enable row level security;

create policy agent_active_campaigns_select_own
  on public.agent_active_campaigns
  for select
  to authenticated
  using ((select auth.uid()) = profile_id);

grant select on public.agent_active_campaigns to authenticated;
revoke insert, update, delete on public.agent_active_campaigns from anon, authenticated;

create or replace function public.set_my_active_campaign(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is null then
    raise exception 'Debes iniciar sesion para elegir una campana.';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = v_actor_id
      and profile.active
      and profile.role = 'agente'::public.app_role
  ) then
    raise exception 'Solo un ejecutivo activo puede elegir su campana.';
  end if;

  if not exists (
    select 1
    from public.campaign_agents membership
    join public.campaigns campaign
      on campaign.id = membership.campaign_id
     and campaign.is_active
    join public.dialer_campaign_configs config
      on config.campaign_id = membership.campaign_id
     and config.is_active
     and config.dial_mode <> 'manual'
    where membership.profile_id = v_actor_id
      and membership.campaign_id = p_campaign_id
  ) then
    raise exception 'La campana no esta habilitada para este ejecutivo.';
  end if;

  -- Cambiar de cola durante una llamada o durante el cierre puede cruzar una
  -- gestion con la campana siguiente. Se exige terminar primero.
  if exists (
    select 1
    from public.dialer_agent_sessions session
    where session.profile_id = v_actor_id
      and session.status in ('ringing', 'on_call', 'wrap_up')
  ) or exists (
    select 1
    from public.calls call
    where call.agent_id = v_actor_id
      and call.ended_at is null
      and call.started_at >= now() - interval '12 hours'
  ) then
    raise exception 'Termina la llamada y la tipificacion antes de cambiar de campana.';
  end if;

  insert into public.agent_active_campaigns (profile_id, campaign_id, updated_at)
  values (v_actor_id, p_campaign_id, now())
  on conflict (profile_id) do update
    set campaign_id = excluded.campaign_id,
        updated_at = excluded.updated_at;

  -- Deja de contabilizar inmediatamente la capacidad de la cola anterior. El
  -- motor reconcilia QueueMember en su siguiente tick.
  update public.dialer_agent_sessions
  set status = 'paused',
      last_state_change_at = case
        when status <> 'paused' then now()
        else last_state_change_at
      end,
      updated_at = now()
  where profile_id = v_actor_id
    and campaign_id <> p_campaign_id
    and status in ('available', 'offline', 'paused');
end;
$function$;

revoke all on function public.set_my_active_campaign(uuid) from public, anon;
grant execute on function public.set_my_active_campaign(uuid) to authenticated;

-- La seleccion explicita manda sobre el horario: el ejecutivo y su
-- supervisor deciden el skill del momento. Las membresias sin seleccion
-- conservan el comportamiento historico basado en horario.
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
    and profile.active and profile.role = 'agente'::public.app_role
  join public.agent_sip_credentials credentials
    on credentials.profile_id = membership.profile_id and credentials.is_active
  join public.agent_current_status current_status
    on current_status.profile_id = membership.profile_id
  join public.agent_status_reasons reason on reason.id = current_status.reason_id
  left join public.agent_active_campaigns active_campaign
    on active_campaign.profile_id = membership.profile_id
  where membership.campaign_id = p_campaign_id
    and reason.code <> 'desconectado'
    and (
      active_campaign.campaign_id = membership.campaign_id
      or (
        active_campaign.profile_id is null
        and (
          (
            not exists (
              select 1 from public.campaign_agent_schedules schedule
              where schedule.campaign_agent_id = membership.id
            )
            and membership.schedule_required = false
          )
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
        )
      )
    );
$function$;

revoke all on function public.get_active_campaign_agent_extensions(uuid)
  from public, anon, authenticated;
grant execute on function public.get_active_campaign_agent_extensions(uuid) to service_role;
