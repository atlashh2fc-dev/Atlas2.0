-- Índices de cobertura para foreign keys sin indexar.
-- Origen: Supabase performance advisor (lint 0001_unindexed_foreign_keys), 21 FKs.
-- Un FK sin índice degrada joins y, sobre todo, los DELETE/UPDATE de la tabla padre
-- (Postgres escanea toda la tabla hija para validar la FK).
--
-- Nota operativa: este archivo usa CREATE INDEX normal (toma un lock breve de
-- escritura sobre cada tabla). Para aplicarlo en horario productivo con discador
-- activo, correr en su lugar las versiones CONCURRENTLY (una por línea, fuera de
-- transacción) que se dejan comentadas al final.

create index if not exists idx_agent_current_status_reason_id
  on public.agent_current_status (reason_id);

create index if not exists idx_agent_current_status_history_reason_id
  on public.agent_current_status_history (reason_id);

create index if not exists idx_dial_attempts_call_id
  on public.dial_attempts (call_id);

create index if not exists idx_dialer_agent_sessions_campaign_id
  on public.dialer_agent_sessions (campaign_id);

create index if not exists idx_dialer_agent_sessions_history_campaign_id
  on public.dialer_agent_sessions_history (campaign_id);

create index if not exists idx_external_import_batches_uploaded_by
  on public.external_import_batches (uploaded_by);

create index if not exists idx_external_lead_events_import_batch_id
  on public.external_lead_events (import_batch_id);

create index if not exists idx_external_lead_events_source_id
  on public.external_lead_events (source_id);

create index if not exists idx_lead_external_refs_campaign_id
  on public.lead_external_refs (campaign_id);

create index if not exists idx_lead_external_refs_last_batch_id
  on public.lead_external_refs (last_batch_id);

create index if not exists idx_lead_mail_status_last_batch_id
  on public.lead_mail_status (last_batch_id);

create index if not exists idx_lead_mail_status_lead_id
  on public.lead_mail_status (lead_id);

create index if not exists idx_mail_campaign_base_recipients_lead_id
  on public.mail_campaign_base_recipients (lead_id);

create index if not exists idx_mail_campaign_bases_created_by
  on public.mail_campaign_bases (created_by);

create index if not exists idx_mail_campaign_bases_source_id
  on public.mail_campaign_bases (source_id);

create index if not exists idx_mail_campaigns_created_by
  on public.mail_campaigns (created_by);

create index if not exists idx_mail_result_batches_base_id
  on public.mail_result_batches (base_id);

create index if not exists idx_mail_result_batches_source_id
  on public.mail_result_batches (source_id);

create index if not exists idx_mail_result_batches_uploaded_by
  on public.mail_result_batches (uploaded_by);

create index if not exists idx_vocalcom_call_events_import_batch_id
  on public.vocalcom_call_events (import_batch_id);

create index if not exists idx_vocalcom_import_batches_uploaded_by
  on public.vocalcom_import_batches (uploaded_by);

-- ---------------------------------------------------------------------------
-- Alternativa sin lock (correr manualmente vía psql, NO dentro de migración):
--
-- create index concurrently if not exists idx_dial_attempts_call_id
--   on public.dial_attempts (call_id);
-- create index concurrently if not exists idx_lead_mail_status_lead_id
--   on public.lead_mail_status (lead_id);
-- ... (repetir por cada índice de arriba con `concurrently`)
