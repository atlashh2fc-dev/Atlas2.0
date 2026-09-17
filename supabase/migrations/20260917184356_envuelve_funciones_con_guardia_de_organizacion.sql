-- Guardia de empresa para las funciones que reciben el id de una campaña, un
-- lead o una conversación.
--
-- No se toca la lógica que ya funciona y tiene pruebas: la función original se
-- renombra con el sufijo `_sin_empresa`, se le quita el permiso a los clientes y
-- en su lugar queda una envoltura con la misma firma que primero comprueba a qué
-- empresa pertenece el dato y luego llama a la original.
--
-- Sin esto, un admin de Geimser podía pedir el informe de una campaña de Altius
-- pasando su id: la función se salta la seguridad por fila y respondía.

do $$
declare
  v_objetivo record;
  v_firma text;
  v_args_llamada text;
  v_resultado text;
  v_cuerpo text;
  v_guardia text;
  v_llamada text;
  v_objetivos text[][] := array[
    ['get_mail_engagement_queue', 'public.org_of_campaign(p_campaign_id)'],
    ['get_mail_engagement_page', 'public.org_of_campaign(p_campaign_id)'],
    ['get_mail_engagement_report', 'public.org_of_campaign(p_campaign_id)'],
    ['get_mail_engagement_report_read_model', 'public.org_of_campaign(p_campaign_id)'],
    ['get_mail_agent_control_summary', 'public.org_of_campaign(p_campaign_id)'],
    ['get_mail_agent_control_summary_read_model', 'public.org_of_campaign(p_campaign_id)'],
    ['get_mail_operational_bucket_summary', 'public.org_of_campaign(p_campaign_id)'],
    ['get_mail_operational_queue_page', 'public.org_of_campaign(p_campaign_id)'],
    ['get_contact_center_queue_control', 'public.org_of_campaign((select campaign_id from public.contact_center_queue_sources where queue_id = p_queue_id limit 1))'],
    ['take_over_whatsapp_conversation', 'public.org_of_whatsapp_conversation(p_conversation_id)'],
    ['enqueue_assigned_mail_reply', 'public.org_of_lead(p_lead_id)'],
    ['set_my_active_campaign', 'public.org_of_campaign(p_campaign_id)'],
    ['enter_agent_hybrid_manual_mode', 'public.org_of_campaign(p_campaign_id)'],
    ['begin_agent_agenda_callback', 'public.org_of_lead(p_lead_id)'],
    ['begin_agent_assigned_lead_call', 'public.org_of_lead(p_lead_id)'],
    ['assign_lead', 'public.org_of_lead(p_lead_id)'],
    ['convert_inbound_email_to_lead', 'public.org_of_lead((select lead_id from public.inbound_emails where id = p_email_id))'],
    ['complete_my_kovacs_demo_assignment', 'public.org_of_lead(p_lead_id)'],
    ['open_my_lead_orchestrator_assignment', 'public.org_of_lead(p_lead_id)'],
    ['can_manage_campaign', 'public.org_of_campaign(p_campaign_id)'],
    ['can_supervise_campaign', 'public.org_of_campaign(p_campaign_id)'],
    ['force_agent_logout', 'public.org_of_profile(p_target_profile_id)']
  ];
begin
  for i in 1 .. array_length(v_objetivos, 1) loop
    select p.oid,
           p.proname,
           p.proretset,
           pg_get_function_identity_arguments(p.oid) as args_firma,
           pg_get_function_result(p.oid) as resultado,
           (select string_agg(coalesce(nullif(p.proargnames[pos], ''), 'p' || pos), ', ' order by pos)
              from generate_series(1, coalesce(array_length(p.proargtypes, 1), 0)) pos) as args_llamada
      into v_objetivo
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = v_objetivos[i][1]
       and p.prosecdef
     limit 1;

    if v_objetivo.oid is null then
      raise exception 'No existe la función %', v_objetivos[i][1];
    end if;

    v_firma := v_objetivo.args_firma;
    v_args_llamada := coalesce(v_objetivo.args_llamada, '');
    v_resultado := v_objetivo.resultado;
    v_guardia := v_objetivos[i][2];

    execute format('alter function public.%I(%s) rename to %I', v_objetivo.proname, v_firma, v_objetivo.proname || '_sin_empresa');
    execute format('revoke execute on function public.%I(%s) from anon, authenticated', v_objetivo.proname || '_sin_empresa', v_firma);

    if v_objetivo.proretset then
      v_llamada := format('  return query select * from public.%I(%s);', v_objetivo.proname || '_sin_empresa', v_args_llamada);
    elsif lower(btrim(v_resultado)) = 'void' then
      v_llamada := format('  perform public.%I(%s);', v_objetivo.proname || '_sin_empresa', v_args_llamada);
    else
      v_llamada := format('  return public.%I(%s);', v_objetivo.proname || '_sin_empresa', v_args_llamada);
    end if;

    v_cuerpo := format(
      $plantilla$
create function public.%I(%s)
returns %s
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $envoltura$
begin
  perform public.assert_org_access(%s);
%s
end;
$envoltura$;
      $plantilla$,
      v_objetivo.proname, v_firma, v_resultado, v_guardia, v_llamada
    );

    execute v_cuerpo;
    execute format('revoke all on function public.%I(%s) from public', v_objetivo.proname, v_firma);
    execute format('revoke execute on function public.%I(%s) from anon', v_objetivo.proname, v_firma);
    execute format('grant execute on function public.%I(%s) to authenticated, service_role', v_objetivo.proname, v_firma);
  end loop;
end
$$;
