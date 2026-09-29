-- Buzones de envío por campaña.
--
-- Geimser tiene muchas campañas y Equifax es solo una cuenta: el buzón de la
-- cuenta Equifax no debe ser el de toda la empresa. Una empresa del contact
-- center puede tener varios buzones de envío (campaign_id null, como el de
-- las clínicas) y cada uno declara qué campañas lo usan. Una campaña usa un
-- solo buzón; un buzón sin campañas marcadas es el de respaldo para las que
-- no tienen uno propio.

create table if not exists public.buzon_campanas (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  mailbox_id uuid not null references public.inbound_mailboxes(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists buzon_campanas_mailbox_idx on public.buzon_campanas (mailbox_id);

comment on table public.buzon_campanas is
  'Qué campañas envían y reciben por cada buzón de envío. Una campaña, un buzón. La escribe guardar_buzon_de_envio.';

alter table public.buzon_campanas enable row level security;
revoke all on table public.buzon_campanas from anon;
revoke insert, update, delete on table public.buzon_campanas from authenticated;
grant select on table public.buzon_campanas to authenticated;
grant all on table public.buzon_campanas to service_role;

drop policy if exists buzon_campanas_organization_isolation on public.buzon_campanas;
create policy buzon_campanas_organization_isolation on public.buzon_campanas
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists buzon_campanas_select on public.buzon_campanas;
create policy buzon_campanas_select on public.buzon_campanas
  for select to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner());

-- ---------------------------------------------------------------------------
-- Guardar un buzón de envío (nuevo o existente) con sus campañas.
-- ---------------------------------------------------------------------------
create or replace function public.guardar_buzon_de_envio(
  p_id uuid,
  p_address text,
  p_label text,
  p_imap_host text,
  p_imap_port integer,
  p_smtp_host text,
  p_smtp_port integer,
  p_usuario text,
  p_clave text,
  p_remitente text,
  p_campanas uuid[]
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_org uuid := public.current_org_id();
  v_id uuid := p_id;
  v_secreto uuid;
  v_address text := lower(btrim(coalesce(p_address, '')));
  v_campanas uuid[] := coalesce(p_campanas, '{}');
  v_ocupada text;
begin
  if (select public.current_role_name()) <> 'admin'::public.app_role and not public.is_platform_owner() then
    raise exception 'Solo administración configura el correo' using errcode = '42501';
  end if;
  if v_org is null then
    raise exception 'No hay empresa activa' using errcode = '22023';
  end if;
  if v_address = '' or position('@' in v_address) = 0 then
    raise exception 'Escribe la dirección del buzón' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_campanas) campana(id) where not exists (
    select 1 from public.campaigns c where c.id = campana.id and c.organization_id = v_org)) then
    raise exception 'Una de las campañas no es de tu empresa' using errcode = '22023';
  end if;

  if v_id is not null then
    select clave_secreto into v_secreto from public.inbound_mailboxes
     where id = v_id and organization_id = v_org and campaign_id is null;
    if not found then
      raise exception 'Ese buzón no existe' using errcode = '22023';
    end if;
  end if;
  if exists (select 1 from public.inbound_mailboxes where address = v_address and id is distinct from v_id) then
    raise exception 'La dirección % ya está conectada en otro buzón', v_address using errcode = '23505';
  end if;

  select format('«%s» ya envía por %s', c.name, m.address) into v_ocupada
    from public.buzon_campanas bc
    join public.campaigns c on c.id = bc.campaign_id
    join public.inbound_mailboxes m on m.id = bc.mailbox_id
   where bc.campaign_id = any (v_campanas) and bc.mailbox_id is distinct from v_id
   limit 1;
  if v_ocupada is not null then
    raise exception '%: quítala de ese buzón primero', v_ocupada using errcode = '23505';
  end if;

  if nullif(btrim(coalesce(p_clave, '')), '') is not null then
    if v_secreto is null then
      v_secreto := vault.create_secret(p_clave, 'buzon:' || v_address || ':' || gen_random_uuid()::text, 'Clave de un buzón de envío');
    else
      perform vault.update_secret(v_secreto, p_clave);
    end if;
  end if;

  if v_id is null then
    if v_secreto is null then
      raise exception 'Escribe la clave del buzón' using errcode = '22023';
    end if;
    insert into public.inbound_mailboxes (address, label, organization_id, imap_host, imap_port, smtp_host, smtp_port, usuario, clave_secreto, remitente, active)
    values (v_address, coalesce(nullif(btrim(p_label), ''), 'Correo de envío'), v_org,
            nullif(btrim(p_imap_host), ''), coalesce(p_imap_port, 993), nullif(btrim(p_smtp_host), ''), coalesce(p_smtp_port, 465),
            coalesce(nullif(btrim(p_usuario), ''), v_address), v_secreto, nullif(btrim(p_remitente), ''), true)
    returning id into v_id;
  else
    update public.inbound_mailboxes
       set address = v_address,
           label = coalesce(nullif(btrim(p_label), ''), label),
           imap_host = nullif(btrim(p_imap_host), ''),
           imap_port = coalesce(p_imap_port, imap_port),
           smtp_host = nullif(btrim(p_smtp_host), ''),
           smtp_port = coalesce(p_smtp_port, smtp_port),
           usuario = coalesce(nullif(btrim(p_usuario), ''), v_address),
           clave_secreto = coalesce(v_secreto, clave_secreto),
           remitente = nullif(btrim(p_remitente), ''),
           active = true,
           last_sync_error = null,
           updated_at = now()
     where id = v_id;
  end if;

  delete from public.buzon_campanas where mailbox_id = v_id and not (campaign_id = any (v_campanas));
  insert into public.buzon_campanas (campaign_id, mailbox_id, organization_id)
  select campana.id, v_id, v_org from unnest(v_campanas) campana(id)
  on conflict (campaign_id) do nothing;

  return v_id;
end;
$$;

revoke all on function public.guardar_buzon_de_envio(uuid, text, text, text, integer, text, integer, text, text, text, uuid[]) from public, anon;
grant execute on function public.guardar_buzon_de_envio(uuid, text, text, text, integer, text, integer, text, text, text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Las respuestas que llegan a un buzón con campañas solo se ligan a registros
-- de esas campañas: el buzón de Equifax no se queda con clientes de otra cuenta.
-- ---------------------------------------------------------------------------
create or replace function public.ligar_respuesta_a_registro(p_email uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_email public.inbound_emails%rowtype;
  v_org uuid;
  v_campanas uuid[];
  v_ref text;
  v_cotizacion public.equifax_cotizaciones%rowtype;
  v_lead public.leads%rowtype;
  v_lead_id uuid;
  v_dueno uuid;
  v_motivo text;
begin
  select * into v_email from public.inbound_emails where id = p_email;
  if not found or v_email.lead_id is not null then
    return v_email.lead_id;
  end if;

  select mailbox.organization_id into v_org
    from public.inbound_mailboxes mailbox
    join public.organizations organizacion on organizacion.id = mailbox.organization_id
   where mailbox.id = v_email.mailbox_id
     and mailbox.campaign_id is null
     and organizacion.edicion = 'center';
  if v_org is null then return null; end if;

  -- Sin campañas marcadas, el buzón responde por toda la empresa.
  select nullif(array_agg(campaign_id), '{}') into v_campanas from public.buzon_campanas where mailbox_id = v_email.mailbox_id;

  v_ref := nullif(lower(btrim(coalesce(v_email.in_reply_to, ''), '<> ')), '');
  if v_ref is not null then
    select * into v_cotizacion from public.equifax_cotizaciones cotizacion
     where cotizacion.organization_id = v_org and cotizacion.canal = 'correo'
       and lower(btrim(coalesce(cotizacion.proveedor_id, ''), '<> ')) = v_ref
     limit 1;
    if v_cotizacion.id is not null then
      v_lead_id := v_cotizacion.lead_id;
    else
      select correo.lead_id into v_lead_id from public.correos_de_registro correo
       where correo.organization_id = v_org
         and lower(btrim(coalesce(correo.message_id, ''), '<> ')) = v_ref
       limit 1;
    end if;
  end if;

  if v_lead_id is null then
    select * into v_cotizacion from public.equifax_cotizaciones cotizacion
     where cotizacion.organization_id = v_org and cotizacion.canal = 'correo'
       and lower(btrim(cotizacion.destinatario)) = v_email.from_address
       and cotizacion.created_at >= now() - interval '180 days'
       and (v_campanas is null or cotizacion.campaign_id = any (v_campanas))
     order by cotizacion.created_at desc
     limit 1;
    v_lead_id := v_cotizacion.lead_id;
  end if;

  if v_lead_id is null then
    select lead.id into v_lead_id from public.leads lead
     where lead.organization_id = v_org
       and lower(btrim(coalesce(lead.email, ''))) = v_email.from_address
       and (v_campanas is null or lead.campaign_id = any (v_campanas))
     order by lead.updated_at desc
     limit 1;
  end if;

  if v_lead_id is null then return null; end if;
  select * into v_lead from public.leads where id = v_lead_id;

  if v_cotizacion.id is null then
    select * into v_cotizacion from public.equifax_cotizaciones cotizacion
     where cotizacion.lead_id = v_lead_id and cotizacion.canal = 'correo'
     order by cotizacion.created_at desc
     limit 1;
  end if;

  if v_lead.next_action_at is not null and v_lead.callback_mode = 'personal' then
    select profile.id into v_dueno from public.profiles profile
     where profile.id = coalesce(v_lead.managed_by, v_lead.assigned_to) and profile.active and profile.role = 'agente';
    if v_dueno is not null then v_motivo := 'agenda'; end if;
  end if;
  if v_dueno is null and v_cotizacion.id is not null then
    select profile.id into v_dueno from public.profiles profile
     where profile.id = v_cotizacion.agent_id and profile.active and profile.role = 'agente';
    if v_dueno is not null then v_motivo := 'cotizacion'; end if;
  end if;
  if v_dueno is null and v_lead.assigned_to is not null then
    select profile.id into v_dueno from public.profiles profile
     where profile.id = v_lead.assigned_to and profile.active and profile.role = 'agente';
    if v_dueno is not null then v_motivo := 'propietario'; end if;
  end if;

  update public.inbound_emails
     set lead_id = v_lead_id,
         organization_id = v_org,
         cotizacion_id = v_cotizacion.id,
         assigned_to = v_dueno,
         asignacion = v_motivo,
         asignado_at = case when v_dueno is not null then now() end,
         updated_at = now()
   where id = p_email;

  if v_cotizacion.id is not null then
    update public.equifax_cotizaciones
       set respondida_at = coalesce(respondida_at, v_email.received_at)
     where id = v_cotizacion.id;
  end if;

  return v_lead_id;
end;
$$;

revoke all on function public.ligar_respuesta_a_registro(uuid) from public, anon, authenticated;
grant execute on function public.ligar_respuesta_a_registro(uuid) to service_role;
