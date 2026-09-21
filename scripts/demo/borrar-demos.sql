-- Borra las empresas de demostración (slug demo-center, demo-dental, demo-vet)
-- y su equipo ficticio. No toca nada fuera de ellas: todo se ubica por la
-- empresa o por los registros de la empresa.
--
-- Correr como una sola transacción. Después se puede volver a sembrar con
-- sembrar-demos.sql.

do $$
declare
  v_orgs uuid[];
  v_personas uuid[];
  v_campanas uuid[];
  v_leads uuid[];
begin
  select array_agg(id) into v_orgs from public.organizations where slug in ('demo-center', 'demo-dental', 'demo-vet');
  if v_orgs is null then
    raise notice 'No hay empresas demo que borrar';
    return;
  end if;

  select array_agg(id) into v_personas from public.profiles where organization_id = any (v_orgs);
  select array_agg(id) into v_campanas from public.campaigns where organization_id = any (v_orgs);
  select array_agg(id) into v_leads from public.leads where organization_id = any (v_orgs);

  delete from public.sales_activities where organization_id = any (v_orgs);
  delete from public.sales_opportunity_items where organization_id = any (v_orgs);
  delete from public.sales_opportunities where organization_id = any (v_orgs);
  delete from public.sales_contacts where organization_id = any (v_orgs);
  delete from public.sales_companies where organization_id = any (v_orgs);
  delete from public.sales_products where organization_id = any (v_orgs);
  delete from public.sales_stages where organization_id = any (v_orgs);

  delete from public.whatsapp_messages where conversation_id in
    (select id from public.whatsapp_conversations where campaign_id = any (v_campanas));
  delete from public.whatsapp_conversation_events where conversation_id in
    (select id from public.whatsapp_conversations where campaign_id = any (v_campanas));
  delete from public.whatsapp_conversations where campaign_id = any (v_campanas);
  delete from public.whatsapp_closure_reasons where campaign_id = any (v_campanas);
  delete from public.whatsapp_channels where organization_id = any (v_orgs);

  delete from public.interactions where lead_id = any (v_leads);
  delete from public.calls where lead_id = any (v_leads);
  delete from public.leads where id = any (v_leads);

  delete from public.agent_current_status where profile_id = any (v_personas);
  delete from public.campaign_agents where campaign_id = any (v_campanas);
  delete from public.campaign_channels where campaign_id = any (v_campanas);
  delete from public.contact_center_queue_members where profile_id = any (v_personas);
  delete from public.campaigns where id = any (v_campanas);

  delete from public.team_supervisors where team_id in (select id from public.teams where organization_id = any (v_orgs));
  update public.profiles set team_id = null where id = any (v_personas);
  delete from public.teams where organization_id = any (v_orgs);
  delete from public.organization_members where organization_id = any (v_orgs);
  delete from public.profiles where id = any (v_personas);
  delete from auth.users where id = any (v_personas) and email like '%.invalid';

  delete from public.organization_modules where organization_id = any (v_orgs);
  delete from public.organizations where id = any (v_orgs);
end;
$$;
