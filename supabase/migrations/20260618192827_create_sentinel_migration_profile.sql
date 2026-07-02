
do $$
declare
  new_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated',
    'migracion-historica@system.local', crypt(gen_random_uuid()::text, gen_salt('bf')),
    null, '{"provider":"email","providers":["email"]}', '{"full_name":"Migración Histórica"}',
    now(), now(), '', ''
  );

  update public.profiles
  set active = false
  where id = new_id;
end $$;

comment on column public.profiles.active is 'false para el perfil sistema "Migración Histórica": nunca debe poder loguearse, solo existe para satisfacer el FK NOT NULL de calls.agent_id/interactions.agent_id en historial sin ejecutivo activado.';
;
