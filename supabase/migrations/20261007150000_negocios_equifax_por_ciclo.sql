-- Negocios Equifax: una recompra es un negocio aparte.
--
-- Reclamo de operación (07-10-2026): Sergio Aravena (77.189.951-K) tiene una
-- venta aprobada de Atlas 1 (17-06) y el 06-10 Rodrigo Figueroa le envió una
-- cotización nueva. La ficha muestra las dos, pero la descarga «Negocios en
-- curso» armaba una sola fila por registro y, como prefería la venta aprobada,
-- salía solo la antigua: la cotización de Rodrigo no aparecía.
--
-- Ahora el negocio es registro × ciclo: cada venta aprobada cierra un ciclo y
-- la siguiente cotización o venta abre otro. Apertura, gestión vigente, Q,
-- venta, rechazo, última gestión y observaciones se toman dentro del ciclo.
-- El 07-10 había 18 registros Equifax con recompra (691 → 709 filas). Las
-- columnas no cambian; lead_id deja de ser único en el resultado.

create or replace function public.get_equifax_negocios(p_campaign_id uuid default null)
returns table (
  lead_id uuid,
  campana text,
  origen text,
  asesor text,
  rut text,
  empresa text,
  productos text[],
  uf numeric,
  q_consultas numeric,
  id_audio text,
  estado text,
  observacion text,
  nombre_cliente text,
  telefono text,
  email text,
  observaciones_equipo text,
  fecha_seguimiento timestamptz,
  fecha_gestion date,
  fecha_ok_contrato date,
  ultima_gestion text,
  fecha_ultima_gestion date
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
#variable_conflict use_column
declare
  v_rol public.app_role := public.current_role_name();
  v_empresas uuid[] := public.current_org_ids();
  v_equipos uuid[] := coalesce(public.supervised_team_ids(), '{}'::uuid[]);
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado.';
  end if;
  if v_rol is null or v_rol not in ('admin', 'supervisor') then
    raise exception 'Solo administración y supervisión descargan el reporte de negocios.';
  end if;

  return query
  with campanas as (
    select campaign.id, campaign.name
    from public.campaigns campaign
    where public.management_requires_equifax_data(campaign.workflow_id, campaign.id)
      and (p_campaign_id is null or campaign.id = p_campaign_id)
  ),
  -- Solo los registros que el usuario puede ver: el admin, los de su
  -- empresa; el supervisor, los de sus equipos (la misma regla de leads).
  visibles as (
    select lead.id
    from public.leads lead
    where lead.campaign_id in (select campanas.id from campanas)
      and lead.organization_id = any (v_empresas)
      and (
        v_rol = 'admin'
        or lead.team_id = any (v_equipos)
      )
  ),
  gestiones as (
    select call.id, call.lead_id, call.agent_id, call.historical_agent_id, call.legacy_call_id,
           call.ended_at, call.notes, call.equifax_products, call.equifax_uf_amount, call.equifax_q_consultas,
           call.equifax_recipient_email,
           -- Ciclo del negocio: cuántas ventas aprobadas del registro hay antes
           -- de esta gestión. Una cotización posterior a una venta aprobada es
           -- una recompra y abre un negocio nuevo.
           (
             select count(*)
             from public.sale_validations aprobada
             where aprobada.lead_id = call.lead_id
               and aprobada.status = 'aprobada'
               and aprobada.sold_at < call.ended_at
           ) as ciclo
    from public.calls call
    where call.lead_id in (select visibles.id from visibles)
      and call.reason ~* '(cotiz|venta)'
      and call.ended_at is not null
      and call.discarded_reason is null
      and public.normalize_management_text(call.reason) in ('COTIZACION ENVIADA', 'VENTA EN VALIDACION')
  ),
  ciclos as (
    select gestiones.lead_id, gestiones.ciclo, min(gestiones.ended_at) as abierto, max(gestiones.ended_at) as ultima
    from gestiones
    group by gestiones.lead_id, gestiones.ciclo
  ),
  -- Un negocio por registro y ciclo. «hasta» es la apertura del negocio
  -- siguiente del mismo registro: lo que pasa después ya es de la recompra.
  negocios as (
    select ciclos.*,
           lead(ciclos.abierto) over (partition by ciclos.lead_id order by ciclos.ciclo) as hasta
    from ciclos
  ),
  -- Cada venta va al ciclo en que se hizo, con la misma regla de las gestiones.
  ventas as (
    select validation.lead_id, validation.status, validation.products, validation.uf_amount, validation.q_consultas,
           validation.call_id, validation.sold_at, validation.decided_at,
           (
             select count(*)
             from public.sale_validations aprobada
             where aprobada.lead_id = validation.lead_id
               and aprobada.status = 'aprobada'
               and aprobada.sold_at < validation.sold_at
           ) as ciclo
    from public.sale_validations validation
    where validation.lead_id in (select visibles.id from visibles)
  )
  select
    lead.id as lead_id,
    campanas.name as campana,
    case
      when lead.extra ? 'fuera_de_base' or lead.extra ? 'ingreso_manual' then 'Ingreso fuera de base'
      when lead.extra->>'external_source' = 'atlas_lead' then campanas.name
      when lead.extra->>'origen' like 'planilla_ventas%' then 'Planilla ventas Equifax'
      when lead.extra ? 'atlas1' then 'Base Atlas 1'
      when lead.extra->'base_discado'->>'base' like 'vocalcom%' then 'Base Vocalcom'
      else coalesce(lead.extra->>'origen', campanas.name)
    end as origen,
    coalesce(agente.full_name, historico.full_name) as asesor,
    lead.rut as rut,
    lead.full_name as empresa,
    coalesce(case when venta.status = 'aprobada' then venta.products end, vigente.equifax_products, '{}'::text[]) as productos,
    coalesce(case when venta.status = 'aprobada' then venta.uf_amount end, vigente.equifax_uf_amount) as uf,
    coalesce(
      case when venta.status = 'aprobada' then venta.q_consultas end,
      vigente.equifax_q_consultas,
      q_previa.equifax_q_consultas
    ) as q_consultas,
    coalesce(apertura.legacy_call_id, apertura.id::text) as id_audio,
    case
      when venta.status = 'aprobada' then 'APROBADO DEFINITIVO'
      when venta.status = 'pendiente' then 'REVISION EQUIFAX'
      when rechazo.ended_at is not null then 'RECHAZO DEFINITIVO'
      when venta.status = 'rechazada' and venta.call_id = vigente.id then 'RECHAZO DEFINITIVO'
      else 'PDTE RESPUESTA CLIENTE'
    end as estado,
    nullif(btrim(apertura.notes), '') as observacion,
    coalesce(
      nullif(nullif(btrim(lead.extra->'atlas1'->>'nombre_cliente'), ''), lead.full_name),
      nullif(btrim(lead.extra->'contacto'->>'nombre'), ''),
      nullif(btrim(lead.extra->>'contact_name'), ''),
      nullif(btrim(lead.extra->'atlas1'->>'nombre_cliente'), '')
    ) as nombre_cliente,
    lead.phone as telefono,
    coalesce(nullif(btrim(vigente.equifax_recipient_email), ''), nullif(btrim(lead.email), '')) as email,
    historial.observaciones as observaciones_equipo,
    lead.next_action_at as fecha_seguimiento,
    (apertura.ended_at at time zone 'America/Santiago')::date as fecha_gestion,
    case when venta.status = 'aprobada' then (coalesce(venta.decided_at, venta.sold_at) at time zone 'America/Santiago')::date end as fecha_ok_contrato,
    ultima.reason as ultima_gestion,
    (ultima.ended_at at time zone 'America/Santiago')::date as fecha_ultima_gestion
  from negocios
  join public.leads lead on lead.id = negocios.lead_id
  join campanas on campanas.id = lead.campaign_id
  join lateral (
    select gestiones.* from gestiones
    where gestiones.lead_id = negocios.lead_id
      and gestiones.ciclo = negocios.ciclo
    order by gestiones.ended_at asc
    limit 1
  ) apertura on true
  join lateral (
    select gestiones.* from gestiones
    where gestiones.lead_id = negocios.lead_id
      and gestiones.ciclo = negocios.ciclo
    order by gestiones.ended_at desc
    limit 1
  ) vigente on true
  -- La última Q informada del negocio, por si la cotización vigente no la trae.
  left join lateral (
    select gestiones.equifax_q_consultas from gestiones
    where gestiones.lead_id = negocios.lead_id
      and gestiones.ciclo = negocios.ciclo
      and gestiones.equifax_q_consultas is not null
    order by gestiones.ended_at desc
    limit 1
  ) q_previa on true
  left join lateral (
    select ventas.status, ventas.products, ventas.uf_amount, ventas.q_consultas, ventas.call_id,
           ventas.sold_at, ventas.decided_at
    from ventas
    where ventas.lead_id = negocios.lead_id
      and ventas.ciclo = negocios.ciclo
    order by (ventas.status = 'aprobada') desc, ventas.sold_at desc
    limit 1
  ) venta on true
  left join lateral (
    select call.ended_at
    from public.calls call
    where call.lead_id = negocios.lead_id
      and call.ended_at > negocios.ultima
      and (negocios.hasta is null or call.ended_at < negocios.hasta)
      and call.discarded_reason is null
      and call.outcome = 'not_interested'
    order by call.ended_at desc
    limit 1
  ) rechazo on true
  left join lateral (
    select call.reason, call.ended_at
    from public.calls call
    where call.lead_id = negocios.lead_id
      and call.ended_at is not null
      and (negocios.hasta is null or call.ended_at < negocios.hasta)
      and call.discarded_reason is null
      and nullif(btrim(call.reason), '') is not null
    order by call.ended_at desc
    limit 1
  ) ultima on true
  left join lateral (
    select string_agg(
      to_char(call.ended_at at time zone 'America/Santiago', 'DD-MM-YYYY') || ': ' || btrim(call.notes),
      ' / ' order by call.ended_at
    ) as observaciones
    from public.calls call
    where call.lead_id = negocios.lead_id
      and call.ended_at >= negocios.abierto
      and (negocios.hasta is null or call.ended_at < negocios.hasta)
      and call.discarded_reason is null
      and nullif(btrim(call.notes), '') is not null
  ) historial on true
  left join public.profiles agente on agente.id = vigente.agent_id
  left join public.historical_agents historico on historico.id = vigente.historical_agent_id
  order by apertura.ended_at desc, lead.full_name;
end;
$function$;

revoke all on function public.get_equifax_negocios(uuid) from public, anon;
grant execute on function public.get_equifax_negocios(uuid) to authenticated;
