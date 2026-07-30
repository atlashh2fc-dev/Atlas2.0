-- Compromisos agendados (callbacks).
--
-- Regla del negocio: cuando un ejecutivo agenda una llamada, ese compromiso es
-- SUYO. A la hora acordada el discador se la entrega a él y a nadie más. Si no
-- se cumple, el supervisor decide: reagendar, pasarlo a otro, o soltarlo al
-- pool de la campaña para que lo tome cualquiera.
--
-- La fuente de verdad sigue siendo `leads.next_action_at` (la usa Mi agenda,
-- los reportes y el discador). Acá solo se agrega el estado que faltaba para
-- poder entregarlo y auditarlo.
alter table public.leads
  add column if not exists callback_mode text not null default 'personal',
  add column if not exists callback_attempts integer not null default 0,
  add column if not exists callback_last_attempt_at timestamptz,
  add column if not exists callback_released_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'leads_callback_mode_check' and conrelid = 'public.leads'::regclass
  ) then
    alter table public.leads
      add constraint leads_callback_mode_check check (callback_mode in ('personal', 'campaign'));
  end if;
end $$;

comment on column public.leads.callback_mode is 'personal = el compromiso es del ejecutivo que lo agendó; campaign = liberado al pool, lo toma cualquiera.';
comment on column public.leads.callback_attempts is 'Intentos de entrega del compromiso a su ejecutivo.';
comment on column public.leads.callback_released_at is 'Cuándo el supervisor lo soltó al pool.';

create index if not exists leads_callback_due_idx
  on public.leads (campaign_id, next_action_at)
  where workflow_status = 'callback' and next_action_at is not null;

alter table public.dial_attempts
  add column if not exists attempt_kind text not null default 'pool';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dial_attempts_attempt_kind_check' and conrelid = 'public.dial_attempts'::regclass
  ) then
    alter table public.dial_attempts
      add constraint dial_attempts_attempt_kind_check check (attempt_kind in ('pool', 'personal_callback'));
  end if;
end $$;

comment on column public.dial_attempts.attempt_kind is 'pool = marcación de campaña; personal_callback = entrega de un compromiso a su ejecutivo.';

alter table public.dialer_campaign_configs
  add column if not exists personal_callback_enabled boolean not null default true,
  add column if not exists personal_callback_window_minutes integer not null default 30,
  add column if not exists personal_callback_retry_seconds integer not null default 120,
  add column if not exists personal_callback_on_expiry text not null default 'keep_in_agenda';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dialer_configs_callback_expiry_check' and conrelid = 'public.dialer_campaign_configs'::regclass
  ) then
    alter table public.dialer_campaign_configs
      add constraint dialer_configs_callback_expiry_check
      check (personal_callback_on_expiry in ('keep_in_agenda', 'release_to_pool'));
  end if;
end $$;

comment on column public.dialer_campaign_configs.personal_callback_enabled is 'Si está activo, a la hora del compromiso el discador llama al cliente y se lo entrega a su ejecutivo.';
comment on column public.dialer_campaign_configs.personal_callback_window_minutes is 'Cuánto se sigue intentando entregar el compromiso a su ejecutivo antes de darlo por vencido.';
comment on column public.dialer_campaign_configs.personal_callback_retry_seconds is 'Cada cuánto se reintenta mientras el ejecutivo no esté disponible.';
comment on column public.dialer_campaign_configs.personal_callback_on_expiry is 'Al vencer la ventana: keep_in_agenda (queda en Mi agenda) o release_to_pool (lo toma cualquiera).';
