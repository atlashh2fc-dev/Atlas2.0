-- Persona de contacto de las bases de empresas (Equifax).
--
-- El registro de Equifax es la razón social: el ejecutivo no sabía por quién
-- preguntar. scripts/completar-contacto-bigdata.mjs busca en Bigdata
-- (empresa_telefonos) la persona del número que se marca o el representante
-- del RUT y la deja en extra.contacto = {nombre, cargo, telefono, fuente}.
--
-- La función solo agrega esa clave: no pisa el resto de extra ni un contacto
-- que ya exista, así que se puede volver a correr después de cada carga.

create or replace function public.completar_contacto_leads(p_filas jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actualizados integer;
begin
  update public.leads l
     set extra = coalesce(l.extra, '{}'::jsonb) || jsonb_build_object('contacto', f.contacto)
    from jsonb_to_recordset(p_filas) as f(id uuid, contacto jsonb)
   where l.id = f.id
     and f.contacto ? 'nombre'
     and not (coalesce(l.extra, '{}'::jsonb) ? 'contacto');
  get diagnostics v_actualizados = row_count;
  return v_actualizados;
end;
$function$;

revoke execute on function public.completar_contacto_leads(jsonb) from public, anon, authenticated;
grant execute on function public.completar_contacto_leads(jsonb) to service_role;
