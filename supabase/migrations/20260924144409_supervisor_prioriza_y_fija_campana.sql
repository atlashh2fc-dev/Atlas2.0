-- Multiskill gobernado por el supervisor.
--
-- * Prioridad: el supervisor ordena las campañas de cada ejecutivo
--   (campaign_agents.priority, 1 = primera). El selector del ejecutivo las muestra
--   en ese orden y quien no ha elegido entra solo a la de mayor prioridad.
-- * Asignación fija: cuando el supervisor manda a un ejecutivo a una campaña, queda
--   bloqueada hasta que ese mismo supervisor (o un admin) la cambie o la libere.
-- * Cada cambio queda en agent_campaign_switches: quién, a qué campaña, cuándo.

alter table public.campaign_agents
  add column if not exists priority smallint not null default 100
    check (priority between 1 and 1000);

alter table public.agent_active_campaigns
  add column if not exists locked boolean not null default false,
  add column if not exists assigned_by uuid references public.profiles(id) on delete set null,
  add column if not exists source text not null default 'agente'
    check (source in ('agente', 'supervisor', 'prioridad'));

create table if not exists public.agent_campaign_switches (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  previous_campaign_id uuid references public.campaigns(id) on delete set null,
  changed_by uuid references public.profiles(id) on delete set null,
  source text not null check (source in ('agente', 'supervisor', 'prioridad', 'liberacion')),
  locked boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists agent_campaign_switches_profile_idx
  on public.agent_campaign_switches (profile_id, created_at desc);

create or replace function public.can_supervise_agent(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles agent
    where agent.id = p_profile_id
      and agent.role = 'agente'::public.app_role
      and (
        ((select public.current_role_name()) = 'admin'::public.app_role
          and public.can_access_org(agent.organization_id))
        or ((select public.current_role_name()) = 'supervisor'::public.app_role
          and agent.team_id = any (public.supervised_team_ids()))
      )
  );
$$;

alter table public.agent_campaign_switches enable row level security;

create policy agent_campaign_switches_select
  on public.agent_campaign_switches
  for select
  to authenticated
  using (profile_id = (select auth.uid()) or public.can_supervise_agent(profile_id));

grant select on public.agent_campaign_switches to authenticated;
revoke insert, update, delete on public.agent_campaign_switches from anon, authenticated;

-- Núcleo común: valida, cambia la cola y deja la traza. Solo lo llaman las
-- funciones públicas de abajo, que ya resolvieron quién puede hacerlo.
create or replace function public.apply_agent_active_campaign(
  p_profile_id uuid,
  p_campaign_id uuid,
  p_source text,
  p_locked boolean,
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_previous public.agent_active_campaigns%rowtype;
begin
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
    where membership.profile_id = p_profile_id
      and membership.campaign_id = p_campaign_id
  ) then
    raise exception 'La campaña no está habilitada para este ejecutivo.';
  end if;

  select * into v_previous from public.agent_active_campaigns where profile_id = p_profile_id;

  -- Cambiar de cola durante una llamada o su cierre cruzaría la gestión con la
  -- campaña siguiente. Si solo cambia el bloqueo, la cola no se toca.
  if v_previous.campaign_id is distinct from p_campaign_id and (
    exists (
      select 1 from public.dialer_agent_sessions session
      where session.profile_id = p_profile_id
        and session.status in ('ringing', 'on_call', 'wrap_up')
    ) or exists (
      select 1 from public.calls call
      where call.agent_id = p_profile_id
        and call.ended_at is null
        and call.started_at >= now() - interval '12 hours'
    )
  ) then
    raise exception 'El ejecutivo tiene una llamada o tipificación en curso; intenta cuando termine.';
  end if;

  insert into public.agent_active_campaigns (profile_id, campaign_id, updated_at, locked, assigned_by, source)
  values (p_profile_id, p_campaign_id, now(), p_locked, case when p_locked then p_changed_by end, p_source)
  on conflict (profile_id) do update
    set campaign_id = excluded.campaign_id,
        updated_at = excluded.updated_at,
        locked = excluded.locked,
        assigned_by = excluded.assigned_by,
        source = excluded.source;

  -- Deja de contar su capacidad en la cola anterior; el motor reconcilia en su
  -- siguiente ciclo.
  update public.dialer_agent_sessions
  set status = 'paused',
      last_state_change_at = case when status <> 'paused' then now() else last_state_change_at end,
      updated_at = now()
  where profile_id = p_profile_id
    and campaign_id <> p_campaign_id
    and status in ('available', 'offline', 'paused');

  if v_previous.campaign_id is distinct from p_campaign_id or v_previous.locked is distinct from p_locked then
    insert into public.agent_campaign_switches (profile_id, campaign_id, previous_campaign_id, changed_by, source, locked)
    values (p_profile_id, p_campaign_id, v_previous.campaign_id, p_changed_by, p_source, p_locked);
  end if;
end;
$$;

revoke all on function public.apply_agent_active_campaign(uuid, uuid, text, boolean, uuid) from public, anon, authenticated;

-- El ejecutivo elige su campaña, salvo que su supervisor se la haya fijado.
create or replace function public.set_my_active_campaign(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_lock record;
begin
  perform public.assert_org_access(public.org_of_campaign(p_campaign_id));

  if v_actor_id is null then
    raise exception 'Debes iniciar sesión para elegir una campaña.';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = v_actor_id and profile.active and profile.role = 'agente'::public.app_role
  ) then
    raise exception 'Solo un ejecutivo activo puede elegir su campaña.';
  end if;

  select active.campaign_id, coalesce(supervisor.full_name, 'tu supervisor') as supervisor_name
  into v_lock
  from public.agent_active_campaigns active
  left join public.profiles supervisor on supervisor.id = active.assigned_by
  where active.profile_id = v_actor_id and active.locked;

  if found then
    if v_lock.campaign_id = p_campaign_id then
      return;
    end if;
    raise exception '% te asignó esta campaña. Solo quien la asignó puede cambiarla.', v_lock.supervisor_name;
  end if;

  perform public.apply_agent_active_campaign(v_actor_id, p_campaign_id, 'agente', false, v_actor_id);
end;
$$;

-- Quien fijó la campaña (o un admin) es el único que puede moverla o liberarla.
create or replace function public.assert_can_change_agent_campaign(p_profile_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lock record;
begin
  if not public.can_supervise_agent(p_profile_id) then
    raise exception 'Este ejecutivo no está en tus equipos.' using errcode = '42501';
  end if;

  select active.assigned_by, coalesce(supervisor.full_name, 'otro supervisor') as supervisor_name
  into v_lock
  from public.agent_active_campaigns active
  left join public.profiles supervisor on supervisor.id = active.assigned_by
  where active.profile_id = p_profile_id and active.locked;

  if found
    and v_lock.assigned_by is distinct from (select auth.uid())
    and (select public.current_role_name()) <> 'admin'::public.app_role then
    raise exception 'La fijó %: solo esa persona o un admin puede cambiarla.', v_lock.supervisor_name;
  end if;
end;
$$;

revoke all on function public.assert_can_change_agent_campaign(uuid) from public, anon, authenticated;

create or replace function public.supervisor_set_agent_campaign(p_profile_id uuid, p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.assert_org_access(public.org_of_campaign(p_campaign_id));
  perform public.assert_can_change_agent_campaign(p_profile_id);
  perform public.apply_agent_active_campaign(p_profile_id, p_campaign_id, 'supervisor', true, (select auth.uid()));
end;
$$;

create or replace function public.supervisor_release_agent_campaign(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_campaign uuid;
begin
  perform public.assert_can_change_agent_campaign(p_profile_id);

  update public.agent_active_campaigns
  set locked = false, assigned_by = null, updated_at = now()
  where profile_id = p_profile_id and locked
  returning campaign_id into v_campaign;

  if found then
    insert into public.agent_campaign_switches (profile_id, campaign_id, previous_campaign_id, changed_by, source, locked)
    values (p_profile_id, v_campaign, v_campaign, (select auth.uid()), 'liberacion', false);
  end if;
end;
$$;

-- Ordena las campañas del ejecutivo: la primera del arreglo queda con prioridad 1.
-- Las que no vienen en el arreglo quedan detrás, en su orden anterior.
create or replace function public.supervisor_set_agent_campaign_priorities(p_profile_id uuid, p_campaign_ids uuid[])
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.can_supervise_agent(p_profile_id) then
    raise exception 'Este ejecutivo no está en tus equipos.' using errcode = '42501';
  end if;

  with ordered as (
    select membership.id,
      row_number() over (
        order by array_position(p_campaign_ids, membership.campaign_id) nulls last,
          membership.priority, membership.assigned_at
      ) as position
    from public.campaign_agents membership
    where membership.profile_id = p_profile_id
  )
  update public.campaign_agents membership
  set priority = ordered.position
  from ordered
  where membership.id = ordered.id;
end;
$$;

-- Si el ejecutivo no eligió campaña (o la tiene por prioridad), entra a la de
-- mayor prioridad cuando hay una sola en el primer lugar. Si la elige él o se la
-- fija el supervisor, esto no la toca.
create or replace function public.ensure_my_active_campaign()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_current public.agent_active_campaigns%rowtype;
  v_top uuid;
  v_top_count integer;
begin
  if v_actor_id is null then
    return null;
  end if;

  select * into v_current from public.agent_active_campaigns where profile_id = v_actor_id;
  if found and (v_current.locked or v_current.source = 'agente') then
    return v_current.campaign_id;
  end if;

  with eligible as (
    select membership.campaign_id, membership.priority, campaign.name
    from public.campaign_agents membership
    join public.campaigns campaign on campaign.id = membership.campaign_id and campaign.is_active
    join public.dialer_campaign_configs config
      on config.campaign_id = membership.campaign_id and config.is_active and config.dial_mode <> 'manual'
    where membership.profile_id = v_actor_id
  ), top as (
    select * from eligible where priority = (select min(priority) from eligible)
  )
  select (select campaign_id from top order by name limit 1), (select count(*) from top)
  into v_top, v_top_count;

  if v_top is null or v_top_count <> 1 or v_top = v_current.campaign_id then
    return v_current.campaign_id;
  end if;

  begin
    perform public.apply_agent_active_campaign(v_actor_id, v_top, 'prioridad', false, null);
  exception when others then
    -- En llamada o tipificando: se reintenta en la próxima lectura de la barra.
    return v_current.campaign_id;
  end;
  return v_top;
end;
$$;

-- Tablero del supervisor: sus ejecutivos, en qué campaña están, quién la fijó y
-- el orden de sus campañas.
create or replace function public.supervisor_agent_campaign_board()
returns table (
  profile_id uuid,
  full_name text,
  team_name text,
  extension text,
  active_campaign_id uuid,
  active_campaign_name text,
  locked boolean,
  source text,
  assigned_by uuid,
  assigned_by_name text,
  changed_at timestamptz,
  campaigns jsonb
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    agent.id,
    agent.full_name,
    team.name,
    credentials.extension,
    active.campaign_id,
    active_campaign.name,
    coalesce(active.locked, false),
    active.source,
    active.assigned_by,
    supervisor.full_name,
    active.updated_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
          'campaign_id', membership.campaign_id,
          'name', campaign.name,
          'priority', membership.priority,
          'dial_mode', config.dial_mode
        ) order by membership.priority, campaign.name)
      from public.campaign_agents membership
      join public.campaigns campaign on campaign.id = membership.campaign_id and campaign.is_active
      join public.dialer_campaign_configs config
        on config.campaign_id = membership.campaign_id and config.is_active and config.dial_mode <> 'manual'
      where membership.profile_id = agent.id
    ), '[]'::jsonb)
  from public.profiles agent
  left join public.teams team on team.id = agent.team_id
  left join public.agent_sip_credentials credentials on credentials.profile_id = agent.id
  left join public.agent_active_campaigns active on active.profile_id = agent.id
  left join public.campaigns active_campaign on active_campaign.id = active.campaign_id
  left join public.profiles supervisor on supervisor.id = active.assigned_by
  where agent.active
    and agent.role = 'agente'::public.app_role
    and public.can_supervise_agent(agent.id)
  order by team.name nulls last, agent.full_name;
$$;

revoke all on function public.can_supervise_agent(uuid) from public, anon;
revoke all on function public.supervisor_set_agent_campaign(uuid, uuid) from public, anon;
revoke all on function public.supervisor_release_agent_campaign(uuid) from public, anon;
revoke all on function public.supervisor_set_agent_campaign_priorities(uuid, uuid[]) from public, anon;
revoke all on function public.ensure_my_active_campaign() from public, anon;
revoke all on function public.supervisor_agent_campaign_board() from public, anon;
grant execute on function public.can_supervise_agent(uuid) to authenticated;
grant execute on function public.supervisor_set_agent_campaign(uuid, uuid) to authenticated;
grant execute on function public.supervisor_release_agent_campaign(uuid) to authenticated;
grant execute on function public.supervisor_set_agent_campaign_priorities(uuid, uuid[]) to authenticated;
grant execute on function public.ensure_my_active_campaign() to authenticated;
grant execute on function public.supervisor_agent_campaign_board() to authenticated;
