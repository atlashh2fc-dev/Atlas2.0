-- La pantalla de ejecutivos históricos contaba las llamadas trayendo todas las filas,
-- y la API corta en 1.000: con ~98 mil llamadas legadas casi todos salían en 0.
-- El conteo se hace en la base. Definer con el permiso explícito (admin, y solo los
-- ejecutivos de sus empresas) para no evaluar el RLS de calls fila por fila.
create or replace function public.historical_agent_call_counts()
returns table (historical_agent_id uuid, calls bigint)
language sql
stable
security definer
set search_path = public
as $$
  select c.historical_agent_id, count(*)
  from public.calls c
  join public.historical_agents h on h.id = c.historical_agent_id
  where (select public.current_role_name()) = 'admin'
    and h.organization_id = any ((select public.current_org_ids())::uuid[])
  group by c.historical_agent_id;
$$;

revoke all on function public.historical_agent_call_counts() from public, anon;
grant execute on function public.historical_agent_call_counts() to authenticated;
