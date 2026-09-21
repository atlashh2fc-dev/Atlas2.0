-- El acuse de una entrega nunca funcionó.
--
-- ack_integration_outbox_v2 cerraba el circuito con un INSERT ... SELECT DISTINCT
-- que llevaba null sin tipo. Con DISTINCT, Postgres resuelve ese null como text,
-- y text no entra en opened_until (timestamptz). La función fallaba en cada
-- llamada, al planificar, con cero filas o con mil.
--
-- Nunca se vio porque ninguna entrega había llegado a completarse: el puente con
-- Atlas Lead se caía antes, primero por la variable de destino y después por el
-- formato de fecha. El 21-09-2026, con esas dos corregidas, un evento de prueba
-- llegó a Atlas Lead y fue aceptado, y el CRM no pudo marcarlo como entregado.
-- Lo reintentaba una y otra vez, y el circuito seguía abierto.
--
-- Los null van tipados. El resto de la función queda igual.

create or replace function public.ack_integration_outbox_v2(
  p_worker_id text, p_event_ids uuid[], p_provider_ack text default null,
  p_http_status integer default null
)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if coalesce(cardinality(p_event_ids),0) > 500 then raise exception 'integration_v2_batch_limit'; end if;
  with changed as (
    update public.integration_outbox_events o
    set status = 'delivered', delivered_at = coalesce(o.delivered_at, now()),
        provider_ack = left(p_provider_ack, 1000), last_http_status = p_http_status,
        lease_owner = null, lease_expires_at = null, last_error_code = null,
        last_error_detail = null, updated_at = now()
    where o.id = any(coalesce(p_event_ids, array[]::uuid[]))
      and o.status = 'processing' and o.lease_owner = btrim(p_worker_id)
    returning o.destination_source_id
  ), circuits as (
    insert into public.integration_circuit_states (
      destination_source_id, consecutive_failures, state, opened_until,
      last_success_at, last_error_code, updated_at
    ) select distinct c.destination_source_id, 0, 'closed', null::timestamptz, now(), null::text, now()
      from changed c
    on conflict (destination_source_id) do update set
      consecutive_failures = 0, state = 'closed', opened_until = null,
      last_success_at = now(), last_error_code = null, updated_at = now()
    returning destination_source_id
  )
  select count(*)::integer into v_count
  from public.integration_outbox_events o
  where o.id = any(coalesce(p_event_ids, array[]::uuid[])) and o.status = 'delivered';
  return coalesce(v_count,0);
end;
$$;
