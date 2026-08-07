-- Contactabilidad por franja horaria: cuándo conviene marcar.
--
-- Reemplaza al "Mix de productos comerciales", que se alimentaba de
-- `equifax_products` y salía siempre vacío porque nadie carga ese dato.
--
-- Es el análisis outbound por excelencia —el "best time to call" de Genesys y
-- Five9—: sin él no hay forma de saber si la operación está marcando en las
-- horas en que la gente contesta. La agrupación va en hora de Chile, que es la
-- que vive el cliente al otro lado del teléfono.
create or replace function public.get_contactability_by_hour(
  p_from timestamptz,
  p_to timestamptz,
  p_campaign_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text := coalesce(public.current_role_name()::text, '');
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado.';
  end if;

  if v_role not in ('admin', 'supervisor') then
    raise exception 'No tienes permiso para revisar este reporte.';
  end if;

  with gestiones as (
    select
      extract(hour from (c.started_at at time zone 'America/Santiago'))::int as hora,
      count(*)::int as gestiones,
      count(*) filter (where c.status = 'connected')::int as contactos,
      count(*) filter (where c.outcome = 'sale')::int as ventas
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where c.started_at >= p_from
      and c.started_at <= p_to
      and c.ended_at is not null
      and (p_campaign_id is null or l.campaign_id = p_campaign_id)
    group by 1
  ),
  -- Las 24 franjas siempre presentes: una hora sin marcaciones es información
  -- (nadie llamó), no una fila que deba desaparecer del eje.
  franjas as (
    select generate_series(0, 23) as hora
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'hora', f.hora,
        'label', lpad(f.hora::text, 2, '0') || ':00',
        'gestiones', coalesce(g.gestiones, 0),
        'contactos', coalesce(g.contactos, 0),
        'ventas', coalesce(g.ventas, 0),
        -- Sin gestiones no hay porcentaje: null para que el gráfico corte la
        -- línea en vez de dibujar un 0 % que se lee como mal desempeño.
        'contactabilidad',
          case
            when coalesce(g.gestiones, 0) = 0 then null
            else round((g.contactos::numeric / g.gestiones) * 100, 1)
          end
      )
      order by f.hora
    ),
    '[]'::jsonb
  )
  into v_result
  from franjas f
  left join gestiones g on g.hora = f.hora;

  return v_result;
end;
$function$;

revoke all on function public.get_contactability_by_hour(timestamptz, timestamptz, uuid) from public;
revoke all on function public.get_contactability_by_hour(timestamptz, timestamptz, uuid) from anon;
grant execute on function public.get_contactability_by_hour(timestamptz, timestamptz, uuid) to authenticated;
