-- El correo de campaña lo ve quien vende.
--
-- `lead_mail_messages` y `mail_reply_commands` solo se dejaban leer por el
-- ejecutivo asignado al registro o por el supervisor de su equipo. Eso es
-- correcto en un call center, donde administración no lee conversaciones.
-- Pero una empresa sin call center (Altius) no tiene ejecutivos ni equipos:
-- quienes venden son administración y supervisión, y el correo que Atlas
-- Lead le mandó a cada lead quedaba guardado e invisible para todos.
--
-- Se suma una sola condición: en una empresa sin el módulo contact_center,
-- administración y supervisión leen el correo de sus registros. El dueño
-- de la plataforma lo lee siempre (solo lectura, como en Conversaciones).
-- En las empresas con call center la regla no cambia.

create or replace function public.lee_correo_de_campana(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select public.is_platform_owner()
      or (
        (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
        and not exists (
          select 1 from public.organization_modules modulo
           where modulo.organization_id = public.org_of_lead(p_lead_id)
             and modulo.module = 'contact_center'
             and modulo.enabled
        )
      );
$$;

revoke all on function public.lee_correo_de_campana(uuid) from public, anon;
grant execute on function public.lee_correo_de_campana(uuid) to authenticated, service_role;

drop policy if exists lead_mail_messages_venta_directa_select on public.lead_mail_messages;
create policy lead_mail_messages_venta_directa_select on public.lead_mail_messages
  for select to authenticated
  using (coalesce(public.is_current_app_session_valid(), false) and lead_id is not null and public.lee_correo_de_campana(lead_id));

drop policy if exists mail_reply_commands_venta_directa_select on public.mail_reply_commands;
create policy mail_reply_commands_venta_directa_select on public.mail_reply_commands
  for select to authenticated
  using (coalesce(public.is_current_app_session_valid(), false) and lead_id is not null and public.lee_correo_de_campana(lead_id));
