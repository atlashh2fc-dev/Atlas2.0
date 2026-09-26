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
  -- Secretaria: agenda personal 'completed' sin que el cliente contestara hace
  -- 5 minutos (el ejecutivo contestó y colgó: causa 16 sin conversación).
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
insert into dial_attempts (lead_id, campaign_id, phone, status, originated_at, ended_at, hangup_cause, attempt_kind) values
  ('00000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-0000000000e2', '+56910000006', 'completed', now() - interval '6 minutes', now() - interval '5 minutes', '16', 'personal_callback');

-- Abandonos que quedaron 'completed' causa 16 (20260926130000): el cliente
-- contestó (originated_at) y colgó sin ejecutiva. Alrededor, lo que NO es
-- abandono: con bridge, con AgentConnect confirmado (agent_id) aunque falte
-- el bridge, y sin originated_at.
insert into leads (id, phone, campaign_id, organization_id, workflow_status) values
  ('00000000-0000-0000-0000-000000000031', '+56910000031', '00000000-0000-0000-0000-0000000000e8', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 'pending'),
  ('00000000-0000-0000-0000-000000000032', '+56910000032', '00000000-0000-0000-0000-0000000000e8', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 'pending'),
  ('00000000-0000-0000-0000-000000000033', '+56910000033', '00000000-0000-0000-0000-0000000000e8', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 'pending'),
  ('00000000-0000-0000-0000-000000000034', '+56910000034', '00000000-0000-0000-0000-0000000000e8', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 'pending');
insert into dial_attempts (id, lead_id, campaign_id, phone, status, originated_at, bridged_at, ended_at, hangup_cause, agent_id) values
  ('00000000-0000-0000-0000-00000000d031', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000e8', '+56910000031', 'completed',
   now() - interval '11 minutes', null, now() - interval '10 minutes', '16', null),
  ('00000000-0000-0000-0000-00000000d032', '00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-0000000000e8', '+56910000032', 'completed',
   now() - interval '11 minutes', now() - interval '11 minutes', now() - interval '10 minutes', '16', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000d033', '00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-0000000000e8', '+56910000033', 'completed',
   now() - interval '11 minutes', null, now() - interval '10 minutes', '16', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000d034', '00000000-0000-0000-0000-000000000034', '00000000-0000-0000-0000-0000000000e8', '+56910000034', 'completed',
   null, null, now() - interval '10 minutes', '16', null);

-- Metas de abandono como fracción (semilla demo de Andes) y en cero.
update dialer_campaign_configs set target_abandonment_rate = 3 where campaign_id = '318cf37a-da42-4cbd-934d-bdc47753d7bd';
update dialer_campaign_configs set target_abandonment_rate = 0.03 where campaign_id = '00000000-0000-0000-0000-0000000000e2';
update dialer_campaign_configs set target_abandonment_rate = 0 where campaign_id = '00000000-0000-0000-0000-0000000000e8';
update dialer_campaign_configs set target_abandonment_rate = 0.05 where campaign_id = '00000000-0000-0000-0000-0000000000e3';
