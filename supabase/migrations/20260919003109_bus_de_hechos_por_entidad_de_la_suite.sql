-- La suite necesita un bus de hechos por ENTIDAD, no por lead.
--
-- external_lead_events cuelga de campaign_id y de un lote de importacion: es la
-- tuberia por la que entran prospectos, no un bus entre modulos. Y 16 de los 21
-- clientes que factura Financiero no tienen lead alguno -- nunca fueron
-- prospectos, llegaron por referencia o por la web. Colgar sus facturas de un
-- lead inexistente las haria invisibles justo para los clientes que mas pagan.
--
-- Por eso el hecho se ancla en crm_entities, que es el maestro compartido de la
-- suite, y la ficha del lead lo alcanza a traves de su crm_entity_id.

create table if not exists public.suite_entity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  crm_entity_id uuid not null references public.crm_entities(id) on delete cascade,
  module text not null,
  event_type text not null,
  external_id text not null,
  occurred_at timestamptz not null,
  title text not null,
  amount numeric,
  currency_code text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suite_entity_events_module_not_blank check (btrim(module) <> ''),
  constraint suite_entity_events_event_type_not_blank check (btrim(event_type) <> ''),
  constraint suite_entity_events_external_id_not_blank check (btrim(external_id) <> ''),
  constraint suite_entity_events_title_not_blank check (btrim(title) <> '')
);

comment on table public.suite_entity_events is
  'Hechos que otros modulos de la suite declaran sobre una entidad del maestro. '
  'Un reintento no duplica: la identidad del hecho es (module, external_id).';

-- Entrega y reintento no son lo mismo que efecto unico. La clave del modulo de
-- origen es lo que hace idempotente al publicador.
create unique index if not exists suite_entity_events_module_external_key
  on public.suite_entity_events (module, external_id);

create index if not exists suite_entity_events_entidad_idx
  on public.suite_entity_events (crm_entity_id, occurred_at desc);

drop trigger if exists suite_entity_events_set_updated_at on public.suite_entity_events;
create trigger suite_entity_events_set_updated_at
before update on public.suite_entity_events
for each row execute function public.set_updated_at();

alter table public.suite_entity_events enable row level security;

-- Se lee dentro de la organizacion dueña del hecho; nunca fuera de ella.
drop policy if exists suite_entity_events_select on public.suite_entity_events;
create policy suite_entity_events_select on public.suite_entity_events
  for select to authenticated
  using (organization_id = any (public.current_org_ids()));

drop policy if exists suite_entity_events_organization_isolation on public.suite_entity_events;
create policy suite_entity_events_organization_isolation on public.suite_entity_events
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

-- Escribe el modulo que es dueño del hecho, mediante su servicio. Ninguna sesion
-- de navegador inventa una factura en la ficha de un cliente.
create or replace function public.registrar_evento_de_suite(
  p_organization_slug text,
  p_crm_entity_id uuid,
  p_module text,
  p_event_type text,
  p_external_id text,
  p_occurred_at timestamptz,
  p_title text,
  p_amount numeric default null,
  p_currency_code text default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.organization_id_by_slug(p_organization_slug);
  v_id uuid;
begin
  if v_org is null then
    raise exception 'registrar_evento_de_suite: no existe la organizacion %', p_organization_slug;
  end if;
  if p_crm_entity_id is null
     or not exists (select 1 from public.crm_entities where id = p_crm_entity_id) then
    raise exception 'registrar_evento_de_suite: la entidad % no existe en el maestro', p_crm_entity_id;
  end if;

  insert into public.suite_entity_events as ev (
    organization_id, crm_entity_id, module, event_type, external_id,
    occurred_at, title, amount, currency_code, payload
  )
  values (
    v_org, p_crm_entity_id, btrim(p_module), btrim(p_event_type), btrim(p_external_id),
    coalesce(p_occurred_at, now()), btrim(p_title), p_amount, p_currency_code,
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (module, external_id) do update
    set crm_entity_id = excluded.crm_entity_id,
        event_type    = excluded.event_type,
        occurred_at   = excluded.occurred_at,
        title         = excluded.title,
        amount        = excluded.amount,
        currency_code = excluded.currency_code,
        payload       = excluded.payload,
        updated_at    = now()
  returning ev.id into v_id;

  return v_id;
end;
$$;

comment on function public.registrar_evento_de_suite(text, uuid, text, text, text, timestamptz, text, numeric, text, jsonb) is
  'Puerta unica por la que un modulo de la suite declara un hecho sobre una entidad del maestro.';

revoke all on function public.registrar_evento_de_suite(text, uuid, text, text, text, timestamptz, text, numeric, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.registrar_evento_de_suite(text, uuid, text, text, text, timestamptz, text, numeric, text, jsonb)
  to service_role;
