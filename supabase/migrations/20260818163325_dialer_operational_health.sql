create table public.dialer_operational_health (
  service text primary key check (service = 'dialer-engine'),
  status text not null check (status in ('ready', 'degraded')),
  release text not null,
  ami_status text not null check (ami_status in ('connected', 'disconnected')),
  payload jsonb not null default '{}'::jsonb,
  reported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dialer_operational_health enable row level security;

-- Es telemetría interna: ningún navegador ni usuario autenticado necesita
-- acceso directo. El dialer y el route handler del CRM usan service_role.
revoke all on table public.dialer_operational_health from anon, authenticated;
grant select, insert, update on table public.dialer_operational_health to service_role;

create trigger dialer_operational_health_set_updated_at
  before update on public.dialer_operational_health
  for each row execute function public.set_updated_at();
