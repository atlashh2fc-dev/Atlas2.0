-- La corrección de una gestión cerrada escribe en crm_audit_events, una tabla
-- append-only que no admite INSERT directo desde authenticated. La versión
-- inicial dejó toda la RPC como security invoker, por lo que la transacción se
-- revertía al llegar a la auditoría con "permission denied".
--
-- Conservamos el endpoint público como security invoker y movemos la
-- implementación validada a un schema no expuesto. La implementación privada
-- usa security definer únicamente para atravesar el límite append-only; sus
-- validaciones existentes de auth.uid(), rol, llamada propia cerrada y lead
-- gestionado por el mismo agente siguen ejecutándose antes de cualquier write.

create schema if not exists private authorization postgres;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

alter function public.revise_call_management(
  uuid, uuid, text, text, text, text, timestamptz, text[], numeric, text
) set schema private;

alter function private.revise_call_management(
  uuid, uuid, text, text, text, text, timestamptz, text[], numeric, text
) security definer;

alter function private.revise_call_management(
  uuid, uuid, text, text, text, text, timestamptz, text[], numeric, text
) set search_path = pg_catalog, public;

revoke all on function private.revise_call_management(
  uuid, uuid, text, text, text, text, timestamptz, text[], numeric, text
) from public, anon;

grant execute on function private.revise_call_management(
  uuid, uuid, text, text, text, text, timestamptz, text[], numeric, text
) to authenticated;

create or replace function public.revise_call_management(
  p_call_id uuid,
  p_lead_id uuid,
  p_status text,
  p_outcome text,
  p_reason text,
  p_notes text,
  p_next_action_at timestamptz,
  p_equifax_products text[],
  p_equifax_uf_amount numeric,
  p_equifax_recipient_email text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private
as $function$
  select private.revise_call_management(
    p_call_id,
    p_lead_id,
    p_status,
    p_outcome,
    p_reason,
    p_notes,
    p_next_action_at,
    p_equifax_products,
    p_equifax_uf_amount,
    p_equifax_recipient_email
  );
$function$;

revoke all on function public.revise_call_management(
  uuid, uuid, text, text, text, text, timestamptz, text[], numeric, text
) from public, anon;

grant execute on function public.revise_call_management(
  uuid, uuid, text, text, text, text, timestamptz, text[], numeric, text
) to authenticated;

comment on function public.revise_call_management(
  uuid, uuid, text, text, text, text, timestamptz, text[], numeric, text
) is 'Endpoint RLS para corregir una gestión propia; delega la escritura append-only a una implementación privada validada.';

comment on function private.revise_call_management(
  uuid, uuid, text, text, text, text, timestamptz, text[], numeric, text
) is 'Implementación privada validada de la corrección de gestión; no está expuesta por Data API.';
