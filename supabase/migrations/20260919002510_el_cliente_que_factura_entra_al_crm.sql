-- El CRM conoce 56.464 prospectos y 5 clientes.
--
-- Atlas Financiero factura hoy a 21 clientes con RUT. Al cruzarlos contra
-- crm_entities por RUT normalizado, solo 5 existen, y cada uno con un unico
-- lead: llegaron por una lista de prospeccion, no por haber comprado. Los otros
-- 16 pagan todos los meses y el CRM no sabe que existen.
--
-- Eso invierte el sentido del puente. El maestro de clientes no puede nutrirse
-- solo de la prospeccion: quien factura es cliente aunque nunca haya sido lead.
-- Esta funcion es la puerta por la que el sistema financiero declara un cliente
-- facturado, sin borrar ni pisar lo que la operacion ya sabe de esa entidad.

create or replace function public.registrar_entidad_facturada(
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
  v_rut text := nullif(public.normalize_lead_rut(p_rut), '');
  v_nombre text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_origen text := nullif(btrim(coalesce(p_origen, '')), '');
  v_id uuid;
begin
  if v_rut is null then
    raise exception 'registrar_entidad_facturada requiere un RUT valido';
  end if;
  if v_nombre is null then
    raise exception 'registrar_entidad_facturada requiere un nombre';
  end if;
  if v_origen is null then
    raise exception 'registrar_entidad_facturada requiere declarar su origen';
  end if;

  -- El nombre que ya tiene la entidad manda: la operacion lo corrigio a mano mas
  -- de una vez y la razon social del SII suele ser peor para quien atiende.
  insert into public.crm_entities as e (normalized_rut, display_name, metadata)
  values (
    v_rut,
    v_nombre,
    jsonb_build_object(
      'facturacion', jsonb_build_object(
        'origen', v_origen,
        'referencia_externa', p_referencia_externa,
        'razon_social', v_nombre,
        'registrado_en', now()
      )
    )
  )
  on conflict (normalized_rut) do update
    set metadata = e.metadata || jsonb_build_object(
          'facturacion', jsonb_build_object(
            'origen', v_origen,
            'referencia_externa', p_referencia_externa,
            'razon_social', v_nombre,
            'registrado_en', now()
          )
        ),
        updated_at = now()
  returning e.id into v_id;

  return v_id;
end;
$$;

comment on function public.registrar_entidad_facturada(text, text, text, text) is
  'Declara en el maestro de clientes a quien factura otro modulo de la suite. '
  'Conserva el display_name existente y deja la procedencia en metadata.facturacion.';

-- La escribe un servicio de la suite, nunca una sesion de navegador.
revoke all on function public.registrar_entidad_facturada(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.registrar_entidad_facturada(text, text, text, text)
  to service_role;
