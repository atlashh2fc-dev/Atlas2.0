-- La cita se confirma sola.
--
-- El recordatorio pide «Responde SÍ y queda confirmada», pero hasta acá la
-- recepción cambiaba el estado a mano. Desde esta migración, cuando la persona
-- responde al recordatorio por WhatsApp o por correo:
--   · «sí», «confirmo», «ok», 👍 … → la cita pasa a confirmada;
--   · «no», «no puedo», «cancelo» … → la cita se cancela y el horario se libera;
--   · «cambiar», «reagendar», «otra hora» … → la cita sigue igual y queda una
--     tarea para que la recepción le ofrezca otra hora.
-- Cada caso deja la línea en la historia de la ficha y una respuesta corta a
-- la persona. Lo que no se entiende con certeza no toca la cita: sigue en
-- Conversaciones para que lo lea una persona.
--
-- Además, cada empresa elige cuándo sale el recordatorio (el mismo día, 1, 2
-- o 3 días antes, desde qué hora) y puede escribir sus propios textos.

-- ---------------------------------------------------------------------------
-- Configuración de la agenda por empresa. Una fila por empresa; sin fila
-- valen los valores por defecto (un día antes, desde las 10:00, con
-- confirmación automática).
-- ---------------------------------------------------------------------------
create table if not exists public.configuracion_agenda (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  recordatorio_dias_antes integer not null default 1,
  recordatorio_desde time not null default '10:00',
  confirmacion_automatica boolean not null default true,
  -- Textos propios por plantilla: {"cita_confirmar": "Hola {{nombre}}…"}.
  textos jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint configuracion_agenda_dias_check check (recordatorio_dias_antes between 0 and 3),
  constraint configuracion_agenda_desde_check check (recordatorio_desde between '07:00' and '20:00'),
  constraint configuracion_agenda_textos_objeto check (jsonb_typeof(textos) = 'object')
);

alter table public.configuracion_agenda enable row level security;

drop policy if exists configuracion_agenda_organization_isolation on public.configuracion_agenda;
create policy configuracion_agenda_organization_isolation on public.configuracion_agenda
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists configuracion_agenda_select on public.configuracion_agenda;
create policy configuracion_agenda_select on public.configuracion_agenda
  for select to authenticated
  using (true);

drop policy if exists configuracion_agenda_write on public.configuracion_agenda;
create policy configuracion_agenda_write on public.configuracion_agenda
  for all to authenticated
  using ((select public.current_role_name()) = 'admin'::public.app_role or public.is_platform_owner())
  with check ((select public.current_role_name()) = 'admin'::public.app_role or public.is_platform_owner());

-- Quién confirmó y cuándo: la agenda muestra «confirmó por WhatsApp».
alter table public.citas add column if not exists confirmada_por text;
alter table public.citas add column if not exists confirmada_at timestamptz;
alter table public.citas drop constraint if exists citas_confirmada_por_check;
alter table public.citas add constraint citas_confirmada_por_check
  check (confirmada_por is null or confirmada_por in ('whatsapp', 'correo', 'recepcion', 'reserva_online'));

-- Confirmar desde la pantalla también queda registrado como «recepción».
create or replace function public.cambiar_estado_cita(p_cita uuid, p_estado text)
returns void
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_cita public.citas%rowtype;
begin
  if p_estado not in ('reservada', 'confirmada', 'en_sala', 'atendida', 'no_vino', 'cancelada') then
    raise exception 'Estado de cita desconocido' using errcode = '22023';
  end if;
  update public.citas
     set estado = p_estado,
         confirmada_por = case when p_estado = 'confirmada' and estado <> 'confirmada' then 'recepcion'
                               when p_estado = 'reservada' then null else confirmada_por end,
         confirmada_at = case when p_estado = 'confirmada' and estado <> 'confirmada' then now()
                              when p_estado = 'reservada' then null else confirmada_at end,
         updated_at = now()
   where id = p_cita
  returning * into v_cita;
  if not found then
    raise exception 'No encontramos esa cita' using errcode = 'P0002';
  end if;
  if p_estado in ('no_vino', 'cancelada') then
    insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done, owner_id)
    values (v_cita.organization_id, v_cita.cuenta_id, 'nota',
            case when p_estado = 'no_vino' then 'No vino a la cita' else 'Cita cancelada' end,
            v_cita.motivo || ' · ' || to_char(v_cita.inicio at time zone 'America/Santiago', 'DD/MM HH24:MI'),
            now(), true, auth.uid());
  end if;
end;
$$;

revoke all on function public.cambiar_estado_cita(uuid, text) from public, anon;
grant execute on function public.cambiar_estado_cita(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Entender la respuesta. Solo mensajes cortos y sin pregunta: «sí, pero
-- ¿puedo llegar 10 minutos tarde?» lo lee una persona, no la máquina.
-- Devuelve 'si', 'no', 'reagendar' o null.
-- ---------------------------------------------------------------------------
create or replace function public.clasificar_respuesta_cita(p_texto text)
returns text
language plpgsql
immutable
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_original text := btrim(coalesce(p_texto, ''));
  v text;
begin
  if v_original = '' or length(v_original) > 80 or position('?' in v_original) > 0 or position('¿' in v_original) > 0 then
    return null;
  end if;
  -- Un pulgar o un visto solos valen como sí.
  if v_original ~ '^(👍|👌|✅|☑️|✔️|🙌|🙏|\s)+$' then
    return 'si';
  end if;
  v := translate(lower(v_original), 'áéíóúüàèìòù', 'aeiouuaeiou');
  v := btrim(regexp_replace(regexp_replace(v, '[^a-zñ0-9 ]', ' ', 'g'), '\s+', ' ', 'g'));
  if v = '' then return null; end if;

  if v ~ '(reagend|cambiar|cambio la hora|cambiamos|mover|moverla|otra hora|otro dia|otro horario|mas tarde|mas temprano|postergar|aplazar)' then
    return 'reagendar';
  end if;
  if v ~ '^(no|nop|nope)( |$)' or v ~ '(no puedo|no podre|no voy|no vamos|no podemos|no alcanzo|no llego|cancel|anul|no asistire|no iremos)' then
    return 'no';
  end if;
  if v ~ '^(s+i+|sip|sep|ok|oki|okey|okay|oka|confirm|dale|listo|lista|voy|vamos|perfecto|de acuerdo|deacuerdo|claro|por supuesto|ahi estare|ahi estaremos|alli estare|asistire|asistiremos|bueno|bn|buenisimo|genial|vale|yes|ya|yap|obvio|correcto|afirmativo)( |$)' then
    return 'si';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Aplicar la respuesta a la cita que la motivó. Solo actúa si a esa ficha se
-- le mandó un recordatorio de cita en las últimas 72 horas y la cita sigue
-- por delante. Devuelve lo que hizo (o null si no hizo nada).
-- ---------------------------------------------------------------------------
create or replace function public.aplicar_respuesta_de_cita(p_cuenta uuid, p_texto text, p_canal text)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_respuesta text;
  v_cita public.citas%rowtype;
  v_cuenta public.sales_companies%rowtype;
  v_org public.organizations%rowtype;
  v_profesional text;
  v_cuando text;
  v_plantilla text;
  v_destino text;
begin
  if p_cuenta is null or p_canal not in ('whatsapp', 'correo') then return null; end if;
  v_respuesta := public.clasificar_respuesta_cita(p_texto);
  if v_respuesta is null then return null; end if;

  select cita.* into v_cita
    from public.mensajes_salientes mensaje
    join public.citas cita on cita.id = mensaje.origen_ref
   where mensaje.cuenta_id = p_cuenta
     and mensaje.regla = 'cita_manana'
     and mensaje.estado in ('enviado', 'entregado', 'leido', 'respondido')
     and coalesce(mensaje.enviado_at, mensaje.created_at) >= now() - interval '72 hours'
     and cita.inicio > now()
     and cita.estado in ('reservada', 'confirmada')
   order by cita.inicio
   limit 1;
  if v_cita.id is null then return null; end if;

  select * into v_org from public.organizations where id = v_cita.organization_id;
  if exists (select 1 from public.configuracion_agenda cfg where cfg.organization_id = v_cita.organization_id and not cfg.confirmacion_automatica) then
    return null;
  end if;
  -- Un sí a una cita ya confirmada no cambia nada ni merece otra respuesta.
  if v_respuesta = 'si' and v_cita.estado = 'confirmada' then return null; end if;

  select * into v_cuenta from public.sales_companies where id = p_cuenta;
  select nombre into v_profesional from public.profesionales where id = v_cita.profesional_id;
  v_cuando := to_char(v_cita.inicio at time zone 'America/Santiago', 'DD/MM') || ' a las ' || to_char(v_cita.inicio at time zone 'America/Santiago', 'HH24:MI');

  if v_respuesta = 'si' then
    update public.citas set estado = 'confirmada', confirmada_por = p_canal, confirmada_at = now(), updated_at = now() where id = v_cita.id;
    insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done)
    values (v_cita.organization_id, p_cuenta, 'nota', 'Confirmó su cita por ' || case when p_canal = 'correo' then 'correo' else 'WhatsApp' end,
            v_cita.motivo || ' · ' || v_cuando || coalesce(' con ' || v_profesional, ''), now(), true);
    v_plantilla := 'cita_confirmada';
  elsif v_respuesta = 'no' then
    update public.citas set estado = 'cancelada', updated_at = now() where id = v_cita.id;
    insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, done)
    values (v_cita.organization_id, p_cuenta, 'nota', 'Canceló su cita por ' || case when p_canal = 'correo' then 'correo' else 'WhatsApp' end,
            v_cita.motivo || ' · ' || v_cuando || '. El horario quedó libre.', now(), true);
    v_plantilla := 'cita_cancelada';
  else
    -- Pedir otra hora no mueve la cita: queda una tarea para la recepción.
    insert into public.sales_activities (organization_id, company_id, kind, subject, body, occurred_at, due_at, done)
    values (v_cita.organization_id, p_cuenta, 'tarea', 'Pidió cambiar la hora de su cita',
            v_cita.motivo || ' · ' || v_cuando || '. Ofrécele otra hora por Conversaciones.', now(), now(), false);
    v_plantilla := 'cita_reagendar';
  end if;

  v_destino := case when p_canal = 'correo' then v_cuenta.email else v_cuenta.phone end;
  if nullif(btrim(coalesce(v_destino, '')), '') is not null then
    insert into public.mensajes_salientes (organization_id, canal, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
    values (v_cita.organization_id, p_canal, p_cuenta, v_destino, v_cuenta.name, 'cita_respuesta', v_cita.id,
            'cita_respuesta:' || v_cita.id || ':' || v_respuesta, v_plantilla,
            jsonb_build_object('nombre', split_part(v_cuenta.name, ' ', 1), 'fecha', v_cuando, 'clinica', v_org.name))
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing;
  end if;
  return v_respuesta;
end;
$$;

revoke all on function public.aplicar_respuesta_de_cita(uuid, text, text) from public, anon, authenticated;
grant execute on function public.aplicar_respuesta_de_cita(uuid, text, text) to service_role;

-- WhatsApp: cada mensaje que entra a una conversación de clínica pasa por acá.
create or replace function public.respuesta_de_cita_por_whatsapp()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_cuenta uuid;
begin
  if new.direction <> 'inbound' or coalesce(new.message_type, '') <> 'text' or nullif(btrim(coalesce(new.text_body, '')), '') is null then
    return new;
  end if;
  select conversacion.company_id into v_cuenta
    from public.whatsapp_conversations conversacion
    join public.organizations organizacion on organizacion.id = conversacion.organization_id and organizacion.edicion in ('vet', 'dental', 'barber')
   where conversacion.id = new.conversation_id;
  if v_cuenta is not null then
    perform public.aplicar_respuesta_de_cita(v_cuenta, new.text_body, 'whatsapp');
  end if;
  return new;
exception when others then
  -- Nunca perder el mensaje entrante por un error de la confirmación.
  raise warning 'respuesta_de_cita_por_whatsapp: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists whatsapp_messages_respuesta_de_cita on public.whatsapp_messages;
create trigger whatsapp_messages_respuesta_de_cita
  after insert on public.whatsapp_messages
  for each row execute function public.respuesta_de_cita_por_whatsapp();

-- Correo: cuando el correo queda ligado a una ficha de clínica. Se lee la
-- primera línea con texto, que es lo que la persona escribió sobre la cita
-- citada.
create or replace function public.respuesta_de_cita_por_correo()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_linea text;
begin
  if new.company_id is null or old.company_id is not distinct from new.company_id then
    return new;
  end if;
  if not exists (select 1 from public.organizations o where o.id = new.organization_id and o.edicion in ('vet', 'dental', 'barber')) then
    return new;
  end if;
  select btrim(linea) into v_linea
    from regexp_split_to_table(coalesce(new.body_text, ''), E'\n') with ordinality as t(linea, n)
   where btrim(linea) <> '' and btrim(linea) !~ '^>'
   order by n
   limit 1;
  perform public.aplicar_respuesta_de_cita(new.company_id, v_linea, 'correo');
  return new;
exception when others then
  raise warning 'respuesta_de_cita_por_correo: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists inbound_emails_respuesta_de_cita on public.inbound_emails;
create trigger inbound_emails_respuesta_de_cita
  after update of company_id on public.inbound_emails
  for each row execute function public.respuesta_de_cita_por_correo();

-- ---------------------------------------------------------------------------
-- Recordatorios con la anticipación de cada empresa. El de cita sale el día
-- que corresponde, desde la hora elegida y hasta las 21:00; si la cita se
-- agendó tarde y el día ya pasó, sale igual el mismo día con 2 horas de
-- margen. El resto de las reglas no cambia.
-- ---------------------------------------------------------------------------
create or replace function public.generar_recordatorios()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_ahora timestamp := now() at time zone 'America/Santiago';
  v_hoy date := (now() at time zone 'America/Santiago')::date;
  v_semana text := to_char(now() at time zone 'America/Santiago', 'IYYY-IW');
  v_mes text := to_char(now() at time zone 'America/Santiago', 'YYYY-MM');
  v_dias text[] := array['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  v_citas integer := 0; v_vacunas integer := 0; v_presupuestos integer := 0; v_controles integer := 0;
begin
  with candidatas as (
    select cita.*, (cita.inicio at time zone 'America/Santiago')::date as dia
      from public.citas cita
      join public.organizations organizacion on organizacion.id = cita.organization_id and organizacion.edicion in ('vet', 'dental', 'barber')
      left join public.configuracion_agenda cfg on cfg.organization_id = cita.organization_id
     where cita.estado in ('reservada', 'confirmada')
       and cita.inicio > now() + interval '2 hours'
       and v_ahora::time >= coalesce(cfg.recordatorio_desde, '10:00'::time)
       and v_ahora::time < '21:00'::time
       and (cita.inicio at time zone 'America/Santiago')::date between v_hoy and v_hoy + coalesce(cfg.recordatorio_dias_antes, 1)
  ), nuevas as (
    insert into public.mensajes_salientes (organization_id, canal, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
    select cita.organization_id, case when nullif(btrim(coalesce(cuenta.phone, '')), '') is not null then 'whatsapp' else 'correo' end,
           cita.cuenta_id, coalesce(nullif(btrim(cuenta.phone), ''), cuenta.email), cuenta.name, 'cita_manana', cita.id, 'cita_manana:' || cita.id,
           case when cita.estado = 'reservada' then 'cita_confirmar' else 'cita_recordatorio' end,
           jsonb_build_object('nombre', split_part(cuenta.name, ' ', 1), 'hora', to_char(cita.inicio at time zone 'America/Santiago', 'HH24:MI'),
                              'cuando', case cita.dia - v_hoy when 0 then 'hoy' when 1 then 'mañana'
                                             else 'el ' || v_dias[extract(isodow from cita.dia)::int] || ' ' || to_char(cita.dia, 'DD/MM') end,
                              'profesional', profesional.nombre, 'motivo', cita.motivo, 'mascota', mascota.nombre, 'clinica', organizacion.name)
      from candidatas cita
      join public.organizations organizacion on organizacion.id = cita.organization_id
      join public.sales_companies cuenta on cuenta.id = cita.cuenta_id
      join public.profesionales profesional on profesional.id = cita.profesional_id
      left join public.mascotas mascota on mascota.id = cita.mascota_id
     where (nullif(btrim(coalesce(cuenta.phone, '')), '') is not null or nullif(btrim(coalesce(cuenta.email, '')), '') is not null)
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing
    returning 1
  ) select count(*) into v_citas from nuevas;

  with nuevas as (
    insert into public.mensajes_salientes (organization_id, canal, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
    select mascota.organization_id, case when nullif(btrim(coalesce(cuenta.phone, '')), '') is not null then 'whatsapp' else 'correo' end,
           mascota.cuenta_id, coalesce(nullif(btrim(cuenta.phone), ''), cuenta.email), cuenta.name, 'vacuna', mascota.id, 'vacuna:' || mascota.id || ':' || v_mes, 'vacuna',
           jsonb_build_object('nombre', split_part(cuenta.name, ' ', 1), 'mascota', mascota.nombre, 'fecha', to_char(mascota.proxima_vacuna, 'DD/MM'), 'vencida', mascota.proxima_vacuna < v_hoy, 'clinica', organizacion.name)
      from public.mascotas mascota
      join public.organizations organizacion on organizacion.id = mascota.organization_id and organizacion.edicion = 'vet'
      join public.sales_companies cuenta on cuenta.id = mascota.cuenta_id
     where mascota.proxima_vacuna is not null and mascota.proxima_vacuna between v_hoy - 60 and v_hoy + 30
       and (nullif(btrim(coalesce(cuenta.phone, '')), '') is not null or nullif(btrim(coalesce(cuenta.email, '')), '') is not null)
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing
    returning 1
  ) select count(*) into v_vacunas from nuevas;

  with nuevas as (
    insert into public.mensajes_salientes (organization_id, canal, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
    select negocio.organization_id, case when nullif(btrim(coalesce(cuenta.phone, '')), '') is not null then 'whatsapp' else 'correo' end,
           negocio.company_id, coalesce(nullif(btrim(cuenta.phone), ''), cuenta.email), cuenta.name, 'presupuesto', negocio.id, 'presupuesto:' || negocio.id || ':' || v_semana, 'presupuesto',
           jsonb_build_object('nombre', split_part(cuenta.name, ' ', 1), 'presupuesto', negocio.name, 'monto', to_char(coalesce(negocio.one_time_amount, 0), 'FM$999G999G999'), 'clinica', organizacion.name)
      from public.sales_opportunities negocio
      join public.organizations organizacion on organizacion.id = negocio.organization_id and organizacion.edicion in ('vet', 'dental', 'barber')
      join public.sales_companies cuenta on cuenta.id = negocio.company_id
     where negocio.status = 'abierta' and negocio.next_action_at is not null and negocio.next_action_at <= now() - interval '7 days'
       and (nullif(btrim(coalesce(cuenta.phone, '')), '') is not null or nullif(btrim(coalesce(cuenta.email, '')), '') is not null)
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing
    returning 1
  ) select count(*) into v_presupuestos from nuevas;

  with ultima as (
    select atencion.organization_id, atencion.cuenta_id, max(atencion.fecha) as fecha from public.atenciones atencion group by 1, 2
  ), candidatos as (
    select ultima.organization_id, ultima.cuenta_id, ultima.fecha, organizacion.edicion,
           row_number() over (partition by ultima.organization_id order by ultima.fecha) as orden
      from ultima join public.organizations organizacion on organizacion.id = ultima.organization_id and organizacion.edicion in ('vet', 'dental', 'barber')
     where ultima.fecha < v_hoy - (case organizacion.edicion when 'vet' then 365 when 'barber' then 35 else 180 end)
       and (organizacion.edicion <> 'barber' or ultima.fecha >= v_hoy - 90)
  ), nuevas as (
    insert into public.mensajes_salientes (organization_id, canal, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables)
    select candidato.organization_id, case when nullif(btrim(coalesce(cuenta.phone, '')), '') is not null then 'whatsapp' else 'correo' end,
           candidato.cuenta_id, coalesce(nullif(btrim(cuenta.phone), ''), cuenta.email), cuenta.name,
           case when candidato.edicion = 'barber' then 'mantencion' else 'control' end, candidato.cuenta_id,
           case when candidato.edicion = 'barber' then 'mantencion:' else 'control:' end || candidato.cuenta_id || ':' || v_mes,
           case when candidato.edicion = 'barber' then 'mantencion' else 'control' end,
           jsonb_build_object('nombre', split_part(cuenta.name, ' ', 1), 'meses', case candidato.edicion when 'vet' then 12 else 6 end,
                              'semanas', ((v_hoy - candidato.fecha) / 7), 'clinica', organizacion.name)
      from candidatos candidato
      join public.organizations organizacion on organizacion.id = candidato.organization_id
      join public.sales_companies cuenta on cuenta.id = candidato.cuenta_id
     where candidato.orden <= 40 and (nullif(btrim(coalesce(cuenta.phone, '')), '') is not null or nullif(btrim(coalesce(cuenta.email, '')), '') is not null)
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing
    returning 1
  ) select count(*) into v_controles from nuevas;

  return jsonb_build_object('citas', v_citas, 'vacunas', v_vacunas, 'presupuestos', v_presupuestos, 'controles', v_controles);
end;
$$;

revoke all on function public.generar_recordatorios() from public, anon, authenticated;
grant execute on function public.generar_recordatorios() to service_role;
