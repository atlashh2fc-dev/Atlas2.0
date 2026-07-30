-- 1) La pantalla de cargas y el RPC bulk_insert_leads permiten supervisor, pero
--    la política de inserción del historial exigía admin: la carga funcionaba y
--    el registro del archivo se rechazaba en silencio.
drop policy if exists lead_uploads_admin_insert on public.lead_uploads;
drop policy if exists lead_uploads_insert on public.lead_uploads;
create policy lead_uploads_insert on public.lead_uploads
  for insert with check (public.current_role_name() in ('admin', 'supervisor'));

-- 2) Un flujo nuevo nacía 'published' por el valor por omisión, así que se
--    ofrecía como operativo sin haber pasado nunca por la validación.
alter table public.workflows alter column status set default 'draft';

-- 3) Índices de cobertura de las dos claves foráneas nuevas.
create index if not exists lead_uploads_team_id_idx on public.lead_uploads (team_id);
create index if not exists lead_uploads_workflow_id_idx on public.lead_uploads (workflow_id);
