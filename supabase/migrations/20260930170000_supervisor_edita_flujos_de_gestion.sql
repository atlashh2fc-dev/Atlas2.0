-- El supervisor vuelve a editar los flujos de gestión (pedido del 30-09-2026):
-- ajusta pasos, motivos y conexiones de la tipificación sin esperar a un admin.
--
-- Solo se amplía el rol en las políticas de escritura. La aislación por empresa
-- (políticas RESTRICTIVE *_organization_isolation) no se toca: el supervisor
-- edita únicamente los flujos de su empresa. Los nombres «admin_*» se conservan
-- para no romper migraciones y auditorías que los nombran.

-- Crear y borrar flujos sigue siendo del admin: crear uno lo conecta a una
-- campaña, y las campañas no las edita el supervisor. Él publica, archiva y
-- edita los que ya existen.
alter policy workflows_admin_update on public.workflows
  using (public.current_role_name() in ('admin', 'supervisor'))
  with check (public.current_role_name() in ('admin', 'supervisor'));

alter policy workflow_steps_admin_insert on public.workflow_steps
  with check (public.current_role_name() in ('admin', 'supervisor'));
alter policy workflow_steps_admin_update on public.workflow_steps
  using (public.current_role_name() in ('admin', 'supervisor'))
  with check (public.current_role_name() in ('admin', 'supervisor'));
alter policy workflow_steps_admin_delete on public.workflow_steps
  using (public.current_role_name() in ('admin', 'supervisor'));

alter policy workflow_step_branches_admin_insert on public.workflow_step_branches
  with check (public.current_role_name() in ('admin', 'supervisor'));
alter policy workflow_step_branches_admin_update on public.workflow_step_branches
  using (public.current_role_name() in ('admin', 'supervisor'))
  with check (public.current_role_name() in ('admin', 'supervisor'));
alter policy workflow_step_branches_admin_delete on public.workflow_step_branches
  using (public.current_role_name() in ('admin', 'supervisor'));

-- Deshacer el borrado de un paso re-enlaza su diccionario de Atlas 1.
alter policy legacy_tipificacion_map_write on public.legacy_tipificacion_map
  using ((select public.current_role_name()) in ('admin', 'supervisor'))
  with check ((select public.current_role_name()) in ('admin', 'supervisor'));
