-- Horario permitido, feriados y política de reintentos del discador, por campaña.
--
-- Hasta hoy el progresivo discaba a cualquier hora si quedaba un ejecutivo
-- «Disponible» (un sábado, a las 22:00, un 18 de septiembre) y volvía a marcar
-- al mismo cliente en segundos cuando la llamada terminaba como 'completed' sin
-- contestar o 'abandoned' (en Secretaria Virtual, 9 llamadas en 2,5 minutos).
-- Estas columnas son la política; claim_next_dial_targets y los disparadores
-- de 20260924181200 la aplican.
--
-- Todo vive en hora Chile (America/Santiago): el horario de un contact center
-- chileno se piensa en hora local, con su cambio de horario incluido.

alter table public.dialer_campaign_configs
  -- Días permitidos en ISO (1 = lunes ... 7 = domingo) y franja [inicio, fin).
  -- Los tres en null = sin restricción, que es como operan hoy las demás
  -- campañas; nadie cambia de comportamiento por esta migración salvo Equifax.
  add column if not exists calling_days smallint[],
  add column if not exists calling_start_time time,
  add column if not exists calling_end_time time,
  -- No discar en feriados (tabla dialer_holidays). Apagado por defecto por la
  -- misma razón: solo Equifax lo pide hoy.
  add column if not exists skip_holidays boolean not null default false,
  -- Espera mínima después del 1.º, 2.º, 3.º... intento sin contacto. El último
  -- escalón se repite y es también la espera tras un contacto o un abandono
  -- (el cliente contestó y no había ejecutivo): a esa persona no se la vuelve
  -- a molestar en el día.
  add column if not exists redial_backoff_minutes integer[] not null default '{30,120,1440}',
  -- Tope total de intentos sin contacto desde la última gestión humana (o la
  -- última vez que un supervisor devolvió el lead a la cola). Al llegar, el
  -- lead sale de la cola con dialer_hold_reason = 'tope_sin_contacto' y queda a
  -- la vista del supervisor. null = sin tope.
  add column if not exists max_uncontacted_attempts integer default 8,
  -- Un intento que ni alcanzó a sonar (la troncal o Asterisk lo rechazaron) no
  -- es un intento sobre el cliente: no cuenta para el cupo semanal ni para el
  -- tope. Tiene su propia espera, que se duplica con cada falla seguida
  -- (10, 20, 40 min...) hasta el último escalón, y su propio tope de fallas
  -- seguidas para no insistir para siempre con un número que la red no acepta.
  add column if not exists technical_retry_minutes integer not null default 10,
  add column if not exists max_technical_failures integer default 10,
  -- Cortacircuitos: si en los últimos 10 minutos terminaron 20 o más intentos
  -- de la campaña y esta fracción o más fueron fallas técnicas, el claim no
  -- entrega nada (la troncal está caída; seguir marcando solo quema la base).
  -- null = apagado, como hasta hoy.
  add column if not exists technical_breaker_ratio numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dialer_configs_calling_days_check') then
    alter table public.dialer_campaign_configs
      add constraint dialer_configs_calling_days_check
      check (
        calling_days is null
        or (cardinality(calling_days) between 1 and 7 and 1 <= all (calling_days) and 7 >= all (calling_days))
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dialer_configs_calling_hours_check') then
    -- Sin franjas que crucen la medianoche: un contact center no disca de noche.
    alter table public.dialer_campaign_configs
      add constraint dialer_configs_calling_hours_check
      check (
        calling_start_time is null
        or calling_end_time is null
        or calling_start_time < calling_end_time
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dialer_configs_redial_backoff_check') then
    alter table public.dialer_campaign_configs
      add constraint dialer_configs_redial_backoff_check
      check (
        cardinality(redial_backoff_minutes) between 1 and 10
        and 1 <= all (redial_backoff_minutes)
        and 10080 >= all (redial_backoff_minutes)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dialer_configs_max_uncontacted_check') then
    alter table public.dialer_campaign_configs
      add constraint dialer_configs_max_uncontacted_check
      check (max_uncontacted_attempts is null or max_uncontacted_attempts between 1 and 50);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dialer_configs_technical_policy_check') then
    alter table public.dialer_campaign_configs
      add constraint dialer_configs_technical_policy_check
      check (
        technical_retry_minutes between 1 and 1440
        and (max_technical_failures is null or max_technical_failures between 2 and 50)
        and (technical_breaker_ratio is null or (technical_breaker_ratio > 0 and technical_breaker_ratio <= 1))
      );
  end if;
end;
$$;

comment on column public.dialer_campaign_configs.calling_days is
  'Días ISO permitidos para discar (1=lunes, 7=domingo), en hora Chile. null = todos.';
comment on column public.dialer_campaign_configs.calling_start_time is
  'Hora Chile desde la que se puede discar (incluida). null = sin límite.';
comment on column public.dialer_campaign_configs.calling_end_time is
  'Hora Chile hasta la que se puede discar (excluida). null = sin límite.';
comment on column public.dialer_campaign_configs.skip_holidays is
  'No discar en los feriados de public.dialer_holidays (nacionales y de la empresa).';
comment on column public.dialer_campaign_configs.redial_backoff_minutes is
  'Espera mínima en minutos tras el 1.º, 2.º, ... intento sin contacto; el último escalón se repite y aplica tras un contacto o un abandono.';
comment on column public.dialer_campaign_configs.max_uncontacted_attempts is
  'Intentos sin contacto (que sí sonaron) desde la última gestión humana tras los que el lead sale de la cola. null = sin tope.';
comment on column public.dialer_campaign_configs.technical_retry_minutes is
  'Espera tras un intento que no alcanzó a sonar (falla de red o troncal); se duplica con cada falla seguida hasta el último escalón.';
comment on column public.dialer_campaign_configs.max_technical_failures is
  'Fallas técnicas seguidas tras las que el lead sale de la cola (número que la red no acepta). null = sin tope.';
comment on column public.dialer_campaign_configs.technical_breaker_ratio is
  'Fracción de fallas técnicas (con 20+ intentos en 10 min) desde la que el claim se detiene. null = cortacircuitos apagado.';
comment on column public.dialer_campaign_configs.max_redial_attempts is
  'Intentos sin contacto permitidos en 7 días corridos, por lead y por teléfono (ventana móvil).';

-- ---------------------------------------------------------------------------
-- Feriados. organization_id null = feriado nacional de Chile, para todas las
-- empresas; una empresa puede agregar los suyos (aniversario, cierre). Solo
-- los mira una campaña con skip_holidays.
-- ---------------------------------------------------------------------------
create table if not exists public.dialer_holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  holiday_date date not null,
  name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists dialer_holidays_date_uidx
  on public.dialer_holidays (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), holiday_date);

comment on table public.dialer_holidays is
  'Feriados en que no disca una campaña con skip_holidays. organization_id null = feriado nacional de Chile. Revisar cada año: los feriados móviles se decretan.';

alter table public.dialer_holidays enable row level security;
revoke all on table public.dialer_holidays from anon;

drop policy if exists dialer_holidays_select on public.dialer_holidays;
create policy dialer_holidays_select on public.dialer_holidays
  for select to authenticated
  using (organization_id is null or organization_id = any (public.current_org_ids()));

-- Los nacionales llegan por migración; los de la empresa los administra su admin.
drop policy if exists dialer_holidays_admin_write on public.dialer_holidays;
create policy dialer_holidays_admin_write on public.dialer_holidays
  for all to authenticated
  using (
    organization_id = any (public.current_org_ids())
    and (select public.current_role_name()) = 'admin'::public.app_role
  )
  with check (
    organization_id = any (public.current_org_ids())
    and (select public.current_role_name()) = 'admin'::public.app_role
  );

-- Feriados nacionales de Chile (leyes vigentes; los que caen en fin de semana
-- también van, aunque la franja ya los excluya, para que la tabla sea el
-- calendario completo).
insert into public.dialer_holidays (organization_id, holiday_date, name)
values
  (null, '2026-01-01', 'Año Nuevo'),
  (null, '2026-04-03', 'Viernes Santo'),
  (null, '2026-04-04', 'Sábado Santo'),
  (null, '2026-05-01', 'Día del Trabajo'),
  (null, '2026-05-21', 'Día de las Glorias Navales'),
  (null, '2026-06-21', 'Día de los Pueblos Indígenas'),
  (null, '2026-06-29', 'San Pedro y San Pablo'),
  (null, '2026-07-16', 'Virgen del Carmen'),
  (null, '2026-08-15', 'Asunción de la Virgen'),
  (null, '2026-09-18', 'Independencia Nacional'),
  (null, '2026-09-19', 'Glorias del Ejército'),
  (null, '2026-10-12', 'Encuentro de Dos Mundos'),
  (null, '2026-10-31', 'Día de las Iglesias Evangélicas'),
  (null, '2026-11-01', 'Todos los Santos'),
  (null, '2026-12-08', 'Inmaculada Concepción'),
  (null, '2026-12-25', 'Navidad'),
  (null, '2027-01-01', 'Año Nuevo'),
  (null, '2027-03-26', 'Viernes Santo'),
  (null, '2027-03-27', 'Sábado Santo'),
  (null, '2027-05-01', 'Día del Trabajo'),
  (null, '2027-05-21', 'Día de las Glorias Navales'),
  (null, '2027-06-21', 'Día de los Pueblos Indígenas'),
  (null, '2027-06-28', 'San Pedro y San Pablo'),
  (null, '2027-07-16', 'Virgen del Carmen'),
  (null, '2027-08-15', 'Asunción de la Virgen'),
  (null, '2027-09-18', 'Independencia Nacional'),
  (null, '2027-09-19', 'Glorias del Ejército'),
  (null, '2027-10-11', 'Encuentro de Dos Mundos'),
  (null, '2027-10-31', 'Día de las Iglesias Evangélicas'),
  (null, '2027-11-01', 'Todos los Santos'),
  (null, '2027-12-08', 'Inmaculada Concepción'),
  (null, '2027-12-25', 'Navidad')
on conflict do nothing;

-- Equifax: lunes a viernes de 09:00 a 19:00 sin feriados, como operaba en
-- Atlas 1 y en Vocalcom; tope de 6 intentos que sonaron (con 2 por semana son
-- unas tres semanas antes de dejar el número) y cortacircuitos al 80 %. Solo
-- toca la política: no enciende ni apaga el discado.
update public.dialer_campaign_configs
set
  calling_days = '{1,2,3,4,5}',
  calling_start_time = '09:00',
  calling_end_time = '19:00',
  skip_holidays = true,
  max_uncontacted_attempts = 6,
  technical_breaker_ratio = 0.8,
  updated_at = now()
where campaign_id = '318cf37a-da42-4cbd-934d-bdc47753d7bd'
  and calling_days is null
  and calling_start_time is null
  and calling_end_time is null;

-- La regla pura: ¿un instante cae dentro de la franja? Separada de la lectura
-- de la configuración para poder probarla con cualquier hora.
create or replace function public.dialer_calling_window_open(
  p_days smallint[],
  p_start time,
  p_end time,
  p_at timestamptz default now()
)
returns boolean
language sql
stable
set search_path to 'pg_catalog', 'public'
as $$
  select
    (p_days is null
      or extract(isodow from (p_at at time zone 'America/Santiago'))::smallint = any (p_days))
    and (p_start is null or (p_at at time zone 'America/Santiago')::time >= p_start)
    and (p_end is null or (p_at at time zone 'America/Santiago')::time < p_end);
$$;

-- ¿Es feriado en Chile ese instante, para esa empresa?
create or replace function public.dialer_is_holiday(p_organization_id uuid, p_at timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select exists (
    select 1
    from public.dialer_holidays holiday
    where holiday.holiday_date = (p_at at time zone 'America/Santiago')::date
      and (holiday.organization_id is null or holiday.organization_id = p_organization_id)
  );
$$;

-- ¿Puede discar ahora esta campaña? Sin configuración o sin franja = sí, para
-- no cambiar a nadie que no la haya pedido. SECURITY INVOKER a propósito: la
-- usan el claim y las agendas (que corren como dueño de la base) y, si algún
-- día la consulta la pantalla, la seguridad por fila de dialer_campaign_configs
-- mantiene la frontera de empresa.
create or replace function public.dialer_campaign_in_calling_window(p_campaign_id uuid)
returns boolean
language sql
stable
set search_path to 'pg_catalog', 'public'
as $$
  select coalesce(
    (
      select public.dialer_calling_window_open(
          config.calling_days,
          config.calling_start_time,
          config.calling_end_time,
          now()
        )
        and not (config.skip_holidays and public.dialer_is_holiday(campaign.organization_id, now()))
      from public.dialer_campaign_configs config
      join public.campaigns campaign on campaign.id = config.campaign_id
      where config.campaign_id = p_campaign_id
    ),
    true
  );
$$;

-- Escalón de espera. p_long = el cliente ya habló (con un ejecutivo o con el
-- silencio de un abandono): se usa el último escalón.
create or replace function public.dialer_backoff_minutes(
  p_ladder integer[],
  p_attempts integer,
  p_long boolean default false
)
returns integer
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $$
  select case
    when p_ladder is null or cardinality(p_ladder) = 0 then 30
    when p_long then p_ladder[cardinality(p_ladder)]
    else p_ladder[least(greatest(coalesce(p_attempts, 1), 1), cardinality(p_ladder))]
  end;
$$;

-- Qué fue un intento terminado, visto desde el cliente:
--   'real'     le sonó el teléfono (contestara o no): cuenta para esperas,
--              cupos y tope.
--   'tecnico'  no alcanzó a sonar: el Originate falló sin crear el canal
--              (originated_at null) o la red cortó por congestión (causas
--              Q.850 34, 38, 41, 42, 47). Espera corta y tope propio.
--   'ignorado' agenda personal cuyo ejecutivo no contestó: la pata que se
--              origina es la del ejecutivo y al cliente no se lo llamó.
-- null = el intento no ha terminado.
create or replace function public.dialer_attempt_result_class(
  p_status text,
  p_attempt_kind text,
  p_originated_at timestamptz,
  p_hangup_cause text
)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $$
  select case
    when p_status not in ('no_answer', 'busy', 'failed', 'voicemail', 'abandoned', 'completed') then null
    when p_attempt_kind = 'personal_callback' and p_originated_at is null then 'ignorado'
    when p_status = 'failed' and p_originated_at is null then 'tecnico'
    when p_status = 'failed' and btrim(coalesce(p_hangup_cause, '')) in ('34', '38', '41', '42', '47') then 'tecnico'
    else 'real'
  end;
$$;

revoke all on function public.dialer_calling_window_open(smallint[], time, time, timestamptz) from public, anon;
revoke all on function public.dialer_is_holiday(uuid, timestamptz) from public, anon;
revoke all on function public.dialer_campaign_in_calling_window(uuid) from public, anon;
revoke all on function public.dialer_backoff_minutes(integer[], integer, boolean) from public, anon;
revoke all on function public.dialer_attempt_result_class(text, text, timestamptz, text) from public, anon;
grant execute on function public.dialer_calling_window_open(smallint[], time, time, timestamptz) to authenticated, service_role;
grant execute on function public.dialer_is_holiday(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.dialer_campaign_in_calling_window(uuid) to authenticated, service_role;
grant execute on function public.dialer_backoff_minutes(integer[], integer, boolean) to authenticated, service_role;
grant execute on function public.dialer_attempt_result_class(text, text, timestamptz, text) to authenticated, service_role;
