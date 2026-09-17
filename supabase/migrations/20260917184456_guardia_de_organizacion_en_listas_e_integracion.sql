-- Segunda tanda de guardias: funciones que reciben listas de leads, ids de
-- integración o combinaciones de campaña y equipo.
--
-- Para las listas no basta mirar el primer elemento: la guardia exige que
-- **todos** los leads pertenezcan a una empresa del visitante.

create or replace function public.assert_org_access_de_leads(p_lead_ids uuid[])
returns void
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_ajenos integer;
begin
  if p_lead_ids is null or array_length(p_lead_ids, 1) is null then
    return;
  end if;

  select count(*)
    into v_ajenos
    from unnest(p_lead_ids) as id
   where not public.can_access_org(public.org_of_lead(id));

  if v_ajenos > 0 then
    raise exception 'La lista incluye % dato(s) de otra empresa', v_ajenos
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.assert_org_access_de_leads(uuid[]) from public;
revoke execute on function public.assert_org_access_de_leads(uuid[]) from anon;
grant execute on function public.assert_org_access_de_leads(uuid[]) to authenticated, service_role;

do $$
declare
  v_objetivo record;
  v_firma text;
  v_args_llamada text;
  v_resultado text;
  v_llamada text;
  v_objetivos text[][] := array[
    ['release_callbacks_to_pool', 'public.assert_org_access_de_leads(p_lead_ids)'],
    ['reschedule_callbacks', 'public.assert_org_access_de_leads(p_lead_ids)'],
    ['assign_mail_engagement_opportunities', 'public.assert_org_access_de_leads(p_lead_ids)'],
    ['create_manual_lead_record', 'public.assert_org_access(coalesce(public.org_of_campaign(p_campaign_id), public.org_of_team(p_team_id), public.current_org_id()))'],
    ['can_supervise_mail_lead', 'public.assert_org_access(coalesce(public.org_of_campaign(p_campaign_id), public.org_of_team(p_team_id)))'],
    ['management_requires_equifax_data', 'public.assert_org_access(coalesce(public.org_of_campaign(p_campaign_id), public.org_of_workflow(p_workflow_id)))'],
    ['lead_agenda_requirement', 'public.assert_org_access(public.org_of_lead(p_lead_id))'],
    ['has_active_dial_attempt', 'public.assert_org_access(public.org_of_lead(p_lead_id))'],
    ['upsert_external_leads', 'public.assert_org_access(public.org_of_campaign(p_campaign_id))'],
    ['apply_mail_result_batch', 'public.assert_org_access(public.org_of_campaign(p_campaign_id))'],
    ['map_atlas_lead_mail_campaign', 'public.assert_org_access(public.org_of_campaign(p_campaign_id))'],
    ['confirm_atlas_lead_mail_campaign_handshake', 'public.assert_org_access(public.org_of_campaign(p_campaign_id))']
  ];
begin
  for i in 1 .. array_length(v_objetivos, 1) loop
    select p.oid, p.proname, p.proretset,
           pg_get_function_identity_arguments(p.oid) as args_firma,
           pg_get_function_result(p.oid) as resultado,
           (select string_agg(coalesce(nullif(p.proargnames[pos], ''), 'p' || pos), ', ' order by pos)
              from generate_series(1, coalesce(array_length(p.proargtypes, 1), 0)) pos) as args_llamada
      into v_objetivo
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_objetivos[i][1] and p.prosecdef
     limit 1;

    if v_objetivo.oid is null then
      raise exception 'No existe la función %', v_objetivos[i][1];
    end if;

    v_firma := v_objetivo.args_firma;
    v_args_llamada := coalesce(v_objetivo.args_llamada, '');
    v_resultado := v_objetivo.resultado;

    execute format('alter function public.%I(%s) rename to %I', v_objetivo.proname, v_firma, v_objetivo.proname || '_sin_empresa');
    execute format('revoke execute on function public.%I(%s) from anon, authenticated', v_objetivo.proname || '_sin_empresa', v_firma);

    if v_objetivo.proretset then
      v_llamada := format('  return query select * from public.%I(%s);', v_objetivo.proname || '_sin_empresa', v_args_llamada);
    elsif lower(btrim(v_resultado)) = 'void' then
      v_llamada := format('  perform public.%I(%s);', v_objetivo.proname || '_sin_empresa', v_args_llamada);
    else
      v_llamada := format('  return public.%I(%s);', v_objetivo.proname || '_sin_empresa', v_args_llamada);
    end if;

    execute format(
      $plantilla$
create function public.%I(%s)
returns %s
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $envoltura$
begin
  perform %s;
%s
end;
$envoltura$;
      $plantilla$,
      v_objetivo.proname, v_firma, v_resultado, v_objetivos[i][2], v_llamada
    );

    execute format('revoke all on function public.%I(%s) from public', v_objetivo.proname, v_firma);
    execute format('revoke execute on function public.%I(%s) from anon', v_objetivo.proname, v_firma);
    execute format('grant execute on function public.%I(%s) to authenticated, service_role', v_objetivo.proname, v_firma);
  end loop;
end
$$;
