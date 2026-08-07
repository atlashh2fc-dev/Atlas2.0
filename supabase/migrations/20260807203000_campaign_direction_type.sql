-- Dirección de la campaña: outbound, inbound o blending.
--
-- Hasta ahora el producto asumía una sola realidad y los reportes mostraban
-- indicadores de inbound —nivel de servicio a 20 s, espera promedio (ASA)— en
-- campañas que solo originan llamadas, donde nadie espera en cola y esas cifras
-- no significan nada. Al revés, faltaban los indicadores propios de outbound
-- (penetración de base, intentos por contacto, agotamiento de reintentos).
--
-- El default es 'outbound' porque es lo que hace hoy todo el motor
-- (trunk_context 'from-dialer-outbound'), así que ninguna campaña existente
-- cambia de comportamiento.
--
-- En 'blending' las dos familias se reportan por separado, nunca promediadas:
-- un AHT de inbound y uno de outbound sumados no describen ninguna operación.
alter table public.dialer_campaign_configs
  add column if not exists campaign_type text not null default 'outbound';

alter table public.dialer_campaign_configs
  drop constraint if exists dialer_campaign_configs_campaign_type_check;

alter table public.dialer_campaign_configs
  add constraint dialer_campaign_configs_campaign_type_check
  check (campaign_type in ('outbound', 'inbound', 'blending'));

comment on column public.dialer_campaign_configs.campaign_type is
  'Dirección de la campaña. Decide qué familia de KPIs corresponde: outbound (contactabilidad, penetración de base, intentos por contacto), inbound (nivel de servicio, ASA, abandono de cola) o blending (ambas, reportadas por separado). Default outbound: todo el motor actual origina llamadas.';
