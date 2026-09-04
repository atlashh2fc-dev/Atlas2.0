-- Un equipo operativo puede ser supervisado por varias personas. Se conserva
-- teams.supervisor_id como supervisor primario legacy para no romper
-- integraciones antiguas; la autoridad efectiva vive en team_supervisors y en
-- el contrato existente supervised_team_ids().

begin;

create table public.team_supervisors (
  team_id uuid not null references public.teams(id) on delete cascade,
  supervisor_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  primary key (team_id, supervisor_id)
);

create index team_supervisors_supervisor_idx
  on public.team_supervisors(supervisor_id, team_id);

alter table public.team_supervisors enable row level security;
revoke all on table public.team_supervisors from public, anon, authenticated;
grant select on table public.team_supervisors to authenticated;
grant all on table public.team_supervisors to service_role;

create policy team_supervisors_select
on public.team_supervisors for select to authenticated
using (
  (select public.current_role_name()) = 'admin'::public.app_role
  or supervisor_id = (select auth.uid())
);

insert into public.team_supervisors (team_id, supervisor_id)
select team.id, team.supervisor_id
from public.teams team
join public.profiles supervisor
  on supervisor.id = team.supervisor_id
 and supervisor.role = 'supervisor'::public.app_role
 and supervisor.active
where team.supervisor_id is not null
on conflict (team_id, supervisor_id) do nothing;

-- La cuenta de Andrea que efectivamente inició sesión como supervisora se
-- agrega junto a Elizabeth, sin tocar sus perfiles duplicados de admin/agente.
insert into public.team_supervisors (team_id, supervisor_id)
select team.id, supervisor.id
from public.teams team
join public.profiles supervisor
  on lower(supervisor.email) = 'aguerra@infobusiness.cl'
 and supervisor.role = 'supervisor'::public.app_role
 and supervisor.active
where team.name = 'Secretaria Virtual'
on conflict (team_id, supervisor_id) do nothing;

create or replace function public.supervised_team_ids()
returns uuid[]
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(scope.team_id order by scope.team_name), '{}'::uuid[])
  from (
    select distinct team.id as team_id, team.name as team_name
    from public.teams team
    join public.profiles actor
      on actor.id = (select auth.uid())
     and actor.role = 'supervisor'::public.app_role
     and actor.active
    where team.supervisor_id = actor.id
       or exists (
         select 1
         from public.team_supervisors membership
         where membership.team_id = team.id
           and membership.supervisor_id = actor.id
       )
  ) scope;
$$;

revoke all on function public.supervised_team_ids() from public, anon;
grant execute on function public.supervised_team_ids() to authenticated;

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.assert_active_supervisors(p_supervisor_ids uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ids uuid[] := coalesce(
    (select array_agg(distinct id order by id) from unnest(coalesce(p_supervisor_ids, '{}'::uuid[])) id),
    '{}'::uuid[]
  );
  v_valid_count integer;
begin
  select count(*)::integer into v_valid_count
  from public.profiles profile
  where profile.id = any(v_ids)
    and profile.role = 'supervisor'::public.app_role
    and profile.active;

  if v_valid_count <> cardinality(v_ids) then
    raise exception 'Todos los responsables deben ser supervisores activos.';
  end if;
  return v_ids;
end;
$$;

create or replace function private.replace_team_supervisors(
  p_team_id uuid,
  p_supervisor_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ids uuid[];
begin
  if auth.uid() is null
     or public.current_role_name() is distinct from 'admin'::public.app_role
     or not coalesce(public.is_current_app_session_valid(), false) then
    raise exception 'Solo Administración puede cambiar supervisores de equipo.';
  end if;
  perform 1 from public.teams team where team.id = p_team_id for update;
  if not found then
    raise exception 'El equipo no existe.';
  end if;

  v_ids := private.assert_active_supervisors(p_supervisor_ids);

  delete from public.team_supervisors membership
  where membership.team_id = p_team_id
    and not (membership.supervisor_id = any(v_ids));

  insert into public.team_supervisors (team_id, supervisor_id, created_by)
  select p_team_id, supervisor_id, auth.uid()
  from unnest(v_ids) supervisor_id
  on conflict (team_id, supervisor_id) do nothing;

  update public.teams team
  set supervisor_id = (
    select membership.supervisor_id
    from public.team_supervisors membership
    where membership.team_id = team.id
    order by
      (membership.supervisor_id = team.supervisor_id) desc,
      membership.created_at,
      membership.supervisor_id
    limit 1
  )
  where team.id = p_team_id;

  return cardinality(v_ids);
end;
$$;

create or replace function private.replace_supervisor_teams(
  p_supervisor_id uuid,
  p_team_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_team_ids uuid[] := coalesce(
    (select array_agg(distinct id order by id) from unnest(coalesce(p_team_ids, '{}'::uuid[])) id),
    '{}'::uuid[]
  );
  v_profile public.profiles%rowtype;
  v_valid_count integer;
begin
  if auth.uid() is null
     or public.current_role_name() is distinct from 'admin'::public.app_role
     or not coalesce(public.is_current_app_session_valid(), false) then
    raise exception 'Solo Administración puede cambiar equipos supervisados.';
  end if;

  select * into v_profile from public.profiles where id = p_supervisor_id;
  if v_profile.id is null then raise exception 'El usuario no existe.'; end if;
  if cardinality(v_team_ids) > 0
     and (v_profile.role is distinct from 'supervisor'::public.app_role or not v_profile.active) then
    raise exception 'El usuario debe ser un supervisor activo.';
  end if;

  select count(*)::integer into v_valid_count
  from public.teams team where team.id = any(v_team_ids);
  if v_valid_count <> cardinality(v_team_ids) then
    raise exception 'Uno de los equipos seleccionados no existe.';
  end if;

  perform 1
  from public.teams team
  where team.id = any(v_team_ids)
     or exists (
       select 1 from public.team_supervisors membership
       where membership.team_id = team.id
         and membership.supervisor_id = p_supervisor_id
     )
  order by team.id
  for update;

  delete from public.team_supervisors membership
  where membership.supervisor_id = p_supervisor_id
    and not (membership.team_id = any(v_team_ids));

  insert into public.team_supervisors (team_id, supervisor_id, created_by)
  select team_id, p_supervisor_id, auth.uid()
  from unnest(v_team_ids) team_id
  on conflict (team_id, supervisor_id) do nothing;

  update public.teams team
  set supervisor_id = (
    select membership.supervisor_id
    from public.team_supervisors membership
    where membership.team_id = team.id
    order by
      (membership.supervisor_id = team.supervisor_id) desc,
      membership.created_at,
      membership.supervisor_id
    limit 1
  )
  where team.supervisor_id = p_supervisor_id
     or team.id = any(v_team_ids);

  return cardinality(v_team_ids);
end;
$$;

create or replace function private.set_user_role_and_team_scope(
  p_user_id uuid,
  p_role public.app_role,
  p_team_id uuid,
  p_supervised_team_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_team_ids uuid[] := case
    when p_role = 'supervisor'::public.app_role then coalesce(
      (select array_agg(distinct id order by id) from unnest(coalesce(p_supervised_team_ids, '{}'::uuid[])) id),
      '{}'::uuid[]
    )
    else '{}'::uuid[]
  end;
  v_valid_count integer;
begin
  if auth.uid() is null
     or public.current_role_name() is distinct from 'admin'::public.app_role
     or not coalesce(public.is_current_app_session_valid(), false) then
    raise exception 'Solo Administración puede cambiar roles y equipos.';
  end if;

  perform 1 from public.profiles profile where profile.id = p_user_id for update;
  if not found then raise exception 'El usuario no existe.'; end if;

  if p_role <> 'supervisor'::public.app_role and p_team_id is not null
     and not exists (select 1 from public.teams team where team.id = p_team_id) then
    raise exception 'El equipo seleccionado no existe.';
  end if;

  select count(*)::integer into v_valid_count
  from public.teams team where team.id = any(v_team_ids);
  if v_valid_count <> cardinality(v_team_ids) then
    raise exception 'Uno de los equipos supervisados no existe.';
  end if;

  perform 1
  from public.teams team
  where team.id = any(v_team_ids)
     or exists (
       select 1 from public.team_supervisors membership
       where membership.team_id = team.id
         and membership.supervisor_id = p_user_id
     )
  order by team.id
  for update;

  update public.profiles
  set role = p_role,
      team_id = case when p_role = 'supervisor'::public.app_role then null else p_team_id end
  where id = p_user_id;

  delete from public.team_supervisors membership
  where membership.supervisor_id = p_user_id
    and not (membership.team_id = any(v_team_ids));

  if p_role = 'supervisor'::public.app_role then
    insert into public.team_supervisors (team_id, supervisor_id, created_by)
    select team_id, p_user_id, auth.uid()
    from unnest(v_team_ids) team_id
    on conflict (team_id, supervisor_id) do nothing;
  end if;

  update public.teams team
  set supervisor_id = (
    select membership.supervisor_id
    from public.team_supervisors membership
    where membership.team_id = team.id
    order by
      (membership.supervisor_id = team.supervisor_id) desc,
      membership.created_at,
      membership.supervisor_id
    limit 1
  )
  where team.supervisor_id = p_user_id
     or team.id = any(v_team_ids);

  return jsonb_build_object(
    'user_id', p_user_id,
    'role', p_role,
    'team_id', case when p_role = 'supervisor'::public.app_role then null else p_team_id end,
    'supervised_team_ids', v_team_ids
  );
end;
$$;

create or replace function private.create_team_with_supervisors(
  p_name text,
  p_supervisor_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_team_id uuid;
  v_ids uuid[];
begin
  if auth.uid() is null
     or public.current_role_name() is distinct from 'admin'::public.app_role
     or not coalesce(public.is_current_app_session_valid(), false) then
    raise exception 'Solo Administración puede crear equipos.';
  end if;
  if nullif(btrim(p_name), '') is null then raise exception 'El nombre del equipo es obligatorio.'; end if;

  v_ids := private.assert_active_supervisors(p_supervisor_ids);
  insert into public.teams (name, supervisor_id)
  values (btrim(p_name), v_ids[1])
  returning id into v_team_id;

  insert into public.team_supervisors (team_id, supervisor_id, created_by)
  select v_team_id, supervisor_id, auth.uid()
  from unnest(v_ids) supervisor_id;
  return v_team_id;
end;
$$;

revoke all on function private.assert_active_supervisors(uuid[]) from public, anon;
revoke all on function private.replace_team_supervisors(uuid, uuid[]) from public, anon;
revoke all on function private.replace_supervisor_teams(uuid, uuid[]) from public, anon;
revoke all on function private.set_user_role_and_team_scope(uuid, public.app_role, uuid, uuid[]) from public, anon;
revoke all on function private.create_team_with_supervisors(text, uuid[]) from public, anon;
grant execute on function private.replace_team_supervisors(uuid, uuid[]) to authenticated;
grant execute on function private.replace_supervisor_teams(uuid, uuid[]) to authenticated;
grant execute on function private.set_user_role_and_team_scope(uuid, public.app_role, uuid, uuid[]) to authenticated;
grant execute on function private.create_team_with_supervisors(text, uuid[]) to authenticated;

create or replace function public.replace_team_supervisors(
  p_team_id uuid,
  p_supervisor_ids uuid[]
)
returns integer
language sql
security invoker
set search_path = pg_catalog
as $$ select private.replace_team_supervisors(p_team_id, p_supervisor_ids); $$;

create or replace function public.replace_supervisor_teams(
  p_supervisor_id uuid,
  p_team_ids uuid[]
)
returns integer
language sql
security invoker
set search_path = pg_catalog
as $$ select private.replace_supervisor_teams(p_supervisor_id, p_team_ids); $$;

create or replace function public.create_team_with_supervisors(
  p_name text,
  p_supervisor_ids uuid[]
)
returns uuid
language sql
security invoker
set search_path = pg_catalog
as $$ select private.create_team_with_supervisors(p_name, p_supervisor_ids); $$;

create or replace function public.set_user_role_and_team_scope(
  p_user_id uuid,
  p_role public.app_role,
  p_team_id uuid,
  p_supervised_team_ids uuid[]
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog
as $$
  select private.set_user_role_and_team_scope(
    p_user_id,
    p_role,
    p_team_id,
    p_supervised_team_ids
  );
$$;

revoke all on function public.replace_team_supervisors(uuid, uuid[]) from public, anon;
revoke all on function public.replace_supervisor_teams(uuid, uuid[]) from public, anon;
revoke all on function public.create_team_with_supervisors(text, uuid[]) from public, anon;
revoke all on function public.set_user_role_and_team_scope(uuid, public.app_role, uuid, uuid[]) from public, anon;
grant execute on function public.replace_team_supervisors(uuid, uuid[]) to authenticated;
grant execute on function public.replace_supervisor_teams(uuid, uuid[]) to authenticated;
grant execute on function public.create_team_with_supervisors(text, uuid[]) to authenticated;
grant execute on function public.set_user_role_and_team_scope(uuid, public.app_role, uuid, uuid[]) to authenticated;

-- La cola ya contiene las tres fuentes. Su nombre visible representa la unidad
-- operativa, no sólo el canal digital; las diferencias quedan dentro.
update public.contact_center_queues
set name = 'Secretaría Virtual',
    description = 'Unidad operativa omnicanal: voz saliente, Meta WhatsApp y correo.',
    updated_at = now()
where name = 'Secretaría Virtual · Atención Digital';

commit;
