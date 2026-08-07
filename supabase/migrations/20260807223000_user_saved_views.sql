-- Vistas con nombre, por usuario y por pantalla.
--
-- Un supervisor no tiene una sola forma de mirar el monitor: quiere una vista
-- por campaña, otra para el arranque del turno, otra para revisar abandono. Con
-- una única preferencia autoguardada tenía que rearmar la pantalla cada vez.
--
-- Convive con `user_view_preferences`, que sigue guardando el estado actual sin
-- que nadie lo pida. Estas son fotos explícitas: se guardan con un nombre y se
-- aplican cuando el usuario quiere.
create table if not exists public.user_saved_views (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  view_key text not null,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_saved_views_name_not_blank check (btrim(name) <> ''),
  -- Guardar con un nombre existente sobrescribe esa vista, que es lo que la
  -- persona espera; sin la restricción se acumularían duplicados homónimos.
  constraint user_saved_views_unique_name unique (profile_id, view_key, name)
);

comment on table public.user_saved_views is
  'Vistas con nombre que cada usuario guarda de una pantalla (por ejemplo, un monitor por campaña). Distinto de user_view_preferences, que guarda el estado actual autoguardado.';

alter table public.user_saved_views enable row level security;

-- Una vista es del dueño y de nadie más, igual que la preferencia activa.
drop policy if exists "own saved views" on public.user_saved_views;
create policy "own saved views"
  on public.user_saved_views
  for all
  to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create index if not exists user_saved_views_profile_view_idx
  on public.user_saved_views (profile_id, view_key);
