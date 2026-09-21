-- El dueño de la plataforma puede leer las conversaciones de WhatsApp.
--
-- La regla sigue siendo que Administración vigila metadatos y no abre la
-- conversación de un cliente: un admin de una empresa no lee mensajes. La
-- excepción es una sola persona, el dueño de la plataforma, que necesita ver
-- el producto completo para mostrarlo y para auditarlo. Leer no es atender:
-- responder sigue siendo del ejecutivo asignado (lo cuida la aplicación con
-- canOperateAssignedConversation, y esta migración no toca ninguna escritura).
--
-- La frontera de empresa no cambia: las políticas de aislamiento por empresa
-- siguen siendo restrictivas y el dueño ve la empresa que tiene elegida.

drop policy if exists whatsapp_messages_workspace_content on public.whatsapp_messages;
create policy whatsapp_messages_workspace_content on public.whatsapp_messages
  as restrictive
  for select to authenticated
  using (
    (select public.is_platform_owner())
    or (
      (select public.current_role_name()) = any (array['agente'::public.app_role, 'supervisor'::public.app_role])
      and exists (
        select 1
        from public.whatsapp_conversations conversation
        where conversation.id = whatsapp_messages.conversation_id
          and (
            (select public.current_role_name()) = 'supervisor'::public.app_role
            or conversation.assigned_to = (select auth.uid())
          )
      )
    )
  );

drop policy if exists whatsapp_events_workspace_content on public.whatsapp_conversation_events;
create policy whatsapp_events_workspace_content on public.whatsapp_conversation_events
  as restrictive
  for select to authenticated
  using (
    (select public.is_platform_owner())
    or (
      (select public.current_role_name()) = any (array['agente'::public.app_role, 'supervisor'::public.app_role])
      and exists (
        select 1
        from public.whatsapp_conversations conversation
        where conversation.id = whatsapp_conversation_events.conversation_id
          and (
            (select public.current_role_name()) = 'supervisor'::public.app_role
            or conversation.assigned_to = (select auth.uid())
          )
      )
    )
  );

-- El contexto del panel dice además si quien mira es el dueño: así el menú y
-- las pantallas lo saben sin otra consulta.
create or replace function public.contexto_de_mi_empresa()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with actual as (select public.current_org_id() as id)
  select jsonb_build_object(
    'edicion', coalesce(
      (select organization.edicion from public.organizations organization where organization.id = (select id from actual)),
      'center'
    ),
    'modulos', coalesce(
      (select jsonb_agg(modulo.module order by modulo.module)
       from public.organization_modules modulo
       where modulo.organization_id = (select id from actual) and modulo.enabled),
      '[]'::jsonb
    ),
    'empresas', coalesce(
      (select jsonb_agg(jsonb_build_object('id', organization.id, 'name', organization.name) order by organization.name)
       from public.organizations organization
       where organization.active
         and (public.is_platform_owner() or organization.id = any (public.current_org_ids()))),
      '[]'::jsonb
    ),
    'empresa', (select organization.name from public.organizations organization where organization.id = (select id from actual)),
    'duenio', public.is_platform_owner()
  );
$$;
