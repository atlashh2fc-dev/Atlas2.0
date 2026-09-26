-- Escenarios del discador sobre un Postgres desechable (scripts/probar-discador-sql.sh).
-- Cada pg_temp.check aborta en la primera regla que no se cumple. Los
-- escenarios no dependen de la hora a la que se corran: las campañas de
-- prueba no tienen franja salvo donde se prueba la franja.
\set ON_ERROR_STOP 1

create function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
create function pg_temp.retry(p uuid) returns timestamptz language sql as $$ select dialer_retry_at from leads where id = p $$;
create function pg_temp.hold(p uuid) returns text language sql as $$ select dialer_hold_reason from leads where id = p $$;
create function pg_temp.near(t timestamptz, target timestamptz) returns boolean language sql as $$
  select t between target - interval '1 minute' and target + interval '1 minute' $$;

-- ===========================================================================
-- 0. Carga inicial (historial.sql + migraciones aplicadas dos veces)
-- ===========================================================================
select pg_temp.check((select calling_days = '{1,2,3,4,5}' and calling_start_time = '09:00' and calling_end_time = '19:00'
  and skip_holidays and max_uncontacted_attempts = 6 and technical_breaker_ratio = 0.8
  from dialer_campaign_configs where campaign_id = '318cf37a-da42-4cbd-934d-bdc47753d7bd'), 'Equifax: L-V 09-19, sin feriados, tope 6, cortacircuitos 0,8');
select pg_temp.check((select calling_days is null and not skip_holidays and technical_breaker_ratio is null and max_uncontacted_attempts = 8
  from dialer_campaign_configs where campaign_id = '00000000-0000-0000-0000-0000000000e2'), 'Secretaria sin franja ni cortacircuitos (como antes)');
select pg_temp.check((select array_agg(name order by name) from campaigns where dialer_client_key = 'equifax') = '{Equifax,"Equifax Imagen"}', 'cliente equifax por nombre, solo en Geimser');
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000012') = 'infinity' and pg_temp.hold('00000000-0000-0000-0000-000000000012') = 'no_llamar', 'ficha CLIENTE MOLESTO suprime al que comparte el número');
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000014') = 'infinity', 'Atlas 1: se suprime el número que se marcó');
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000015') is null, 'Atlas 1: no el teléfono actual del lead');
select pg_temp.check(pg_temp.near(pg_temp.retry('00000000-0000-0000-0000-000000000016'), now() + interval '25 minutes'), 'Secretaria: completed sin contestar hace 5 min espera 25 min más');
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000018') is null, 'fuera de servicio vencido no suprime');
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000020') = 'infinity', 'carterizado en Equifax Imagen vale para Equifax');
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000021') is null, 'carterizado de Equifax no vale para Abogado');
select pg_temp.check((select count(*) = 1 from dialer_phone_suppressions where phone = '56910000009' and client_key = 'equifax' and campaign_id is null), 'fila con alcance de cliente');

-- Abandono real y meta en porcentaje (20260926130000)
create function pg_temp.meta(p uuid) returns numeric language sql as $$
  select target_abandonment_rate from dialer_campaign_configs where campaign_id = p $$;
create function pg_temp.estado(p uuid) returns text language sql as $$ select status from dial_attempts where id = p $$;
create function pg_temp.rechaza_meta(p numeric) returns boolean language plpgsql as $$
begin
  update dialer_campaign_configs set target_abandonment_rate = p where campaign_id = '00000000-0000-0000-0000-0000000000e8';
  return false;
exception when check_violation then return true;
end $$;
select pg_temp.check(pg_temp.meta('318cf37a-da42-4cbd-934d-bdc47753d7bd') = 3, 'meta ya en porcentaje no cambia');
select pg_temp.check(pg_temp.meta('00000000-0000-0000-0000-0000000000e2') = 3, 'meta 0,03 pasa a 3 %');
select pg_temp.check(pg_temp.meta('00000000-0000-0000-0000-0000000000e3') = 5, 'meta 0,05 pasa a 5 %');
select pg_temp.check(pg_temp.meta('00000000-0000-0000-0000-0000000000e8') = 3, 'meta 0 pasa a 3 %');
select pg_temp.check(pg_temp.rechaza_meta(0.03) and pg_temp.rechaza_meta(0) and pg_temp.rechaza_meta(150), 'la base rechaza fracciones, cero y más de 100');
select pg_temp.check(not pg_temp.rechaza_meta(2.5) and pg_temp.meta('00000000-0000-0000-0000-0000000000e8') = 2.5, 'acepta 2,5 %');
update dialer_campaign_configs set target_abandonment_rate = 3 where campaign_id = '00000000-0000-0000-0000-0000000000e8';
select pg_temp.check(pg_temp.estado('00000000-0000-0000-0000-00000000d031') = 'abandoned', 'contestado sin ejecutiva que quedó completed pasa a abandoned');
select pg_temp.check(pg_temp.near(pg_temp.retry('00000000-0000-0000-0000-000000000031'), now() + interval '1430 minutes'), 'el abandono cuenta como "habló": espera el último escalón');
select pg_temp.check(pg_temp.estado('00000000-0000-0000-0000-00000000d032') = 'completed', 'con bridge sigue completed');
select pg_temp.check(pg_temp.estado('00000000-0000-0000-0000-00000000d033') = 'completed', 'con AgentConnect confirmado (agent_id) sigue completed aunque falte el bridge');
select pg_temp.check(pg_temp.estado('00000000-0000-0000-0000-00000000d034') = 'completed', 'sin originated_at no se sabe si contestó: sigue completed');
select pg_temp.check((select status = 'completed' from dial_attempts where lead_id = '00000000-0000-0000-0000-000000000016'), 'una agenda personal no se reclasifica');

-- ===========================================================================
-- Datos de los escenarios
-- ===========================================================================
insert into organizations (id, name) values ('00000000-0000-0000-0000-00000000000c', 'Tercera');
insert into profiles (id, role) values
  ('00000000-0000-0000-0000-0000000000a2', 'agente'),
  ('00000000-0000-0000-0000-0000000000a9', 'agente'),
  ('00000000-0000-0000-0000-0000000000b1', 'supervisor'),
  ('00000000-0000-0000-0000-0000000000b2', 'supervisor'),
  ('00000000-0000-0000-0000-0000000000c1', 'admin');
insert into organization_members values
  ('e64a8fa5-2f38-4460-97d8-f6b19634dccd', '00000000-0000-0000-0000-0000000000a1'),
  ('e64a8fa5-2f38-4460-97d8-f6b19634dccd', '00000000-0000-0000-0000-0000000000a2'),
  ('e64a8fa5-2f38-4460-97d8-f6b19634dccd', '00000000-0000-0000-0000-0000000000b1'),
  ('e64a8fa5-2f38-4460-97d8-f6b19634dccd', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a9');
insert into campaigns (id, name, organization_id) values
  ('00000000-0000-0000-0000-0000000000f1', 'Pool', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-0000000000f2', 'Pool holgado', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-0000000000f5', 'Entrante', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-0000000000f6', 'QA', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-0000000000f7', 'Voz IA', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-0000000000f8', 'Troncal caída', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-0000000000f9', 'Barrera', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd');
insert into stub_supervisor_campaigns values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1');
insert into dialer_campaign_configs (campaign_id, max_redial_attempts) values
  ('00000000-0000-0000-0000-0000000000f1', 2), ('00000000-0000-0000-0000-0000000000f2', 5),
  ('00000000-0000-0000-0000-0000000000f5', 0), ('00000000-0000-0000-0000-0000000000f6', 1),
  ('00000000-0000-0000-0000-0000000000f8', 2), ('00000000-0000-0000-0000-0000000000f9', 2);
update dialer_campaign_configs set max_uncontacted_attempts = 6, max_technical_failures = 3
where campaign_id = '00000000-0000-0000-0000-0000000000f1';
update dialer_campaign_configs set technical_breaker_ratio = 0.8 where campaign_id = '00000000-0000-0000-0000-0000000000f8';
-- Los cambios de política de arriba piden recálculo: se vacía para empezar limpio.
select dialer_process_retry_recompute();
insert into ai_voice_campaign_configs (campaign_id, max_concurrent_calls, phone_number_id) values ('00000000-0000-0000-0000-0000000000f7', 5, 'x');
insert into dialer_agent_sessions (profile_id, campaign_id, status) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 'available'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f1', 'available'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f5', 'available'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f6', 'available'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2', 'available'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f8', 'available'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f9', 'available');

insert into leads (id, phone, campaign_id, organization_id, external_priority_rank, workflow_status) values
  ('00000000-0000-0000-0000-000000000101', '+56911111111', '00000000-0000-0000-0000-0000000000f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 1, 'pending'),
  ('00000000-0000-0000-0000-000000000102', '911111111',    '00000000-0000-0000-0000-0000000000f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 2, 'pending'),
  ('00000000-0000-0000-0000-000000000103', '+56922222222', '00000000-0000-0000-0000-0000000000f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 3, 'pending'),
  ('00000000-0000-0000-0000-000000000104', '+56933333333', '00000000-0000-0000-0000-0000000000f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 4, 'pending'),
  ('00000000-0000-0000-0000-000000000105', '+56933333333', '00000000-0000-0000-0000-0000000000e2', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', null, 'managed'),
  ('00000000-0000-0000-0000-000000000106', '+56933333333', '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000000b', 1, 'pending'),
  ('00000000-0000-0000-0000-000000000107', '+56944444444', '00000000-0000-0000-0000-0000000000f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 7, 'pending'),
  ('00000000-0000-0000-0000-000000000108', '+56955555555', '00000000-0000-0000-0000-0000000000f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 8, 'pending'),
  ('00000000-0000-0000-0000-000000000109', '+56966666666', '00000000-0000-0000-0000-0000000000f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 9, 'pending');

-- ===========================================================================
-- 1. Reglas puras
-- ===========================================================================
select pg_temp.check(dialer_suppression_reason('Cliente molesto') = 'cliente_molesto', 'motivo: molesto');
select pg_temp.check(dialer_suppression_reason('NUMERO ERRONEO / NO CORRESPONDE') = 'numero_erroneo', 'motivo: número erróneo');
select pg_temp.check(dialer_suppression_reason('TELÉFONO FUERA DE SERVICIO') = 'fuera_de_servicio', 'motivo: fuera de servicio');
select pg_temp.check(dialer_suppression_reason('lo que sea', 'out_of_service') = 'fuera_de_servicio', 'estado fuera de servicio');
select pg_temp.check(dialer_suppression_reason('CTE CARTERIZADO') = 'cliente_carterizado', 'motivo: carterizado');
select pg_temp.check(dialer_suppression_reason('SE DECLARA EN QUIEBRA O PROCESO DE CIERRE') = 'quiebra_o_cierre', 'motivo: quiebra');
select pg_temp.check(dialer_suppression_reason('CLIENTE NO SUJETO A VENTA') = 'no_sujeto_a_venta', 'motivo: no sujeto a venta');
select pg_temp.check(dialer_suppression_reason('OCUPADO | CIERRE AUTOMÁTICO POR TIEMPO DE INACTIVIDAD (15 MIN)') is null, 'el cierre automático no es quiebra');
select pg_temp.check(dialer_suppression_reason('VOLVER A LLAMAR') is null, 'volver a llamar no suprime');

-- Franja (septiembre de 2026 en Chile = UTC-3).
select pg_temp.check(dialer_calling_window_open('{1,2,3,4,5}', '09:00', '19:00', '2026-09-24 15:00+00'), 'jueves 12:00 abierto');
select pg_temp.check(not dialer_calling_window_open('{1,2,3,4,5}', '09:00', '19:00', '2026-09-26 15:00+00'), 'sábado cerrado');
select pg_temp.check(not dialer_calling_window_open('{1,2,3,4,5}', '09:00', '19:00', '2026-09-24 22:00+00'), 'jueves 19:00 cerrado');
select pg_temp.check(not dialer_calling_window_open('{1,2,3,4,5}', '09:00', '19:00', '2026-09-24 11:59+00'), 'jueves 08:59 cerrado');
select pg_temp.check(dialer_calling_window_open('{1,2,3,4,5}', '09:00', '19:00', '2026-09-24 12:00+00'), 'jueves 09:00 abierto');
select pg_temp.check(dialer_calling_window_open(null, null, null, '2026-09-27 06:00+00'), 'sin franja siempre abierto');
select pg_temp.check(dialer_is_holiday('e64a8fa5-2f38-4460-97d8-f6b19634dccd', '2026-09-18 15:00+00'), '18 de septiembre es feriado');
select pg_temp.check(dialer_is_holiday(null, '2026-12-25 23:30+00'), '25-12 20:30 hora Chile es feriado');
select pg_temp.check(dialer_is_holiday(null, '2026-12-26 02:30+00'), 'el feriado se mide en hora Chile: 26-12 02:30 UTC es 25-12 23:30 en Chile');
select pg_temp.check(not dialer_is_holiday(null, '2026-12-26 15:00+00'), '26-12 no es feriado');
select pg_temp.check(dialer_campaign_in_calling_window('00000000-0000-0000-0000-0000000000e2'), 'campaña sin franja abierta');
select pg_temp.check(dialer_campaign_in_calling_window(gen_random_uuid()), 'campaña sin configuración abierta');
select pg_temp.check(dialer_backoff_minutes('{30,120,1440}', 1) = 30 and dialer_backoff_minutes('{30,120,1440}', 2) = 120
  and dialer_backoff_minutes('{30,120,1440}', 9) = 1440 and dialer_backoff_minutes('{30,120,1440}', 1, true) = 1440, 'escalones');

select pg_temp.check(dialer_attempt_result_class('failed', 'pool', null, null) = 'tecnico', 'Originate fallido = técnico');
select pg_temp.check(dialer_attempt_result_class('failed', 'pool', now(), '34') = 'tecnico', 'congestión Q.850 34 = técnico');
select pg_temp.check(dialer_attempt_result_class('failed', 'pool', null, '1') = 'invalido', 'número no asignado Q.850 1 = inválido');
select pg_temp.check(dialer_attempt_result_class('failed', 'pool', null, '21') = 'real', 'rechazo del destino Q.850 21 = real');
select pg_temp.check(dialer_attempt_result_class('failed', 'pool', null, '34') = 'tecnico', 'sin circuito Q.850 34 sin contestar = técnico');
select pg_temp.check(dialer_attempt_result_class('no_answer', 'pool', null, null) = 'real', 'Originate que sonó (reason 3 -> no_answer) = real');
select pg_temp.check(dialer_attempt_result_class('completed', 'pool', now(), '16') = 'real', 'completed sin contestar = real');
select pg_temp.check(dialer_attempt_result_class('no_answer', 'personal_callback', null, null) = 'ignorado', 'agenda: el ejecutivo no contestó = ignorado');
select pg_temp.check(dialer_attempt_result_class('ringing', 'pool', now(), null) is null, 'en vuelo no se clasifica');

-- ===========================================================================
-- 2. Tipificación sensible: fila por llamada y saca a quien comparte el número
-- ===========================================================================
insert into calls (id, lead_id, agent_id, status, outcome, reason, ended_at) values
  ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-0000000000a1', 'connected', 'not_interested', 'CLIENTE MOLESTO', now());
select pg_temp.check((select count(*) = 1 from dialer_phone_suppressions where phone = '56933333333' and campaign_id is null and client_key is null and reason = 'cliente_molesto' and lifted_at is null), 'fila de no llamar creada');
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000104') = 'infinity' and pg_temp.hold('00000000-0000-0000-0000-000000000104') = 'no_llamar', 'L104 fuera de la cola por teléfono molesto');
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000106') is null, 'otra empresa no se ve afectada');

-- ===========================================================================
-- 3. Claim: uno por teléfono; 'completed' sin contestar cuenta y espera
-- ===========================================================================
create temp table r1 as select * from claim_next_dial_targets('00000000-0000-0000-0000-0000000000f1', 10);
select pg_temp.check((select array_agg(lead_id order by lead_id) from r1) = array['00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000103'::uuid], 'claim 1 = L101 y L103 (uno por teléfono) ' || (select coalesce(array_agg(lead_id)::text, '-') from r1));

update dial_attempts set status = 'completed', originated_at = now() - interval '40 seconds', ended_at = now(), hangup_cause = '16'
where lead_id = '00000000-0000-0000-0000-000000000101';
select pg_temp.check(pg_temp.near(pg_temp.retry('00000000-0000-0000-0000-000000000101'), now() + interval '30 minutes'), 'completed sin contestar espera 30 min');
select pg_temp.check(pg_temp.near(pg_temp.retry('00000000-0000-0000-0000-000000000102'), now() + interval '30 minutes'), 'el mismo número en otro lead también espera 30 min');

create temp table r2 as select * from claim_next_dial_targets('00000000-0000-0000-0000-0000000000f1', 10);
select pg_temp.check((select array_agg(lead_id order by lead_id) from r2) = array['00000000-0000-0000-0000-000000000107'::uuid], 'claim 2 = L107 (L103 sigue en vuelo) ' || (select coalesce(array_agg(lead_id)::text, '-') from r2));

-- Abandono (contestó sin ejecutivo): último escalón.
update dial_attempts set status = 'abandoned', originated_at = now(), answered_at = now(), ended_at = now()
where lead_id = '00000000-0000-0000-0000-000000000103';
select pg_temp.check(pg_temp.near(pg_temp.retry('00000000-0000-0000-0000-000000000103'), now() + interval '24 hours'), 'abandono espera 24 h');

-- Pasada la espera, L101 vuelve.
update dial_attempts set ended_at = now() - interval '31 minutes' where lead_id = '00000000-0000-0000-0000-000000000101';
select dialer_refresh_retry_at('e64a8fa5-2f38-4460-97d8-f6b19634dccd', '+56911111111', null);
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000101') is null, 'L101 sin espera tras 31 min');
update dial_attempts set status = 'no_answer', originated_at = now(), ended_at = now() where lead_id = '00000000-0000-0000-0000-000000000107';
create temp table r3 as select * from claim_next_dial_targets('00000000-0000-0000-0000-0000000000f1', 10);
select pg_temp.check((select array_agg(lead_id order by lead_id) from r3) = array['00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000108'::uuid], 'claim 3 = L101 y L108 ' || (select coalesce(array_agg(lead_id)::text, '-') from r3));

-- Segundo intento real en 7 días con max_redial = 2: manda la ventana semanal.
update dial_attempts set status = 'busy', originated_at = now(), ended_at = now()
where lead_id = '00000000-0000-0000-0000-000000000101' and status = 'queued';
select pg_temp.check(pg_temp.near(pg_temp.retry('00000000-0000-0000-0000-000000000101'), now() + interval '7 days' - interval '31 minutes'), 'cupo semanal por lead');
select pg_temp.check(pg_temp.near(pg_temp.retry('00000000-0000-0000-0000-000000000102'), now() + interval '7 days' - interval '31 minutes'), 'cupo semanal por teléfono alcanza al otro lead');

-- ===========================================================================
-- 4. Gestión humana: agenda sin dueño y devolución a la cola
-- ===========================================================================
update leads set managed_at = now(), workflow_status = 'callback', next_action_at = now() - interval '1 minute'
where id = '00000000-0000-0000-0000-000000000101';
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000101') is null, 'agenda: ni los intentos previos ni el cupo semanal la retrasan');

-- L108 habló con un ejecutivo, se tipificó y un supervisor lo devuelve al pool
-- 5 minutos después: no se lo vuelve a llamar en el día.
update dial_attempts set status = 'completed', originated_at = now() - interval '4 minutes', answered_at = now() - interval '3 minutes',
  bridged_at = now() - interval '3 minutes', ended_at = now(), agent_id = '00000000-0000-0000-0000-0000000000a1'
where lead_id = '00000000-0000-0000-0000-000000000108';
update leads set managed_at = now(), workflow_status = 'managed', tipificacion_actual = 'NO DA MOTIVO' where id = '00000000-0000-0000-0000-000000000108';
update leads set workflow_status = 'pending' where id = '00000000-0000-0000-0000-000000000108';
select pg_temp.check(pg_temp.near(pg_temp.retry('00000000-0000-0000-0000-000000000108'), now() + interval '24 hours'), 'devuelto al pool tras hablar: 24 h desde el contacto');

-- ===========================================================================
-- 5. Tope sin contacto, cambio de política por lotes y devolución por supervisor
-- ===========================================================================
insert into dial_attempts (lead_id, campaign_id, phone, status, originated_at, ended_at)
select '00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-0000000000f1', '+56966666666', 'no_answer',
  now() - (g || ' days')::interval, now() - (g || ' days')::interval
from generate_series(10, 60, 10) g;
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000109') = 'infinity' and pg_temp.hold('00000000-0000-0000-0000-000000000109') = 'tope_sin_contacto', 'tope de 6 intentos que sonaron');

update dialer_campaign_configs set max_uncontacted_attempts = 10 where campaign_id = '00000000-0000-0000-0000-0000000000f1';
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000109') = 'infinity', 'guardar la política no recalcula en la misma petición');
select pg_temp.check(exists (select 1 from dialer_retry_recompute_campaigns where campaign_id = '00000000-0000-0000-0000-0000000000f1'), 'la política queda pedida al cron');
select dialer_process_retry_recompute();
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000109') is null and pg_temp.hold('00000000-0000-0000-0000-000000000109') is null, 'el cron aplica el tope nuevo y libera a L109');
select pg_temp.check(not exists (select 1 from dialer_retry_recompute_campaigns), 'la petición se cierra al terminar');
update dialer_campaign_configs set max_uncontacted_attempts = 6 where campaign_id = '00000000-0000-0000-0000-0000000000f1';
select dialer_process_retry_recompute();
-- Bajar el tope rige para los sin espera desde su próximo intento; se fuerza.
select dialer_refresh_lead_retry_at('00000000-0000-0000-0000-000000000109');
select pg_temp.check(pg_temp.hold('00000000-0000-0000-0000-000000000109') = 'tope_sin_contacto', 'con tope 6 vuelve a quedar retenido');
select pg_temp.check(exists (select 1 from dialer_held_leads where lead_id = '00000000-0000-0000-0000-000000000109'), 'visible en dialer_held_leads');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ begin
  perform dialer_release_held_leads('00000000-0000-0000-0000-0000000000f1', null);
  raise exception 'un ejecutivo no debería poder devolver leads';
exception when insufficient_privilege then null;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b2';
do $$ begin
  perform dialer_release_held_leads('00000000-0000-0000-0000-0000000000f1', null);
  raise exception 'un supervisor de otra empresa no debería poder devolver leads';
exception when insufficient_privilege then null;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.check(dialer_release_held_leads('00000000-0000-0000-0000-0000000000f1', null) = 1, 'el supervisor de la campaña devuelve 1 lead');
reset role;
reset request.jwt.claim.sub;
select pg_temp.check(pg_temp.hold('00000000-0000-0000-0000-000000000109') is null
  and pg_temp.near(pg_temp.retry('00000000-0000-0000-0000-000000000109'), now() + interval '5 minutes'), 'devuelto: espera provisional de 5 min');
select dialer_process_retry_recompute();
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000109') is null and pg_temp.hold('00000000-0000-0000-0000-000000000109') is null, 'ciclo nuevo: sin espera ni tope');

-- ===========================================================================
-- 6. Fallas técnicas: espera corta creciente, no gastan el cupo, tope propio
-- ===========================================================================
insert into leads (id, phone, campaign_id, organization_id, external_priority_rank) values
  ('00000000-0000-0000-0000-000000000110', '+56977777777', '00000000-0000-0000-0000-0000000000f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 10),
  ('00000000-0000-0000-0000-000000000111', '+56988888888', '00000000-0000-0000-0000-0000000000f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 11);
insert into dial_attempts (lead_id, campaign_id, phone, status, ended_at) values
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-0000000000f1', '+56977777777', 'failed', now() - interval '2 seconds');
select pg_temp.check(pg_temp.near(pg_temp.retry('00000000-0000-0000-0000-000000000110'), now() + interval '10 minutes'), '1.ª falla técnica: 10 min');
insert into dial_attempts (lead_id, campaign_id, phone, status, ended_at) values
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-0000000000f1', '+56977777777', 'failed', now() - interval '1 second');
select pg_temp.check(pg_temp.near(pg_temp.retry('00000000-0000-0000-0000-000000000110'), now() + interval '20 minutes'), '2.ª falla técnica seguida: 20 min (y no 7 días por cupo semanal)');
insert into dial_attempts (lead_id, campaign_id, phone, status, ended_at) values
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-0000000000f1', '+56977777777', 'failed', now());
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000110') = 'infinity' and pg_temp.hold('00000000-0000-0000-0000-000000000110') = 'tope_fallas_tecnicas', 'tope de 3 fallas técnicas seguidas');
insert into dial_attempts (lead_id, campaign_id, phone, status, attempt_kind, ended_at) values
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-0000000000f1', '+56988888888', 'no_answer', 'personal_callback', now());
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000111') is null, 'agenda cuyo ejecutivo no contestó no cuenta contra el cliente');

-- ===========================================================================
-- 7. Por teléfono: la espera más larga de la ventana y el cupo semanal
-- ===========================================================================
insert into leads (id, phone, campaign_id, organization_id, external_priority_rank) values
  ('00000000-0000-0000-0000-000000000121', '+56912340001', '00000000-0000-0000-0000-0000000000f2', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 1),
  ('00000000-0000-0000-0000-000000000122', '+56912340001', '00000000-0000-0000-0000-0000000000f2', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 2),
  ('00000000-0000-0000-0000-000000000123', '+56912340001', '00000000-0000-0000-0000-0000000000f2', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 3),
  ('00000000-0000-0000-0000-000000000131', '+56912340002', '00000000-0000-0000-0000-0000000000f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 31),
  ('00000000-0000-0000-0000-000000000132', '+56912340002', '00000000-0000-0000-0000-0000000000f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 32),
  ('00000000-0000-0000-0000-000000000133', '+56912340002', '00000000-0000-0000-0000-0000000000f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 33);
-- Pool holgado (5 por semana): habló hace 3 h en L121, no contestó hace 1 h en L122.
insert into dial_attempts (lead_id, campaign_id, phone, status, originated_at, answered_at, bridged_at, ended_at) values
  ('00000000-0000-0000-0000-000000000121', '00000000-0000-0000-0000-0000000000f2', '+56912340001', 'completed', now() - interval '3 hours', now() - interval '3 hours', now() - interval '3 hours', now() - interval '3 hours'),
  ('00000000-0000-0000-0000-000000000122', '00000000-0000-0000-0000-0000000000f2', '+56912340001', 'no_answer', now() - interval '1 hour', null, null, now() - interval '1 hour');
select pg_temp.check(pg_temp.near(pg_temp.retry('00000000-0000-0000-0000-000000000123'), now() + interval '21 hours'), 'el no contesta de después no acorta las 24 h de quien habló');
-- Pool con 2 por semana: dos intentos al número en leads distintos agotan el número.
insert into dial_attempts (lead_id, campaign_id, phone, status, originated_at, ended_at) values
  ('00000000-0000-0000-0000-000000000131', '00000000-0000-0000-0000-0000000000f1', '+56912340002', 'no_answer', now() - interval '5 hours', now() - interval '5 hours'),
  ('00000000-0000-0000-0000-000000000132', '00000000-0000-0000-0000-0000000000f1', '+56912340002', 'no_answer', now() - interval '4 hours', now() - interval '4 hours');
select pg_temp.check(pg_temp.near(pg_temp.retry('00000000-0000-0000-0000-000000000133'), now() + interval '7 days' - interval '5 hours'), 'cupo semanal por número entre leads');

-- ===========================================================================
-- 8. Correcciones: se levanta solo la fila de la llamada corregida
-- ===========================================================================
insert into calls (id, lead_id, agent_id, status, outcome, reason, ended_at) values
  ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-0000000000a1', 'connected', 'not_interested', 'CLIENTE MOLESTO', now());
select pg_temp.check((select count(*) = 2 from dialer_phone_suppressions where phone = '56933333333' and lifted_at is null), 'dos llamadas, dos filas');
update calls set reason = 'NO DA MOTIVO' where id = '00000000-0000-0000-0000-0000000000c5';
select pg_temp.check((select count(*) = 1 from dialer_phone_suppressions where phone = '56933333333' and lifted_at is null), 'corregir una llamada deja la otra vigente');
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000104') = 'infinity', 'L104 sigue fuera mientras otra llamada diga molesto');
update calls set reason = 'NO DA MOTIVO' where id = '00000000-0000-0000-0000-0000000000c6';
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000104') is null, 'corregidas ambas, L104 vuelve a la cola');
-- Carterizado en una campaña sin cliente: solo esa campaña.
insert into calls (lead_id, status, outcome, reason, ended_at) values ('00000000-0000-0000-0000-000000000105', 'connected', 'not_interested', 'CLIENTE CARTERIZADO', now());
select pg_temp.check((select campaign_id = '00000000-0000-0000-0000-0000000000e2' from dialer_phone_suppressions where reason = 'cliente_carterizado' and phone = '56933333333'), 'carterizado sin cliente: alcance de campaña');
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000104') is null, 'carterizado de Secretaria no bloquea el Pool');
-- La ficha: al cambiar su tipificación se levanta su fila.
update leads set tipificacion_actual = 'NO DA MOTIVO' where id = '00000000-0000-0000-0000-000000000011';
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000012') is null, 'ficha corregida: L12 vuelve a la cola');

-- ===========================================================================
-- 9. Horario y feriados en el claim
-- ===========================================================================
update dialer_campaign_configs set calling_days = array[(extract(isodow from now() at time zone 'America/Santiago')::int % 7) + 1]::smallint[]
where campaign_id = '00000000-0000-0000-0000-0000000000f1';
update dial_attempts set status = 'failed', ended_at = now() - interval '2 days' where status in ('queued', 'originating', 'ringing', 'answered', 'bridged');
create temp table r4 as select * from claim_next_dial_targets('00000000-0000-0000-0000-0000000000f1', 10);
select pg_temp.check((select count(*) = 0 from r4), 'fuera de los días permitidos no disca');
update dialer_campaign_configs set calling_days = null, skip_holidays = true where campaign_id = '00000000-0000-0000-0000-0000000000f1';
insert into dialer_holidays (organization_id, holiday_date, name)
values ('e64a8fa5-2f38-4460-97d8-f6b19634dccd', (now() at time zone 'America/Santiago')::date, 'Feriado de prueba');
select pg_temp.check(not dialer_campaign_in_calling_window('00000000-0000-0000-0000-0000000000f1'), 'feriado de la empresa cierra la campaña');
select pg_temp.check(dialer_campaign_in_calling_window('00000000-0000-0000-0000-0000000000e2'), 'sin skip_holidays la campaña sigue abierta');
delete from dialer_holidays where name = 'Feriado de prueba';
update dialer_campaign_configs set skip_holidays = false where campaign_id = '00000000-0000-0000-0000-0000000000f1';

-- ===========================================================================
-- 10. Lista de no llamar: consulta segura, resguardo de dial_attempts y voz IA
-- ===========================================================================
insert into leads (id, phone, campaign_id, organization_id, external_priority_rank) values
  ('00000000-0000-0000-0000-000000000141', '+56999990000', '00000000-0000-0000-0000-0000000000f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 41),
  ('00000000-0000-0000-0000-000000000142', '+56999990000', '00000000-0000-0000-0000-0000000000f7', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', null),
  ('00000000-0000-0000-0000-000000000143', '+56999990001', '00000000-0000-0000-0000-0000000000f7', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', null);
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
insert into dialer_phone_suppressions (organization_id, phone, reason, source) values ('e64a8fa5-2f38-4460-97d8-f6b19634dccd', '+56 9 9999 0000', 'pidio_no_llamar', 'manual');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.check((select count(*) = 0 from dialer_phone_suppressions), 'un ejecutivo no lee la tabla');
select pg_temp.check(dialer_lead_block_reason('00000000-0000-0000-0000-000000000141') = 'pidio_no_llamar', 'pero sí sabe que ese lead no se llama');
select pg_temp.check(dialer_phone_block_reason('00000000-0000-0000-0000-0000000000f1', '999990000') = 'pidio_no_llamar', 'ni ese número escrito a mano');
select pg_temp.check(dialer_phone_block_reason('00000000-0000-0000-0000-0000000000f1', '+56999990009') is null, 'un número libre no tiene motivo');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a9';
do $$ begin
  perform dialer_lead_block_reason('00000000-0000-0000-0000-000000000141');
  raise exception 'un ejecutivo de otra empresa no debería poder consultar';
exception when insufficient_privilege then null;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select count(*) >= 1 from dialer_phone_suppressions), 'el supervisor ve la lista de su empresa');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.check((select count(*) = 0 from dialer_phone_suppressions), 'el supervisor de otra empresa no ve nada');
select pg_temp.check(not has_function_privilege('authenticated', 'public.claim_next_dial_targets(uuid, integer)', 'execute'), 'claim cerrado a usuarios');
select pg_temp.check(not has_function_privilege('authenticated', 'public.dialer_phone_is_suppressed(uuid, uuid, text)', 'execute'), 'la consulta interna no se expone');
select pg_temp.check(not has_function_privilege('authenticated', 'public.dialer_process_retry_recompute(integer)', 'execute'), 'el cron no se expone');
reset role;
reset request.jwt.claim.sub;
select pg_temp.check(pg_temp.retry('00000000-0000-0000-0000-000000000141') = 'infinity', 'la supresión manual saca al lead de la cola');
insert into dial_attempts (lead_id, campaign_id, phone, status, attempt_kind, agent_id)
values ('00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-0000000000f1', '+56999990000', 'queued', 'personal_callback', '00000000-0000-0000-0000-0000000000a1');
select pg_temp.check(not exists (select 1 from dial_attempts where lead_id = '00000000-0000-0000-0000-000000000141'), 'ningún intento nace hacia un número suprimido');
create temp table r5 as select * from claim_next_ai_voice_targets('00000000-0000-0000-0000-0000000000f7', 5);
select pg_temp.check((select array_agg(lead_id) from r5) = array['00000000-0000-0000-0000-000000000143'::uuid], 'la voz IA salta el número suprimido');

-- ===========================================================================
-- 11. Cortacircuitos y barrera del claim
-- ===========================================================================
insert into leads (id, phone, campaign_id, organization_id, external_priority_rank)
select ('00000000-0000-0000-0000-0000000002' || lpad(g::text, 2, '0'))::uuid, '+5697000' || lpad(g::text, 4, '0'),
  '00000000-0000-0000-0000-0000000000f8', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', g
from generate_series(0, 20) g;
insert into dial_attempts (lead_id, campaign_id, phone, status, ended_at)
select ('00000000-0000-0000-0000-0000000002' || lpad(g::text, 2, '0'))::uuid, '00000000-0000-0000-0000-0000000000f8', '+5697000' || lpad(g::text, 4, '0'), 'failed', now()
from generate_series(1, 20) g;
select pg_temp.check(dialer_campaign_technical_breaker_open('00000000-0000-0000-0000-0000000000f8'), '20 fallas técnicas en 10 min abren el cortacircuitos');
create temp table r6 as select * from claim_next_dial_targets('00000000-0000-0000-0000-0000000000f8', 1);
select pg_temp.check((select count(*) = 0 from r6), 'con el cortacircuitos abierto no sale nada');
update dialer_campaign_configs set technical_breaker_ratio = null where campaign_id = '00000000-0000-0000-0000-0000000000f8';
create temp table r7 as select * from claim_next_dial_targets('00000000-0000-0000-0000-0000000000f8', 1);
select pg_temp.check((select array_agg(lead_id) from r7) = array['00000000-0000-0000-0000-000000000200'::uuid], 'sin cortacircuitos sale el lead fresco');

insert into leads (id, phone, campaign_id, organization_id, external_priority_rank) values
  ('00000000-0000-0000-0000-000000000151', '+56912345671', '00000000-0000-0000-0000-0000000000f9', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 1),
  ('00000000-0000-0000-0000-000000000152', '+56912345671', '00000000-0000-0000-0000-0000000000e2', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', null),
  ('00000000-0000-0000-0000-000000000153', '+56912345673', '00000000-0000-0000-0000-0000000000f9', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 2);
insert into dial_attempts (lead_id, campaign_id, phone, status, originated_at, ended_at) values
  ('00000000-0000-0000-0000-000000000152', '00000000-0000-0000-0000-0000000000e2', '+56912345671', 'no_answer', now() - interval '5 minutes', now() - interval '5 minutes');
-- Como si el recálculo hubiera fallado: la columna quedó sin espera.
update leads set dialer_retry_at = null where id = '00000000-0000-0000-0000-000000000151';
create temp table r8 as select * from claim_next_dial_targets('00000000-0000-0000-0000-0000000000f9', 1);
select pg_temp.check((select array_agg(lead_id) from r8) = array['00000000-0000-0000-0000-000000000153'::uuid], 'la barrera no remarca un número llamado hace 5 min aunque falte la espera');

-- ===========================================================================
-- 12. Otras campañas: entrante sin pool, QA con 1 intento, Secretaria sin franja
-- ===========================================================================
insert into leads (id, phone, campaign_id, organization_id, external_priority_rank) values
  ('00000000-0000-0000-0000-000000000161', '+56912345681', '00000000-0000-0000-0000-0000000000f5', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 1),
  ('00000000-0000-0000-0000-000000000171', '+56912345691', '00000000-0000-0000-0000-0000000000f6', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 1),
  ('00000000-0000-0000-0000-000000000172', '+56912345692', '00000000-0000-0000-0000-0000000000f6', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 2),
  ('00000000-0000-0000-0000-000000000181', '+56912345601', '00000000-0000-0000-0000-0000000000e2', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd', 1);
create temp table r9 as select * from claim_next_dial_targets('00000000-0000-0000-0000-0000000000f5', 5);
select pg_temp.check((select count(*) = 0 from r9), 'campaña entrante (max_redial 0) no disca');
create temp table r10 as select * from claim_next_dial_targets('00000000-0000-0000-0000-0000000000f6', 1);
select pg_temp.check((select array_agg(lead_id) from r10) = array['00000000-0000-0000-0000-000000000171'::uuid], 'QA toma su primer lead');
update dial_attempts set status = 'no_answer', originated_at = now(), ended_at = now() where lead_id = '00000000-0000-0000-0000-000000000171';
select pg_temp.check(pg_temp.near(pg_temp.retry('00000000-0000-0000-0000-000000000171'), now() + interval '7 days'), 'QA con 1 intento semanal: 7 días');
create temp table r11 as select * from claim_next_dial_targets('00000000-0000-0000-0000-0000000000f6', 1);
select pg_temp.check((select array_agg(lead_id) from r11) = array['00000000-0000-0000-0000-000000000172'::uuid], 'QA sigue con el siguiente');
create temp table r12 as select * from claim_next_dial_targets('00000000-0000-0000-0000-0000000000e2', 1);
select pg_temp.check((select array_agg(lead_id) from r12) = array['00000000-0000-0000-0000-000000000181'::uuid], 'Secretaria disca a cualquier hora, como antes');

-- ===========================================================================
-- 13. Los errores no se esconden: quedan en la cola del cron
-- ===========================================================================
select dialer_enqueue_retry_recompute('00000000-0000-0000-0000-000000000172', 'error', 'prueba');
select pg_temp.check(exists (select 1 from dialer_retry_recompute_queue where lead_id = '00000000-0000-0000-0000-000000000172' and last_error = 'prueba'), 'el error queda registrado');
select dialer_process_retry_recompute();
select pg_temp.check(not exists (select 1 from dialer_retry_recompute_queue), 'el cron lo reintenta y vacía la cola');

-- ===========================================================================
-- 14. Número sin ruta: dos fallas de red con la troncal cursando => fuera 30 días
-- ===========================================================================
create function pg_temp.falla(p_lead uuid, p_campaign uuid, p_phone text, p_cause text) returns void language plpgsql as $$
declare v_id uuid;
begin
  insert into dial_attempts (lead_id, campaign_id, phone, status) values (p_lead, p_campaign, p_phone, 'queued') returning id into v_id;
  update dial_attempts set status = 'failed', ended_at = now(), hangup_cause = p_cause where id = v_id;
end $$;
create function pg_temp.sin_ruta(p_phone text) returns bigint language sql as $$
  select count(*) from dialer_phone_suppressions
  where phone = canonical_chile_phone(p_phone) and reason = 'fuera_de_servicio' and source = 'discador' and lifted_at is null $$;

insert into campaigns (id, name, organization_id) values
  ('00000000-0000-0000-0000-0000000001f1', 'Troncal sana', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-0000000001f2', 'Troncal muda', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd');
insert into leads (id, phone, campaign_id, organization_id) values
  ('00000000-0000-0000-0000-000000000191', '+56412000001', '00000000-0000-0000-0000-0000000001f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-000000000192', '+56412000002', '00000000-0000-0000-0000-0000000001f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-000000000193', '+56412000003', '00000000-0000-0000-0000-0000000001f2', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-000000000194', '+56412000004', '00000000-0000-0000-0000-0000000001f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-000000000199', '+56912000009', '00000000-0000-0000-0000-0000000001f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd');
-- La troncal de "Troncal sana" cursa: otra llamada contestó hace un minuto.
insert into dial_attempts (lead_id, campaign_id, phone, status, originated_at, answered_at, ended_at, hangup_cause) values
  ('00000000-0000-0000-0000-000000000199', '00000000-0000-0000-0000-0000000001f1', '+56912000009', 'completed',
   now() - interval '1 minute', now() - interval '1 minute', now(), '16');

select pg_temp.falla('00000000-0000-0000-0000-000000000191', '00000000-0000-0000-0000-0000000001f1', '+56412000001', '34');
select pg_temp.check(pg_temp.sin_ruta('+56412000001') = 0, 'una falla de red no descarta el número');
select pg_temp.check(dialer_phone_unroutable_failures('+56412000001', now() - interval '7 days') = 1, 'cuenta la falla con la troncal cursando');
select pg_temp.falla('00000000-0000-0000-0000-000000000191', '00000000-0000-0000-0000-0000000001f1', '+56412000001', '34');
select pg_temp.check(pg_temp.sin_ruta('+56412000001') = 1, 'segunda falla de red sin otra respuesta: fuera de servicio');
select pg_temp.check((select source_reason = 'Q.850 34' and campaign_id is null and client_key is null
    and pg_temp.near(expires_at, now() + interval '30 days')
  from dialer_phone_suppressions where phone = '56412000001' and source = 'discador'), 'toda la empresa, 30 días, con la causa');
select pg_temp.check(pg_temp.near(pg_temp.retry('00000000-0000-0000-0000-000000000191'), now() + interval '30 days')
  and pg_temp.hold('00000000-0000-0000-0000-000000000191') = 'no_llamar', 'el lead queda retenido 30 días como no llamar');
select pg_temp.falla('00000000-0000-0000-0000-000000000191', '00000000-0000-0000-0000-0000000001f1', '+56412000001', '27');
select pg_temp.check(pg_temp.sin_ruta('+56412000001') = 1, 'una tercera falla no duplica la fila');

-- Si el carrier alguna vez respondió por el número, la red falló de a ratos.
insert into dial_attempts (lead_id, campaign_id, phone, status, ended_at, hangup_cause) values
  ('00000000-0000-0000-0000-000000000192', '00000000-0000-0000-0000-0000000001f1', '+56412000002', 'no_answer', now() - interval '2 hours', '19');
select pg_temp.falla('00000000-0000-0000-0000-000000000192', '00000000-0000-0000-0000-0000000001f1', '+56412000002', '34');
select pg_temp.falla('00000000-0000-0000-0000-000000000192', '00000000-0000-0000-0000-0000000001f1', '+56412000002', '34');
select pg_temp.check(pg_temp.sin_ruta('+56412000002') = 0, 'número que alguna vez sonó no se descarta por fallas de red');

-- Con la troncal sin cursar nada, la culpa no es del número.
select pg_temp.falla('00000000-0000-0000-0000-000000000193', '00000000-0000-0000-0000-0000000001f2', '+56412000003', '34');
select pg_temp.falla('00000000-0000-0000-0000-000000000193', '00000000-0000-0000-0000-0000000001f2', '+56412000003', '34');
select pg_temp.check(pg_temp.sin_ruta('+56412000003') = 0, 'troncal muda: no se descarta a nadie');

-- Una falla sin causa no dice nada del número: ni lo salva ni lo condena.
select pg_temp.falla('00000000-0000-0000-0000-000000000194', '00000000-0000-0000-0000-0000000001f1', '+56412000004', null);
select pg_temp.falla('00000000-0000-0000-0000-000000000194', '00000000-0000-0000-0000-0000000001f1', '+56412000004', '34');
select pg_temp.check(pg_temp.sin_ruta('+56412000004') = 0, 'una falla sin causa no cuenta como falla de red');
select pg_temp.falla('00000000-0000-0000-0000-000000000194', '00000000-0000-0000-0000-0000000001f1', '+56412000004', '38');
select pg_temp.check(pg_temp.sin_ruta('+56412000004') = 1, 'ni impide descartarlo');

-- ===========================================================================
-- 15. Rotación de caller ID: lista normalizada, número por intento e informe
-- ====================================================================
-- ===========================================================================
-- 16. -- Sin lista la campaña queda como estaba.
select pg_temp.check((select caller_ids is null from dialer_campaign_configs where campaign_id = '00000000-0000-0000-0000-0000000000f1'), 'sin lista: caller_ids null, se usa caller_id');
update dialer_campaign_configs set caller_ids = array['+56 9 6590 6926', '912345678', '56965906926', '', null, '(2) 2345 6789']
where campaign_id = '00000000-0000-0000-0000-0000000000f1';
select pg_temp.check((select caller_ids = '{56965906926,56912345678,56223456789}' from dialer_campaign_configs where campaign_id = '00000000-0000-0000-0000-0000000000f1'),
  'la lista queda en formato Siptel, sin vacíos ni repetidos y en el orden escrito');
update dialer_campaign_configs set caller_ids = array['', '  '] where campaign_id = '00000000-0000-0000-0000-0000000000f2';
select pg_temp.check((select caller_ids is null from dialer_campaign_configs where campaign_id = '00000000-0000-0000-0000-0000000000f2'), 'una lista vacía queda null');
do $$ begin
  update dialer_campaign_configs set caller_ids = array['56965906926', '+16507062614'] where campaign_id = '00000000-0000-0000-0000-0000000000f2';
  raise exception 'un número extranjero no debería aceptarse en la rotación';
exception when check_violation then null;
end $$;
do $$ begin
  update dialer_campaign_configs set caller_ids = array['5696590'] where campaign_id = '00000000-0000-0000-0000-0000000000f2';
  raise exception 'un número incompleto no debería aceptarse';
exception when check_violation then null;
end $$;
do $$ begin
  update dialer_campaign_configs set caller_ids = array(select '5691' || lpad(g::text, 7, '0') from generate_series(1, 51) g)
  where campaign_id = '00000000-0000-0000-0000-0000000000f2';
  raise exception 'más de 50 números no debería aceptarse';
exception when check_violation then null;
end $$;
-- La lista no es política de reintentos: no pide recálculo de esperas.
select pg_temp.check(not exists (select 1 from dialer_retry_recompute_campaigns), 'cambiar la lista no pide recálculo de esperas');

insert into campaigns (id, name, organization_id) values
  ('00000000-0000-0000-0000-0000000002f1', 'Rotación', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-0000000002f2', 'Rotación ajena', '00000000-0000-0000-0000-00000000000b');
insert into stub_supervisor_campaigns values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000002f1');
insert into leads (id, phone, campaign_id, organization_id) values
  ('00000000-0000-0000-0000-000000000301', '+56913000001', '00000000-0000-0000-0000-0000000002f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-000000000302', '+56913000002', '00000000-0000-0000-0000-0000000002f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-000000000303', '+56913000003', '00000000-0000-0000-0000-0000000002f1', 'e64a8fa5-2f38-4460-97d8-f6b19634dccd'),
  ('00000000-0000-0000-0000-000000000304', '+56913000004', '00000000-0000-0000-0000-0000000002f2', '00000000-0000-0000-0000-00000000000b');
-- Hoy en hora Chile: dos por el número A (una conectó), una por B que solo
-- contestó, dos sin número registrado y una agenda que no cuenta; ayer, una
-- por A; la de la otra empresa no se ve.
insert into dial_attempts (id, lead_id, campaign_id, phone, status, attempt_kind, originated_at, bridged_at, ended_at, created_at) values
  ('00000000-0000-0000-0000-00000000d201', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-0000000002f1', '+56913000001', 'completed', 'pool', now(), now(), now(), now()),
  ('00000000-0000-0000-0000-00000000d202', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-0000000002f1', '+56913000002', 'no_answer', 'pool', null, null, now(), now()),
  ('00000000-0000-0000-0000-00000000d203', '00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-0000000002f1', '+56913000003', 'abandoned', 'pool', now(), null, now(), now()),
  ('00000000-0000-0000-0000-00000000d204', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-0000000002f1', '+56913000001', 'no_answer', 'pool', null, null, now(), now()),
  ('00000000-0000-0000-0000-00000000d205', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-0000000002f1', '+56913000002', 'completed', 'personal_callback', now(), now(), now(), now()),
  ('00000000-0000-0000-0000-00000000d206', '00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-0000000002f1', '+56913000003', 'completed', 'pool', now(), now(), now(), now() - interval '1 day'),
  ('00000000-0000-0000-0000-00000000d207', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-0000000002f1', '+56913000002', 'no_answer', 'pool', null, null, now(), now()),
  ('00000000-0000-0000-0000-00000000d208', '00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-0000000002f2', '+56913000004', 'completed', 'pool', now(), now(), now(), now());

select pg_temp.check(record_dial_attempt_caller_ids(
  array['00000000-0000-0000-0000-00000000d201', '00000000-0000-0000-0000-00000000d202', '00000000-0000-0000-0000-00000000d203',
        '00000000-0000-0000-0000-00000000d205', '00000000-0000-0000-0000-00000000d206', '00000000-0000-0000-0000-00000000d208',
        '00000000-0000-0000-0000-00000000d207']::uuid[],
  array['56911111111', '56911111111', '56922222222', '56911111111', '56911111111', '56911111111', ' ']) = 6,
  'el motor registra el número de cada intento en un viaje, sin números en blanco');
select pg_temp.check(record_dial_attempt_caller_ids(array['00000000-0000-0000-0000-00000000d201']::uuid[], array['56999999999']) = 0
  and (select caller_id = '56911111111' from dial_attempts where id = '00000000-0000-0000-0000-00000000d201'), 'el primer número registrado no se pisa');
select pg_temp.check((select status = 'completed' and hangup_cause is null from dial_attempts where id = '00000000-0000-0000-0000-00000000d201'), 'registrar el número no toca el estado');
do $$ begin
  perform record_dial_attempt_caller_ids(array['00000000-0000-0000-0000-00000000d204']::uuid[], array[]::text[]);
  raise exception 'listas de distinto largo deberían rechazarse';
exception when invalid_parameter_value then null;
end $$;
select pg_temp.check(not has_function_privilege('authenticated', 'public.record_dial_attempt_caller_ids(uuid[], text[])', 'execute')
  and not has_function_privilege('anon', 'public.record_dial_attempt_caller_ids(uuid[], text[])', 'execute')
  and has_function_privilege('service_role', 'public.record_dial_attempt_caller_ids(uuid[], text[])', 'execute'), 'solo el motor registra números');
select pg_temp.check(not has_function_privilege('anon', 'public.get_caller_id_contactability(date, date, uuid)', 'execute'), 'el informe no se abre a visitantes');

create function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Santiago')::date $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.check((select count(*) = 4 from get_caller_id_contactability(pg_temp.hoy() - 1, pg_temp.hoy(), '00000000-0000-0000-0000-0000000002f1')),
  'admin: 4 filas (ayer A; hoy A, B y sin número)');
select pg_temp.check((select intentos = 2 and contestadas = 1 and conectadas = 1 and tasa_contestadas = 50.0 and tasa_conexion = 50.0
  from get_caller_id_contactability(pg_temp.hoy(), pg_temp.hoy(), '00000000-0000-0000-0000-0000000002f1') where caller_id = '56911111111'),
  'número A hoy: 2 intentos del pool, la agenda no cuenta');
select pg_temp.check((select intentos = 1 and contestadas = 1 and conectadas = 0 and tasa_conexion = 0
  from get_caller_id_contactability(pg_temp.hoy(), pg_temp.hoy(), '00000000-0000-0000-0000-0000000002f1') where caller_id = '56922222222'),
  'número B: contestó pero no llegó a un ejecutivo');
select pg_temp.check((select intentos = 2 and contestadas = 0
  from get_caller_id_contactability(pg_temp.hoy(), pg_temp.hoy(), '00000000-0000-0000-0000-0000000002f1') where caller_id is null),
  'los intentos sin número salen aparte');
select pg_temp.check((select dia = pg_temp.hoy() - 1 and intentos = 1
  from get_caller_id_contactability(pg_temp.hoy() - 1, pg_temp.hoy() - 1, '00000000-0000-0000-0000-0000000002f1')), 'el día se corta en hora Chile');
select pg_temp.check(not exists (select 1 from get_caller_id_contactability(pg_temp.hoy() - 1, pg_temp.hoy()) where campaign_id = '00000000-0000-0000-0000-0000000002f2'),
  'sin filtro, la campaña de otra empresa no aparece');
do $$ begin
  perform get_caller_id_contactability(pg_temp.hoy(), pg_temp.hoy(), '00000000-0000-0000-0000-0000000002f2');
  raise exception 'un admin no debería consultar otra empresa';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform get_caller_id_contactability(pg_temp.hoy(), pg_temp.hoy() - 1);
  raise exception 'un rango invertido debería rechazarse';
exception when invalid_parameter_value then null;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select count(*) >= 4 and bool_and(campaign_id in ('00000000-0000-0000-0000-0000000002f1', '00000000-0000-0000-0000-0000000000f1'))
  from get_caller_id_contactability(pg_temp.hoy() - 1, pg_temp.hoy())), 'el supervisor ve solo las campañas de su alcance');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.check((select count(*) = 0 from get_caller_id_contactability(pg_temp.hoy() - 1, pg_temp.hoy())), 'el supervisor sin alcance no ve nada');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ begin
  perform get_caller_id_contactability(pg_temp.hoy(), pg_temp.hoy());
  raise exception 'un ejecutivo no debería ver el informe';
exception when insufficient_privilege then null;
end $$;
reset role;
reset request.jwt.claim.sub;
=======
-- Cierre automático de conexiones cortas (20260926150000)
-- ===========================================================================
select pg_temp.check((select count(*) = 0 from dialer_campaign_configs
  where short_call_seconds is not null or short_call_disposition is not null), 'conexiones cortas: apagado en todas las campañas');
update dialer_campaign_configs set short_call_seconds = 10, short_call_disposition = 'NO CONTESTA'
  where campaign_id = '318cf37a-da42-4cbd-934d-bdc47753d7bd';
select pg_temp.check((select short_call_seconds = 10 and short_call_disposition = 'NO CONTESTA'
  from dialer_campaign_configs where campaign_id = '318cf37a-da42-4cbd-934d-bdc47753d7bd'), 'conexiones cortas: se activa por campaña');
do $$ begin
  update dialer_campaign_configs set short_call_seconds = 0 where campaign_id = '318cf37a-da42-4cbd-934d-bdc47753d7bd';
  raise exception 'un umbral de 0 s no debería aceptarse';
exception when check_violation then null;
end $$;
do $$ begin
  update dialer_campaign_configs set short_call_seconds = 61 where campaign_id = '318cf37a-da42-4cbd-934d-bdc47753d7bd';
  raise exception 'un umbral sobre 60 s no debería aceptarse';
exception when check_violation then null;
end $$;
do $$ begin
  update dialer_campaign_configs set short_call_disposition = '  ' where campaign_id = '318cf37a-da42-4cbd-934d-bdc47753d7bd';
  raise exception 'un motivo en blanco no debería aceptarse';
exception when check_violation then null;
end $$;
select pg_temp.check(true, 'conexiones cortas: umbral fuera de 1-60 y motivo en blanco se rechazan');
update dialer_campaign_configs set short_call_seconds = null, short_call_disposition = null
  where campaign_id = '318cf37a-da42-4cbd-934d-bdc47753d7bd';

select 'ESCENARIOS COMPLETOS' as resultado;
