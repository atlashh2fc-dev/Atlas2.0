-- Multiempresa, paso 3: el aislamiento.
--
-- Las 164 políticas actuales no se tocan. Postgres permite políticas
-- RESTRICTIVAS, que se suman con AND a las permisivas que ya existen: quien hoy
-- ve un dato lo seguirá viendo solo si además pertenece a la empresa dueña. Así
-- el aislamiento entra sin reescribir el control de acceso por rol, que costó
-- caro afinar y tiene sus propias pruebas.
--
-- Cada tabla se ata a su empresa por donde ya cuelga: el lead, la campaña, la
-- conversación, el equipo, el flujo, la grabación o el perfil. Las funciones
-- `org_of_*` resuelven ese salto con una lectura por clave primaria y son
-- SECURITY DEFINER a propósito: si leyeran con la RLS del visitante, la política
-- se llamaría a sí misma.
--
-- Filas huérfanas (sin lead, sin campaña, sin conversación) quedan visibles como
-- hasta hoy. Esconderlas sería un cambio de comportamiento para la operación de
-- Geimser y no aporta aislamiento: Altius nace sin datos huérfanos.
--
-- Quedan fuera, a propósito, las tablas puramente técnicas de integración y
-- salud: `integration_inbox_items`, `integration_outbox_events`,
-- `integration_dead_letters`, `integration_entity_versions`,
-- `integration_circuit_states`, `integration_canary_runs`,
-- `integration_feedback_checkpoints`, `whatsapp_webhook_events` y
-- `dialer_operational_health`. Hoy alimentan el panel de integridad y no
-- contienen operación de otra empresa; cuando Altius empiece a mover eventos,
-- el paso 5 les agrega su propia columna.

create or replace function public.org_of_lead(p_lead_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select organization_id from public.leads where id = p_lead_id;
$$;

create or replace function public.org_of_campaign(p_campaign_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select organization_id from public.campaigns where id = p_campaign_id;
$$;

create or replace function public.org_of_profile(p_profile_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select organization_id from public.profiles where id = p_profile_id;
$$;

create or replace function public.org_of_team(p_team_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select organization_id from public.teams where id = p_team_id;
$$;

create or replace function public.org_of_workflow(p_workflow_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select organization_id from public.workflows where id = p_workflow_id;
$$;

create or replace function public.org_of_whatsapp_conversation(p_conversation_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select coalesce(
    public.org_of_lead(conversation.lead_id),
    public.org_of_campaign(conversation.campaign_id)
  )
  from public.whatsapp_conversations conversation
  where conversation.id = p_conversation_id;
$$;

create or replace function public.org_of_call_recording(p_recording_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select public.org_of_lead(recording.lead_id)
  from public.call_recordings recording
  where recording.id = p_recording_id;
$$;

create or replace function public.org_of_ai_loop_run(p_run_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select public.org_of_lead(run.lead_id)
  from public.ai_loop_runs run
  where run.id = p_run_id;
$$;

create or replace function public.org_of_campaign_agent(p_campaign_agent_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select public.org_of_campaign(campaign_agent.campaign_id)
  from public.campaign_agents campaign_agent
  where campaign_agent.id = p_campaign_agent_id;
$$;

do $$
declare
  v_funcion text;
begin
  foreach v_funcion in array array[
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
    execute format('revoke all on function %s from public', v_funcion);
    execute format('grant execute on function %s to authenticated, service_role', v_funcion);
  end loop;
end
$$;

drop policy if exists profiles_organization_isolation on public.profiles;
create policy profiles_organization_isolation
on public.profiles
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()));

drop policy if exists teams_organization_isolation on public.teams;
create policy teams_organization_isolation
on public.teams
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()));

drop policy if exists campaigns_organization_isolation on public.campaigns;
create policy campaigns_organization_isolation
on public.campaigns
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()));

drop policy if exists workflows_organization_isolation on public.workflows;
create policy workflows_organization_isolation
on public.workflows
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()));

drop policy if exists leads_organization_isolation on public.leads;
create policy leads_organization_isolation
on public.leads
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()));

drop policy if exists crm_entities_organization_isolation on public.crm_entities;
create policy crm_entities_organization_isolation
on public.crm_entities
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()));

drop policy if exists contact_center_queues_organization_isolation on public.contact_center_queues;
create policy contact_center_queues_organization_isolation
on public.contact_center_queues
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()));

drop policy if exists whatsapp_channels_organization_isolation on public.whatsapp_channels;
create policy whatsapp_channels_organization_isolation
on public.whatsapp_channels
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()));

drop policy if exists historical_agents_organization_isolation on public.historical_agents;
create policy historical_agents_organization_isolation
on public.historical_agents
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()));

drop policy if exists agent_status_reasons_organization_isolation on public.agent_status_reasons;
create policy agent_status_reasons_organization_isolation
on public.agent_status_reasons
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()));

drop policy if exists integration_sources_organization_isolation on public.integration_sources;
create policy integration_sources_organization_isolation
on public.integration_sources
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()));

drop policy if exists vocalcom_import_batches_organization_isolation on public.vocalcom_import_batches;
create policy vocalcom_import_batches_organization_isolation
on public.vocalcom_import_batches
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()));

drop policy if exists staging_carga_tipificaciones_organization_isolation on public.staging_carga_tipificaciones;
create policy staging_carga_tipificaciones_organization_isolation
on public.staging_carga_tipificaciones
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()));

drop policy if exists staging_historial_gestiones_organization_isolation on public.staging_historial_gestiones;
create policy staging_historial_gestiones_organization_isolation
on public.staging_historial_gestiones
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()));

drop policy if exists staging_snapshots_equifax_organization_isolation on public.staging_snapshots_equifax;
create policy staging_snapshots_equifax_organization_isolation
on public.staging_snapshots_equifax
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or organization_id = any (public.current_org_ids()));

drop policy if exists ai_loop_runs_organization_isolation on public.ai_loop_runs;
create policy ai_loop_runs_organization_isolation
on public.ai_loop_runs
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists call_events_organization_isolation on public.call_events;
create policy call_events_organization_isolation
on public.call_events
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists call_recordings_organization_isolation on public.call_recordings;
create policy call_recordings_organization_isolation
on public.call_recordings
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists calls_organization_isolation on public.calls;
create policy calls_organization_isolation
on public.calls
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists crm_audit_events_organization_isolation on public.crm_audit_events;
create policy crm_audit_events_organization_isolation
on public.crm_audit_events
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists dial_attempts_organization_isolation on public.dial_attempts;
create policy dial_attempts_organization_isolation
on public.dial_attempts
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists external_lead_events_organization_isolation on public.external_lead_events;
create policy external_lead_events_organization_isolation
on public.external_lead_events
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists inbound_emails_organization_isolation on public.inbound_emails;
create policy inbound_emails_organization_isolation
on public.inbound_emails
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists interactions_organization_isolation on public.interactions;
create policy interactions_organization_isolation
on public.interactions
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists lead_assignments_organization_isolation on public.lead_assignments;
create policy lead_assignments_organization_isolation
on public.lead_assignments
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists lead_contacts_organization_isolation on public.lead_contacts;
create policy lead_contacts_organization_isolation
on public.lead_contacts
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists lead_external_refs_organization_isolation on public.lead_external_refs;
create policy lead_external_refs_organization_isolation
on public.lead_external_refs
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists lead_mail_messages_organization_isolation on public.lead_mail_messages;
create policy lead_mail_messages_organization_isolation
on public.lead_mail_messages
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists lead_mail_status_organization_isolation on public.lead_mail_status;
create policy lead_mail_status_organization_isolation
on public.lead_mail_status
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists lead_orchestrator_assignments_organization_isolation on public.lead_orchestrator_assignments;
create policy lead_orchestrator_assignments_organization_isolation
on public.lead_orchestrator_assignments
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists mail_campaign_base_recipients_organization_isolation on public.mail_campaign_base_recipients;
create policy mail_campaign_base_recipients_organization_isolation
on public.mail_campaign_base_recipients
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists mail_campaign_lead_status_organization_isolation on public.mail_campaign_lead_status;
create policy mail_campaign_lead_status_organization_isolation
on public.mail_campaign_lead_status
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists mail_reply_commands_organization_isolation on public.mail_reply_commands;
create policy mail_reply_commands_organization_isolation
on public.mail_reply_commands
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists mail_result_contacts_organization_isolation on public.mail_result_contacts;
create policy mail_result_contacts_organization_isolation
on public.mail_result_contacts
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists prever_survey_results_organization_isolation on public.prever_survey_results;
create policy prever_survey_results_organization_isolation
on public.prever_survey_results
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists vocalcom_call_events_organization_isolation on public.vocalcom_call_events;
create policy vocalcom_call_events_organization_isolation
on public.vocalcom_call_events
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists whatsapp_conversations_organization_isolation on public.whatsapp_conversations;
create policy whatsapp_conversations_organization_isolation
on public.whatsapp_conversations
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or lead_id is null
    or public.org_of_lead(lead_id) = any (public.current_org_ids()));

drop policy if exists agent_active_campaigns_organization_isolation on public.agent_active_campaigns;
create policy agent_active_campaigns_organization_isolation
on public.agent_active_campaigns
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists agent_hybrid_manual_requests_organization_isolation on public.agent_hybrid_manual_requests;
create policy agent_hybrid_manual_requests_organization_isolation
on public.agent_hybrid_manual_requests
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists ai_loop_campaign_configs_organization_isolation on public.ai_loop_campaign_configs;
create policy ai_loop_campaign_configs_organization_isolation
on public.ai_loop_campaign_configs
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists ai_voice_campaign_configs_organization_isolation on public.ai_voice_campaign_configs;
create policy ai_voice_campaign_configs_organization_isolation
on public.ai_voice_campaign_configs
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists ai_voice_test_calls_organization_isolation on public.ai_voice_test_calls;
create policy ai_voice_test_calls_organization_isolation
on public.ai_voice_test_calls
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists campaign_agents_organization_isolation on public.campaign_agents;
create policy campaign_agents_organization_isolation
on public.campaign_agents
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists campaign_channels_organization_isolation on public.campaign_channels;
create policy campaign_channels_organization_isolation
on public.campaign_channels
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists contact_center_queue_sources_organization_isolation on public.contact_center_queue_sources;
create policy contact_center_queue_sources_organization_isolation
on public.contact_center_queue_sources
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists dialer_agent_sessions_organization_isolation on public.dialer_agent_sessions;
create policy dialer_agent_sessions_organization_isolation
on public.dialer_agent_sessions
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists dialer_agent_sessions_history_organization_isolation on public.dialer_agent_sessions_history;
create policy dialer_agent_sessions_history_organization_isolation
on public.dialer_agent_sessions_history
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists dialer_campaign_configs_organization_isolation on public.dialer_campaign_configs;
create policy dialer_campaign_configs_organization_isolation
on public.dialer_campaign_configs
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists external_import_batches_organization_isolation on public.external_import_batches;
create policy external_import_batches_organization_isolation
on public.external_import_batches
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists inbound_mailboxes_organization_isolation on public.inbound_mailboxes;
create policy inbound_mailboxes_organization_isolation
on public.inbound_mailboxes
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists integration_campaign_mappings_organization_isolation on public.integration_campaign_mappings;
create policy integration_campaign_mappings_organization_isolation
on public.integration_campaign_mappings
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists integration_inbox_batches_organization_isolation on public.integration_inbox_batches;
create policy integration_inbox_batches_organization_isolation
on public.integration_inbox_batches
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists lead_orchestrator_configs_organization_isolation on public.lead_orchestrator_configs;
create policy lead_orchestrator_configs_organization_isolation
on public.lead_orchestrator_configs
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists lead_priority_rules_organization_isolation on public.lead_priority_rules;
create policy lead_priority_rules_organization_isolation
on public.lead_priority_rules
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists lead_uploads_organization_isolation on public.lead_uploads;
create policy lead_uploads_organization_isolation
on public.lead_uploads
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists mail_campaign_bases_organization_isolation on public.mail_campaign_bases;
create policy mail_campaign_bases_organization_isolation
on public.mail_campaign_bases
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists mail_campaigns_organization_isolation on public.mail_campaigns;
create policy mail_campaigns_organization_isolation
on public.mail_campaigns
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists mail_result_batches_organization_isolation on public.mail_result_batches;
create policy mail_result_batches_organization_isolation
on public.mail_result_batches
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists whatsapp_ai_configs_organization_isolation on public.whatsapp_ai_configs;
create policy whatsapp_ai_configs_organization_isolation
on public.whatsapp_ai_configs
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists whatsapp_automation_changes_organization_isolation on public.whatsapp_automation_changes;
create policy whatsapp_automation_changes_organization_isolation
on public.whatsapp_automation_changes
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists whatsapp_campaign_routes_organization_isolation on public.whatsapp_campaign_routes;
create policy whatsapp_campaign_routes_organization_isolation
on public.whatsapp_campaign_routes
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists whatsapp_closure_reasons_organization_isolation on public.whatsapp_closure_reasons;
create policy whatsapp_closure_reasons_organization_isolation
on public.whatsapp_closure_reasons
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_id is null
    or public.org_of_campaign(campaign_id) = any (public.current_org_ids()));

drop policy if exists whatsapp_ai_runs_organization_isolation on public.whatsapp_ai_runs;
create policy whatsapp_ai_runs_organization_isolation
on public.whatsapp_ai_runs
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or conversation_id is null
    or public.org_of_whatsapp_conversation(conversation_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or conversation_id is null
    or public.org_of_whatsapp_conversation(conversation_id) = any (public.current_org_ids()));

drop policy if exists whatsapp_conversation_events_organization_isolation on public.whatsapp_conversation_events;
create policy whatsapp_conversation_events_organization_isolation
on public.whatsapp_conversation_events
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or conversation_id is null
    or public.org_of_whatsapp_conversation(conversation_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or conversation_id is null
    or public.org_of_whatsapp_conversation(conversation_id) = any (public.current_org_ids()));

drop policy if exists whatsapp_conversation_memories_organization_isolation on public.whatsapp_conversation_memories;
create policy whatsapp_conversation_memories_organization_isolation
on public.whatsapp_conversation_memories
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or conversation_id is null
    or public.org_of_whatsapp_conversation(conversation_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or conversation_id is null
    or public.org_of_whatsapp_conversation(conversation_id) = any (public.current_org_ids()));

drop policy if exists whatsapp_conversation_memory_sources_organization_isolation on public.whatsapp_conversation_memory_sources;
create policy whatsapp_conversation_memory_sources_organization_isolation
on public.whatsapp_conversation_memory_sources
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or conversation_id is null
    or public.org_of_whatsapp_conversation(conversation_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or conversation_id is null
    or public.org_of_whatsapp_conversation(conversation_id) = any (public.current_org_ids()));

drop policy if exists whatsapp_media_uploads_organization_isolation on public.whatsapp_media_uploads;
create policy whatsapp_media_uploads_organization_isolation
on public.whatsapp_media_uploads
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or conversation_id is null
    or public.org_of_whatsapp_conversation(conversation_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or conversation_id is null
    or public.org_of_whatsapp_conversation(conversation_id) = any (public.current_org_ids()));

drop policy if exists whatsapp_messages_organization_isolation on public.whatsapp_messages;
create policy whatsapp_messages_organization_isolation
on public.whatsapp_messages
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or conversation_id is null
    or public.org_of_whatsapp_conversation(conversation_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or conversation_id is null
    or public.org_of_whatsapp_conversation(conversation_id) = any (public.current_org_ids()));

drop policy if exists agent_current_status_organization_isolation on public.agent_current_status;
create policy agent_current_status_organization_isolation
on public.agent_current_status
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or profile_id is null
    or public.org_of_profile(profile_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or profile_id is null
    or public.org_of_profile(profile_id) = any (public.current_org_ids()));

drop policy if exists agent_current_status_history_organization_isolation on public.agent_current_status_history;
create policy agent_current_status_history_organization_isolation
on public.agent_current_status_history
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or profile_id is null
    or public.org_of_profile(profile_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or profile_id is null
    or public.org_of_profile(profile_id) = any (public.current_org_ids()));

drop policy if exists agent_sip_credentials_organization_isolation on public.agent_sip_credentials;
create policy agent_sip_credentials_organization_isolation
on public.agent_sip_credentials
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or profile_id is null
    or public.org_of_profile(profile_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or profile_id is null
    or public.org_of_profile(profile_id) = any (public.current_org_ids()));

drop policy if exists agent_sip_provisioning_status_organization_isolation on public.agent_sip_provisioning_status;
create policy agent_sip_provisioning_status_organization_isolation
on public.agent_sip_provisioning_status
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or profile_id is null
    or public.org_of_profile(profile_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or profile_id is null
    or public.org_of_profile(profile_id) = any (public.current_org_ids()));

drop policy if exists contact_center_queue_members_organization_isolation on public.contact_center_queue_members;
create policy contact_center_queue_members_organization_isolation
on public.contact_center_queue_members
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or profile_id is null
    or public.org_of_profile(profile_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or profile_id is null
    or public.org_of_profile(profile_id) = any (public.current_org_ids()));

drop policy if exists revoked_app_sessions_organization_isolation on public.revoked_app_sessions;
create policy revoked_app_sessions_organization_isolation
on public.revoked_app_sessions
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or profile_id is null
    or public.org_of_profile(profile_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or profile_id is null
    or public.org_of_profile(profile_id) = any (public.current_org_ids()));

drop policy if exists user_saved_views_organization_isolation on public.user_saved_views;
create policy user_saved_views_organization_isolation
on public.user_saved_views
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or profile_id is null
    or public.org_of_profile(profile_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or profile_id is null
    or public.org_of_profile(profile_id) = any (public.current_org_ids()));

drop policy if exists user_view_preferences_organization_isolation on public.user_view_preferences;
create policy user_view_preferences_organization_isolation
on public.user_view_preferences
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or profile_id is null
    or public.org_of_profile(profile_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or profile_id is null
    or public.org_of_profile(profile_id) = any (public.current_org_ids()));

drop policy if exists agent_control_commands_organization_isolation on public.agent_control_commands;
create policy agent_control_commands_organization_isolation
on public.agent_control_commands
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or target_profile_id is null
    or public.org_of_profile(target_profile_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or target_profile_id is null
    or public.org_of_profile(target_profile_id) = any (public.current_org_ids()));

drop policy if exists sensitive_access_log_organization_isolation on public.sensitive_access_log;
create policy sensitive_access_log_organization_isolation
on public.sensitive_access_log
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or target_profile_id is null
    or public.org_of_profile(target_profile_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or target_profile_id is null
    or public.org_of_profile(target_profile_id) = any (public.current_org_ids()));

drop policy if exists supervisor_report_daily_agent_metrics_organization_isolation on public.supervisor_report_daily_agent_metrics;
create policy supervisor_report_daily_agent_metrics_organization_isolation
on public.supervisor_report_daily_agent_metrics
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or team_id is null
    or public.org_of_team(team_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or team_id is null
    or public.org_of_team(team_id) = any (public.current_org_ids()));

drop policy if exists supervisor_report_daily_agent_tipifications_organization_isolation on public.supervisor_report_daily_agent_tipifications;
create policy supervisor_report_daily_agent_tipifications_organization_isolation
on public.supervisor_report_daily_agent_tipifications
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or team_id is null
    or public.org_of_team(team_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or team_id is null
    or public.org_of_team(team_id) = any (public.current_org_ids()));

drop policy if exists supervisor_report_daily_metrics_organization_isolation on public.supervisor_report_daily_metrics;
create policy supervisor_report_daily_metrics_organization_isolation
on public.supervisor_report_daily_metrics
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or team_id is null
    or public.org_of_team(team_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or team_id is null
    or public.org_of_team(team_id) = any (public.current_org_ids()));

drop policy if exists supervisor_report_daily_tipifications_organization_isolation on public.supervisor_report_daily_tipifications;
create policy supervisor_report_daily_tipifications_organization_isolation
on public.supervisor_report_daily_tipifications
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or team_id is null
    or public.org_of_team(team_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or team_id is null
    or public.org_of_team(team_id) = any (public.current_org_ids()));

drop policy if exists team_supervisors_organization_isolation on public.team_supervisors;
create policy team_supervisors_organization_isolation
on public.team_supervisors
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or team_id is null
    or public.org_of_team(team_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or team_id is null
    or public.org_of_team(team_id) = any (public.current_org_ids()));

drop policy if exists workflow_steps_organization_isolation on public.workflow_steps;
create policy workflow_steps_organization_isolation
on public.workflow_steps
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or workflow_id is null
    or public.org_of_workflow(workflow_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or workflow_id is null
    or public.org_of_workflow(workflow_id) = any (public.current_org_ids()));

drop policy if exists workflow_step_branches_organization_isolation on public.workflow_step_branches;
create policy workflow_step_branches_organization_isolation
on public.workflow_step_branches
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or workflow_id is null
    or public.org_of_workflow(workflow_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or workflow_id is null
    or public.org_of_workflow(workflow_id) = any (public.current_org_ids()));

drop policy if exists legacy_tipificacion_map_organization_isolation on public.legacy_tipificacion_map;
create policy legacy_tipificacion_map_organization_isolation
on public.legacy_tipificacion_map
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or workflow_id is null
    or public.org_of_workflow(workflow_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or workflow_id is null
    or public.org_of_workflow(workflow_id) = any (public.current_org_ids()));

drop policy if exists call_transcriptions_organization_isolation on public.call_transcriptions;
create policy call_transcriptions_organization_isolation
on public.call_transcriptions
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or recording_id is null
    or public.org_of_call_recording(recording_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or recording_id is null
    or public.org_of_call_recording(recording_id) = any (public.current_org_ids()));

drop policy if exists call_quality_evaluations_organization_isolation on public.call_quality_evaluations;
create policy call_quality_evaluations_organization_isolation
on public.call_quality_evaluations
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or recording_id is null
    or public.org_of_call_recording(recording_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or recording_id is null
    or public.org_of_call_recording(recording_id) = any (public.current_org_ids()));

drop policy if exists call_recording_access_logs_organization_isolation on public.call_recording_access_logs;
create policy call_recording_access_logs_organization_isolation
on public.call_recording_access_logs
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or recording_id is null
    or public.org_of_call_recording(recording_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or recording_id is null
    or public.org_of_call_recording(recording_id) = any (public.current_org_ids()));

drop policy if exists ai_loop_feedback_organization_isolation on public.ai_loop_feedback;
create policy ai_loop_feedback_organization_isolation
on public.ai_loop_feedback
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or run_id is null
    or public.org_of_ai_loop_run(run_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or run_id is null
    or public.org_of_ai_loop_run(run_id) = any (public.current_org_ids()));

drop policy if exists ai_loop_memory_organization_isolation on public.ai_loop_memory;
create policy ai_loop_memory_organization_isolation
on public.ai_loop_memory
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or run_id is null
    or public.org_of_ai_loop_run(run_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or run_id is null
    or public.org_of_ai_loop_run(run_id) = any (public.current_org_ids()));

drop policy if exists campaign_agent_schedules_organization_isolation on public.campaign_agent_schedules;
create policy campaign_agent_schedules_organization_isolation
on public.campaign_agent_schedules
as restrictive
for all
to authenticated
using (public.is_platform_owner()
    or campaign_agent_id is null
    or public.org_of_campaign_agent(campaign_agent_id) = any (public.current_org_ids()))
with check (public.is_platform_owner()
    or campaign_agent_id is null
    or public.org_of_campaign_agent(campaign_agent_id) = any (public.current_org_ids()));

