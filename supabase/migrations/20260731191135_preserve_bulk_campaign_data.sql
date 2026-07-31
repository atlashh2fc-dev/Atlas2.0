-- La carga masiva conserva las columnas originales en leads.extra. Antes
-- solo persistía el mapeo mínimo (nombre/RUT/teléfono/correo/estado), por lo
-- que el ejecutivo no podía usar la información operacional de la BBDD.
-- Los conflictos refrescan esos campos: reimportar el mismo archivo permite
-- completar registros históricos que fueron cargados con la versión anterior.
create or replace function public.bulk_insert_leads(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  rut_inserted int := 0;
  rut_refreshed int := 0;
  phone_inserted int := 0;
  phone_refreshed int := 0;
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
      v_user_id as created_by,
      case when jsonb_typeof(extra) = 'object' then extra else '{}'::jsonb end as extra
    from jsonb_to_recordset(payload) as r(
      full_name text, rut text, phone text, email text, status text,
      team_id uuid, workflow_id uuid, campaign_id uuid, created_by uuid, extra jsonb
    )
  ), affected as (
    insert into public.leads (
      full_name, rut, phone, email, status, team_id, workflow_id, campaign_id, created_by, extra
    )
    select full_name, rut, phone, email, status, team_id, workflow_id, campaign_id, created_by, extra
    from src
    where full_name is not null and rut is not null
      and status in ('nuevo', 'en_gestion', 'convertido', 'descartado')
    on conflict (
      (coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)),
      (upper(regexp_replace(rut, '[^0-9kK]', '', 'g')))
    ) where rut is not null and btrim(rut) <> ''
    do update set
      extra = coalesce(public.leads.extra, '{}'::jsonb) || coalesce(excluded.extra, '{}'::jsonb),
      updated_at = now()
    returning (xmax = 0) as was_inserted
  )
  select count(*) filter (where was_inserted), count(*) filter (where not was_inserted)
  into rut_inserted, rut_refreshed
  from affected;

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
      v_user_id as created_by,
      case when jsonb_typeof(extra) = 'object' then extra else '{}'::jsonb end as extra
    from jsonb_to_recordset(payload) as r(
      full_name text, rut text, phone text, email text, status text,
      team_id uuid, workflow_id uuid, campaign_id uuid, created_by uuid, extra jsonb
    )
  ), affected as (
    insert into public.leads (
      full_name, rut, phone, email, status, team_id, workflow_id, campaign_id, created_by, extra
    )
    select full_name, rut, phone, email, status, team_id, workflow_id, campaign_id, created_by, extra
    from src
    where full_name is not null and (rut is null or btrim(rut) = '') and phone is not null
      and status in ('nuevo', 'en_gestion', 'convertido', 'descartado')
    on conflict (
      (coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)),
      (regexp_replace(phone, '[^0-9]', '', 'g'))
    ) where rut is null and phone is not null and btrim(phone) <> ''
    do update set
      extra = coalesce(public.leads.extra, '{}'::jsonb) || coalesce(excluded.extra, '{}'::jsonb),
      updated_at = now()
    returning (xmax = 0) as was_inserted
  )
  select count(*) filter (where was_inserted), count(*) filter (where not was_inserted)
  into phone_inserted, phone_refreshed
  from affected;

  return jsonb_build_object(
    'inserted', rut_inserted + phone_inserted,
    'refreshed', rut_refreshed + phone_refreshed
  );
end;
$function$;

revoke all on function public.bulk_insert_leads(jsonb) from public, anon;
grant execute on function public.bulk_insert_leads(jsonb) to authenticated;
