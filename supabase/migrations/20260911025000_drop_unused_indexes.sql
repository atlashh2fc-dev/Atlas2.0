-- Suelta siete índices que nadie consulta.
--
-- Un índice inútil no cuesta sólo disco: se reescribe en cada INSERT y en cada
-- UPDATE que no sea HOT. En `leads`, el 96,5 % de los 135.909 updates medidos
-- no son HOT, así que cada uno tocaba también estos tres.
--
-- Se sueltan sólo los que tienen dos usos o menos desde que se reiniciaron las
-- estadísticas, hace 111 días, y que no respaldan ninguna constraint ni son
-- únicos:
--
--   staging_snap_call_idx                             0 usos   2.576 kB
--   integration_inbox_batches_status_idx              0 usos   2.184 kB
--   mail_campaign_lead_status_campaign_hot_queue_idx  0 usos     464 kB
--   leads_vocalcom_last_touched_at_idx                0 usos       8 kB
--   leads_campaign_email_norm_idx                     1 uso    4.680 kB
--   leads_external_last_seen_idx                      1 uso      304 kB
--   crm_entities_primary_lead_id_idx                  2 usos   2.368 kB
--
-- Quedan deliberadamente fuera, aunque una auditoría ingenua los marcaría:
--
--   leads_rut_norm_lookup_idx y leads_rut_body_lookup_idx aparecen con 20 y 11
--   usos porque el arreglo que los activó tiene un día, no porque estén
--   muertos. Antes de ese arreglo tenían cero y llevaban meses creados.
--
--   idx_leads_rut_norm tiene 68.764 usos históricos. Probablemente quede
--   huérfano ahora que la búsqueda usa la otra escritura de la misma
--   expresión, pero eso se comprueba con estadísticas nuevas, no adivinando.
--
--   leads_phone_last9_lookup_idx e interactions_lead_id_idx son redundantes en
--   teoría con un índice más ancho, pero el planner los está usando.
--
-- Se usa DROP INDEX y no CONCURRENTLY porque la herramienta de migración
-- envuelve en una transacción y CONCURRENTLY no lo admite. Es una operación de
-- catálogo, sin reescritura de tabla: el bloqueo dura milisegundos.
--
-- Todos se recrean con un CREATE INDEX si alguna vez hicieran falta.

drop index if exists public.staging_snap_call_idx;
drop index if exists public.integration_inbox_batches_status_idx;
drop index if exists public.mail_campaign_lead_status_campaign_hot_queue_idx;
drop index if exists public.leads_vocalcom_last_touched_at_idx;
drop index if exists public.leads_campaign_email_norm_idx;
drop index if exists public.leads_external_last_seen_idx;
drop index if exists public.crm_entities_primary_lead_id_idx;
