-- El admin lee las conversaciones de su empresa.
--
-- Hasta hoy Administración solo veía metadatos: la ficha de un registro de
-- «Meta Ads · WhatsApp» decía «Sin actividad todavía» aunque el cliente había
-- conversado con la Secretaria. Hugo (15-10-2026): los admin tienen que poder
-- ver esa conversación. Leer no es atender: responder, tomar o cerrar sigue
-- siendo del ejecutivo (canAttendCustomers en la app).
--
-- Los mensajes ya eran legibles para el admin por la política permisiva de la
-- campaña; los eventos (derivaciones, agendas del bot) tenían una política
-- restrictiva que lo dejaba fuera. El aislamiento por empresa sigue intacto:
-- `whatsapp_conversation_events_organization_isolation` es restrictiva y no se
-- toca.

drop policy if exists whatsapp_events_workspace_content on public.whatsapp_conversation_events;
create policy whatsapp_events_workspace_content on public.whatsapp_conversation_events
  as restrictive
  for select to authenticated
  using (
    (select public.is_platform_owner())
    or (
      (select public.current_role_name()) = any (
        array['agente'::public.app_role, 'supervisor'::public.app_role, 'admin'::public.app_role]
      )
      and exists (
        select 1
        from public.whatsapp_conversations conversation
        where conversation.id = whatsapp_conversation_events.conversation_id
          and (
            (select public.current_role_name()) = any (array['supervisor'::public.app_role, 'admin'::public.app_role])
            or conversation.assigned_to = (select auth.uid())
          )
      )
    )
  );
