-- Supabase concede EXECUTE a `anon` por defecto en cada función nueva del
-- esquema público, así que revocar a PUBLIC no alcanzó: las funciones de
-- organización quedaron llamables sin iniciar sesión por /rest/v1/rpc.
--
-- Ninguna responde algo útil sin sesión, pero confirman la existencia de ids y
-- no tienen por qué estar expuestas. El disparador de membresía además no debe
-- ser invocable por nadie: corre como disparador, no como RPC.

do $$
declare
  v_funcion text;
begin
  foreach v_funcion in array array[
    'public.is_platform_owner()',
    'public.current_org_ids()',
    'public.current_org_id()',
    'public.organization_id_by_slug(text)',
    'public.default_organization_id()',
    'public.org_of_lead(uuid)',
    'public.org_of_campaign(uuid)',
    'public.org_of_profile(uuid)',
    'public.org_of_team(uuid)',
    'public.org_of_workflow(uuid)',
    'public.org_of_whatsapp_conversation(uuid)',
    'public.org_of_call_recording(uuid)',
    'public.org_of_ai_loop_run(uuid)',
    'public.org_of_campaign_agent(uuid)'
  ] loop
    execute format('revoke execute on function %s from anon', v_funcion);
  end loop;

  execute 'revoke execute on function public.sync_profile_organization_membership() from anon, authenticated';
end
$$;

do $$
declare
  v_expuestas text;
begin
  select string_agg(p.proname, ', ')
  into v_expuestas
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'org\_of\_%' or p.proname in (
      'is_platform_owner', 'current_org_ids', 'current_org_id',
      'organization_id_by_slug', 'default_organization_id',
      'sync_profile_organization_membership'
    ))
    and has_function_privilege('anon', p.oid, 'execute');

  if v_expuestas is not null then
    raise exception 'Estas funciones siguen abiertas a visitantes: %', v_expuestas;
  end if;
end
$$;
