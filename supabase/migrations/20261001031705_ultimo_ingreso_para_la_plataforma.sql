-- Último ingreso de cada persona, para la consola de plataforma.
--
-- La consola muestra si una empresa usa Atlas (el último ingreso de su gente).
-- `auth.admin.listUsers` responde 500 en este proyecto, así que el dato se lee
-- directo de auth.users. Solo lo puede llamar el cliente de servicio: la
-- consola lo usa después de comprobar que quien mira es el dueño de la
-- plataforma. Nadie con sesión normal ni sin sesión puede ejecutarla.

create or replace function public.ultimo_ingreso_de_personas()
returns table(profile_id uuid, last_sign_in_at timestamptz)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth'
as $$
  select usuario.id, usuario.last_sign_in_at
  from auth.users usuario;
$$;

revoke all on function public.ultimo_ingreso_de_personas() from public;
revoke execute on function public.ultimo_ingreso_de_personas() from anon, authenticated;
grant execute on function public.ultimo_ingreso_de_personas() to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.ultimo_ingreso_de_personas()', 'execute')
     or has_function_privilege('anon', 'public.ultimo_ingreso_de_personas()', 'execute') then
    raise exception 'El último ingreso de todas las personas quedó expuesto a sesiones normales';
  end if;
end;
$$;
