-- Cada corrida de un agente deja rastro.
--
-- Todo lo que falló esta semana falló en silencio. Un agente que trabaja solo y
-- no anota que trabajó es indistinguible de un agente muerto: si mañana no
-- llega el informe, sin esta tabla no habría cómo saber si falló el envío, si
-- falló la revisión o si el cron nunca lo despertó.

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agente text not null,
  organization_id uuid references public.organizations(id) on delete cascade,
  estado text not null check (estado in ('ok', 'alerta', 'error')),
  resumen text,
  detalle jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.agent_runs is
  'Bitácora de los agentes automáticos. Sin ella, un agente caído se ve igual que un día tranquilo.';

create index if not exists agent_runs_agente_fecha_idx
  on public.agent_runs (agente, created_at desc);

alter table public.agent_runs enable row level security;

drop policy if exists agent_runs_select on public.agent_runs;
create policy agent_runs_select on public.agent_runs
  for select to authenticated
  using (organization_id is null or organization_id = any (public.current_org_ids()));

-- Escribe el servicio, nunca una sesión de navegador.
drop policy if exists agent_runs_organization_isolation on public.agent_runs;
create policy agent_runs_organization_isolation on public.agent_runs
  as restrictive for all to authenticated
  using (organization_id is null or organization_id = any (public.current_org_ids()))
  with check (organization_id is null or organization_id = any (public.current_org_ids()));

create or replace function public.anotar_corrida_de_agente(
  p_agente text,
  p_organization_slug text,
  p_estado text,
  p_resumen text,
  p_detalle jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_id uuid;
begin
  insert into public.agent_runs (agente, organization_id, estado, resumen, detalle)
  values (
    p_agente,
    public.organization_id_by_slug(p_organization_slug),
    p_estado,
    p_resumen,
    coalesce(p_detalle, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.anotar_corrida_de_agente(text, text, text, text, jsonb) from public;
revoke execute on function public.anotar_corrida_de_agente(text, text, text, text, jsonb) from anon, authenticated;
grant execute on function public.anotar_corrida_de_agente(text, text, text, text, jsonb) to service_role;

-- Si un agente deja de anotar, esto lo dice: la última corrida y cuánto hace.
create or replace function public.ultima_corrida_de_agente(p_agente text)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select coalesce(
    (select jsonb_build_object(
       'agente', r.agente, 'estado', r.estado, 'resumen', r.resumen,
       'cuando', r.created_at,
       'horas_desde', round(extract(epoch from (now() - r.created_at)) / 3600, 1))
     from public.agent_runs r
     where r.agente = p_agente
     order by r.created_at desc limit 1),
    jsonb_build_object('agente', p_agente, 'estado', 'sin_corridas')
  );
$$;

revoke execute on function public.ultima_corrida_de_agente(text) from anon;
grant execute on function public.ultima_corrida_de_agente(text) to authenticated, service_role;
