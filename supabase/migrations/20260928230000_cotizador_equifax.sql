-- Cotizador Equifax dentro de la ficha.
--
-- El equipo cotizaba en una página aparte (CotizadorGo!) que guardaba todo en
-- el navegador de cada ejecutivo y enviaba copiando y pegando en Gmail. Ahora
-- se cotiza desde la gestión: cada propuesta enviada queda en
-- equifax_cotizaciones, ligada al registro y a la gestión, y la firma del
-- correo sale del perfil del ejecutivo.

-- ---------------------------------------------------------------------------
-- Firma comercial del ejecutivo. El nombre ya está en profiles.full_name.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists cargo_comercial text,
  add column if not exists whatsapp_comercial text,
  add column if not exists correo_comercial text,
  add column if not exists firma_comercial text;

comment on column public.profiles.cargo_comercial is 'Cargo que firma las propuestas (p. ej. Ejecutiva Comercial).';
comment on column public.profiles.whatsapp_comercial is 'WhatsApp que aparece en la firma de las propuestas, +569XXXXXXXX.';
comment on column public.profiles.correo_comercial is 'Correo que aparece en la firma; si falta, se usa el de acceso.';
comment on column public.profiles.firma_comercial is 'Frase bajo el nombre en la firma de las propuestas.';

create or replace function public.guardar_mi_firma_comercial(
  p_cargo text,
  p_whatsapp text,
  p_correo text,
  p_firma text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_whatsapp text := nullif(regexp_replace(coalesce(p_whatsapp, ''), '[^0-9+]', '', 'g'), '');
  v_correo text := nullif(lower(btrim(coalesce(p_correo, ''))), '');
begin
  if v_actor is null then
    raise exception 'No autenticado.';
  end if;
  if v_whatsapp is not null and v_whatsapp !~ '^\+569[0-9]{8}$' then
    raise exception 'El WhatsApp va como +569 y ocho dígitos.';
  end if;
  if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Revisa el correo de la firma.';
  end if;
  update public.profiles
  set cargo_comercial = nullif(left(btrim(coalesce(p_cargo, '')), 80), ''),
      whatsapp_comercial = v_whatsapp,
      correo_comercial = v_correo,
      firma_comercial = nullif(left(btrim(coalesce(p_firma, '')), 160), ''),
      updated_at = now()
  where id = v_actor;
end;
$$;

revoke all on function public.guardar_mi_firma_comercial(text, text, text, text) from public, anon;
grant execute on function public.guardar_mi_firma_comercial(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Cotizaciones enviadas.
-- ---------------------------------------------------------------------------
create table if not exists public.equifax_cotizaciones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  call_id uuid references public.calls(id) on delete set null,
  agent_id uuid not null references public.profiles(id),
  canal text not null check (canal in ('correo', 'whatsapp')),
  destinatario text not null check (length(btrim(destinatario)) between 3 and 320),
  asunto text,
  -- La configuración de cada línea (producto y tramo) y lo que se calculó con
  -- ella, congelado: si mañana cambia la tabla, esto sigue diciendo qué se ofreció.
  lineas jsonb not null check (jsonb_typeof(lineas) = 'array' and jsonb_array_length(lineas) between 1 and 12),
  productos text[] not null,
  uf_mensual numeric(12, 4) not null default 0,
  uf_unico numeric(12, 4) not null default 0,
  uf_anual numeric(12, 4) not null default 0,
  clp_total numeric(14, 0) not null default 0,
  valor_uf numeric(10, 2) not null check (valor_uf > 0),
  -- enviando → enviada | fallida (correo); whatsapp_abierto: se abrió WhatsApp
  -- con el mensaje listo, el envío lo confirma el ejecutivo en su teléfono.
  estado text not null check (estado in ('enviando', 'enviada', 'fallida', 'whatsapp_abierto')),
  proveedor_id text,
  error text,
  created_at timestamptz not null default now(),
  enviada_at timestamptz
);

create index if not exists equifax_cotizaciones_lead_idx on public.equifax_cotizaciones (lead_id, created_at desc);
create index if not exists equifax_cotizaciones_agent_idx on public.equifax_cotizaciones (agent_id, created_at desc);
create index if not exists equifax_cotizaciones_org_idx on public.equifax_cotizaciones (organization_id, created_at desc);
create index if not exists equifax_cotizaciones_call_idx on public.equifax_cotizaciones (call_id) where call_id is not null;

comment on table public.equifax_cotizaciones is
  'Propuestas Equifax enviadas desde la ficha (correo por el buzón de la empresa o WhatsApp). Las crea registrar_cotizacion_equifax; el servidor cierra el estado del correo.';

alter table public.equifax_cotizaciones enable row level security;
revoke all on table public.equifax_cotizaciones from anon;
revoke insert, update, delete on table public.equifax_cotizaciones from authenticated;
grant select on table public.equifax_cotizaciones to authenticated;

drop policy if exists equifax_cotizaciones_organization_isolation on public.equifax_cotizaciones;
create policy equifax_cotizaciones_organization_isolation on public.equifax_cotizaciones
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

-- Supervisión y admin ven todas; el ejecutivo, las suyas y las de los
-- registros que tiene a su nombre (para no volver a cotizar a ciegas).
drop policy if exists equifax_cotizaciones_select on public.equifax_cotizaciones;
create policy equifax_cotizaciones_select on public.equifax_cotizaciones
  for select to authenticated
  using (
    (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
    or agent_id = (select auth.uid())
    or public.is_platform_owner()
    or exists (
      select 1 from public.leads lead
      where lead.id = equifax_cotizaciones.lead_id
        and (select auth.uid()) in (lead.assigned_to, lead.managed_by)
    )
  );

-- ---------------------------------------------------------------------------
-- Registrar una cotización antes de enviarla. Valida que quien la manda pueda
-- gestionar el registro y que la gestión sea suya y siga abierta.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_cotizacion_equifax(
  p_lead_id uuid,
  p_call_id uuid,
  p_canal text,
  p_destinatario text,
  p_asunto text,
  p_lineas jsonb,
  p_productos text[],
  p_uf_mensual numeric,
  p_uf_unico numeric,
  p_uf_anual numeric,
  p_clp_total numeric,
  p_valor_uf numeric
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role;
  v_lead public.leads%rowtype;
  v_call public.calls%rowtype;
  v_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception 'No autenticado.';
  end if;
  select role into v_role from public.profiles where id = v_actor and active;
  if v_role is null then
    raise exception 'Tu usuario no está activo.';
  end if;
  if p_canal not in ('correo', 'whatsapp') then
    raise exception 'La propuesta sale por correo o por WhatsApp.';
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if not found then
    raise exception 'El registro no existe.';
  end if;
  perform public.assert_org_access(v_lead.organization_id);

  if not public.management_requires_equifax_data(
    coalesce(v_lead.workflow_id, (select workflow_id from public.campaigns where id = v_lead.campaign_id)),
    v_lead.campaign_id
  ) then
    raise exception 'La campaña de este registro no es de Equifax.';
  end if;

  if p_call_id is not null then
    select * into v_call from public.calls where id = p_call_id and lead_id = p_lead_id;
    if not found then
      raise exception 'La gestión no corresponde a este registro.';
    end if;
  end if;

  if v_role = 'agente' then
    if v_call.id is null or v_call.agent_id is distinct from v_actor or v_call.ended_at is not null then
      raise exception 'Cotiza desde tu gestión abierta de este registro.';
    end if;
  end if;

  insert into public.equifax_cotizaciones (
    organization_id, lead_id, campaign_id, call_id, agent_id, canal, destinatario, asunto,
    lineas, productos, uf_mensual, uf_unico, uf_anual, clp_total, valor_uf, estado, enviada_at
  )
  values (
    v_lead.organization_id, p_lead_id, v_lead.campaign_id, p_call_id, v_actor, p_canal,
    left(btrim(p_destinatario), 320), left(p_asunto, 500),
    p_lineas, coalesce(p_productos, '{}'),
    coalesce(p_uf_mensual, 0), coalesce(p_uf_unico, 0), coalesce(p_uf_anual, 0), coalesce(p_clp_total, 0),
    p_valor_uf,
    case when p_canal = 'whatsapp' then 'whatsapp_abierto' else 'enviando' end,
    case when p_canal = 'whatsapp' then v_now end
  )
  returning id into v_id;

  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    p_lead_id, v_lead.crm_entity_id, v_actor, 'lead.equifax_quote_sent',
    jsonb_build_object(
      'cotizacion_id', v_id,
      'call_id', p_call_id,
      'canal', p_canal,
      'productos', to_jsonb(coalesce(p_productos, '{}')),
      'uf_mensual', p_uf_mensual
    )
  );

  return v_id;
end;
$$;

revoke all on function public.registrar_cotizacion_equifax(uuid, uuid, text, text, text, jsonb, text[], numeric, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.registrar_cotizacion_equifax(uuid, uuid, text, text, text, jsonb, text[], numeric, numeric, numeric, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- El buzón de empresa del contact center lee las respuestas, pero no crea
-- cuentas: ligar un correo a una ficha de cuentas (sales_companies) es cosa de
-- las clínicas. Sin esto, cada correo que llegara al buzón de Geimser abría
-- una cuenta nueva.
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
  select mailbox.organization_id into v_org
    from public.inbound_mailboxes mailbox
    join public.organizations organizacion on organizacion.id = mailbox.organization_id
   where mailbox.id = v_email.mailbox_id
     and mailbox.campaign_id is null
     and organizacion.edicion is distinct from 'center';
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
