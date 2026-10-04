-- Órbita en la nube · los agentes trabajan dentro de Atlas, sin depender de
-- ningún computador.
--
-- Hasta acá Órbita solo miraba: los agentes corrían como tareas programadas
-- en el Mac de quien opera, con su memoria en archivos. Esta migración le da
-- a Atlas lo necesario para correrlos él mismo:
--
-- - `orbita_agentes.motor`: qué motor de Atlas lo ejecuta ('ceo', 'lider',
--   'inteligencia', 'guardian'). Sin motor, el agente corre fuera de Atlas y
--   solo reporta (como hasta ahora).
-- - `orbita_agentes.instrucciones`: su ficha, por empresa. Así el mismo motor
--   sirve a cualquier cliente.
-- - `orbita_tareas`: lo que un agente le encarga a otro (el CEO al Productor,
--   el Líder al CEO). Los agentes de fuera de Atlas las leen por
--   /api/orbita/tareas.
-- - `orbita_notas`: la memoria compartida: estrategia, prioridad de la semana,
--   decisiones, informes, inteligencia, ideas y escalamientos.
-- - `orbita_ejecuciones`: cada turno de un agente de la nube, con su intento.
--   El reloj (/api/orbita/reloj, cada 5 min) las usa para no lanzar dos veces
--   el mismo turno y para recuperar las que fallan o se cuelgan.
--
-- Idempotente: se puede correr más de una vez.

-- ---------------------------------------------------------------------------
-- El agente: motor, ficha y si está activo.
-- ---------------------------------------------------------------------------
alter table public.orbita_agentes add column if not exists motor text;
alter table public.orbita_agentes add column if not exists instrucciones text;
alter table public.orbita_agentes add column if not exists activo boolean not null default true;
alter table public.orbita_agentes add column if not exists duracion_max_min integer not null default 30;

alter table public.orbita_agentes drop constraint if exists orbita_agentes_motor_check;
alter table public.orbita_agentes
  add constraint orbita_agentes_motor_check check (motor is null or motor in ('ceo', 'lider', 'inteligencia', 'guardian'));

alter table public.orbita_agentes drop constraint if exists orbita_agentes_duracion_check;
alter table public.orbita_agentes
  add constraint orbita_agentes_duracion_check check (duracion_max_min between 1 and 720);

comment on column public.orbita_agentes.motor is
  'Motor de Atlas que ejecuta al agente (ceo, lider, inteligencia, guardian). Null = corre fuera de Atlas y solo reporta.';
comment on column public.orbita_agentes.instrucciones is
  'Ficha del agente para esta empresa: objetivo, criterio y reglas. La usa el motor de la nube.';

-- ---------------------------------------------------------------------------
-- Tareas entre agentes.
-- ---------------------------------------------------------------------------
create table if not exists public.orbita_tareas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  de text not null,
  para text not null,
  titulo text not null,
  detalle text,
  estado text not null default 'pendiente',
  vence date,
  resultado text,
  origen text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cerrada_at timestamptz,
  constraint orbita_tareas_estado_check check (estado in ('pendiente', 'hecha', 'descartada')),
  constraint orbita_tareas_titulo_not_blank check (btrim(titulo) <> '')
);

comment on table public.orbita_tareas is
  'Atlas Órbita: tareas que un agente le encarga a otro. de y para son códigos de orbita_agentes de la misma empresa.';

create index if not exists orbita_tareas_para_idx
  on public.orbita_tareas (organization_id, para, estado, created_at desc);

drop trigger if exists orbita_tareas_set_updated_at on public.orbita_tareas;
create trigger orbita_tareas_set_updated_at
  before update on public.orbita_tareas
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Memoria compartida.
-- ---------------------------------------------------------------------------
create table if not exists public.orbita_notas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agente_codigo text,
  tipo text not null,
  titulo text not null,
  contenido text not null default '',
  datos jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint orbita_notas_tipo_check check (tipo in (
    'estrategia', 'reglas', 'prioridad', 'decision', 'reporte', 'retrospectiva',
    'inteligencia', 'competidores', 'idea', 'escalamiento'
  )),
  constraint orbita_notas_titulo_not_blank check (btrim(titulo) <> ''),
  constraint orbita_notas_datos_object check (jsonb_typeof(datos) = 'object')
);

comment on table public.orbita_notas is
  'Atlas Órbita: memoria compartida de los agentes (estrategia, prioridad, decisiones, informes, inteligencia, ideas, escalamientos).';

create index if not exists orbita_notas_tipo_idx
  on public.orbita_notas (organization_id, tipo, created_at desc);
create index if not exists orbita_notas_agente_idx
  on public.orbita_notas (organization_id, agente_codigo, created_at desc);

-- ---------------------------------------------------------------------------
-- Turnos de los agentes de la nube.
-- ---------------------------------------------------------------------------
create table if not exists public.orbita_ejecuciones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agente_codigo text not null,
  -- El turno según el cron (hora exacta), o la hora en que se pidió a mano.
  programada_para timestamptz not null,
  intento integer not null default 1,
  estado text not null default 'pendiente',
  iniciada_at timestamptz,
  terminada_at timestamptz,
  resumen text,
  error text,
  uso jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint orbita_ejecuciones_estado_check check (estado in ('pendiente', 'corriendo', 'ok', 'error')),
  constraint orbita_ejecuciones_intento_check check (intento between 1 and 10),
  constraint orbita_ejecuciones_turno_uniq unique (organization_id, agente_codigo, programada_para, intento)
);

comment on table public.orbita_ejecuciones is
  'Atlas Órbita: cada turno de un agente de la nube. El reloj no lanza dos veces el mismo (agente, turno, intento).';

create index if not exists orbita_ejecuciones_recientes_idx
  on public.orbita_ejecuciones (organization_id, agente_codigo, programada_para desc);

-- ---------------------------------------------------------------------------
-- Seguridad: como orbita_agentes. Leen los miembros de la empresa; escribe el
-- servicio (los motores corren con la clave de servicio) y, a mano, admin o
-- supervisor. anon no ve nada.
-- ---------------------------------------------------------------------------
alter table public.orbita_tareas enable row level security;
alter table public.orbita_notas enable row level security;
alter table public.orbita_ejecuciones enable row level security;

do $$
declare
  tabla text;
begin
  foreach tabla in array array['orbita_tareas', 'orbita_notas', 'orbita_ejecuciones'] loop
    execute format('drop policy if exists %I on public.%I', tabla || '_organization_isolation', tabla);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (organization_id = any (public.current_org_ids()))
         with check (organization_id = any (public.current_org_ids()))',
      tabla || '_organization_isolation', tabla);

    execute format('drop policy if exists %I on public.%I', tabla || '_select', tabla);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (organization_id = any (public.current_org_ids()))',
      tabla || '_select', tabla);

    execute format('drop policy if exists %I on public.%I', tabla || '_insert', tabla);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (
           (select public.current_role_name()) = any (array[''admin''::public.app_role, ''supervisor''::public.app_role])
           or public.is_platform_owner()
         )',
      tabla || '_insert', tabla);

    execute format('drop policy if exists %I on public.%I', tabla || '_update', tabla);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (
           (select public.current_role_name()) = any (array[''admin''::public.app_role, ''supervisor''::public.app_role])
           or public.is_platform_owner()
         )
         with check (
           (select public.current_role_name()) = any (array[''admin''::public.app_role, ''supervisor''::public.app_role])
           or public.is_platform_owner()
         )',
      tabla || '_update', tabla);

    execute format('revoke all on public.%I from anon', tabla);
    execute format('grant select, insert, update on public.%I to authenticated', tabla);
    execute format('grant all on public.%I to service_role', tabla);
  end loop;
end
$$;
