-- Horario permitido y política de reintentos del discador, por campaña.
--
-- Hasta hoy el progresivo discaba a cualquier hora si quedaba un ejecutivo
-- «Disponible» (un sábado, a las 22:00) y volvía a marcar al mismo cliente en
-- segundos cuando la llamada terminaba como 'completed' sin contestar o
-- 'abandoned' (en Secretaria Virtual, 9 llamadas en 2,5 minutos). Estas
-- columnas son la política; claim_next_dial_targets y los disparadores de
-- 20260924181200 la aplican.
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
  -- Espera mínima después del 1.º, 2.º, 3.º... intento sin contacto. El último
  -- escalón se repite y es también la espera tras un contacto o un abandono
  -- (el cliente contestó y no había ejecutivo): a esa persona no se la vuelve
  -- a molestar en el día.
  add column if not exists redial_backoff_minutes integer[] not null default '{30,120,1440}',
  -- Tope total de intentos sin contacto desde la última gestión humana. Al
  -- llegar, el lead sale de la cola (leads.dialer_retry_at = 'infinity') en vez
  -- de volver cada semana. null = sin tope.
  add column if not exists max_uncontacted_attempts integer default 8;

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
end;
$$;

comment on column public.dialer_campaign_configs.calling_days is
  'Días ISO permitidos para discar (1=lunes, 7=domingo), en hora Chile. null = todos.';
comment on column public.dialer_campaign_configs.calling_start_time is
  'Hora Chile desde la que se puede discar (incluida). null = sin límite.';
comment on column public.dialer_campaign_configs.calling_end_time is
  'Hora Chile hasta la que se puede discar (excluida). null = sin límite.';
comment on column public.dialer_campaign_configs.redial_backoff_minutes is
  'Espera mínima en minutos tras el 1.º, 2.º, ... intento sin contacto; el último escalón se repite y aplica tras un contacto o un abandono.';
comment on column public.dialer_campaign_configs.max_uncontacted_attempts is
  'Intentos sin contacto desde la última gestión humana tras los que el lead sale de la cola. null = sin tope.';
comment on column public.dialer_campaign_configs.max_redial_attempts is
  'Intentos sin contacto permitidos en 7 días corridos (ventana móvil).';

-- Equifax: lunes a viernes de 09:00 a 19:00, como operaba en Atlas 1 y en
-- Vocalcom, y tope de 6 intentos sin contacto (con 2 por semana son unas tres
-- semanas de intentos antes de dejar el número). Solo toca la política: no
-- enciende ni apaga el discado.
update public.dialer_campaign_configs
set
  calling_days = '{1,2,3,4,5}',
  calling_start_time = '09:00',
  calling_end_time = '19:00',
  max_uncontacted_attempts = 6,
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
      from public.dialer_campaign_configs config
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

revoke all on function public.dialer_calling_window_open(smallint[], time, time, timestamptz) from public, anon;
revoke all on function public.dialer_campaign_in_calling_window(uuid) from public, anon;
revoke all on function public.dialer_backoff_minutes(integer[], integer, boolean) from public, anon;
grant execute on function public.dialer_calling_window_open(smallint[], time, time, timestamptz) to authenticated, service_role;
grant execute on function public.dialer_campaign_in_calling_window(uuid) to authenticated, service_role;
grant execute on function public.dialer_backoff_minutes(integer[], integer, boolean) to authenticated, service_role;
