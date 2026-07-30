-- Historial de cargas masivas: antes la carga insertaba leads sin dejar
-- registro del archivo, así que no se podía auditar qué entró ni desde dónde.
create table if not exists public.lead_uploads (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  workflow_id uuid references public.workflows(id) on delete set null,
  total_rows integer not null default 0,
  inserted_count integer not null default 0,
  duplicates_in_file integer not null default 0,
  duplicates_in_db integer not null default 0,
  rejected_count integer not null default 0,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists lead_uploads_created_at_idx on public.lead_uploads (created_at desc);
create index if not exists lead_uploads_campaign_id_idx on public.lead_uploads (campaign_id);
create index if not exists lead_uploads_uploaded_by_idx on public.lead_uploads (uploaded_by);

alter table public.lead_uploads enable row level security;

drop policy if exists lead_uploads_select on public.lead_uploads;
create policy lead_uploads_select on public.lead_uploads
  for select using (public.current_role_name() in ('admin', 'supervisor'));

drop policy if exists lead_uploads_admin_insert on public.lead_uploads;
create policy lead_uploads_admin_insert on public.lead_uploads
  for insert with check (public.current_role_name() = 'admin');

drop policy if exists lead_uploads_admin_delete on public.lead_uploads;
create policy lead_uploads_admin_delete on public.lead_uploads
  for delete using (public.current_role_name() = 'admin');

comment on table public.lead_uploads is 'Una fila por archivo de carga masiva procesado: qué entró, qué se descartó y quién lo subió.';
