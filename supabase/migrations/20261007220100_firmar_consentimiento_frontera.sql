-- La firma presencial valida empresa y rol de forma explícita: llama a la
-- función interna de firma, que la sesión no puede ejecutar directamente.
create or replace function public.firmar_consentimiento(p_id uuid, p_nombre text, p_rut text, p_firma text)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if not exists (select 1 from public.consentimientos where id = p_id and organization_id = any (public.current_org_ids()))
     or not ((select public.current_role_name()) in ('admin', 'supervisor') or public.is_platform_owner()) then
    raise exception 'No encontramos ese consentimiento' using errcode = 'P0002';
  end if;
  return public.firmar_consentimiento_interno(p_id, null, p_nombre, p_rut, p_firma, 'presencial');
end;
$$;
revoke all on function public.firmar_consentimiento(uuid, text, text, text) from public, anon;
grant execute on function public.firmar_consentimiento(uuid, text, text, text) to authenticated;
