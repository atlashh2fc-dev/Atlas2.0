-- Lista de «no llamar» por teléfono.
--
-- El discador solo evitaba marcar dos veces el mismo número en el mismo
-- instante. No sabía que ese número ya había dicho «no me llamen más» en otro
-- lead. Medido el 24-09-2026 sobre la cola de Equifax (80.030 leads): 208 leads
-- comparten teléfono con una ficha de Geimser cerrada como NUMERO ERRONEO (139),
-- CARTERIZADO (27), CLIENTE MOLESTO (18), FUERA DE SERVICIO (17), QUIEBRA (7) o
-- NO SUJETO A VENTA (2) (un lead puede estar en más de un motivo); el
-- historial de llamadas agrega los que se tipificaron así en una llamada
-- aunque la ficha diga otra cosa.
--
-- La lista vive por teléfono canónico (canonical_chile_phone) y por empresa.
-- Se alimenta sola al cerrar una llamada con un motivo sensible, se carga hoy
-- desde el historial (Atlas 2.0, Atlas 1 migrado y la tipificación de cada
-- ficha) y un admin o supervisor puede agregar o levantar filas a mano. No se
-- borra: levantar una fila deja quién y por qué.
--
-- Alcance:
--   * Lo que es de la persona o del número (molesto, número erróneo, fuera de
--     servicio, quiebra) vale para toda la empresa: todas las campañas salen
--     con el mismo número de origen.
--   * Lo comercial (carterizado, no sujeto a venta) es un hecho del cliente
--     final, no de una campaña: una empresa carterizada en «Equifax Imagen» lo
--     está para todas las campañas de Equifax. Vale para las campañas con el
--     mismo campaigns.dialer_client_key; si la campaña no tiene cliente, solo
--     para ella. Otro cliente de la misma empresa sí puede ofrecerle algo.
--
-- Único punto de consulta para la aplicación: dialer_phone_block_reason y
-- dialer_lead_block_reason (SECURITY DEFINER, con frontera de empresa). La
-- tabla solo la leen admin y supervisor.

-- Cliente comercial dueño de la campaña. Las campañas de Equifax de Geimser se
-- reconocen por el nombre, igual que management_requires_equifax_data.
alter table public.campaigns add column if not exists dialer_client_key text;

comment on column public.campaigns.dialer_client_key is
  'Cliente comercial de la campaña (p. ej. equifax). Las supresiones comerciales (carterizado, no sujeto a venta) valen para todas las campañas de la empresa con el mismo valor.';

update public.campaigns
set dialer_client_key = 'equifax'
where dialer_client_key is null
  and organization_id = 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'
  and name ilike '%equifax%';

create table if not exists public.dialer_phone_suppressions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Alcance: ambos null = toda la empresa; campaign_id = solo esa campaña;
  -- client_key = las campañas de ese cliente.
  campaign_id uuid references public.campaigns(id) on delete cascade,
  client_key text,
  phone text not null,
  reason text not null,
  source text not null default 'manual',
  source_lead_id uuid references public.leads(id) on delete set null,
  source_call_id uuid references public.calls(id) on delete set null,
  -- El texto tal cual se tipificó, para auditar la clasificación.
  source_reason text,
  notes text,
  -- Un número fuera de servicio se reasigna con el tiempo; el resto no vence.
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  lifted_at timestamptz,
  lifted_by uuid references public.profiles(id) on delete set null,
  lifted_reason text,
  constraint dialer_phone_suppressions_phone_check check (phone ~ '^[0-9]{8,15}$'),
  constraint dialer_phone_suppressions_scope_check check (campaign_id is null or client_key is null),
  constraint dialer_phone_suppressions_reason_check check (reason in (
    'cliente_molesto', 'numero_erroneo', 'fuera_de_servicio', 'cliente_carterizado',
    'quiebra_o_cierre', 'no_sujeto_a_venta', 'pidio_no_llamar', 'otro'
  )),
  constraint dialer_phone_suppressions_source_check check (source in (
    'tipificacion', 'atlas1', 'ficha', 'manual'
  ))
);

-- Una fila por llamada: si dos llamadas dicen CLIENTE MOLESTO y se corrige una,
-- la otra sigue suprimiendo. Las filas sin llamada son una por ficha (o una
-- manual) por teléfono, alcance y motivo, por la misma razón.
create unique index if not exists dialer_phone_suppressions_call_uidx
  on public.dialer_phone_suppressions (source_call_id)
  where source_call_id is not null and lifted_at is null;
create unique index if not exists dialer_phone_suppressions_active_uidx
  on public.dialer_phone_suppressions (
    organization_id, phone,
    coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(client_key, ''),
    reason, source,
    coalesce(source_lead_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where lifted_at is null and source_call_id is null;
create index if not exists dialer_phone_suppressions_lookup_idx
  on public.dialer_phone_suppressions (organization_id, phone)
  where lifted_at is null;
create index if not exists dialer_phone_suppressions_lead_idx
  on public.dialer_phone_suppressions (source_lead_id)
  where source_lead_id is not null;
create index if not exists dialer_phone_suppressions_campaign_idx
  on public.dialer_phone_suppressions (campaign_id)
  where campaign_id is not null;

comment on table public.dialer_phone_suppressions is
  'Lista de no llamar por teléfono canónico y empresa (campaign_id y client_key null = toda la empresa). Ningún intento de discado sale hacia un teléfono con una fila vigente.';

-- ---------------------------------------------------------------------------
-- Qué motivo de cierre suprime el teléfono. Compara el texto normalizado
-- (mayúsculas, sin tildes ni signos) y anclado al inicio, para no confundir
-- «OCUPADO | CIERRE AUTOMATICO...» con «...EN QUIEBRA O PROCESO DE CIERRE».
-- ---------------------------------------------------------------------------
create or replace function public.dialer_suppression_reason(p_reason text, p_status text default null)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $$
  with motivo as (select public.normalize_management_text(p_reason) as texto)
  select case
    when texto ~ '^CLIENTE MOLESTO' then 'cliente_molesto'
    when texto ~ '^(NUMERO ERRONEO|NO CORRESPONDE)' then 'numero_erroneo'
    when texto ~ '^((TELEFONO|NUMERO) )?FUERA DE SERVICIO' or p_status = 'out_of_service' then 'fuera_de_servicio'
    when texto ~ '^((CLIENTE|CTE) )?CARTERIZADO' then 'cliente_carterizado'
    when texto ~ '^SE DECLARA EN QUIEBRA' then 'quiebra_o_cierre'
    when texto ~ '^CLIENTE NO SUJETO A VENTA' then 'no_sujeto_a_venta'
  end
  from motivo;
$$;

-- Carterizado y no sujeto a venta son comerciales (cliente o campaña); lo
-- demás, de la empresa.
create or replace function public.dialer_suppression_is_campaign_scoped(p_reason text)
returns boolean
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $$
  select p_reason in ('cliente_carterizado', 'no_sujeto_a_venta');
$$;

create or replace function public.dialer_suppression_default_expiry(p_reason text, p_from timestamptz)
returns timestamptz
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $$
  select case when p_reason = 'fuera_de_servicio' then p_from + interval '180 days' end;
$$;

-- ¿Hasta cuándo está suprimido este teléfono para esta campaña? 'infinity' si
-- no vence, null si no está. Interna (la usan el claim, los disparadores y el
-- resguardo de dial_attempts): SECURITY DEFINER para que funcione en cualquier
-- contexto y cerrada a usuarios, que consultan por dialer_phone_block_reason.
create or replace function public.dialer_phone_suppressed_until(
  p_organization_id uuid,
  p_campaign_id uuid,
  p_phone text
)
returns timestamptz
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select max(coalesce(suppression.expires_at, 'infinity'::timestamptz))
  from public.dialer_phone_suppressions suppression
  left join public.campaigns campaign on campaign.id = p_campaign_id
  where suppression.organization_id = p_organization_id
    and suppression.phone = public.canonical_chile_phone(p_phone)
    and suppression.lifted_at is null
    and (suppression.expires_at is null or suppression.expires_at > now())
    and (
      (suppression.campaign_id is null and suppression.client_key is null)
      or suppression.campaign_id = p_campaign_id
      or suppression.client_key = campaign.dialer_client_key
    );
$$;

create or replace function public.dialer_phone_is_suppressed(
  p_organization_id uuid,
  p_campaign_id uuid,
  p_phone text
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select public.dialer_phone_suppressed_until(p_organization_id, p_campaign_id, p_phone) is not null;
$$;

-- Motivo vigente que bloquea el teléfono, o null. Para la pantalla y las
-- llamadas manuales: cualquier usuario de la empresa puede preguntar (un
-- ejecutivo necesita saber que no debe marcar), pero solo por su empresa y
-- solo recibe el motivo, nunca la fila.
create or replace function public.dialer_phone_block_reason(p_campaign_id uuid, p_phone text)
returns text
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_organization_id uuid;
begin
  select campaign.organization_id into v_organization_id
  from public.campaigns campaign
  where campaign.id = p_campaign_id;
  -- can_access_org(null) es verdadero: una campaña inexistente no pasa.
  if v_organization_id is null
    or not (public.can_access_org(v_organization_id) or public.is_platform_owner()) then
    raise exception 'El dato pertenece a otra empresa' using errcode = '42501';
  end if;

  return (
    select suppression.reason
    from public.dialer_phone_suppressions suppression
    left join public.campaigns campaign on campaign.id = p_campaign_id
    where suppression.organization_id = v_organization_id
      and suppression.phone = public.canonical_chile_phone(p_phone)
      and suppression.lifted_at is null
      and (suppression.expires_at is null or suppression.expires_at > now())
      and (
        (suppression.campaign_id is null and suppression.client_key is null)
        or suppression.campaign_id = p_campaign_id
        or suppression.client_key = campaign.dialer_client_key
      )
    order by suppression.created_at desc
    limit 1
  );
end;
$$;

create or replace function public.dialer_lead_block_reason(p_lead_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_lead record;
begin
  select lead.organization_id, lead.campaign_id, lead.phone into v_lead
  from public.leads lead
  where lead.id = p_lead_id;
  if v_lead.organization_id is null
    or not (public.can_access_org(v_lead.organization_id) or public.is_platform_owner()) then
    raise exception 'El dato pertenece a otra empresa' using errcode = '42501';
  end if;
  if v_lead.campaign_id is null or v_lead.phone is null then
    return null;
  end if;
  return public.dialer_phone_block_reason(v_lead.campaign_id, v_lead.phone);
end;
$$;

-- ---------------------------------------------------------------------------
-- Normaliza el teléfono y deja la autoría. La campaña, si viene, tiene que ser
-- de la misma empresa: una fila no puede cruzar la frontera.
-- ---------------------------------------------------------------------------
create or replace function public.dialer_phone_suppressions_normalize()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  new.phone := public.canonical_chile_phone(new.phone);
  if new.phone is null or new.phone !~ '^[0-9]{8,15}$' then
    raise exception 'El teléfono no es válido para la lista de no llamar' using errcode = '22023';
  end if;
  new.client_key := nullif(btrim(lower(new.client_key)), '');

  if new.campaign_id is not null and not exists (
    select 1 from public.campaigns campaign
    where campaign.id = new.campaign_id
      and campaign.organization_id = new.organization_id
  ) then
    raise exception 'La campaña pertenece a otra empresa' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, (select auth.uid()));
  elsif new.lifted_at is not null and old.lifted_at is null then
    new.lifted_by := coalesce(new.lifted_by, (select auth.uid()));
  end if;
  return new;
end;
$$;

drop trigger if exists dialer_phone_suppressions_normalize on public.dialer_phone_suppressions;
create trigger dialer_phone_suppressions_normalize
  before insert or update on public.dialer_phone_suppressions
  for each row execute function public.dialer_phone_suppressions_normalize();

-- ---------------------------------------------------------------------------
-- Seguridad por fila: solo la propia empresa; la ven y la administran admin y
-- supervisor. Nadie borra desde la aplicación: se levanta.
-- ---------------------------------------------------------------------------
alter table public.dialer_phone_suppressions enable row level security;
revoke all on table public.dialer_phone_suppressions from anon;

drop policy if exists dialer_phone_suppressions_organization_isolation on public.dialer_phone_suppressions;
create policy dialer_phone_suppressions_organization_isolation on public.dialer_phone_suppressions
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists dialer_phone_suppressions_select on public.dialer_phone_suppressions;
create policy dialer_phone_suppressions_select on public.dialer_phone_suppressions
  for select to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner());

drop policy if exists dialer_phone_suppressions_insert on public.dialer_phone_suppressions;
create policy dialer_phone_suppressions_insert on public.dialer_phone_suppressions
  for insert to authenticated
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
              or public.is_platform_owner());

drop policy if exists dialer_phone_suppressions_update on public.dialer_phone_suppressions;
create policy dialer_phone_suppressions_update on public.dialer_phone_suppressions
  for update to authenticated
  using ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
         or public.is_platform_owner())
  with check ((select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
              or public.is_platform_owner());

-- ---------------------------------------------------------------------------
-- Alimentación automática: al cerrar una llamada con motivo sensible, una fila
-- por llamada. Si luego se corrige la tipificación, se levanta la fila de esa
-- llamada y solo esa: si otra llamada o la ficha siguen diciendo lo mismo, su
-- fila sigue vigente. Nunca bloquea el cierre: un problema aquí queda como
-- aviso, no como error para el ejecutivo.
-- ---------------------------------------------------------------------------
create or replace function public.dialer_suppress_phone_from_call()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_reason text;
  v_old_reason text;
  v_lead record;
  v_phone text;
  v_at timestamptz;
begin
  v_reason := case
    when new.ended_at is not null and new.discarded_reason is null
      then public.dialer_suppression_reason(new.reason, new.status)
  end;

  if tg_op = 'UPDATE' then
    v_old_reason := case
      when old.ended_at is not null and old.discarded_reason is null
        then public.dialer_suppression_reason(old.reason, old.status)
    end;
    if v_old_reason is not distinct from v_reason then
      return null;
    end if;
    if v_old_reason is not null then
      update public.dialer_phone_suppressions
      set lifted_at = now(),
          lifted_reason = 'Se corrigió la tipificación de la llamada'
      where source_call_id = new.id
        and lifted_at is null
        and source in ('tipificacion', 'atlas1');
    end if;
  end if;

  if v_reason is null then
    return null;
  end if;

  begin
    select lead.organization_id, lead.campaign_id, lead.phone, campaign.dialer_client_key
    into v_lead
    from public.leads lead
    left join public.campaigns campaign on campaign.id = lead.campaign_id
    where lead.id = new.lead_id;

    v_phone := public.canonical_chile_phone(v_lead.phone);
    if v_lead.organization_id is null or v_phone is null or v_phone !~ '^[0-9]{8,15}$' then
      return null;
    end if;

    v_at := coalesce(new.ended_at, now());
    if public.dialer_suppression_default_expiry(v_reason, v_at) <= now() then
      return null;
    end if;

    insert into public.dialer_phone_suppressions (
      organization_id, campaign_id, client_key, phone, reason, source,
      source_lead_id, source_call_id, source_reason, expires_at, created_at, created_by
    )
    values (
      v_lead.organization_id,
      case when public.dialer_suppression_is_campaign_scoped(v_reason) and v_lead.dialer_client_key is null
        then v_lead.campaign_id end,
      case when public.dialer_suppression_is_campaign_scoped(v_reason) then v_lead.dialer_client_key end,
      v_phone,
      v_reason,
      case when new.legacy_call_id is not null then 'atlas1' else 'tipificacion' end,
      new.lead_id,
      new.id,
      new.reason,
      public.dialer_suppression_default_expiry(v_reason, v_at),
      v_at,
      new.agent_id
    )
    on conflict do nothing;
  exception when others then
    raise warning 'No se pudo registrar el teléfono en la lista de no llamar (llamada %): %', new.id, sqlerrm;
  end;

  return null;
end;
$$;

drop trigger if exists calls_suppress_sensitive_phone on public.calls;
create trigger calls_suppress_sensitive_phone
  after insert or update of reason, status, ended_at, discarded_reason on public.calls
  for each row execute function public.dialer_suppress_phone_from_call();

-- Las filas cargadas desde la ficha (sin llamada) se levantan si la ficha deja
-- de decir ese motivo.
create or replace function public.dialer_lift_ficha_suppression()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_old_reason text := public.dialer_suppression_reason(old.tipificacion_actual);
begin
  if v_old_reason is null
    or v_old_reason is not distinct from public.dialer_suppression_reason(new.tipificacion_actual) then
    return null;
  end if;
  update public.dialer_phone_suppressions
  set lifted_at = now(),
      lifted_reason = 'La ficha ya no tiene esa tipificación'
  where source_lead_id = new.id
    and source = 'ficha'
    and reason = v_old_reason
    and lifted_at is null;
  return null;
exception when others then
  raise warning 'No se pudo levantar la supresión de la ficha %: %', new.id, sqlerrm;
  return null;
end;
$$;

drop trigger if exists leads_lift_ficha_suppression on public.leads;
create trigger leads_lift_ficha_suppression
  after update of tipificacion_actual on public.leads
  for each row
  when (old.tipificacion_actual is distinct from new.tipificacion_actual)
  execute function public.dialer_lift_ficha_suppression();

-- ---------------------------------------------------------------------------
-- Resguardo final: ningún intento de discado (pool, agenda personal o voz IA)
-- nace hacia un teléfono suprimido, lo cree quien lo cree. La fila
-- simplemente no se inserta; los claim ya los filtran para no perder turnos,
-- esto es la red por si un camino nuevo se olvida de hacerlo.
-- ---------------------------------------------------------------------------
create or replace function public.dialer_attempts_block_suppressed()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if public.dialer_phone_is_suppressed(
    (select campaign.organization_id from public.campaigns campaign where campaign.id = new.campaign_id),
    new.campaign_id,
    new.phone
  ) then
    raise warning 'Intento hacia un teléfono en la lista de no llamar descartado (lead %)', new.lead_id;
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists dial_attempts_block_suppressed on public.dial_attempts;
create trigger dial_attempts_block_suppressed
  before insert on public.dial_attempts
  for each row execute function public.dialer_attempts_block_suppressed();

-- ---------------------------------------------------------------------------
-- Carga inicial desde el historial. Para las llamadas de Atlas 1 se usa el
-- número que realmente se marcó (mig_a1_calls.phone_number) cuando la tabla de
-- carga todavía existe; si no, el teléfono actual del lead.
-- ---------------------------------------------------------------------------
create temporary table _llamada_legada_fono (legacy_call_id text primary key, phone text) on commit drop;

do $$
begin
  if to_regclass('public.mig_a1_calls') is not null then
    execute $sql$
      insert into _llamada_legada_fono (legacy_call_id, phone)
      select distinct on (legacy_call_id) legacy_call_id, phone_number
      from public.mig_a1_calls
      where nullif(btrim(phone_number), '') is not null
      order by legacy_call_id
    $sql$;
  end if;
end;
$$;

with historial as (
  -- Llamadas cerradas con motivo sensible (Atlas 2.0 y Atlas 1 migrado): una
  -- fila por llamada.
  select
    lead.organization_id,
    lead.campaign_id,
    campaign.dialer_client_key,
    public.canonical_chile_phone(coalesce(legado.phone, lead.phone)) as phone,
    public.dialer_suppression_reason(call.reason, call.status) as reason,
    case when call.legacy_call_id is not null then 'atlas1' else 'tipificacion' end as source,
    lead.id as source_lead_id,
    call.id as source_call_id,
    call.reason as source_reason,
    coalesce(call.ended_at, call.updated_at, call.created_at) as at,
    call.agent_id as created_by
  from public.calls call
  join public.leads lead on lead.id = call.lead_id
  left join public.campaigns campaign on campaign.id = lead.campaign_id
  left join _llamada_legada_fono legado on legado.legacy_call_id = call.legacy_call_id
  where call.ended_at is not null
    and call.discarded_reason is null
    and (call.status = 'out_of_service'
      or call.reason ~* '(molest|erron|corresponde|servicio|carteriz|quiebra|sujeto)')
  union all
  -- La tipificación vigente de la ficha, solo si no hay una llamada con ese
  -- mismo motivo: la llamada sabe qué número se marcó, la ficha solo sabe el
  -- teléfono de hoy (que pudo cambiar después del «número erróneo»).
  select
    lead.organization_id,
    lead.campaign_id,
    campaign.dialer_client_key,
    public.canonical_chile_phone(lead.phone),
    public.dialer_suppression_reason(lead.tipificacion_actual),
    'ficha',
    lead.id,
    null::uuid,
    lead.tipificacion_actual,
    coalesce(lead.managed_at, lead.updated_at),
    lead.managed_by
  from public.leads lead
  left join public.campaigns campaign on campaign.id = lead.campaign_id
  where lead.tipificacion_actual ~* '(molest|erron|corresponde|servicio|carteriz|quiebra|sujeto)'
    and not exists (
      select 1
      from public.calls call
      where call.lead_id = lead.id
        and call.ended_at is not null
        and call.discarded_reason is null
        and public.dialer_suppression_reason(call.reason, call.status)
            = public.dialer_suppression_reason(lead.tipificacion_actual)
    )
), candidatas as (
  select
    historial.*,
    case when public.dialer_suppression_is_campaign_scoped(historial.reason) and historial.dialer_client_key is null
      then historial.campaign_id end as scope_campaign_id,
    case when public.dialer_suppression_is_campaign_scoped(historial.reason)
      then historial.dialer_client_key end as scope_client_key,
    public.dialer_suppression_default_expiry(historial.reason, historial.at) as expires_at
  from historial
  where historial.reason is not null
    and historial.organization_id is not null
    and historial.phone ~ '^[0-9]{8,15}$'
)
insert into public.dialer_phone_suppressions (
  organization_id, campaign_id, client_key, phone, reason, source,
  source_lead_id, source_call_id, source_reason, expires_at, created_at, created_by
)
select
  organization_id, scope_campaign_id, scope_client_key, phone, reason, source,
  source_lead_id, source_call_id, source_reason, expires_at, at, created_by
from candidatas
where expires_at is null or expires_at > now()
on conflict do nothing;

revoke all on function public.dialer_suppression_reason(text, text) from public, anon;
revoke all on function public.dialer_suppression_is_campaign_scoped(text) from public, anon;
revoke all on function public.dialer_suppression_default_expiry(text, timestamptz) from public, anon;
revoke all on function public.dialer_phone_suppressed_until(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.dialer_phone_is_suppressed(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.dialer_phone_block_reason(uuid, text) from public, anon;
revoke all on function public.dialer_lead_block_reason(uuid) from public, anon;
revoke all on function public.dialer_phone_suppressions_normalize() from public, anon, authenticated;
revoke all on function public.dialer_suppress_phone_from_call() from public, anon, authenticated;
revoke all on function public.dialer_lift_ficha_suppression() from public, anon, authenticated;
revoke all on function public.dialer_attempts_block_suppressed() from public, anon, authenticated;
grant execute on function public.dialer_suppression_reason(text, text) to authenticated, service_role;
grant execute on function public.dialer_suppression_is_campaign_scoped(text) to authenticated, service_role;
grant execute on function public.dialer_suppression_default_expiry(text, timestamptz) to authenticated, service_role;
grant execute on function public.dialer_phone_suppressed_until(uuid, uuid, text) to service_role;
grant execute on function public.dialer_phone_is_suppressed(uuid, uuid, text) to service_role;
grant execute on function public.dialer_phone_block_reason(uuid, text) to authenticated, service_role;
grant execute on function public.dialer_lead_block_reason(uuid) to authenticated, service_role;
