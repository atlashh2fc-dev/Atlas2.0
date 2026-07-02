-- Hardening for role freshness and supervisor bulk upload scope.
-- The base schema already exists in the remote Atlas project; this migration
-- only changes the contracts needed by the current app.

create or replace function public.current_role_name()
returns public.app_role
language sql
stable
security definer
set search_path to 'public'
as $function$
  select role
  from public.profiles
  where id = (select auth.uid())
    and active = true;
$function$;

create or replace function public.current_team_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select team_id
  from public.profiles
  where id = (select auth.uid())
    and active = true;
$function$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.app_role := 'agente';
begin
  if new.raw_app_meta_data ? 'role'
     and (new.raw_app_meta_data->>'role') in ('agente', 'supervisor', 'admin') then
    v_role := (new.raw_app_meta_data->>'role')::public.app_role;
  end if;

  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), new.email),
    new.email,
    v_role
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
    updated_at = now();

  return new;
end;
$function$;

create or replace function public.bulk_insert_leads(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  rut_inserted int := 0;
  phone_inserted int := 0;
  v_role public.app_role := public.current_role_name();
  v_user_id uuid := (select auth.uid());
  v_team_id uuid := public.current_team_id();
begin
  if v_user_id is null or v_role is null then
    raise exception 'No autenticado.';
  end if;

  if v_role not in ('admin', 'supervisor') then
    raise exception 'No tienes permisos para cargar leads.';
  end if;

  if v_role = 'supervisor' and v_team_id is null then
    raise exception 'Tu supervisor no tiene equipo asignado.';
  end if;

  with src as (
    select
      nullif(btrim(full_name), '') as full_name,
      nullif(btrim(rut), '') as rut,
      nullif(btrim(phone), '') as phone,
      nullif(btrim(email), '') as email,
      coalesce(nullif(btrim(status), ''), 'nuevo') as status,
      case when v_role = 'supervisor' then v_team_id else team_id end as team_id,
      workflow_id,
      campaign_id,
      v_user_id as created_by
    from jsonb_to_recordset(payload) as r(
      full_name text,
      rut text,
      phone text,
      email text,
      status text,
      team_id uuid,
      workflow_id uuid,
      campaign_id uuid,
      created_by uuid
    )
  )
  insert into leads (full_name, rut, phone, email, status, team_id, workflow_id, campaign_id, created_by)
  select full_name, rut, phone, email, status, team_id, workflow_id, campaign_id, created_by
  from src
  where full_name is not null
    and rut is not null
    and status in ('nuevo', 'en_gestion', 'convertido', 'descartado')
  on conflict (
    (coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (upper(regexp_replace(rut, '[^0-9kK]', '', 'g')))
  ) where rut is not null and btrim(rut) <> ''
  do nothing;
  get diagnostics rut_inserted = row_count;

  with src as (
    select
      nullif(btrim(full_name), '') as full_name,
      nullif(btrim(rut), '') as rut,
      nullif(btrim(phone), '') as phone,
      nullif(btrim(email), '') as email,
      coalesce(nullif(btrim(status), ''), 'nuevo') as status,
      case when v_role = 'supervisor' then v_team_id else team_id end as team_id,
      workflow_id,
      campaign_id,
      v_user_id as created_by
    from jsonb_to_recordset(payload) as r(
      full_name text,
      rut text,
      phone text,
      email text,
      status text,
      team_id uuid,
      workflow_id uuid,
      campaign_id uuid,
      created_by uuid
    )
  )
  insert into leads (full_name, rut, phone, email, status, team_id, workflow_id, campaign_id, created_by)
  select full_name, rut, phone, email, status, team_id, workflow_id, campaign_id, created_by
  from src
  where full_name is not null
    and (rut is null or btrim(rut) = '')
    and phone is not null
    and status in ('nuevo', 'en_gestion', 'convertido', 'descartado')
  on conflict (
    (coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (regexp_replace(phone, '[^0-9]', '', 'g'))
  ) where rut is null and phone is not null and btrim(phone) <> ''
  do nothing;
  get diagnostics phone_inserted = row_count;

  return jsonb_build_object('inserted', rut_inserted + phone_inserted);
end;
$function$;

revoke all on function public.bulk_insert_leads(jsonb) from public, anon;
grant execute on function public.bulk_insert_leads(jsonb) to authenticated;

revoke all on function public.current_role_name() from public, anon;
grant execute on function public.current_role_name() to authenticated;

revoke all on function public.current_team_id() from public, anon;
grant execute on function public.current_team_id() to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
