-- El artículo 152 quáter C del Código del Trabajo exige una interrupción
-- efectiva de al menos 10 segundos entre atenciones para teleoperadores con
-- conexión continua. La DT (Ord. 1450/2020) aclara que este lapso no puede
-- consumirse realizando tipificación u otro trabajo posterior a la llamada.
--
-- `wrapup_seconds` alimenta el wrapuptime de la queue de Asterisk. Normalizar
-- primero evita que la nueva restricción falle sobre configuraciones antiguas.
update public.dialer_campaign_configs
set
  wrapup_seconds = 10,
  updated_at = now()
where wrapup_seconds < 10;

alter table public.dialer_campaign_configs
  drop constraint if exists dialer_campaign_configs_wrapup_seconds_check;

alter table public.dialer_campaign_configs
  add constraint dialer_campaign_configs_wrapup_seconds_check
  check (wrapup_seconds >= 10 and wrapup_seconds <= 600);

comment on column public.dialer_campaign_configs.wrapup_seconds is
  'Interrupción mínima entre atenciones en segundos. No puede ser inferior a 10 (Código del Trabajo art. 152 quáter C).';
