-- Órbita · el monitor de los agentes de marketing con IA.
--
-- Atlas Órbita es el sistema de marketing autónomo que Altius opera para sí y
-- que después venderá: un CEO de marketing, agentes que publican, un monitor,
-- un líder de resultados, inteligencia competitiva, un productor de Reels y un
-- guardián que vigila a todos. Esta migración guarda quiénes son (con sus
-- conexiones) y lo que van haciendo, para que la pantalla Órbita los muestre
-- como una red viva.
--
-- Los agentes y sus eventos los escriben los propios agentes por
-- /api/orbita/eventos (firma HMAC, misma clave que Marketing). Cada evento
-- actualiza el estado del agente (ultimo_estado, ultimo_evento_at,
-- ultimo_resumen) en la ruta, no con un trigger: la regla vive en
-- src/lib/orbita.ts y tiene pruebas.
--
-- Idempotente: se puede correr más de una vez.

-- ---------------------------------------------------------------------------
-- La aplicación en el catálogo de la suite.
-- ---------------------------------------------------------------------------
alter table public.organization_modules
  drop constraint if exists organization_modules_module_check;

alter table public.organization_modules
  add constraint organization_modules_module_check check (module in (
    'leads',           -- capa base: registros y su seguimiento
    'ventas_b2b',      -- embudo de empresas
    'ventas_b2c',      -- venta a consumidor final
    'contact_center',  -- Atlas CRM: voz, discador, agentes, colas, calidad
    'correo',          -- Atlas Lead: campañas de correo
    'whatsapp',        -- canal WhatsApp, con o sin IA
    'bigdata',         -- Atlas Scoring: datos y priorización
    'analytics',       -- Atlas Analytics: tableros e indicadores
    'itsm',            -- Atlas ITSM: mesa de ayuda e inventario
    'finanzas',        -- Atlas Financiero: tesorería, cartera, SII
    'aprende',         -- Atlas Aprende: capacitación de los equipos
    'marketing',       -- calendario de publicaciones, correos y anuncios
    'orbita'           -- Atlas Órbita: monitor de los agentes de marketing con IA
  ));

insert into public.organization_modules (organization_id, module)
select public.organization_id_by_slug('altius'), 'orbita'
where public.organization_id_by_slug('altius') is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Un agente de la red: su papel, su horario y con quién se conecta.
-- ---------------------------------------------------------------------------
create table if not exists public.orbita_agentes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Identidad estable del agente dentro de la empresa: '0' (CEO), '1'…'9', 'G'.
  codigo text not null,
  nombre text not null,
  rol text,
  descripcion text,
  -- Para personas ("Diario 09:00") y para máquinas (cron, hora de Chile).
  horario text,
  cron text,
  -- Color de identidad del nodo (#rrggbb). El estado se pinta aparte.
  color text,
  -- [{ "a": "7", "tipo": "reporta", "etiqueta": "Resumen diario" }]; "a": "*" = todos.
  conexiones jsonb not null default '[]'::jsonb,
  ultimo_estado text not null default 'inactivo',
  ultimo_evento_at timestamptz,
  ultimo_resumen text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orbita_agentes_codigo_check check (codigo ~ '^[0-9A-Z][0-9A-Z_-]{0,15}$'),
  constraint orbita_agentes_nombre_not_blank check (btrim(nombre) <> ''),
  constraint orbita_agentes_color_check check (color is null or color ~* '^#([0-9a-f]{3}|[0-9a-f]{6})$'),
  constraint orbita_agentes_conexiones_array check (jsonb_typeof(conexiones) = 'array'),
  constraint orbita_agentes_ultimo_estado_check check (ultimo_estado in ('ok', 'corriendo', 'error', 'atrasado', 'inactivo')),
  constraint orbita_agentes_codigo_uniq unique (organization_id, codigo)
);

comment on table public.orbita_agentes is
  'Atlas Órbita: agentes de marketing con IA por empresa, con sus conexiones y su último estado. Lo escriben los agentes vía /api/orbita/eventos.';

drop trigger if exists orbita_agentes_set_updated_at on public.orbita_agentes;
create trigger orbita_agentes_set_updated_at
  before update on public.orbita_agentes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Lo que hace cada agente: inicios, fines, errores, decisiones, alertas,
-- recuperaciones, latidos y tareas. `relacionado_con` es el agente al que
-- fluye el evento (el CEO ordena al 3; el Guardián recupera al 5).
-- ---------------------------------------------------------------------------
create table if not exists public.orbita_eventos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agente_codigo text not null,
  tipo text not null,
  estado text,
  resumen text,
  detalle jsonb not null default '{}'::jsonb,
  relacionado_con text,
  ocurrido_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint orbita_eventos_tipo_check check (tipo in ('inicio', 'fin', 'error', 'decision', 'alerta', 'recuperacion', 'pulso', 'tarea')),
  constraint orbita_eventos_estado_check check (estado is null or estado in ('ok', 'corriendo', 'error', 'atrasado', 'inactivo')),
  constraint orbita_eventos_detalle_object check (jsonb_typeof(detalle) = 'object')
);

comment on table public.orbita_eventos is
  'Atlas Órbita: bitácora de lo que hacen los agentes. agente_codigo y relacionado_con son códigos de orbita_agentes de la misma empresa.';

-- La pantalla lee lo último por empresa (actividad en vivo y cifras de 24 h y 7 d).
create index if not exists orbita_eventos_recientes_idx
  on public.orbita_eventos (organization_id, ocurrido_at desc);

-- El panel de un agente: sus últimos eventos.
create index if not exists orbita_eventos_agente_idx
  on public.orbita_eventos (organization_id, agente_codigo, ocurrido_at desc);

-- ---------------------------------------------------------------------------
-- Seguridad: aislamiento por empresa (restrictiva) como marketing_items.
-- Lee cualquier miembro de la empresa; escriben admin, supervisor o el dueño
-- de la plataforma. Borrar queda solo para el servicio. anon no ve nada.
-- ---------------------------------------------------------------------------
alter table public.orbita_agentes enable row level security;
alter table public.orbita_eventos enable row level security;

drop policy if exists orbita_agentes_organization_isolation on public.orbita_agentes;
create policy orbita_agentes_organization_isolation on public.orbita_agentes
  as restrictive
  for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists orbita_agentes_select on public.orbita_agentes;
create policy orbita_agentes_select on public.orbita_agentes
  for select to authenticated
  using (organization_id = any (public.current_org_ids()));

drop policy if exists orbita_agentes_insert on public.orbita_agentes;
create policy orbita_agentes_insert on public.orbita_agentes
  for insert to authenticated
  with check (
    (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
    or public.is_platform_owner()
  );

drop policy if exists orbita_agentes_update on public.orbita_agentes;
create policy orbita_agentes_update on public.orbita_agentes
  for update to authenticated
  using (
    (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
    or public.is_platform_owner()
  )
  with check (
    (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
    or public.is_platform_owner()
  );

drop policy if exists orbita_eventos_organization_isolation on public.orbita_eventos;
create policy orbita_eventos_organization_isolation on public.orbita_eventos
  as restrictive
  for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists orbita_eventos_select on public.orbita_eventos;
create policy orbita_eventos_select on public.orbita_eventos
  for select to authenticated
  using (organization_id = any (public.current_org_ids()));

drop policy if exists orbita_eventos_insert on public.orbita_eventos;
create policy orbita_eventos_insert on public.orbita_eventos
  for insert to authenticated
  with check (
    (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
    or public.is_platform_owner()
  );

drop policy if exists orbita_eventos_update on public.orbita_eventos;
create policy orbita_eventos_update on public.orbita_eventos
  for update to authenticated
  using (
    (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
    or public.is_platform_owner()
  )
  with check (
    (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
    or public.is_platform_owner()
  );

revoke all on public.orbita_agentes from anon;
revoke all on public.orbita_eventos from anon;
grant select, insert, update on public.orbita_agentes to authenticated;
grant select, insert, update on public.orbita_eventos to authenticated;
grant all on public.orbita_agentes to service_role;
grant all on public.orbita_eventos to service_role;

-- ---------------------------------------------------------------------------
-- En vivo: la pantalla escucha los eventos nuevos y los cambios de estado
-- (Supabase Realtime respeta las políticas de arriba). Sin realtime igual
-- se actualiza cada 15 s.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orbita_eventos'
    ) then
      alter publication supabase_realtime add table public.orbita_eventos;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orbita_agentes'
    ) then
      alter publication supabase_realtime add table public.orbita_agentes;
    end if;
  end if;
end
$$;
