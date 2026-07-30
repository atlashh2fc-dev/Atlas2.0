-- 1) La interrupción legal entre llamadas vivía en `localStorage` y en la
--    sesión del discador. Se evadía borrando una clave del navegador, y para
--    los registros sin campaña no se validaba nada: ahora se guarda en el
--    perfil y el servidor la exige siempre.
alter table public.profiles
  add column if not exists intercall_break_until timestamptz;

comment on column public.profiles.intercall_break_until is 'Hasta cuándo dura la interrupción legal obligatoria entre llamadas. La escribe el servidor al terminar cada llamada.';

-- 2) La lectura de credenciales SIP incluía la contraseña y estaba abierta a
--    todos los supervisores: con ella cualquiera podía registrar la extensión
--    de otro en un softphone externo y llamar sin grabación ni tipificación.
--    Queda solo el dueño; los administradores siguen viéndola a través de
--    `revealAgentSipCredential`, que corre con la clave de servicio, exige rol
--    admin y ahora deja registro.
drop policy if exists agent_sip_credentials_select on public.agent_sip_credentials;
create policy agent_sip_credentials_select on public.agent_sip_credentials
  for select using (profile_id = (select auth.uid()));

-- Bitácora de accesos a credenciales y de llamadas manuales del CTI.
create table if not exists public.sensitive_access_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_profile_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sensitive_access_log_created_at_idx on public.sensitive_access_log (created_at desc);
create index if not exists sensitive_access_log_actor_idx on public.sensitive_access_log (actor_id);

alter table public.sensitive_access_log enable row level security;

drop policy if exists sensitive_access_log_select on public.sensitive_access_log;
create policy sensitive_access_log_select on public.sensitive_access_log
  for select using (public.current_role_name() = 'admin');

comment on table public.sensitive_access_log is 'Quién leyó una credencial SIP y cuándo, y qué llamadas manuales se marcaron desde el CTI. Solo se escribe con la clave de servicio.';
