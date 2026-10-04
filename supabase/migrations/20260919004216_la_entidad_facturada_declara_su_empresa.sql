-- La entidad facturada tiene que declarar de que empresa es.
--
-- La version anterior no fijaba organization_id y dependia del default de la
-- columna, que es default_organization_id(): 'geimser' fijo. Los 21 clientes de
-- hoy quedaron bien por casualidad, porque son de Geimser. El dia que Altius
-- facture desde su propio Financiero, sus clientes caerian en Geimser sin que
-- nadie se entere, y la politica restrictiva de aislamiento los mostraria del
-- lado equivocado.
--
-- Ademas crm_entities es unica por RUT a nivel global. Si una empresa ya existe
-- en otra organizacion, esta funcion no la mueve ni le escribe encima: levanta
-- el conflicto para que lo resuelva una persona. Reasignar en silencio seria
-- pasar un cliente de una empresa a otra.

drop function if exists public.registrar_entidad_facturada(text, text, text, text);

create or replace function public.registrar_entidad_facturada(
  p_organization_slug text,
  p_rut text,
  p_display_name text,
  p_origen text default 'atlas-financiero',
  p_referencia_externa text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.organization_id_by_slug(p_organization_slug);
  v_rut text := nullif(public.normalize_lead_rut(p_rut), '');
  v_nombre text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_origen text := nullif(btrim(coalesce(p_origen, '')), '');
  v_procedencia jsonb;
  v_duena uuid;
  v_id uuid;
begin
  if v_org is null then
    raise exception 'registrar_entidad_facturada: no existe la organizacion %', p_organization_slug;
  end if;
  if v_rut is null then
    raise exception 'registrar_entidad_facturada requiere un RUT valido';
  end if;
  if v_nombre is null then
    raise exception 'registrar_entidad_facturada requiere un nombre';
  end if;
  if v_origen is null then
    raise exception 'registrar_entidad_facturada requiere declarar su origen';
  end if;

  select organization_id into v_duena
  from public.crm_entities where normalized_rut = v_rut;

  if v_duena is not null and v_duena <> v_org then
    raise exception
      'registrar_entidad_facturada: el RUT % ya pertenece a otra organizacion; requiere resolucion humana', v_rut;
  end if;

  v_procedencia := jsonb_build_object(
    'facturacion', jsonb_build_object(
      'origen', v_origen,
      'referencia_externa', p_referencia_externa,
      'razon_social', v_nombre,
      'registrado_en', now()
    )
  );

  -- El nombre que ya tiene la entidad manda: la operacion lo corrigio a mano mas
  -- de una vez y la razon social del SII suele ser peor para quien atiende.
  insert into public.crm_entities as e (organization_id, normalized_rut, display_name, metadata)
  values (v_org, v_rut, v_nombre, v_procedencia)
  on conflict (normalized_rut) do update
    set metadata = e.metadata || v_procedencia,
        updated_at = now()
  returning e.id into v_id;

  return v_id;
end;
$$;

comment on function public.registrar_entidad_facturada(text, text, text, text, text) is
  'Declara en el maestro de clientes a quien factura otro modulo de la suite, dentro de su organizacion. '
  'Conserva el display_name existente y rechaza el RUT que ya pertenece a otra empresa.';

revoke all on function public.registrar_entidad_facturada(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.registrar_entidad_facturada(text, text, text, text, text)
  to service_role;
