-- Correo de la clínica.
--
-- El correo entra y sale por Atlas, como el WhatsApp. Cada clínica tiene su
-- buzón (IMAP para leer, SMTP para responder) con la clave guardada en el
-- Vault de Supabase, nunca en una columna. Lo que llega se liga a la ficha
-- por la dirección; lo que sale pasa por la cola de mensajes salientes con
-- canal 'correo'. Las casillas del call center siguen igual: solo ganan la
-- posibilidad de pertenecer a una empresa en vez de a una campaña.

alter table public.inbound_mailboxes
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists imap_host text,
  add column if not exists imap_port integer not null default 993,
  add column if not exists smtp_host text,
  add column if not exists smtp_port integer not null default 465,
  add column if not exists usuario text,
  add column if not exists clave_secreto uuid,
  add column if not exists remitente text;

alter table public.inbound_mailboxes alter column campaign_id drop not null;
alter table public.inbound_mailboxes drop constraint if exists inbound_mailboxes_campana_o_empresa;
alter table public.inbound_mailboxes add constraint inbound_mailboxes_campana_o_empresa
  check (campaign_id is not null or organization_id is not null);

update public.inbound_mailboxes mailbox
   set organization_id = public.org_of_campaign(mailbox.campaign_id)
 where mailbox.organization_id is null and mailbox.campaign_id is not null;

alter table public.inbound_emails
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists company_id uuid references public.sales_companies(id) on delete set null,
  add column if not exists in_reply_to text;

update public.inbound_emails email
   set organization_id = mailbox.organization_id
  from public.inbound_mailboxes mailbox
 where mailbox.id = email.mailbox_id and email.organization_id is null;

create index if not exists inbound_emails_company_idx on public.inbound_emails (company_id, received_at desc) where company_id is not null;
create index if not exists inbound_emails_org_idx on public.inbound_emails (organization_id, received_at desc);

-- La ficha ve sus correos: administración y supervisión de la empresa.
drop policy if exists inbound_mailboxes_organization_isolation on public.inbound_mailboxes;
create policy inbound_mailboxes_organization_isolation on public.inbound_mailboxes
  as restrictive for all to authenticated
  using (coalesce(organization_id, public.org_of_campaign(campaign_id)) = any (public.current_org_ids()))
  with check (coalesce(organization_id, public.org_of_campaign(campaign_id)) = any (public.current_org_ids()));

drop policy if exists inbound_mailboxes_clinica_select on public.inbound_mailboxes;
create policy inbound_mailboxes_clinica_select on public.inbound_mailboxes
  for select to authenticated
  using (campaign_id is null
         and ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner()));

drop policy if exists inbound_emails_organization_isolation on public.inbound_emails;
create policy inbound_emails_organization_isolation on public.inbound_emails
  as restrictive for all to authenticated
  using (coalesce(organization_id, public.org_of_lead(lead_id)) is null or coalesce(organization_id, public.org_of_lead(lead_id)) = any (public.current_org_ids()))
  with check (coalesce(organization_id, public.org_of_lead(lead_id)) = any (public.current_org_ids()));

drop policy if exists inbound_emails_clinica_select on public.inbound_emails;
create policy inbound_emails_clinica_select on public.inbound_emails
  for select to authenticated
  using (company_id is not null
         and ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]) or public.is_platform_owner()));

-- El asunto de un correo saliente viaja con el mensaje.
alter table public.mensajes_salientes add column if not exists asunto text;
alter table public.mensajes_salientes add column if not exists in_reply_to text;

-- ---------------------------------------------------------------------------
-- Guardar el buzón de la clínica. La clave va al Vault; la fila solo guarda
-- el id del secreto. Corre con la sesión del administrador: la seguridad por
-- fila decide la empresa.
-- ---------------------------------------------------------------------------
create or replace function public.guardar_buzon_de_clinica(
  p_address text,
  p_label text,
  p_imap_host text,
  p_imap_port integer,
  p_smtp_host text,
  p_smtp_port integer,
  p_usuario text,
  p_clave text default null,
  p_remitente text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_org uuid := public.current_org_id();
  v_id uuid;
  v_secreto uuid;
begin
  if (select public.current_role_name()) <> 'admin'::public.app_role and not public.is_platform_owner() then
    raise exception 'Solo administración configura el correo' using errcode = '42501';
  end if;
  if v_org is null then
    raise exception 'No hay empresa activa' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_address, '')), '') is null or position('@' in p_address) = 0 then
    raise exception 'Escribe la dirección del buzón' using errcode = '22023';
  end if;

  select id, clave_secreto into v_id, v_secreto from public.inbound_mailboxes where organization_id = v_org and campaign_id is null limit 1;

  if p_clave is not null and btrim(p_clave) <> '' then
    if v_secreto is null then
      v_secreto := vault.create_secret(p_clave, 'buzon:' || v_org::text, 'Clave del buzón de correo de la clínica');
    else
      perform vault.update_secret(v_secreto, p_clave);
    end if;
  end if;

  if v_id is null then
    insert into public.inbound_mailboxes (address, label, organization_id, imap_host, imap_port, smtp_host, smtp_port, usuario, clave_secreto, remitente, active)
    values (lower(btrim(p_address)), coalesce(nullif(btrim(p_label), ''), 'Correo de la clínica'), v_org,
            nullif(btrim(p_imap_host), ''), coalesce(p_imap_port, 993), nullif(btrim(p_smtp_host), ''), coalesce(p_smtp_port, 465),
            coalesce(nullif(btrim(p_usuario), ''), lower(btrim(p_address))), v_secreto, nullif(btrim(p_remitente), ''), true)
    returning id into v_id;
  else
    update public.inbound_mailboxes
       set address = lower(btrim(p_address)),
           label = coalesce(nullif(btrim(p_label), ''), label),
           imap_host = nullif(btrim(p_imap_host), ''),
           imap_port = coalesce(p_imap_port, imap_port),
           smtp_host = nullif(btrim(p_smtp_host), ''),
           smtp_port = coalesce(p_smtp_port, smtp_port),
           usuario = coalesce(nullif(btrim(p_usuario), ''), lower(btrim(p_address))),
           clave_secreto = coalesce(v_secreto, clave_secreto),
           remitente = nullif(btrim(p_remitente), ''),
           active = true,
           updated_at = now()
     where id = v_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.guardar_buzon_de_clinica(text, text, text, integer, text, integer, text, text, text) from public, anon;
grant execute on function public.guardar_buzon_de_clinica(text, text, text, integer, text, integer, text, text, text) to authenticated;

-- Solo la clave de servicio lee la clave, y solo para conectar.
create or replace function public.leer_clave_de_buzon(p_mailbox uuid)
returns text
language sql
security definer
set search_path to 'pg_catalog', 'public', 'vault'
as $$
  select secreto.decrypted_secret
    from public.inbound_mailboxes mailbox
    join vault.decrypted_secrets secreto on secreto.id = mailbox.clave_secreto
   where mailbox.id = p_mailbox;
$$;

revoke all on function public.leer_clave_de_buzon(uuid) from public, anon, authenticated;
grant execute on function public.leer_clave_de_buzon(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Un correo que llega a una clínica se liga a la ficha por la dirección; si
-- nadie la tiene, nace una ficha. Una respuesta cierra los recordatorios de
-- correo que la motivaron.
-- ---------------------------------------------------------------------------
create or replace function public.ligar_correo_a_ficha(p_email uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_email public.inbound_emails%rowtype;
  v_org uuid;
  v_cuenta uuid;
begin
  select * into v_email from public.inbound_emails where id = p_email;
  if not found then return null; end if;
  select mailbox.organization_id into v_org from public.inbound_mailboxes mailbox where mailbox.id = v_email.mailbox_id and mailbox.campaign_id is null;
  if v_org is null then return null; end if;

  select cuenta.id into v_cuenta from public.sales_companies cuenta
   where cuenta.organization_id = v_org and lower(btrim(coalesce(cuenta.email, ''))) = lower(v_email.from_address)
   order by cuenta.updated_at desc limit 1;
  if v_cuenta is null then
    insert into public.sales_companies (organization_id, name, email, source, metadata)
    values (v_org, coalesce(nullif(btrim(v_email.from_name), ''), v_email.from_address), v_email.from_address, 'correo', jsonb_build_object('origen', 'correo'))
    returning id into v_cuenta;
  end if;

  update public.inbound_emails set organization_id = v_org, company_id = v_cuenta, updated_at = now() where id = p_email;
  update public.mensajes_salientes set estado = 'respondido', updated_at = now()
   where cuenta_id = v_cuenta and canal = 'correo' and estado in ('enviado', 'entregado', 'leido')
     and coalesce(enviado_at, created_at) >= now() - interval '14 days';
  return v_cuenta;
end;
$$;

revoke all on function public.ligar_correo_a_ficha(uuid) from public, anon, authenticated;
grant execute on function public.ligar_correo_a_ficha(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Las reglas de recordatorio eligen canal: WhatsApp si hay celular, correo si
-- solo hay correo. Misma regla, mismo período, un solo mensaje.
-- ---------------------------------------------------------------------------
create or replace function public.generar_recordatorios()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_hoy date := (now() at time zone 'America/Santiago')::date;
  v_manana date := (now() at time zone 'America/Santiago')::date + 1;
  v_semana text := to_char(now() at time zone 'America/Santiago', 'IYYY-IW');
  v_mes text := to_char(now() at time zone 'America/Santiago', 'YYYY-MM');
  v_citas integer := 0;
  v_vacunas integer := 0;
  v_presupuestos integer := 0;
  v_controles integer := 0;
begin
  with nuevas as (
    insert into public.mensajes_salientes (organization_id, canal, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
    select cita.organization_id,
           case when nullif(btrim(coalesce(cuenta.phone, '')), '') is not null then 'whatsapp' else 'correo' end,
           cita.cuenta_id, coalesce(nullif(btrim(cuenta.phone), ''), cuenta.email), cuenta.name,
           'cita_manana', cita.id, 'cita_manana:' || cita.id,
           case when cita.estado = 'reservada' then 'cita_confirmar' else 'cita_recordatorio' end,
           jsonb_build_object('nombre', split_part(cuenta.name, ' ', 1), 'hora', to_char(cita.inicio at time zone 'America/Santiago', 'HH24:MI'),
                              'profesional', profesional.nombre, 'motivo', cita.motivo, 'mascota', mascota.nombre, 'clinica', organizacion.name)
      from public.citas cita
      join public.organizations organizacion on organizacion.id = cita.organization_id and organizacion.edicion in ('vet', 'dental')
      join public.sales_companies cuenta on cuenta.id = cita.cuenta_id
      join public.profesionales profesional on profesional.id = cita.profesional_id
      left join public.mascotas mascota on mascota.id = cita.mascota_id
     where cita.estado in ('reservada', 'confirmada')
       and (cita.inicio at time zone 'America/Santiago')::date = v_manana
       and (nullif(btrim(coalesce(cuenta.phone, '')), '') is not null or nullif(btrim(coalesce(cuenta.email, '')), '') is not null)
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing
    returning 1
  ) select count(*) into v_citas from nuevas;

  with nuevas as (
    insert into public.mensajes_salientes (organization_id, canal, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
    select mascota.organization_id,
           case when nullif(btrim(coalesce(cuenta.phone, '')), '') is not null then 'whatsapp' else 'correo' end,
           mascota.cuenta_id, coalesce(nullif(btrim(cuenta.phone), ''), cuenta.email), cuenta.name,
           'vacuna', mascota.id, 'vacuna:' || mascota.id || ':' || v_mes, 'vacuna',
           jsonb_build_object('nombre', split_part(cuenta.name, ' ', 1), 'mascota', mascota.nombre, 'fecha', to_char(mascota.proxima_vacuna, 'DD/MM'),
                              'vencida', mascota.proxima_vacuna < v_hoy, 'clinica', organizacion.name)
      from public.mascotas mascota
      join public.organizations organizacion on organizacion.id = mascota.organization_id and organizacion.edicion = 'vet'
      join public.sales_companies cuenta on cuenta.id = mascota.cuenta_id
     where mascota.proxima_vacuna is not null
       and mascota.proxima_vacuna between v_hoy - 60 and v_hoy + 30
       and (nullif(btrim(coalesce(cuenta.phone, '')), '') is not null or nullif(btrim(coalesce(cuenta.email, '')), '') is not null)
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing
    returning 1
  ) select count(*) into v_vacunas from nuevas;

  with nuevas as (
    insert into public.mensajes_salientes (organization_id, canal, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
    select negocio.organization_id,
           case when nullif(btrim(coalesce(cuenta.phone, '')), '') is not null then 'whatsapp' else 'correo' end,
           negocio.company_id, coalesce(nullif(btrim(cuenta.phone), ''), cuenta.email), cuenta.name,
           'presupuesto', negocio.id, 'presupuesto:' || negocio.id || ':' || v_semana, 'presupuesto',
           jsonb_build_object('nombre', split_part(cuenta.name, ' ', 1), 'presupuesto', negocio.name,
                              'monto', to_char(coalesce(negocio.one_time_amount, 0), 'FM$999G999G999'), 'clinica', organizacion.name)
      from public.sales_opportunities negocio
      join public.organizations organizacion on organizacion.id = negocio.organization_id and organizacion.edicion in ('vet', 'dental')
      join public.sales_companies cuenta on cuenta.id = negocio.company_id
     where negocio.status = 'abierta'
       and negocio.next_action_at is not null
       and negocio.next_action_at <= now() - interval '7 days'
       and (nullif(btrim(coalesce(cuenta.phone, '')), '') is not null or nullif(btrim(coalesce(cuenta.email, '')), '') is not null)
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing
    returning 1
  ) select count(*) into v_presupuestos from nuevas;

  with ultima as (
    select atencion.organization_id, atencion.cuenta_id, max(atencion.fecha) as fecha
      from public.atenciones atencion group by atencion.organization_id, atencion.cuenta_id
  ), candidatos as (
    select ultima.organization_id, ultima.cuenta_id, ultima.fecha,
           row_number() over (partition by ultima.organization_id order by ultima.fecha) as orden
      from ultima
      join public.organizations organizacion on organizacion.id = ultima.organization_id and organizacion.edicion in ('vet', 'dental')
     where ultima.fecha < v_hoy - (case when organizacion.edicion = 'vet' then 365 else 180 end)
  ), nuevas as (
    insert into public.mensajes_salientes (organization_id, canal, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
    select candidato.organization_id,
           case when nullif(btrim(coalesce(cuenta.phone, '')), '') is not null then 'whatsapp' else 'correo' end,
           candidato.cuenta_id, coalesce(nullif(btrim(cuenta.phone), ''), cuenta.email), cuenta.name,
           'control', candidato.cuenta_id, 'control:' || candidato.cuenta_id || ':' || v_mes, 'control',
           jsonb_build_object('nombre', split_part(cuenta.name, ' ', 1), 'meses', case when organizacion.edicion = 'vet' then 12 else 6 end, 'clinica', organizacion.name)
      from candidatos candidato
      join public.organizations organizacion on organizacion.id = candidato.organization_id
      join public.sales_companies cuenta on cuenta.id = candidato.cuenta_id
     where candidato.orden <= 40
       and (nullif(btrim(coalesce(cuenta.phone, '')), '') is not null or nullif(btrim(coalesce(cuenta.email, '')), '') is not null)
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing
    returning 1
  ) select count(*) into v_controles from nuevas;

  return jsonb_build_object('citas', v_citas, 'vacunas', v_vacunas, 'presupuestos', v_presupuestos, 'controles', v_controles);
end;
$$;

-- ---------------------------------------------------------------------------
-- Demostración: un buzón sin clave por clínica (los envíos se simulan) y
-- algunos correos de tutores y pacientes ya ligados a su ficha.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org record;
  v_buzon uuid;
  v_cuenta record;
  v_correo uuid;
  v_n integer := 0;
  v_asuntos text[] := array['Consulta por horario', 'Re: Recordatorio de control', 'Duda con el presupuesto', 'Certificado de vacunas'];
  v_cuerpos text[] := array[
    'Hola, quería saber si tienen hora la próxima semana en la tarde. Gracias.',
    'Gracias por el recordatorio. ¿Puede ser el jueves a las 17:00?',
    'Hola, recibí el presupuesto. ¿El valor incluye los controles posteriores?',
    'Buenas tardes, necesito el certificado de vacunas para un viaje. ¿Me lo pueden enviar por acá?'];
begin
  for v_org in select o.id, o.slug, o.name from public.organizations o where o.slug in ('demo-vet', 'demo-dental') loop
    select id into v_buzon from public.inbound_mailboxes where organization_id = v_org.id and campaign_id is null limit 1;
    if v_buzon is null then
      insert into public.inbound_mailboxes (address, label, organization_id, imap_host, smtp_host, usuario, remitente, active)
      values ('contacto@' || replace(v_org.slug, '-', '') || '.demo.cl', 'Correo de la clínica', v_org.id, 'imap.demo.cl', 'smtp.demo.cl', 'contacto@' || replace(v_org.slug, '-', '') || '.demo.cl', v_org.name, true)
      returning id into v_buzon;
    end if;
    if exists (select 1 from public.inbound_emails where mailbox_id = v_buzon) then continue; end if;
    v_n := 0;
    for v_cuenta in select c.id, c.name, c.email from public.sales_companies c where c.organization_id = v_org.id and nullif(btrim(coalesce(c.email, '')), '') is not null order by random() limit 4 loop
      v_n := v_n + 1;
      insert into public.inbound_emails (mailbox_id, organization_id, imap_uid, message_id, from_name, from_address, subject, body_text, preview, received_at, status)
      values (v_buzon, v_org.id, 1000 + v_n, '<demo-' || v_cuenta.id || '@' || v_org.slug || '>', v_cuenta.name, lower(v_cuenta.email),
              v_asuntos[v_n], v_cuerpos[v_n], left(v_cuerpos[v_n], 120), now() - (v_n * interval '5 hours'), 'new')
      returning id into v_correo;
      perform public.ligar_correo_a_ficha(v_correo);
    end loop;
  end loop;
end;
$$;
