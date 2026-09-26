-- Rotación del número que ve el cliente (caller ID) en el discador.
--
-- La contactabilidad de Equifax ronda el 14 % y todo sale con un solo número
-- (56965906926). Un número que marca miles de veces al día termina etiquetado
-- como spam por los operadores y las apps de bloqueo, y con uno solo tampoco
-- se puede saber si el problema es el número o la base. Se pedirán más números
-- a Siptel; esto deja todo listo para cuando lleguen, sin cambiar nada
-- mientras haya uno solo:
--
--   * dialer_campaign_configs.caller_ids: la lista de números a rotar. Vacía
--     o null => el motor sigue usando caller_id, exactamente como hoy.
--   * dial_attempts.caller_id: el número que se mostró en cada intento. Lo
--     escribe el motor con record_dial_attempt_caller_ids al originar (no se
--     tocan claim_next_dial_targets ni register_dial_event).
--   * get_caller_id_contactability: por campaña, número y día en hora Chile,
--     intentos, contestadas, conectadas y tasas.
--
-- Qué número le toca a cada lead lo decide el motor (dialer-engine/src/dialer/
-- callerId.ts): el mismo para el mismo lead mientras la lista no cambie, para
-- que quien devuelve la llamada reconozca el número.

-- ---------------------------------------------------------------------------
-- Lista de números por campaña
-- ---------------------------------------------------------------------------
alter table public.dialer_campaign_configs
  add column if not exists caller_ids text[];

comment on column public.dialer_campaign_configs.caller_ids is
  'Números que el discador rota como identificador de llamada (56 + número nacional, sin +). Vacío o null: se usa caller_id.';

-- Siptel exige el ANI como 56 + número nacional, sin '+' (docs/siptel-403-
-- resuelto.md). canonical_chile_phone ya deja así lo que se escribe como
-- +56 9 ..., 9 ... o 56...; aquí además se quitan vacíos y repetidos (un
-- número repetido se llevaría el doble de leads) y la lista vacía queda null.
create or replace function public.dialer_normalize_caller_ids(p_caller_ids text[])
returns text[]
language sql
immutable
parallel safe
set search_path to ''
as $$
  select nullif(
    array(
      select numero
      from (
        select public.canonical_chile_phone(valor) as numero, min(orden) as orden
        from unnest(p_caller_ids) with ordinality as item(valor, orden)
        group by 1
      ) normalizados
      where numero is not null
      order by orden
    ),
    '{}'::text[]
  )
$$;

create or replace function public.dialer_campaign_configs_normalize_caller_ids()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  new.caller_ids := public.dialer_normalize_caller_ids(new.caller_ids);
  return new;
end;
$$;

drop trigger if exists dialer_campaign_configs_normalize_caller_ids on public.dialer_campaign_configs;
create trigger dialer_campaign_configs_normalize_caller_ids
  before insert or update of caller_ids on public.dialer_campaign_configs
  for each row execute function public.dialer_campaign_configs_normalize_caller_ids();

-- Tras normalizar, cada elemento tiene que ser un número chileno completo. Un
-- número extranjero o incompleto se rechaza al guardar, no en el carrier.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dialer_configs_caller_ids_check'
      and conrelid = 'public.dialer_campaign_configs'::regclass
  ) then
    alter table public.dialer_campaign_configs
      add constraint dialer_configs_caller_ids_check check (
        caller_ids is null
        or (
          cardinality(caller_ids) between 1 and 50
          and array_to_string(caller_ids, ',', '?') ~ '^56[2-9][0-9]{8}(,56[2-9][0-9]{8})*$'
        )
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Número mostrado en cada intento
-- ---------------------------------------------------------------------------
alter table public.dial_attempts
  add column if not exists caller_id text;

comment on column public.dial_attempts.caller_id is
  'Número que se presentó al cliente en este intento. Null en intentos anteriores al 26-09-2026 o si el motor no alcanzó a registrarlo.';

-- El informe filtra por campaña y fecha de creación del intento.
create index if not exists dial_attempts_campaign_created_idx
  on public.dial_attempts (campaign_id, created_at);

-- Una sola llamada por lote: el motor la dispara en paralelo con los
-- Originate para no demorar el discado. Solo completa intentos sin número
-- (el primero que escribe gana) y no toca estado, así que no despierta los
-- triggers de reintento ni de supresión, que miran status.
create or replace function public.record_dial_attempt_caller_ids(
  p_attempt_ids uuid[],
  p_caller_ids text[]
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_updated integer;
begin
  if coalesce(cardinality(p_attempt_ids), 0) <> coalesce(cardinality(p_caller_ids), 0) then
    raise exception 'Se esperaba un número por intento' using errcode = '22023';
  end if;

  update public.dial_attempts attempt
  set caller_id = btrim(item.caller_id)
  from unnest(p_attempt_ids, p_caller_ids) as item(id, caller_id)
  where attempt.id = item.id
    and attempt.caller_id is null
    and nullif(btrim(item.caller_id), '') is not null;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.record_dial_attempt_caller_ids(uuid[], text[]) from public, anon, authenticated;
grant execute on function public.record_dial_attempt_caller_ids(uuid[], text[]) to service_role;

-- ---------------------------------------------------------------------------
-- Contactabilidad por número
-- ---------------------------------------------------------------------------
-- Mismo patrón que get_contactability_by_hour: SECURITY DEFINER con la
-- frontera de empresa puesta a mano (la seguridad por fila no aplica aquí),
-- solo admin y supervisor, y el supervisor solo en las campañas de su alcance.
-- Cuenta solo el pool: las agendas marcan primero al ejecutivo y su
-- originated_at no dice si el cliente contestó.
--   contestadas = originated_at no nulo (el carrier completó la llamada)
--   conectadas  = bridged_at no nulo (llegó a un ejecutivo)
-- Los intentos sin número registrado salen con caller_id null.
create or replace function public.get_caller_id_contactability(
  p_from date,
  p_to date,
  p_campaign_id uuid default null
)
returns table (
  campaign_id uuid,
  campaign_name text,
  caller_id text,
  dia date,
  intentos integer,
  contestadas integer,
  conectadas integer,
  tasa_contestadas numeric,
  tasa_conexion numeric
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
#variable_conflict use_column
declare
  v_role text := coalesce(public.current_role_name()::text, '');
  v_desde timestamptz;
  v_hasta timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado.' using errcode = '42501';
  end if;
  if v_role not in ('admin', 'supervisor') then
    raise exception 'No tienes permiso para revisar este reporte.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Rango de fechas inválido' using errcode = '22023';
  end if;
  if p_to - p_from > 92 then
    raise exception 'El rango máximo es de 93 días' using errcode = '22023';
  end if;

  perform public.assert_org_access(public.org_of_campaign(p_campaign_id));

  -- Días en hora Chile: [p_from 00:00, p_to + 1 00:00) de America/Santiago.
  v_desde := p_from::timestamp at time zone 'America/Santiago';
  v_hasta := (p_to + 1)::timestamp at time zone 'America/Santiago';

  return query
  with alcance as (
    select c.id, c.name
    from public.campaigns c
    where public.can_access_org(c.organization_id)
      and (p_campaign_id is null or c.id = p_campaign_id)
      and (
        v_role = 'admin'
        or exists (select 1 from public.get_report_scope_campaigns() scope where scope.id = c.id)
      )
  ),
  por_dia as (
    select
      alcance.id as campaign_id,
      alcance.name as campaign_name,
      attempt.caller_id,
      (attempt.created_at at time zone 'America/Santiago')::date as dia,
      count(*)::integer as intentos,
      (count(*) filter (where attempt.originated_at is not null))::integer as contestadas,
      (count(*) filter (where attempt.bridged_at is not null))::integer as conectadas
    from alcance
    join public.dial_attempts attempt on attempt.campaign_id = alcance.id
    where attempt.attempt_kind = 'pool'
      and attempt.created_at >= v_desde
      and attempt.created_at < v_hasta
    group by 1, 2, 3, 4
  )
  select
    por_dia.campaign_id,
    por_dia.campaign_name,
    por_dia.caller_id,
    por_dia.dia,
    por_dia.intentos,
    por_dia.contestadas,
    por_dia.conectadas,
    round(100.0 * por_dia.contestadas / por_dia.intentos, 1),
    round(100.0 * por_dia.conectadas / por_dia.intentos, 1)
  from por_dia
  order by por_dia.dia, por_dia.campaign_name, por_dia.caller_id nulls first;
end;
$$;

comment on function public.get_caller_id_contactability(date, date, uuid) is
  'Intentos del pool por campaña, número mostrado y día (hora Chile): contestadas (originated_at), conectadas (bridged_at) y tasas en %.';

revoke all on function public.get_caller_id_contactability(date, date, uuid) from public, anon;
grant execute on function public.get_caller_id_contactability(date, date, uuid) to authenticated, service_role;

revoke all on function public.dialer_normalize_caller_ids(text[]) from anon;
revoke all on function public.dialer_campaign_configs_normalize_caller_ids() from public, anon, authenticated;
