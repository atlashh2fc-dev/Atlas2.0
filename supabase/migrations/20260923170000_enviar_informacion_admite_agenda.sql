-- «Enviar Información» cerraba la gestión sin posibilidad de agenda: la regla
-- la trataba como tipificación final ('none'), así que el registro quedaba en
-- managed, salía de la agenda del ejecutivo y el trigger rechazaba cualquier
-- fecha. En Secretaria Virtual el cliente pide el material y la ejecutiva
-- necesita volver a llamarlo para saber si lo leyó; para hacerlo tipificaba
-- «Volver a Llamar» o «Cotización Enviada» en su lugar.
--
-- Pasa al mismo contrato que la cotización fuera de Equifax: admite agenda sin
-- exigirla. Con fecha, save_call_management deja el lead en callback y vuelve
-- a la agenda; sin fecha, el cierre sigue siendo final. Espejo de inferAgenda
-- en src/lib/call-typification.ts.

create or replace function public.management_agenda_requirement(
  p_reason text,
  p_outcome text,
  p_requires_equifax_data boolean
)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $function$
  select case
    when coalesce(p_outcome, '') = 'callback' then 'required'
    when public.normalize_management_text(p_reason) like '%VOLVER A LLAMAR%' then 'required'
    when public.normalize_management_text(p_reason) like '%REUNION%' then 'required'
    when public.normalize_management_text(p_reason) like '%NO ES EL MOMENTO%' then 'required'
    when public.normalize_management_text(p_reason) like '%COMPROMISO DE PAGO%' then 'required'
    when public.normalize_management_text(p_reason) like '%NEGOCIACION EN CURSO%' then 'required'
    when public.normalize_management_text(p_reason) like '%COTIZACION%' then
      case when coalesce(p_requires_equifax_data, false) then 'required' else 'optional' end
    when public.normalize_management_text(p_reason) like '%ENVIAR INFORMACION%' then 'optional'
    when public.normalize_management_text(p_reason) like '%ENVIA INFORMACION%' then 'optional'
    else 'none'
  end;
$function$;

comment on function public.management_agenda_requirement(text, text, boolean)
is 'required | optional | none para una tipificación, según su contrato de campaña. Espejo de inferAgenda en src/lib/call-typification.ts.';
