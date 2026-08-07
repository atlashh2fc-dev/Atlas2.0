-- Preferencias de interfaz por usuario.
--
-- El monitor en vivo ya permitía mover y redimensionar tarjetas, pero la
-- disposición se guardaba en localStorage: se perdía al cambiar de equipo o de
-- navegador, y no era "de la cuenta" sino del computador. Cada supervisor
-- necesita su propia vista y encontrarla igual desde donde entre.
--
-- `config` es jsonb a propósito: la forma de la preferencia cambia con cada
-- pantalla y no vale la pena una columna por atributo.
create table if not exists public.user_view_preferences (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  view_key text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, view_key)
);

comment on table public.user_view_preferences is
  'Preferencias de interfaz por usuario y pantalla (qué tarjetas ve, en qué orden y tamaño). Vivían en localStorage, así que se perdían al cambiar de equipo o de navegador.';

alter table public.user_view_preferences enable row level security;

-- Una preferencia es del dueño y de nadie más: ni siquiera un supervisor tiene
-- por qué ver o alterar la vista de otro.
drop policy if exists "own view preferences" on public.user_view_preferences;
create policy "own view preferences"
  on public.user_view_preferences
  for all
  to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create index if not exists user_view_preferences_profile_idx
  on public.user_view_preferences (profile_id);
