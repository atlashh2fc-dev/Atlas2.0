-- Postgres corta los identificadores en 63 caracteres.
--
-- `supervisor_report_daily_agent_tipifications_organization_isolation` mide 66,
-- así que la base la guardó truncada y el nombre dejó de calzar con el del
-- repositorio. El paso 3 ya usa el sufijo corto `_org_isolation`; esta migración
-- arregla las bases donde la política alcanzó a crearse con el nombre cortado.

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'supervisor_report_daily_agent_tipifications'
      and policyname = 'supervisor_report_daily_agent_tipifications_organization_isolat'
  ) then
    execute 'alter policy supervisor_report_daily_agent_tipifications_organization_isolat'
      || ' on public.supervisor_report_daily_agent_tipifications'
      || ' rename to supervisor_report_daily_agent_tipifications_org_isolation';
  end if;
end
$$;
