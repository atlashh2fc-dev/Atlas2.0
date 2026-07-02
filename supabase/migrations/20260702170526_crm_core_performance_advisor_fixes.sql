-- Core CRM performance hygiene from Supabase advisors.
-- These indexes cover foreign keys used by assignment/audit flows and
-- primary keys make legacy staging tables deterministic at scale.

create index if not exists lead_assignments_assigned_by_idx
  on public.lead_assignments (assigned_by);

create index if not exists lead_assignments_campaign_id_idx
  on public.lead_assignments (campaign_id);

create index if not exists lead_contacts_created_by_idx
  on public.lead_contacts (created_by);

alter table public.staging_carga_tipificaciones
  add constraint staging_carga_tipificaciones_pkey primary key (row_n);

alter table public.staging_historial_gestiones
  add constraint staging_historial_gestiones_pkey primary key (row_n);

alter table public.staging_snapshots_equifax
  add constraint staging_snapshots_equifax_pkey primary key (row_n);
