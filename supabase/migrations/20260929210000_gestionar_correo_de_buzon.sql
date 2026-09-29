-- Supervisión gestiona la cola del buzón de envío (Correo › Buzón): asigna o
-- reasigna una respuesta, la liga a un registro por RUT cuando llegó de una
-- dirección desconocida, o la cierra si no es de un cliente.

alter table public.inbound_emails drop constraint if exists inbound_emails_asignacion_check;
alter table public.inbound_emails add constraint inbound_emails_asignacion_check
  check (asignacion is null or asignacion in ('agenda', 'cotizacion', 'propietario', 'supervision'));

create or replace function public.gestionar_correo_de_buzon(
  p_email uuid,
  p_agente uuid default null,
  p_rut text default null,
  p_cerrar boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_email public.inbound_emails%rowtype;
  v_org uuid;
  v_campanas uuid[];
  v_rut text := nullif(regexp_replace(upper(coalesce(p_rut, '')), '[^0-9K]', '', 'g'), '');
  v_lead uuid;
begin
  if (select public.current_role_name()) not in ('admin'::public.app_role, 'supervisor'::public.app_role) and not public.is_platform_owner() then
    raise exception 'Solo supervisión gestiona el buzón' using errcode = '42501';
  end if;
  select * into v_email from public.inbound_emails where id = p_email;
  if not found then
    raise exception 'El correo no existe' using errcode = '22023';
  end if;
  select mailbox.organization_id into v_org from public.inbound_mailboxes mailbox where mailbox.id = v_email.mailbox_id and mailbox.campaign_id is null;
  if v_org is null or not public.can_access_org(v_org) then
    raise exception 'El correo no es de un buzón de tu empresa' using errcode = '42501';
  end if;

  if v_rut is not null then
    select nullif(array_agg(campaign_id), '{}') into v_campanas from public.buzon_campanas where mailbox_id = v_email.mailbox_id;
    select lead.id into v_lead from public.leads lead
     where lead.organization_id = v_org
       and regexp_replace(upper(coalesce(lead.rut, '')), '[^0-9K]', '', 'g') = v_rut
       and (v_campanas is null or lead.campaign_id = any (v_campanas))
     order by lead.updated_at desc
     limit 1;
    if v_lead is null then
      raise exception 'No hay un registro con ese RUT en las campañas del buzón' using errcode = '22023';
    end if;
    update public.inbound_emails set lead_id = v_lead, organization_id = v_org, updated_at = now() where id = p_email;
    -- Sin agente elegido, se asigna como cualquier respuesta: agenda, propuesta, asignado.
    if p_agente is null and v_email.assigned_to is null then
      select coalesce(case when lead.next_action_at is not null and lead.callback_mode = 'personal' then coalesce(lead.managed_by, lead.assigned_to) end, lead.assigned_to)
        into p_agente from public.leads lead where lead.id = v_lead;
      if p_agente is not null and not exists (select 1 from public.profiles where id = p_agente and active and role = 'agente') then
        p_agente := null;
      end if;
    end if;
  end if;

  if p_agente is not null then
    if not exists (
      select 1 from public.profiles profile
      where profile.id = p_agente and profile.active and profile.role = 'agente' and profile.organization_id = v_org
    ) then
      raise exception 'Elige un ejecutivo activo de la empresa' using errcode = '22023';
    end if;
    update public.inbound_emails
       set assigned_to = p_agente, asignacion = 'supervision', asignado_at = now(), updated_at = now()
     where id = p_email;
  end if;

  if coalesce(p_cerrar, false) then
    update public.inbound_emails
       set status = 'converted', converted_by = v_actor, converted_at = now(), updated_at = now()
     where id = p_email;
  end if;
end;
$$;

revoke all on function public.gestionar_correo_de_buzon(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.gestionar_correo_de_buzon(uuid, uuid, text, boolean) to authenticated;

-- Supervisión y administración leen lo que llega a los buzones de envío de su
-- empresa (la política de campañas no los cubre: no tienen campaign_id). El
-- aislamiento por empresa sigue aplicando por la política restrictiva.
drop policy if exists inbound_emails_buzon_envio_select on public.inbound_emails;
create policy inbound_emails_buzon_envio_select on public.inbound_emails
  for select to authenticated
  using (
    ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner())
    and exists (
      select 1 from public.inbound_mailboxes mailbox
      where mailbox.id = inbound_emails.mailbox_id and mailbox.campaign_id is null and mailbox.active
    )
  );
