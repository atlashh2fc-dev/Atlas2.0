
-- Tablas de staging temporales para la migración del CRM legado (Equifax/DICOM).
-- Se eliminan al final de la migración (no son parte del esquema permanente).

create table public.staging_carga_tipificaciones (
  row_n int generated always as identity,
  campana text,
  legacy_lead_id text,
  legacy_contact_id text,
  rut_empresa text,
  razon_social_o_nombre text,
  telefono_1_normalizado text,
  telefono_contacto text,
  tipificacion_actual text,
  observacion_actual text,
  tipificacion_para_migrar text,
  workflow_status text,
  assignment_status text,
  managed_at_utc text,
  ejecutivo_gestion text,
  ejecutivo_gestion_id text,
  next_action_at_utc text,
  last_call_id text
);

create table public.staging_historial_gestiones (
  row_n int generated always as identity,
  campana text,
  legacy_call_id text,
  legacy_lead_id text,
  ejecutivo_id text,
  ejecutivo text,
  started_at_local text,
  ended_at_local text,
  status text,
  outcome text,
  tipificacion_para_migrar text,
  notes text,
  next_action_at_local text,
  phone_number text,
  rut_empresa text
);

create table public.staging_snapshots_equifax (
  row_n int generated always as identity,
  legacy_call_id text,
  productos text,
  uf_mensual text
);

create index staging_carga_tip_rut_idx on public.staging_carga_tipificaciones (rut_empresa);
create index staging_hist_call_idx on public.staging_historial_gestiones (legacy_call_id);
create index staging_snap_call_idx on public.staging_snapshots_equifax (legacy_call_id);
;
