-- Campañas de terreno: vendedores que visitan comercios, sin llamar desde Atlas.
--
-- La primera es "Mercado Pago" (Geimser): el vendedor anda con el teléfono,
-- ingresa los comercios que va a visitar, los busca por RUT (Atlas y Bigdata
-- completan lo que se sepa) y registra cada visita con ubicación y foto.
-- El objetivo es vender lectores Point de Mercado Pago.
--
-- El cliente sigue siendo un `lead` (búsqueda por RUT, ficha y reportes de
-- siempre). Lo propio del terreno vive aparte:
--   * terreno_fichas  — una por cliente: etapa del embudo, datos del comercio
--                       y la etapa más alta alcanzada (para el embudo).
--   * terreno_visitas — cada visita con GPS, foto y el resultado.
--
-- Embudo: no_visitado → visitado → interesado → documentos → vendido.
-- Salida: descartado, con motivo obligatorio (no_interesado, cerrado,
-- no_ubicado).
--
-- El vendedor es un `agente` que pertenece a la campaña (campaign_agents).
-- Los agentes no insertan leads por RLS; todo pasa por las funciones de
-- abajo, que validan campaña, empresa y dueño del cliente.

-- `campaigns` la lee el discador todo el tiempo: sin tope de espera, el
-- ALTER choca con él (el primer intento terminó en deadlock).
set local lock_timeout = '5s';

-- ── Modalidad de la campaña ────────────────────────────────────────────────
alter table public.campaigns
  add column if not exists modalidad text not null default 'remota';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_modalidad_check') then
    alter table public.campaigns
      add constraint campaigns_modalidad_check check (modalidad in ('remota', 'terreno'));
  end if;
end $$;

comment on column public.campaigns.modalidad is
  'remota: se gestiona por teléfono, WhatsApp o correo desde Atlas. terreno: vendedores que visitan en persona desde /terreno.';

-- ── Fichas ─────────────────────────────────────────────────────────────────
create table if not exists public.terreno_fichas (
  lead_id          uuid primary key references public.leads(id) on delete cascade,
  campaign_id      uuid not null references public.campaigns(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id),
  vendedor_id      uuid not null references public.profiles(id),
  etapa            text not null default 'no_visitado',
  -- 0 no_visitado · 1 visitado · 2 interesado · 3 documentos · 4 vendido
  etapa_max        smallint not null default 0,
  motivo_salida    text,
  nombre_contacto  text,
  rubro            text,
  direccion        text,
  comuna           text,
  region           text,
  completado_con   text,
  pos_cantidad     integer,
  pos_modelo       text,
  visitas          integer not null default 0,
  ultima_visita_at timestamptz,
  etapa_at         timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint terreno_fichas_etapa_check
    check (etapa in ('no_visitado', 'visitado', 'interesado', 'documentos', 'vendido', 'descartado')),
  constraint terreno_fichas_etapa_max_check check (etapa_max between 0 and 4),
  constraint terreno_fichas_motivo_check
    check (motivo_salida is null or motivo_salida in ('no_interesado', 'cerrado', 'no_ubicado')),
  constraint terreno_fichas_completado_check
    check (completado_con is null or completado_con in ('bigdata', 'atlas')),
  constraint terreno_fichas_pos_check check (pos_cantidad is null or pos_cantidad between 1 and 50)
);

create index if not exists terreno_fichas_campana_vendedor_idx
  on public.terreno_fichas (campaign_id, vendedor_id, etapa);
create index if not exists terreno_fichas_campana_creada_idx
  on public.terreno_fichas (campaign_id, created_at);

-- ── Visitas ────────────────────────────────────────────────────────────────
create table if not exists public.terreno_visitas (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.leads(id) on delete cascade,
  campaign_id     uuid not null references public.campaigns(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  vendedor_id     uuid not null references public.profiles(id),
  etapa_antes     text not null,
  etapa           text not null,
  motivo_salida   text,
  nota            text,
  lat             double precision,
  lng             double precision,
  precision_m     integer,
  sin_ubicacion   text,
  foto_path       text,
  pos_cantidad    integer,
  pos_modelo      text,
  created_at      timestamptz not null default now(),
  constraint terreno_visitas_etapa_check
    check (etapa in ('visitado', 'interesado', 'documentos', 'vendido', 'descartado')),
  constraint terreno_visitas_motivo_check
    check (motivo_salida is null or motivo_salida in ('no_interesado', 'cerrado', 'no_ubicado')),
  constraint terreno_visitas_lat_check check (lat is null or lat between -90 and 90),
  constraint terreno_visitas_lng_check check (lng is null or lng between -180 and 180),
  -- O hay ubicación, o queda escrito por qué no.
  constraint terreno_visitas_ubicacion_check
    check ((lat is not null and lng is not null) or nullif(btrim(coalesce(sin_ubicacion, '')), '') is not null)
);

create index if not exists terreno_visitas_campana_fecha_idx
  on public.terreno_visitas (campaign_id, created_at desc);
create index if not exists terreno_visitas_vendedor_fecha_idx
  on public.terreno_visitas (vendedor_id, created_at desc);
create index if not exists terreno_visitas_lead_idx
  on public.terreno_visitas (lead_id, created_at desc);

-- ── Quién ve qué ───────────────────────────────────────────────────────────
-- Vendedor: lo suyo. Supervisor: lo de los vendedores de sus equipos.
-- Admin: todo lo de su empresa. Nadie escribe directo: solo las funciones.
create or replace function public.terreno_puede_ver(p_vendedor_id uuid, p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select p_organization_id = any(public.current_org_ids())
    and case public.current_role_name()
      when 'admin' then true
      when 'agente' then p_vendedor_id = (select auth.uid())
      when 'supervisor' then exists (
        select 1 from public.profiles vendedor
        where vendedor.id = p_vendedor_id
          and vendedor.team_id = any(public.supervised_team_ids())
      ) or p_vendedor_id = (select auth.uid())
      else false
    end;
$$;

revoke all on function public.terreno_puede_ver(uuid, uuid) from public, anon;
grant execute on function public.terreno_puede_ver(uuid, uuid) to authenticated;

alter table public.terreno_fichas enable row level security;
alter table public.terreno_visitas enable row level security;

drop policy if exists terreno_fichas_leer on public.terreno_fichas;
create policy terreno_fichas_leer on public.terreno_fichas
  for select to authenticated
  using (public.terreno_puede_ver(vendedor_id, organization_id));

drop policy if exists terreno_visitas_leer on public.terreno_visitas;
create policy terreno_visitas_leer on public.terreno_visitas
  for select to authenticated
  using (public.terreno_puede_ver(vendedor_id, organization_id));

revoke insert, update, delete on public.terreno_fichas, public.terreno_visitas from anon, authenticated;
grant select on public.terreno_fichas, public.terreno_visitas to authenticated;

-- ── Fotos ──────────────────────────────────────────────────────────────────
-- Bucket privado. Sube y firma el servidor (service role) después de validar
-- con las funciones de abajo; el navegador nunca escribe directo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('terreno-visitas', 'terreno-visitas', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ── Campañas de terreno a las que llega la persona ─────────────────────────
create or replace function public.terreno_mis_campanas()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select campaign.id, campaign.name
  from public.campaigns campaign
  where campaign.modalidad = 'terreno'
    and campaign.is_active
    and campaign.organization_id = any(public.current_org_ids())
    and (
      public.current_role_name() in ('admin', 'supervisor')
      or exists (
        select 1 from public.campaign_agents member
        where member.campaign_id = campaign.id
          and member.profile_id = (select auth.uid())
      )
    )
  order by campaign.name;
$$;

revoke all on function public.terreno_mis_campanas() from public, anon;
grant execute on function public.terreno_mis_campanas() to authenticated;

-- Lanza si la persona no trabaja en esa campaña de terreno.
create or replace function public.terreno_assert_campana(p_campaign_id uuid)
returns public.campaigns
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_campaign public.campaigns%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado.';
  end if;
  select * into v_campaign
  from public.campaigns
  where id = p_campaign_id and modalidad = 'terreno' and is_active;
  if not found then
    raise exception 'La campaña de terreno no existe o no está activa.';
  end if;
  perform public.assert_org_access(v_campaign.organization_id);
  if public.current_role_name() not in ('admin', 'supervisor') and not exists (
    select 1 from public.campaign_agents member
    where member.campaign_id = p_campaign_id and member.profile_id = (select auth.uid())
  ) then
    raise exception 'No perteneces a esta campaña. Pide a tu supervisor que te agregue.';
  end if;
  return v_campaign;
end;
$$;

revoke all on function public.terreno_assert_campana(uuid) from public, anon;

-- ── Buscar por RUT ─────────────────────────────────────────────────────────
-- Dice si el cliente ya está en la campaña (y de quién es) y propone lo que
-- Atlas ya sabe de ese RUT en la empresa. Bigdata se consulta aparte, desde
-- el servidor, por el puente firmado.
create or replace function public.terreno_buscar_rut(p_campaign_id uuid, p_rut text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_campaign public.campaigns%rowtype := public.terreno_assert_campana(p_campaign_id);
  v_rut text := nullif(public.normalize_lead_rut(p_rut), '');
  v_en_campana jsonb;
  v_atlas jsonb;
begin
  if v_rut is null or not public.rut_es_valido(p_rut) then
    raise exception 'RUT inválido: revisa el dígito verificador.';
  end if;

  select jsonb_build_object(
    'lead_id', lead.id,
    'propio', ficha.vendedor_id = (select auth.uid()),
    'vendedor', vendedor.full_name,
    'etapa', ficha.etapa,
    'nombre', lead.full_name
  )
  into v_en_campana
  from public.leads lead
  left join public.terreno_fichas ficha on ficha.lead_id = lead.id
  left join public.profiles vendedor on vendedor.id = ficha.vendedor_id
  where lead.campaign_id = p_campaign_id
    and (lead.rut is not null and btrim(lead.rut) <> '' and upper(regexp_replace(lead.rut, '[^0-9kK]', '', 'g')) = v_rut)
  order by lead.created_at
  limit 1;

  -- Lo más reciente que la empresa sabe de ese RUT en cualquier campaña.
  select jsonb_strip_nulls(jsonb_build_object(
    'full_name', lead.full_name,
    'phone', lead.phone,
    'email', lead.email,
    'nombre_contacto', coalesce(ficha.nombre_contacto, lead.extra #>> '{ingreso_manual,nombre_contacto}'),
    'region', coalesce(ficha.region, lead.extra #>> '{ingreso_manual,region}'),
    'comuna', coalesce(ficha.comuna, lead.extra #>> '{ingreso_manual,comuna}'),
    'direccion', coalesce(ficha.direccion, lead.extra #>> '{ingreso_manual,direccion}'),
    'rubro', coalesce(ficha.rubro, lead.extra #>> '{ingreso_manual,rubro}')
  ))
  into v_atlas
  from public.leads lead
  left join public.terreno_fichas ficha on ficha.lead_id = lead.id
  where lead.organization_id = v_campaign.organization_id
    and (lead.rut is not null and btrim(lead.rut) <> '' and upper(regexp_replace(lead.rut, '[^0-9kK]', '', 'g')) = v_rut)
  order by lead.updated_at desc
  limit 1;

  return jsonb_build_object('en_campana', v_en_campana, 'atlas', v_atlas);
end;
$$;

revoke all on function public.terreno_buscar_rut(uuid, text) from public, anon;
grant execute on function public.terreno_buscar_rut(uuid, text) to authenticated;

-- Solo claves conocidas y con texto.
create or replace function public.terreno_detalle_limpio(p_detalle jsonb)
returns jsonb
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $$
  select coalesce(jsonb_object_agg(item.key, left(btrim(item.value #>> '{}'), 300)), '{}'::jsonb)
  from jsonb_each(coalesce(p_detalle, '{}'::jsonb)) item
  where item.key in ('nombre_contacto', 'rubro', 'direccion', 'comuna', 'region', 'completado_con')
    and jsonb_typeof(item.value) = 'string'
    and btrim(item.value #>> '{}') <> '';
$$;

-- ── Crear cliente ──────────────────────────────────────────────────────────
create or replace function public.terreno_crear_cliente(
  p_campaign_id uuid,
  p_full_name text,
  p_rut text default null,
  p_phone text default null,
  p_email text default null,
  p_detalle jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_campaign public.campaigns%rowtype := public.terreno_assert_campana(p_campaign_id);
  v_actor uuid := (select auth.uid());
  v_team uuid := (select team_id from public.profiles where id = (select auth.uid()));
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_rut_in text := nullif(btrim(coalesce(p_rut, '')), '');
  v_rut text;
  v_existente record;
  v_detalle jsonb := public.terreno_detalle_limpio(p_detalle);
  v_lead_id uuid;
begin
  if v_full_name is null then
    raise exception 'Escribe el nombre del comercio o de la persona.';
  end if;

  if v_rut_in is not null then
    if not public.rut_es_valido(v_rut_in) then
      raise exception 'El RUT % no es válido: revisa los números y el dígito verificador.', v_rut_in;
    end if;
    v_rut := public.normalize_lead_rut(v_rut_in);

    select lead.id, ficha.vendedor_id, vendedor.full_name as vendedor
    into v_existente
    from public.leads lead
    left join public.terreno_fichas ficha on ficha.lead_id = lead.id
    left join public.profiles vendedor on vendedor.id = ficha.vendedor_id
    where lead.campaign_id = p_campaign_id
      and (lead.rut is not null and btrim(lead.rut) <> '' and upper(regexp_replace(lead.rut, '[^0-9kK]', '', 'g')) = v_rut)
    limit 1;

    if v_existente.id is not null then
      if v_existente.vendedor_id = v_actor then
        return jsonb_build_object('lead_id', v_existente.id, 'duplicate', true);
      end if;
      raise exception 'Este RUT ya está en la campaña con %. Pide a tu supervisor que lo reasigne si corresponde.',
        coalesce(v_existente.vendedor, 'otro vendedor');
    end if;
  end if;

  -- Sin RUT, la base deduplica por teléfono dentro de la campaña.
  if v_rut_in is null and nullif(btrim(coalesce(p_phone, '')), '') is not null and exists (
    select 1 from public.leads lead
    where lead.campaign_id = p_campaign_id
      and lead.rut is null
      and lead.phone is not null and btrim(lead.phone) <> ''
      and regexp_replace(lead.phone, '[^0-9]', '', 'g') = regexp_replace(p_phone, '[^0-9]', '', 'g')
  ) then
    raise exception 'Ya hay un cliente con ese teléfono en la campaña. Búscalo en tus clientes o agrega el RUT.';
  end if;

  insert into public.leads (
    full_name, rut, phone, email, status, team_id, campaign_id, created_by,
    assigned_to, assignment_status, workflow_status, next_action_channel, extra
  )
  values (
    v_full_name,
    v_rut_in,
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(lower(btrim(coalesce(p_email, ''))), ''),
    'nuevo',
    v_team,
    p_campaign_id,
    v_actor,
    v_actor,
    'assigned',
    'pending',
    'in_person',
    jsonb_build_object('source', 'terreno', 'created_from', 'terreno.nuevo')
  )
  returning id into v_lead_id;

  insert into public.terreno_fichas (
    lead_id, campaign_id, organization_id, vendedor_id,
    nombre_contacto, rubro, direccion, comuna, region, completado_con
  )
  values (
    v_lead_id, p_campaign_id, v_campaign.organization_id, v_actor,
    v_detalle ->> 'nombre_contacto', v_detalle ->> 'rubro', v_detalle ->> 'direccion',
    v_detalle ->> 'comuna', v_detalle ->> 'region', v_detalle ->> 'completado_con'
  );

  return jsonb_build_object('lead_id', v_lead_id, 'duplicate', false);
end;
$$;

revoke all on function public.terreno_crear_cliente(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.terreno_crear_cliente(uuid, text, text, text, text, jsonb) to authenticated;

-- ── Completar datos ────────────────────────────────────────────────────────
-- Los campos que llegan vacíos se borran: el formulario siempre manda todo.
create or replace function public.terreno_actualizar_cliente(
  p_lead_id uuid,
  p_full_name text,
  p_rut text default null,
  p_phone text default null,
  p_email text default null,
  p_detalle jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_ficha public.terreno_fichas%rowtype;
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_rut_in text := nullif(btrim(coalesce(p_rut, '')), '');
  v_detalle jsonb := public.terreno_detalle_limpio(p_detalle);
begin
  select * into v_ficha from public.terreno_fichas where lead_id = p_lead_id;
  if not found or not public.terreno_puede_ver(v_ficha.vendedor_id, v_ficha.organization_id) then
    raise exception 'El cliente no existe o no es tuyo.';
  end if;
  if v_full_name is null then
    raise exception 'Escribe el nombre del comercio o de la persona.';
  end if;
  if v_rut_in is not null then
    if not public.rut_es_valido(v_rut_in) then
      raise exception 'El RUT % no es válido: revisa los números y el dígito verificador.', v_rut_in;
    end if;
    if exists (
      select 1 from public.leads other
      where other.campaign_id = v_ficha.campaign_id
        and other.id <> p_lead_id
        and other.rut is not null and btrim(other.rut) <> ''
        and upper(regexp_replace(other.rut, '[^0-9kK]', '', 'g')) = public.normalize_lead_rut(v_rut_in)
    ) then
      raise exception 'Ese RUT ya está en otro cliente de la campaña.';
    end if;
  end if;

  update public.leads
  set full_name = v_full_name,
      rut = v_rut_in,
      phone = nullif(btrim(coalesce(p_phone, '')), ''),
      email = nullif(lower(btrim(coalesce(p_email, ''))), '')
  where id = p_lead_id;

  update public.terreno_fichas
  set nombre_contacto = v_detalle ->> 'nombre_contacto',
      rubro = v_detalle ->> 'rubro',
      direccion = v_detalle ->> 'direccion',
      comuna = v_detalle ->> 'comuna',
      region = v_detalle ->> 'region',
      completado_con = coalesce(v_detalle ->> 'completado_con', completado_con),
      updated_at = now()
  where lead_id = p_lead_id;
end;
$$;

revoke all on function public.terreno_actualizar_cliente(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.terreno_actualizar_cliente(uuid, text, text, text, text, jsonb) to authenticated;

-- ── Registrar visita ───────────────────────────────────────────────────────
-- Solo el vendedor dueño del cliente. La foto ya la subió el servidor a
-- terreno-visitas/<empresa>/<lead>/…; acá solo se valida que sea de ese cliente.
create or replace function public.terreno_registrar_visita(
  p_lead_id uuid,
  p_etapa text,
  p_motivo_salida text default null,
  p_nota text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_precision_m integer default null,
  p_sin_ubicacion text default null,
  p_foto_path text default null,
  p_pos_cantidad integer default null,
  p_pos_modelo text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_ficha public.terreno_fichas%rowtype;
  v_rank smallint;
  v_visita uuid;
  v_status text;
begin
  select * into v_ficha from public.terreno_fichas where lead_id = p_lead_id for update;
  if not found or v_ficha.vendedor_id is distinct from v_actor then
    raise exception 'Solo el vendedor del cliente registra sus visitas.';
  end if;
  perform public.terreno_assert_campana(v_ficha.campaign_id);

  v_rank := case p_etapa
    when 'visitado' then 1 when 'interesado' then 2 when 'documentos' then 3 when 'vendido' then 4
    when 'descartado' then 0 else null end;
  if v_rank is null then
    raise exception 'Elige el resultado de la visita.';
  end if;
  if p_etapa = 'descartado' and coalesce(p_motivo_salida, '') not in ('no_interesado', 'cerrado', 'no_ubicado') then
    raise exception 'Indica por qué no sigue.';
  end if;
  if p_etapa = 'vendido' and coalesce(p_pos_cantidad, 0) < 1 then
    raise exception 'Indica cuántos lectores vendiste.';
  end if;
  if nullif(btrim(coalesce(p_foto_path, '')), '') is null then
    raise exception 'Falta la foto de la visita.';
  end if;
  if p_foto_path not like v_ficha.organization_id::text || '/' || p_lead_id::text || '/%' then
    raise exception 'La foto no corresponde a este cliente.';
  end if;
  if (p_lat is null or p_lng is null) and nullif(btrim(coalesce(p_sin_ubicacion, '')), '') is null then
    raise exception 'Falta la ubicación de la visita.';
  end if;

  insert into public.terreno_visitas (
    lead_id, campaign_id, organization_id, vendedor_id, etapa_antes, etapa, motivo_salida,
    nota, lat, lng, precision_m, sin_ubicacion, foto_path, pos_cantidad, pos_modelo
  )
  values (
    p_lead_id, v_ficha.campaign_id, v_ficha.organization_id, v_actor, v_ficha.etapa, p_etapa,
    case when p_etapa = 'descartado' then p_motivo_salida end,
    nullif(left(btrim(coalesce(p_nota, '')), 1000), ''),
    p_lat, p_lng, p_precision_m,
    case when p_lat is null or p_lng is null then left(btrim(p_sin_ubicacion), 200) end,
    p_foto_path,
    case when p_etapa = 'vendido' then p_pos_cantidad end,
    case when p_etapa = 'vendido' then nullif(left(btrim(coalesce(p_pos_modelo, '')), 80), '') end
  )
  returning id into v_visita;

  update public.terreno_fichas
  set etapa = p_etapa,
      etapa_max = greatest(etapa_max, v_rank),
      motivo_salida = case when p_etapa = 'descartado' then p_motivo_salida end,
      pos_cantidad = case when p_etapa = 'vendido' then p_pos_cantidad else pos_cantidad end,
      pos_modelo = case when p_etapa = 'vendido' then nullif(btrim(coalesce(p_pos_modelo, '')), '') else pos_modelo end,
      visitas = visitas + 1,
      ultima_visita_at = now(),
      etapa_at = case when etapa is distinct from p_etapa then now() else etapa_at end,
      updated_at = now()
  where lead_id = p_lead_id;

  -- El estado general del lead, para las vistas de siempre.
  v_status := case p_etapa
    when 'visitado' then 'contactado'
    when 'interesado' then 'en_gestion'
    when 'documentos' then 'en_gestion'
    when 'vendido' then 'convertido'
    when 'descartado' then case when p_motivo_salida = 'no_ubicado' then 'no_contactado' else 'descartado' end
  end;

  update public.leads
  set status = v_status,
      managed_at = now(),
      managed_by = v_actor,
      observacion_actual = coalesce(nullif(left(btrim(coalesce(p_nota, '')), 1000), ''), observacion_actual)
  where id = p_lead_id;

  return v_visita;
end;
$$;

revoke all on function public.terreno_registrar_visita(uuid, text, text, text, double precision, double precision, integer, text, text, integer, text) from public, anon;
grant execute on function public.terreno_registrar_visita(uuid, text, text, text, double precision, double precision, integer, text, text, integer, text) to authenticated;

-- ── Embudo y productividad ─────────────────────────────────────────────────
-- Por vendedor, en el período:
--   * clientes ingresados y hasta qué etapa llegaron (embudo de la cohorte);
--   * visitas, con cuántas traen GPS y foto (calidad del registro);
--   * ventas cerradas y lectores vendidos (por fecha de la visita de venta);
--   * días con al menos una visita.
-- Admin ve la empresa, supervisor sus equipos, el vendedor solo lo suyo.
create or replace function public.terreno_embudo(
  p_campaign_id uuid,
  p_desde timestamptz,
  p_hasta timestamptz
)
returns table (
  vendedor_id uuid,
  vendedor text,
  clientes integer,
  visitados integer,
  interesados integer,
  documentos integer,
  vendidos integer,
  descartados integer,
  visitas integer,
  visitas_con_gps integer,
  visitas_con_foto integer,
  ventas integer,
  lectores integer,
  dias_activos integer,
  ultima_visita_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_campaign public.campaigns%rowtype := public.terreno_assert_campana(p_campaign_id);
begin
  return query
  with vendedores as (
    select distinct person.id, person.full_name
    from public.profiles person
    where (
        exists (select 1 from public.campaign_agents member
                where member.campaign_id = p_campaign_id and member.profile_id = person.id)
        or exists (select 1 from public.terreno_fichas ficha
                   where ficha.campaign_id = p_campaign_id and ficha.vendedor_id = person.id)
      )
      and public.terreno_puede_ver(person.id, v_campaign.organization_id)
  ),
  cohorte as (
    select ficha.vendedor_id,
      count(*)::int as clientes,
      count(*) filter (where ficha.etapa_max >= 1 or ficha.visitas > 0)::int as visitados,
      count(*) filter (where ficha.etapa_max >= 2)::int as interesados,
      count(*) filter (where ficha.etapa_max >= 3)::int as documentos,
      count(*) filter (where ficha.etapa_max >= 4)::int as vendidos,
      count(*) filter (where ficha.etapa = 'descartado')::int as descartados
    from public.terreno_fichas ficha
    where ficha.campaign_id = p_campaign_id
      and ficha.created_at >= p_desde and ficha.created_at < p_hasta
    group by ficha.vendedor_id
  ),
  actividad as (
    select visita.vendedor_id,
      count(*)::int as visitas,
      count(*) filter (where visita.lat is not null)::int as visitas_con_gps,
      count(*) filter (where visita.foto_path is not null)::int as visitas_con_foto,
      count(*) filter (where visita.etapa = 'vendido' and visita.etapa_antes <> 'vendido')::int as ventas,
      coalesce(sum(visita.pos_cantidad) filter (where visita.etapa = 'vendido' and visita.etapa_antes <> 'vendido'), 0)::int as lectores,
      count(distinct (visita.created_at at time zone 'America/Santiago')::date)::int as dias_activos,
      max(visita.created_at) as ultima_visita_at
    from public.terreno_visitas visita
    where visita.campaign_id = p_campaign_id
      and visita.created_at >= p_desde and visita.created_at < p_hasta
    group by visita.vendedor_id
  )
  select v.id, v.full_name,
    coalesce(c.clientes, 0), coalesce(c.visitados, 0), coalesce(c.interesados, 0),
    coalesce(c.documentos, 0), coalesce(c.vendidos, 0), coalesce(c.descartados, 0),
    coalesce(a.visitas, 0), coalesce(a.visitas_con_gps, 0), coalesce(a.visitas_con_foto, 0),
    coalesce(a.ventas, 0), coalesce(a.lectores, 0), coalesce(a.dias_activos, 0), a.ultima_visita_at
  from vendedores v
  left join cohorte c on c.vendedor_id = v.id
  left join actividad a on a.vendedor_id = v.id
  order by coalesce(a.ventas, 0) desc, coalesce(a.visitas, 0) desc, v.full_name;
end;
$$;

revoke all on function public.terreno_embudo(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.terreno_embudo(uuid, timestamptz, timestamptz) to authenticated;

-- ── Mercado Pago pasa a ser de terreno ─────────────────────────────────────
-- La campaña existía vacía (sin registros ni ejecutivos) desde julio. Se
-- reutiliza: sin canales remotos, porque desde Atlas no se llama a nadie.
update public.campaigns
set modalidad = 'terreno',
    vertical = 'ventas',
    description = 'Venta de lectores Point de Mercado Pago con vendedores en terreno',
    is_active = true
where name = 'Mercado Pago'
  and organization_id = (select id from public.organizations where slug = 'geimser');

update public.campaign_channels
set enabled = false
where campaign_id in (select id from public.campaigns where name = 'Mercado Pago' and modalidad = 'terreno');
