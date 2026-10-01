-- auth.uid() envuelto en un select: se evalúa una vez por consulta y no una
-- vez por fila (advisor auth_rls_initplan).
alter policy prospeccion_toques_delete on public.prospeccion_toques
  using ((organization_id = any (public.current_org_ids())) and (hecho_por = (select auth.uid())) and (created_at > (now() - '1 day'::interval)) and (resultado <> 'interesado'::text));
