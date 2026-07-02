
-- Las tablas staging quedaron expuestas en el schema public sin RLS tras la carga masiva.
-- La migración ya está verificada y completa; se conservan como respaldo auditable del
-- archivo legado original, pero solo accesibles por admins (no público vía PostgREST).
alter table staging_carga_tipificaciones enable row level security;
alter table staging_historial_gestiones enable row level security;
alter table staging_snapshots_equifax enable row level security;

create policy staging_admin_only on staging_carga_tipificaciones
  for all to authenticated
  using ((select current_role_name()) = 'admin');

create policy staging_admin_only on staging_historial_gestiones
  for all to authenticated
  using ((select current_role_name()) = 'admin');

create policy staging_admin_only on staging_snapshots_equifax
  for all to authenticated
  using ((select current_role_name()) = 'admin');

-- Índices de cobertura para las FKs que quedaron sin índice tras la migración.
create index if not exists idx_historical_agents_linked_profile_id on historical_agents (linked_profile_id);
create index if not exists idx_legacy_tipificacion_map_workflow_id on legacy_tipificacion_map (workflow_id);
create index if not exists idx_legacy_tipificacion_map_workflow_step_id on legacy_tipificacion_map (workflow_step_id);

-- Políticas RLS duplicadas (SELECT cubierto dos veces) en las tablas nuevas de esta migración.
drop policy if exists historical_agents_select on historical_agents;
drop policy if exists legacy_tipificacion_map_select on legacy_tipificacion_map;
;
