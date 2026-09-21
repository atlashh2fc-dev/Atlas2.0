-- Mensajes salientes.
--
-- Atlas es el único lugar desde donde se le escribe al paciente, por cualquier
-- canal. Hasta acá los recordatorios abrían WhatsApp fuera de la plataforma.
-- Esta tabla es la cola única de lo que Atlas manda: cada mensaje sabe por
-- qué canal va, a quién, con qué plantilla, cuándo sale y en qué estado quedó
-- (programado, enviado, entregado, leído, fallido). De ella se cuelgan los
-- recordatorios automáticos, las campañas y los enlaces de pago; el canal
-- (WhatsApp propio, correo por Atlas Lead) es un detalle del despacho.

create table if not exists public.mensajes_salientes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  canal text not null default 'whatsapp',
  cuenta_id uuid references public.sales_companies(id) on delete cascade,
  destinatario text not null,
  nombre_destinatario text,
  -- De dónde nace: la regla del recordatorio (cita_manana, vacuna, presupuesto,
  -- control, enlace_pago) o 'manual'. `origen_ref` es la cita, mascota,
  -- presupuesto o pago que lo motivó.
  regla text not null default 'manual',
  origen_ref uuid,
  -- Evita mandar dos veces el mismo recordatorio: regla + referencia + período.
  clave_dedupe text,
  plantilla text not null,
  variables jsonb not null default '{}'::jsonb,
  cuerpo text,
  programado_para timestamptz not null default now(),
  estado text not null default 'programado',
  proveedor text,
  proveedor_id text,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  whatsapp_message_id uuid references public.whatsapp_messages(id) on delete set null,
  error text,
  intentos integer not null default 0,
  enviado_at timestamptz,
  entregado_at timestamptz,
  leido_at timestamptz,
  creado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mensajes_canal_check check (canal in ('whatsapp', 'correo', 'sms')),
  constraint mensajes_estado_check check (estado in ('programado', 'enviando', 'enviado', 'entregado', 'leido', 'respondido', 'fallido', 'cancelado')),
  constraint mensajes_destinatario_not_blank check (btrim(destinatario) <> '')
);

create unique index if not exists mensajes_salientes_dedupe_uidx on public.mensajes_salientes (organization_id, clave_dedupe) where clave_dedupe is not null;
create index if not exists mensajes_salientes_cola_idx on public.mensajes_salientes (estado, programado_para) where estado in ('programado', 'enviando');
create index if not exists mensajes_salientes_org_idx on public.mensajes_salientes (organization_id, created_at desc);
create index if not exists mensajes_salientes_origen_idx on public.mensajes_salientes (origen_ref);
create index if not exists mensajes_salientes_cuenta_idx on public.mensajes_salientes (cuenta_id, created_at desc);

alter table public.mensajes_salientes enable row level security;

drop policy if exists mensajes_salientes_organization_isolation on public.mensajes_salientes;
create policy mensajes_salientes_organization_isolation on public.mensajes_salientes
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists mensajes_salientes_select on public.mensajes_salientes;
create policy mensajes_salientes_select on public.mensajes_salientes
  for select to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner());

drop policy if exists mensajes_salientes_write on public.mensajes_salientes;
create policy mensajes_salientes_write on public.mensajes_salientes
  for all to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
              or public.is_platform_owner());

-- ---------------------------------------------------------------------------
-- Programar un mensaje desde la pantalla (con la sesión de quien lo pide).
-- ---------------------------------------------------------------------------
create or replace function public.programar_mensaje(
  p_cuenta uuid,
  p_plantilla text,
  p_variables jsonb default '{}'::jsonb,
  p_regla text default 'manual',
  p_origen_ref uuid default null,
  p_programado_para timestamptz default null,
  p_canal text default 'whatsapp'
)
returns uuid
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_cuenta public.sales_companies%rowtype;
  v_destino text;
  v_id uuid;
begin
  select * into v_cuenta from public.sales_companies where id = p_cuenta;
  if not found then
    raise exception 'No encontramos esa ficha' using errcode = 'P0002';
  end if;
  v_destino := case when p_canal = 'correo' then v_cuenta.email else v_cuenta.phone end;
  if nullif(btrim(coalesce(v_destino, '')), '') is null then
    raise exception 'La ficha no tiene % registrado', case when p_canal = 'correo' then 'correo' else 'celular' end using errcode = '22023';
  end if;
  insert into public.mensajes_salientes (organization_id, canal, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref,
                                         plantilla, variables, programado_para, creado_por)
  values (v_cuenta.organization_id, p_canal, p_cuenta, v_destino, v_cuenta.name, coalesce(p_regla, 'manual'), p_origen_ref,
          p_plantilla, coalesce(p_variables, '{}'::jsonb), coalesce(p_programado_para, now()), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.programar_mensaje(uuid, text, jsonb, text, uuid, timestamptz, text) from public, anon;
grant execute on function public.programar_mensaje(uuid, text, jsonb, text, uuid, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Las reglas de recordatorio. Corre desde el cron con la clave de servicio y
-- deja programado lo que toca hoy, una sola vez por regla, referencia y
-- período. Solo para empresas de clínica (Dental y Vet) y fichas con celular.
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
  -- Citas de mañana: sin confirmar piden confirmación; confirmadas reciben el recordatorio.
  with nuevas as (
    insert into public.mensajes_salientes (organization_id, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
    select cita.organization_id, cita.cuenta_id, cuenta.phone, cuenta.name,
           'cita_manana', cita.id, 'cita_manana:' || cita.id,
           case when cita.estado = 'reservada' then 'cita_confirmar' else 'cita_recordatorio' end,
           jsonb_build_object(
             'nombre', split_part(cuenta.name, ' ', 1),
             'hora', to_char(cita.inicio at time zone 'America/Santiago', 'HH24:MI'),
             'profesional', profesional.nombre,
             'motivo', cita.motivo,
             'mascota', mascota.nombre,
             'clinica', organizacion.name)
      from public.citas cita
      join public.organizations organizacion on organizacion.id = cita.organization_id and organizacion.edicion in ('vet', 'dental')
      join public.sales_companies cuenta on cuenta.id = cita.cuenta_id
      join public.profesionales profesional on profesional.id = cita.profesional_id
      left join public.mascotas mascota on mascota.id = cita.mascota_id
     where cita.estado in ('reservada', 'confirmada')
       and (cita.inicio at time zone 'America/Santiago')::date = v_manana
       and nullif(btrim(coalesce(cuenta.phone, '')), '') is not null
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing
    returning 1
  ) select count(*) into v_citas from nuevas;

  -- Vacunas vencidas o por vencer en 30 días, una vez al mes por mascota.
  with nuevas as (
    insert into public.mensajes_salientes (organization_id, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
    select mascota.organization_id, mascota.cuenta_id, cuenta.phone, cuenta.name,
           'vacuna', mascota.id, 'vacuna:' || mascota.id || ':' || v_mes, 'vacuna',
           jsonb_build_object(
             'nombre', split_part(cuenta.name, ' ', 1),
             'mascota', mascota.nombre,
             'fecha', to_char(mascota.proxima_vacuna, 'DD/MM'),
             'vencida', mascota.proxima_vacuna < v_hoy,
             'clinica', organizacion.name)
      from public.mascotas mascota
      join public.organizations organizacion on organizacion.id = mascota.organization_id and organizacion.edicion = 'vet'
      join public.sales_companies cuenta on cuenta.id = mascota.cuenta_id
     where mascota.proxima_vacuna is not null
       and mascota.proxima_vacuna between v_hoy - 60 and v_hoy + 30
       and nullif(btrim(coalesce(cuenta.phone, '')), '') is not null
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing
    returning 1
  ) select count(*) into v_vacunas from nuevas;

  -- Presupuestos abiertos sin respuesta hace más de 7 días, una vez por semana.
  with nuevas as (
    insert into public.mensajes_salientes (organization_id, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
    select negocio.organization_id, negocio.company_id, cuenta.phone, cuenta.name,
           'presupuesto', negocio.id, 'presupuesto:' || negocio.id || ':' || v_semana, 'presupuesto',
           jsonb_build_object(
             'nombre', split_part(cuenta.name, ' ', 1),
             'presupuesto', negocio.name,
             'monto', to_char(coalesce(negocio.one_time_amount, 0), 'FM$999G999G999'),
             'clinica', organizacion.name)
      from public.sales_opportunities negocio
      join public.organizations organizacion on organizacion.id = negocio.organization_id and organizacion.edicion in ('vet', 'dental')
      join public.sales_companies cuenta on cuenta.id = negocio.company_id
     where negocio.status = 'abierta'
       and negocio.next_action_at is not null
       and negocio.next_action_at <= now() - interval '7 days'
       and nullif(btrim(coalesce(cuenta.phone, '')), '') is not null
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing
    returning 1
  ) select count(*) into v_presupuestos from nuevas;

  -- Controles: quien no vuelve hace 6 meses (dental) o 12 (vet), una vez al mes, máximo 40 por empresa.
  with ultima as (
    select atencion.organization_id, atencion.cuenta_id, max(atencion.fecha) as fecha
      from public.atenciones atencion
     group by atencion.organization_id, atencion.cuenta_id
  ), candidatos as (
    select ultima.organization_id, ultima.cuenta_id, ultima.fecha,
           row_number() over (partition by ultima.organization_id order by ultima.fecha) as orden
      from ultima
      join public.organizations organizacion on organizacion.id = ultima.organization_id and organizacion.edicion in ('vet', 'dental')
     where ultima.fecha < v_hoy - (case when organizacion.edicion = 'vet' then 365 else 180 end)
  ), nuevas as (
    insert into public.mensajes_salientes (organization_id, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
    select candidato.organization_id, candidato.cuenta_id, cuenta.phone, cuenta.name,
           'control', candidato.cuenta_id, 'control:' || candidato.cuenta_id || ':' || v_mes, 'control',
           jsonb_build_object(
             'nombre', split_part(cuenta.name, ' ', 1),
             'meses', case when organizacion.edicion = 'vet' then 12 else 6 end,
             'clinica', organizacion.name)
      from candidatos candidato
      join public.organizations organizacion on organizacion.id = candidato.organization_id
      join public.sales_companies cuenta on cuenta.id = candidato.cuenta_id
     where candidato.orden <= 40
       and nullif(btrim(coalesce(cuenta.phone, '')), '') is not null
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing
    returning 1
  ) select count(*) into v_controles from nuevas;

  return jsonb_build_object('citas', v_citas, 'vacunas', v_vacunas, 'presupuestos', v_presupuestos, 'controles', v_controles);
end;
$$;

revoke all on function public.generar_recordatorios() from public, anon, authenticated;
grant execute on function public.generar_recordatorios() to service_role;

-- El despachador reclama lo que toca enviar y cierra cada mensaje con su
-- resultado. Solo la clave de servicio.
create or replace function public.reclamar_mensajes_salientes(p_limite integer default 50)
returns setof public.mensajes_salientes
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  return query
    update public.mensajes_salientes mensaje
       set estado = 'enviando', intentos = mensaje.intentos + 1, updated_at = now()
     where mensaje.id in (
       select candidato.id from public.mensajes_salientes candidato
        where candidato.estado = 'programado' and candidato.programado_para <= now()
        order by candidato.programado_para
        limit greatest(1, least(coalesce(p_limite, 50), 200))
        for update skip locked
     )
    returning mensaje.*;
end;
$$;

revoke all on function public.reclamar_mensajes_salientes(integer) from public, anon, authenticated;
grant execute on function public.reclamar_mensajes_salientes(integer) to service_role;

create or replace function public.cerrar_mensaje_saliente(
  p_id uuid,
  p_estado text,
  p_cuerpo text default null,
  p_proveedor text default null,
  p_proveedor_id text default null,
  p_error text default null,
  p_conversation uuid default null,
  p_whatsapp_message uuid default null
)
returns void
language sql
security definer
set search_path to 'pg_catalog', 'public'
as $$
  update public.mensajes_salientes
     set estado = p_estado,
         cuerpo = coalesce(p_cuerpo, cuerpo),
         proveedor = coalesce(p_proveedor, proveedor),
         proveedor_id = coalesce(p_proveedor_id, proveedor_id),
         error = case when p_estado = 'fallido' then left(p_error, 800) else null end,
         conversation_id = coalesce(p_conversation, conversation_id),
         whatsapp_message_id = coalesce(p_whatsapp_message, whatsapp_message_id),
         enviado_at = case when p_estado in ('enviado', 'entregado', 'leido') then coalesce(enviado_at, now()) else enviado_at end,
         entregado_at = case when p_estado in ('entregado', 'leido') then coalesce(entregado_at, now()) else entregado_at end,
         leido_at = case when p_estado = 'leido' then coalesce(leido_at, now()) else leido_at end,
         updated_at = now()
   where id = p_id;
$$;

revoke all on function public.cerrar_mensaje_saliente(uuid, text, text, text, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.cerrar_mensaje_saliente(uuid, text, text, text, text, text, uuid, uuid) to service_role;

-- Cuando el proveedor avisa entregado o leído sobre el mensaje de WhatsApp, el
-- mensaje saliente lo hereda: así el recordatorio sabe si llegó.
create or replace function public.reflejar_estado_whatsapp_en_saliente()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if new.direction = 'outbound' and new.status is distinct from old.status then
    update public.mensajes_salientes
       set estado = case new.status when 'read' then 'leido' when 'delivered' then 'entregado' when 'sent' then 'enviado'
                                    when 'failed' then 'fallido' else estado end,
           error = case when new.status = 'failed' then left(new.error_message, 800) else error end,
           entregado_at = case when new.status in ('delivered', 'read') then coalesce(entregado_at, now()) else entregado_at end,
           leido_at = case when new.status = 'read' then coalesce(leido_at, now()) else leido_at end,
           updated_at = now()
     where whatsapp_message_id = new.id
       and estado not in ('cancelado', 'respondido');
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_messages_reflejan_saliente on public.whatsapp_messages;
create trigger whatsapp_messages_reflejan_saliente
  after update of status on public.whatsapp_messages
  for each row execute function public.reflejar_estado_whatsapp_en_saliente();
