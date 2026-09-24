-- Historial previo a las migraciones del discador, para probar la carga
-- inicial (lista de no llamar desde fichas, llamadas y Atlas 1; esperas de
-- intentos recientes). Geimser y Equifax usan sus id reales porque las
-- migraciones los nombran.
insert into organizations (id, name) values
  ('e64a8fa5-2f38-4460-97d8-f6b19634dccd', 'Geimser'),
  ('00000000-0000-0000-0000-00000000000b', 'Otra empresa');
insert into profiles (id, role) values ('00000000-0000-0000-0000-0000000000a1', 'agente');
insert into campaigns (id, name, organization_id) values
  ('318cf37a-da42-4cbd-934d-bdc47753d7bd', 'Equifax', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-0000000000e4', 'Equifax Imagen', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-0000000000e2', 'Secretaria Virtual', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-0000000000e8', 'Abogado Legal', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-0000000000e3', 'Campaña de otra empresa', '00000000-0000-0000-0000-00000000000b');
insert into dialer_campaign_configs (campaign_id, max_redial_attempts) values
  ('318cf37a-da42-4cbd-934d-bdc47753d7bd', 2),
  ('00000000-0000-0000-0000-0000000000e2', 2),
  ('00000000-0000-0000-0000-0000000000e8', 2),
  ('00000000-0000-0000-0000-0000000000e3', 2);
create table public.mig_a1_calls (legacy_call_id text primary key, phone_number text);

insert into leads (id, phone, campaign_id, organization_id, workflow_status, tipificacion_actual, managed_at) values
  -- Ficha cerrada CLIENTE MOLESTO sin llamada; L12 comparte el número.
  ('00000000-0000-0000-0000-000000000011', '+56910000001', '318cf37a-da42-4cbd-934d-bdc47753d7bd', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 'managed', 'CLIENTE MOLESTO', now() - interval '30 days'),
  ('00000000-0000-0000-0000-000000000012', '+56910000001', '318cf37a-da42-4cbd-934d-bdc47753d7bd', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 'pending', null, null),
  -- Llamada de Atlas 1: el número marcado (…04) no es el actual del lead (…03).
  ('00000000-0000-0000-0000-000000000013', '+56910000003', '318cf37a-da42-4cbd-934d-bdc47753d7bd', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 'managed', 'NUMERO ERRONEO / NO CORRESPONDE', now() - interval '60 days'),
  ('00000000-0000-0000-0000-000000000014', '+56910000004', '318cf37a-da42-4cbd-934d-bdc47753d7bd', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 'pending', null, null),
  ('00000000-0000-0000-0000-000000000015', '+56910000003', '318cf37a-da42-4cbd-934d-bdc47753d7bd', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 'pending', null, null),
  -- Secretaria: 'completed' sin contestar hace 5 minutos.
  ('00000000-0000-0000-0000-000000000016', '+56910000006', '00000000-0000-0000-0000-0000000000e2', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 'pending', null, null),
  -- Fuera de servicio de hace 400 días: ya venció, no entra.
  ('00000000-0000-0000-0000-000000000017', '+56910000007', '318cf37a-da42-4cbd-934d-bdc47753d7bd', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 'managed', null, now() - interval '400 days'),
  ('00000000-0000-0000-0000-000000000018', '+56910000007', '318cf37a-da42-4cbd-934d-bdc47753d7bd', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 'pending', null, null),
  -- Carterizado en Equifax Imagen: vale para Equifax (mismo cliente), no para Abogado.
  ('00000000-0000-0000-0000-000000000019', '+56910000009', '00000000-0000-0000-0000-0000000000e4', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 'managed', 'CLIENTE CARTERIZADO', now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000000020', '+56910000009', '318cf37a-da42-4cbd-934d-bdc47753d7bd', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 'pending', null, null),
  ('00000000-0000-0000-0000-000000000021', '+56910000009', '00000000-0000-0000-0000-0000000000e8', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 'pending', null, null);

insert into calls (lead_id, status, outcome, reason, ended_at, legacy_call_id) values
  ('00000000-0000-0000-0000-000000000013', 'connected', 'not_interested', 'NUMERO ERRONEO / NO CORRESPONDE', now() - interval '60 days', 'A1-1'),
  ('00000000-0000-0000-0000-000000000017', 'out_of_service', 'other', 'TELEFONO FUERA DE SERVICIO', now() - interval '400 days', 'A1-2'),
  ('00000000-0000-0000-0000-000000000019', 'connected', 'not_interested', 'CLIENTE CARTERIZADO', now() - interval '10 days', null);
insert into mig_a1_calls values ('A1-1', '+56910000004'), ('A1-2', '+56910000007');
insert into dial_attempts (lead_id, campaign_id, phone, status, originated_at, ended_at, hangup_cause) values
  ('00000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-0000000000e2', '+56910000006', 'completed', now() - interval '6 minutes', now() - interval '5 minutes', '16');
