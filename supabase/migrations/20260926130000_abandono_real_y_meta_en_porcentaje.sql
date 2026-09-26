-- El abandono se registra de verdad y la meta de abandono queda en porcentaje.
--
-- Diagnóstico del 26-09-2026: el motor esperaba un DialEnd ANSWER sobre la
-- pata del cliente para saber que contestó, y en Originate→Queue ese evento
-- casi nunca llega. Un cliente que contestaba y colgaba esperando ejecutiva
-- quedaba 'completed' causa 16, ningún intento quedaba 'abandoned' y
-- getRecentAbandonmentRate no tenía denominador: el predictivo crecía "sin
-- señal". Desde este cambio el motor marca contestado con el OriginateResponse
-- Success (con Async solo llega cuando la pata saliente contesta) y mide el
-- abandono sobre originated_at. Esta migración pone el historial y la meta en
-- los mismos términos.

-- 1. La meta es porcentaje (3 = 3 %), que es lo que espera computeEffectiveRatio
-- y lo que guarda el formulario de discado. La semilla demo de Andes la dejó
-- como fracción (0,03 y 0,05): esas campañas quedaban 100 veces más estrictas
-- y el predictivo de Cobranza Retail frenaba con el primer abandono.
update public.dialer_campaign_configs
set target_abandonment_rate = target_abandonment_rate * 100,
    updated_at = now()
where target_abandonment_rate > 0
  and target_abandonment_rate < 1;

-- Lo que quede bajo 1 % no es una meta alcanzable en predictivo y no se
-- distingue de una fracción mal cargada. Hoy es solo el 0 de «Meta Ads ·
-- WhatsApp · Secretaria Virtual Geimser» (entrante, progresivo: el motor no lo
-- usa). Pasa al 3 % con que opera el resto de Geimser.
update public.dialer_campaign_configs
set target_abandonment_rate = 3,
    updated_at = now()
where target_abandonment_rate < 1;

-- El piso es 1 y no 0: con "> 0" una fracción como 0,03 seguiría entrando
-- callada. La columna es not null, así que no hay nulos que permitir.
alter table public.dialer_campaign_configs
  drop constraint if exists dialer_configs_target_abandonment_check;
alter table public.dialer_campaign_configs
  add constraint dialer_configs_target_abandonment_check
  check (target_abandonment_rate >= 1 and target_abandonment_rate <= 100);

comment on column public.dialer_campaign_configs.target_abandonment_rate is
  'Abandono objetivo del modo predictivo en PORCENTAJE (3 = 3 %), entre 1 y 100. '
  'Abandono = intentos del pool que el cliente contestó (originated_at) y que '
  'terminaron sin ejecutiva (status abandoned).';

-- 2. Historial: intentos del pool que el cliente contestó (originated_at, que
-- solo llena el OriginateResponse Success) y que terminaron sin ejecutiva.
-- Quedaron 'completed' causa 16 y eran abandonos.
--
-- agent_id nulo es parte de la regla: si AgentConnect confirmó a una
-- ejecutiva (agent_id + asignación 'dialer.connect'), hubo conversación
-- aunque el 'bridged' no se haya registrado. En producción son 41, y los 38
-- con answered_at están todos ahí (ese DialEnd ANSWER es la Queue entregando
-- la llamada a la ejecutiva). No son abandonos y no se tocan.
--
-- Conteo en producción el 26-09-2026: 133 'completed' del pool contestados y
-- sin bridged_at; 92 sin ejecutiva pasan a 'abandoned' (Secretaria Virtual 70,
-- Equifax 17, Abogado Legal 5; entre el 31-07 y el 25-09).
--
-- El trigger dial_attempts_refresh_retry_on_finish recalcula la espera del
-- lead: dialer_compute_lead_retry cuenta 'abandoned' como "habló" y le da el
-- último escalón, que es lo correcto (se le dejó esperando; no se le vuelve a
-- llamar al rato). Los triggers de supresión solo miran 'failed'. Los
-- reportes que contaban 'completed' como conectado dejan de contar estos.
update public.dial_attempts
set status = 'abandoned',
    updated_at = now()
where attempt_kind = 'pool'
  and status = 'completed'
  and originated_at is not null
  and bridged_at is null
  and ended_at is not null
  and agent_id is null;
