-- El puesto de trabajo comercial, segunda parte.
--
-- Tres cosas que una empresa que vende B2B necesita y no tenía: escribirle
-- al contacto del negocio desde Atlas (el correo del contacto vale cuando la
-- empresa no tiene uno), que lo que llega de la web se reparta solo entre el
-- equipo, y que una propuesta sin respuesta reciba seguimiento sin que nadie
-- se acuerde. El seguimiento automático es opcional por empresa, apagado
-- por defecto: le escribe a clientes reales.

-- El destino de un mensaje: el de la ficha o, si no tiene, el del contacto principal.
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
    select case when p_canal = 'correo' then contacto.email else coalesce(contacto.whatsapp, contacto.phone) end into v_destino
      from public.sales_contacts contacto
     where contacto.company_id = p_cuenta
       and nullif(btrim(coalesce(case when p_canal = 'correo' then contacto.email else coalesce(contacto.whatsapp, contacto.phone) end, '')), '') is not null
     order by contacto.is_decision_maker desc, contacto.created_at
     limit 1;
  end if;
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

-- Lo que llega de la web o del calificador se reparte entre quienes venden:
-- a quien menos negocios abiertos tenga. Sin equipo, queda sin responsable.
create or replace function public.asignar_negocio_nuevo()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare v_owner uuid;
begin
  if new.owner_id is not null or coalesce(new.source, '') not in ('agenda_web', 'agente_calificador', 'atlas_lead') then
    return new;
  end if;
  select persona.id into v_owner
    from public.profiles persona
    left join public.sales_opportunities abierto on abierto.owner_id = persona.id and abierto.status = 'abierta'
   where persona.organization_id = new.organization_id and persona.active and persona.role in ('admin', 'supervisor')
   group by persona.id, persona.created_at
   order by count(abierto.id), persona.created_at
   limit 1;
  new.owner_id := v_owner;
  return new;
end;
$$;

drop trigger if exists sales_opportunities_reparto on public.sales_opportunities;
create trigger sales_opportunities_reparto before insert on public.sales_opportunities
  for each row execute function public.asignar_negocio_nuevo();

-- Seguimiento automático de propuestas (opcional por empresa).
create or replace function public.alternar_seguimiento_automatico(p_activo boolean)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare v_org uuid := public.current_org_id();
begin
  if (select public.current_role_name()) <> 'admin'::public.app_role and not public.is_platform_owner() then
    raise exception 'Solo administración cambia esto' using errcode = '42501';
  end if;
  update public.organizations set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('seguimiento_automatico', coalesce(p_activo, false)), updated_at = now()
   where id = v_org;
  return coalesce(p_activo, false);
end;
$$;

revoke all on function public.alternar_seguimiento_automatico(boolean) from public, anon;
grant execute on function public.alternar_seguimiento_automatico(boolean) to authenticated;

create or replace function public.generar_seguimientos_b2b()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_semana text := to_char(now() at time zone 'America/Santiago', 'IYYY-IW');
  v_n integer := 0;
begin
  with nuevas as (
    insert into public.mensajes_salientes (organization_id, canal, cuenta_id, destinatario, nombre_destinatario, regla, origen_ref, clave_dedupe, plantilla, variables, asunto)
    select negocio.organization_id, 'correo', negocio.company_id,
           coalesce(nullif(btrim(cuenta.email), ''), contacto.email),
           coalesce(contacto.full_name, cuenta.name),
           'seguimiento', negocio.id, 'seguimiento:' || negocio.id || ':' || v_semana, 'seguimiento_propuesta',
           jsonb_build_object('nombre', split_part(coalesce(contacto.full_name, cuenta.name), ' ', 1), 'empresa', cuenta.name,
                              'negocio', negocio.name, 'remitente', organizacion.name),
           'Seguimiento: ' || negocio.name
      from public.sales_opportunities negocio
      join public.organizations organizacion on organizacion.id = negocio.organization_id
       and organizacion.edicion = 'center' and coalesce(organizacion.settings->>'seguimiento_automatico', 'false') = 'true'
      join public.sales_companies cuenta on cuenta.id = negocio.company_id
      join public.sales_stages etapa on etapa.id = negocio.stage_id
      left join lateral (
        select c.full_name, c.email from public.sales_contacts c
         where c.company_id = negocio.company_id and nullif(btrim(coalesce(c.email, '')), '') is not null
         order by c.is_decision_maker desc, c.created_at limit 1
      ) contacto on true
     where negocio.status = 'abierta'
       and (etapa.name ilike 'propuesta%' or etapa.name ilike 'negociaci%')
       and negocio.next_action_at is not null and negocio.next_action_at <= now() - interval '7 days'
       and coalesce(nullif(btrim(cuenta.email), ''), contacto.email) is not null
    on conflict (organization_id, clave_dedupe) where clave_dedupe is not null do nothing
    returning 1
  ) select count(*) into v_n from nuevas;
  return v_n;
end;
$$;

revoke all on function public.generar_seguimientos_b2b() from public, anon, authenticated;
grant execute on function public.generar_seguimientos_b2b() to service_role;
