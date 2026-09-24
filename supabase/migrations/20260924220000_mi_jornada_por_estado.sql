-- Totales del día del propio ejecutivo por estado, para la barra superior.
--
-- El cronómetro de la barra del teléfono vuelve a cero al cambiar de estado
-- (es cuánto lleva en el estado actual). Operación pidió además los totales
-- de la jornada a la vista del ejecutivo: cuánto lleva hoy en Disponible, en
-- Descanso, en Baño, etc., más sus gestiones y su TMO.
--
-- Día en hora Chile. Tramos: el historial cerrado más el tramo abierto (el
-- estado actual hasta ahora), recortados al inicio del día. SECURITY DEFINER
-- acotado a auth.uid(): cada ejecutivo ve solo lo suyo, y sus gestiones del
-- día cuentan aunque el lead ya no esté a su nombre (la política de calls del
-- agente mira el dueño actual del lead).

create or replace function public.get_my_status_day()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with dia as (
    select date_trunc('day', now() at time zone 'America/Santiago') at time zone 'America/Santiago' as inicio
  ), yo as (
    select (select auth.uid()) as id
  ), tramos as (
    select h.reason_id,
           greatest(h.since, dia.inicio) as desde,
           least(coalesce(h.until, now()), now()) as hasta
    from public.agent_current_status_history h, dia, yo
    where h.profile_id = yo.id
      and coalesce(h.until, now()) > dia.inicio
    union all
    select s.reason_id, greatest(s.since, dia.inicio), now()
    from public.agent_current_status s, dia, yo
    where s.profile_id = yo.id
  ), totales as (
    select r.id, r.code, r.label, r.is_pause, r.sort_order,
           sum(extract(epoch from (t.hasta - t.desde)))::bigint as segundos
    from tramos t
    join public.agent_status_reasons r on r.id = t.reason_id
    where t.hasta > t.desde
    group by r.id, r.code, r.label, r.is_pause, r.sort_order
  ), gestiones as (
    select public.report_call_handle_seconds(c.started_at, c.ended_at, c.legacy_call_id) as segundos
    from public.calls c, dia, yo
    where c.agent_id = yo.id
      and c.started_at >= dia.inicio
      and c.ended_at is not null
      and c.legacy_call_id is null
      and c.discarded_reason is null
  )
  select jsonb_build_object(
    'desde', (select inicio from dia),
    'actual', (
      select jsonb_build_object('reason_id', s.reason_id, 'since', s.since)
      from public.agent_current_status s, yo
      where s.profile_id = yo.id
    ),
    'estados', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reason_id', id, 'code', code, 'label', label, 'is_pause', is_pause, 'segundos', segundos
      ) order by is_pause, sort_order, label)
      from totales
      where code <> 'desconectado'
    ), '[]'::jsonb),
    'conectado_segundos', coalesce((select sum(segundos) from totales where code <> 'desconectado'), 0),
    'gestiones', (select count(*) from gestiones),
    'tmo_segundos', (select round(avg(segundos)) from gestiones where segundos is not null)
  );
$$;

revoke all on function public.get_my_status_day() from public, anon;
grant execute on function public.get_my_status_day() to authenticated;
