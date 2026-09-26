-- Cierre automático de conexiones cortas, configurable por campaña.
--
-- Medición del 25-09-2026 en Equifax: 261 de 830 conexiones del discador
-- (31 %) duraron menos de 10 s —buzones, centralitas, gente que corta al tiro,
-- con la detección de contestadora apagada— y cada una se tipificaba a mano:
-- ~110 s de wrap-up por conexión, 25,5 h de cierre contra 10,5 h hablando.
--
-- Con estas dos columnas, cuando una llamada del pool termina con menos de
-- short_call_seconds de conversación (dial_attempts.bridged_at -> ended_at) y
-- la ejecutiva no armó otra tipificación, la ficha arma sola
-- short_call_disposition y la guarda al terminar la interrupción legal, por el
-- mismo camino de la tipificación anticipada (validaciones y
-- save_call_management incluidas). Cada cierre así queda en call_events como
-- 'call.short_call_auto_closed' con los segundos, el umbral y el intento.
--
-- short_call_disposition es el valor que se guarda en calls.reason, igual que
-- lo identifica el formulario (CallReasonConfig.value); estado y resultado
-- salen del catálogo del workflow de la campaña al aplicarlo, así que un
-- motivo que el workflow ya no tenga simplemente no se aplica.
--
-- Queda apagado en todas las campañas (null). Se activa desde Discado.

alter table public.dialer_campaign_configs
  add column if not exists short_call_seconds integer,
  add column if not exists short_call_disposition text;

alter table public.dialer_campaign_configs
  drop constraint if exists dialer_campaign_configs_short_call_seconds_check;
alter table public.dialer_campaign_configs
  add constraint dialer_campaign_configs_short_call_seconds_check
  check (short_call_seconds is null or short_call_seconds between 1 and 60);

alter table public.dialer_campaign_configs
  drop constraint if exists dialer_campaign_configs_short_call_disposition_check;
alter table public.dialer_campaign_configs
  add constraint dialer_campaign_configs_short_call_disposition_check
  check (short_call_disposition is null or btrim(short_call_disposition) <> '');

comment on column public.dialer_campaign_configs.short_call_seconds is
  'Conversación (dial_attempts.bridged_at -> ended_at) bajo la cual una conexión del pool se cierra sola con short_call_disposition. null = apagado.';
comment on column public.dialer_campaign_configs.short_call_disposition is
  'Motivo (valor de calls.reason del workflow de la campaña) que se aplica a las conexiones cortas. null = apagado.';
