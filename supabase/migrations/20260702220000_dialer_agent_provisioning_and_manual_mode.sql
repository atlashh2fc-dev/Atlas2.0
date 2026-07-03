-- Tiempo entre llamadas (wrap-up) configurable por campaña, hoy delegado
-- por completo a queues.conf sin ningún control desde el CRM.
alter table public.dialer_campaign_configs
  add column if not exists wrapup_seconds integer not null default 5;

alter table public.dialer_campaign_configs
  add constraint dialer_campaign_configs_wrapup_seconds_check
  check (wrapup_seconds >= 0 and wrapup_seconds <= 600);

-- 'manual' habilita que una campaña exista solo para marcación manual desde
-- la barra CTI (el motor no debe auto-discar estas campañas).
alter table public.dialer_campaign_configs
  drop constraint dialer_campaign_configs_dial_mode_check;

alter table public.dialer_campaign_configs
  add constraint dialer_campaign_configs_dial_mode_check
  check (dial_mode = any (array['manual', 'preview', 'progressive', 'predictive']));

-- Hoy dialer_campaign_configs solo tiene policy de SELECT: no hay forma de
-- configurar nada desde la UI. Agregamos escritura para admin, mismo patrón
-- que campaigns_admin_insert/update/delete.
create policy dialer_campaign_configs_admin_insert
  on public.dialer_campaign_configs
  for insert
  with check (current_role_name() = 'admin'::app_role);

create policy dialer_campaign_configs_admin_update
  on public.dialer_campaign_configs
  for update
  using (current_role_name() = 'admin'::app_role);

create policy dialer_campaign_configs_admin_delete
  on public.dialer_campaign_configs
  for delete
  using (current_role_name() = 'admin'::app_role);

-- Credenciales SIP por agente: hoy la barra CTI usa una única línea (6002)
-- compartida por todos. Esta tabla es la fuente de verdad para aprovisionar
-- una extensión PJSIP real por ejecutivo (el motor de discado sincroniza
-- esto hacia Asterisk vía AMI).
create table public.agent_sip_credentials (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  extension text not null unique,
  sip_password text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_sip_credentials enable row level security;

-- El propio agente puede leer su fila (la barra CTI la necesita para
-- registrarse) y admin/supervisor pueden leer todas (pantalla de gestión).
create policy agent_sip_credentials_select
  on public.agent_sip_credentials
  for select
  to authenticated
  using (
    profile_id = (select auth.uid())
    or current_role_name() = any (array['admin'::app_role, 'supervisor'::app_role])
  );

create policy agent_sip_credentials_admin_insert
  on public.agent_sip_credentials
  for insert
  with check (current_role_name() = 'admin'::app_role);

create policy agent_sip_credentials_admin_update
  on public.agent_sip_credentials
  for update
  using (current_role_name() = 'admin'::app_role);

create policy agent_sip_credentials_admin_delete
  on public.agent_sip_credentials
  for delete
  using (current_role_name() = 'admin'::app_role);

create trigger agent_sip_credentials_set_updated_at
  before update on public.agent_sip_credentials
  for each row execute function public.set_updated_at();
