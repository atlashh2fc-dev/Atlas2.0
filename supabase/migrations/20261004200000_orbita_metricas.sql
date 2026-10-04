-- Órbita · métricas diarias con evidencia.
--
-- Lo que hacen los agentes que trabajan fuera de Atlas (seguir empresas en
-- Facebook e Instagram, pedir y activar grupos nuevos) no deja rastro en
-- ninguna tabla de Atlas. Para que el tablero de objetivos muestre lo hecho y
-- no lo dicho, cada agente envía por el ingreso firmado de Órbita
-- (/api/orbita/eventos, lista `metricas`) una cifra por día, recalculada desde
-- su archivo de origen, con la evidencia que la respalda (qué empresa, qué
-- grupo, con su enlace).
--
-- Una fila por (empresa, día, métrica): reenviar el mismo día la reemplaza,
-- así que recalcular nunca duplica. Solo escribe el servicio; las personas
-- solo leen las de su empresa.
--
-- Idempotente.

create table if not exists public.orbita_metricas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dia date not null,
  metrica text not null,
  agente_codigo text,
  valor numeric not null,
  evidencia jsonb not null default '[]'::jsonb,
  fuente text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orbita_metricas_uniq unique (organization_id, dia, metrica),
  constraint orbita_metricas_metrica_check check (metrica ~ '^[a-z0-9_]{1,40}$'),
  constraint orbita_metricas_valor_check check (valor >= 0),
  constraint orbita_metricas_evidencia_check check (jsonb_typeof(evidencia) = 'array')
);

comment on table public.orbita_metricas is
  'Cifra diaria de un objetivo de Órbita (empresas seguidas, grupos activados…) con su evidencia. La envían los agentes por el ingreso firmado.';
comment on column public.orbita_metricas.dia is 'Día en hora de Chile.';
comment on column public.orbita_metricas.evidencia is 'Lista de {texto, url?, estado?} que respalda la cifra.';

create index if not exists orbita_metricas_org_dia_idx on public.orbita_metricas (organization_id, dia desc);

drop trigger if exists orbita_metricas_updated_at on public.orbita_metricas;
create trigger orbita_metricas_updated_at
  before update on public.orbita_metricas
  for each row execute function public.set_updated_at();

alter table public.orbita_metricas enable row level security;

drop policy if exists orbita_metricas_organization_isolation on public.orbita_metricas;
create policy orbita_metricas_organization_isolation on public.orbita_metricas
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists orbita_metricas_select on public.orbita_metricas;
create policy orbita_metricas_select on public.orbita_metricas
  for select to authenticated
  using (organization_id = any (public.current_org_ids()));

revoke all on public.orbita_metricas from anon;
grant select on public.orbita_metricas to authenticated;
