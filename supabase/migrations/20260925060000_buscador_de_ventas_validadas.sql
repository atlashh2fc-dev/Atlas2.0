-- Buscador de ventas y decisión en bloque para la validación de ventas.
--
-- Pedido de operación (24-09-2026): la cola en tarjetas no servía para
-- trabajar volumen ni para encontrar una venta ya validada. Dos piezas:
--
--   * search_sale_validations: busca dentro del universo de ventas por texto
--     (empresa, RUT, teléfono, ejecutivo, producto, campaña), ejecutivo,
--     producto, estado y rango de fechas en hora Chile. Para las decididas el
--     rango es sobre la fecha de la decisión; para las pendientes, sobre la
--     fecha de la venta. Mismo alcance que list_sale_validations.
--   * resolve_sale_validations: aprueba o rechaza varias de una vez, pasando
--     cada una por resolve_sale_validation (mismas reglas, misma auditoría).
--     Es todo o nada: si una falla, no se decide ninguna.

create or replace function public.search_sale_validations(
  p_status text default 'aprobada',
  p_query text default null,
  p_from date default null,
  p_to date default null,
  p_agent text default null,
  p_product text default null,
  p_limit integer default 1000
)
returns table (
  id uuid,
  status text,
  sold_at timestamptz,
  lead_id uuid,
  lead_name text,
  lead_rut text,
  lead_phone text,
  lead_email text,
  lead_status text,
  campaign_name text,
  team_name text,
  agent_name text,
  products text[],
  uf_amount numeric,
  recipient_email text,
  agent_notes text,
  decided_at timestamptz,
  decided_by_name text,
  decision_note text,
  decision_source text
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with base as (
    select
      v.id, v.status, v.sold_at, v.lead_id,
      lead.full_name as lead_name, lead.rut as lead_rut, lead.phone as lead_phone,
      lead.email as lead_email, lead.status as lead_status,
      campaign.name as campaign_name, team.name as team_name,
      coalesce(historical.full_name, agent.full_name, agent.email) as agent_name,
      v.products, v.uf_amount, v.recipient_email, v.agent_notes,
      v.decided_at, coalesce(decider.full_name, decider.email) as decided_by_name,
      v.decision_note, v.decision_source,
      (coalesce(v.decided_at, v.sold_at) at time zone 'America/Santiago')::date as fecha_filtro
    from public.sale_validations v
    join public.leads lead on lead.id = v.lead_id
    left join public.campaigns campaign on campaign.id = v.campaign_id
    left join public.teams team on team.id = v.team_id
    left join public.profiles agent on agent.id = v.agent_id
    left join public.historical_agents historical on historical.id = v.historical_agent_id
    left join public.profiles decider on decider.id = v.decided_by
    where (nullif(p_status, '') is null or v.status = p_status)
      and private.sale_validation_in_scope(v)
  ),
  termino as (
    select
      nullif(btrim(coalesce(p_query, '')), '') as texto,
      nullif(regexp_replace(coalesce(p_query, ''), '\D', '', 'g'), '') as digitos
  )
  select
    base.id, base.status, base.sold_at, base.lead_id, base.lead_name, base.lead_rut, base.lead_phone,
    base.lead_email, base.lead_status, base.campaign_name, base.team_name, base.agent_name,
    base.products, base.uf_amount, base.recipient_email, base.agent_notes, base.decided_at,
    base.decided_by_name, base.decision_note, base.decision_source
  from base, termino
  where (p_from is null or base.fecha_filtro >= p_from)
    and (p_to is null or base.fecha_filtro <= p_to)
    and (nullif(p_agent, '') is null or base.agent_name = p_agent)
    and (nullif(p_product, '') is null or p_product = any (base.products))
    and (
      termino.texto is null
      or base.lead_name ilike '%' || termino.texto || '%'
      or base.agent_name ilike '%' || termino.texto || '%'
      or base.campaign_name ilike '%' || termino.texto || '%'
      or base.lead_email ilike '%' || termino.texto || '%'
      or array_to_string(base.products, ' ') ilike '%' || termino.texto || '%'
      -- RUT y teléfono se comparan solo por dígitos: 76.123.456-7, 761234567
      -- y +56 9 … encuentran lo mismo. Con menos de 4 dígitos no se intenta.
      or (
        length(termino.digitos) >= 4
        and (
          regexp_replace(coalesce(base.lead_rut, ''), '\D', '', 'g') like '%' || termino.digitos || '%'
          or regexp_replace(coalesce(base.lead_phone, ''), '\D', '', 'g') like '%' || termino.digitos || '%'
        )
      )
    )
  order by coalesce(base.decided_at, base.sold_at) desc
  limit least(greatest(coalesce(p_limit, 1000), 1), 5000);
$$;

revoke all on function public.search_sale_validations(text, text, date, date, text, text, integer) from public, anon;
grant execute on function public.search_sale_validations(text, text, date, date, text, text, integer) to authenticated;

create or replace function public.resolve_sale_validations(p_validation_ids uuid[], p_decision text, p_note text)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_id uuid;
  v_done integer := 0;
begin
  if coalesce(cardinality(p_validation_ids), 0) = 0 then
    raise exception 'Selecciona al menos una venta.';
  end if;
  if cardinality(p_validation_ids) > 500 then
    raise exception 'Decide hasta 500 ventas por vez.';
  end if;
  foreach v_id in array (select array_agg(distinct x) from unnest(p_validation_ids) x) loop
    perform public.resolve_sale_validation(v_id, p_decision, p_note);
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;

revoke all on function public.resolve_sale_validations(uuid[], text, text) from public, anon;
grant execute on function public.resolve_sale_validations(uuid[], text, text) to authenticated;
