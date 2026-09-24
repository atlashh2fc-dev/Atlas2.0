-- Tablero en vivo de la supervisión: tarjetas de resumen y métricas del día.
--
-- El monitor mostraba solo la tabla de ejecutivos. Operación pidió (24-09-2026,
-- al encender Equifax) lo que muestran los contact center grandes: cuántos
-- conectados, hablando, disponibles, en pausa y por qué; TMO, contactabilidad,
-- abandono y producción del día; y por ejecutivo cuánto lleva en pausa y en
-- qué motivo.
--
-- Alcance: los mismos ejecutivos que get_agent_live_status le muestra a quien
-- consulta (supervisor: sus equipos; admin: su empresa). Las gestiones y el
-- tiempo en pausa se miden sobre esos ejecutivos; el discador, sobre sus
-- campañas. SECURITY INVOKER: la seguridad por fila de calls, dial_attempts e
-- historial de estados sigue mandando.

create or replace function public.get_live_wallboard(p_campaign_id uuid default null)
returns jsonb
language plpgsql
-- volatile: arma una tabla temporal con los ejecutivos para no llamar dos
-- veces a get_agent_live_status.
volatile
security invoker
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_day_start timestamptz :=
    date_trunc('day', now() at time zone 'America/Santiago') at time zone 'America/Santiago';
  v_now timestamptz := now();
  v_agents jsonb;
  v_agent_ids uuid[];
  v_campaign_ids uuid[];
  v_result jsonb;
begin
  create temporary table if not exists _wallboard_agents on commit drop as
    select * from public.get_agent_live_status() where false;
  truncate _wallboard_agents;
  insert into _wallboard_agents
    select * from public.get_agent_live_status() live
    where p_campaign_id is null or live.campaign_id = p_campaign_id;

  select coalesce(array_agg(distinct profile_id), '{}'::uuid[]),
         coalesce(array_agg(distinct campaign_id) filter (where campaign_id is not null), '{}'::uuid[])
  into v_agent_ids, v_campaign_ids
  from _wallboard_agents;
  if p_campaign_id is not null then
    v_campaign_ids := array[p_campaign_id];
  end if;

  with
  agentes as (
    select
      a.*,
      coalesce(a.reason_code, '') = 'desconectado' or a.phone_status = 'offline' as desconectado,
      coalesce(a.is_pause, false) and coalesce(a.reason_code, '') <> 'desconectado' as en_pausa
    from _wallboard_agents a
  ),
  estado as (
    select jsonb_build_object(
      'total', count(*),
      'conectados', count(*) filter (where not desconectado),
      'disponibles', count(*) filter (where not desconectado and not en_pausa and phone_status = 'available'),
      'hablando', count(*) filter (where not desconectado and phone_status = 'on_call'),
      'timbrando', count(*) filter (where not desconectado and phone_status = 'ringing'),
      'wrap_up', count(*) filter (where not desconectado and phone_status = 'wrap_up'),
      'en_pausa', count(*) filter (where en_pausa),
      'desconectados', count(*) filter (where desconectado),
      'pausa_por_motivo', coalesce((
        select jsonb_agg(jsonb_build_object('motivo', motivo, 'ejecutivos', n) order by n desc)
        from (
          select coalesce(reason_label, reason_code) as motivo, count(*) as n
          from agentes where en_pausa group by 1
        ) m
      ), '[]'::jsonb)
    ) as data
    from agentes
  ),
  gestiones as (
    select
      c.agent_id,
      c.status,
      c.outcome,
      c.reason,
      c.next_action_at,
      c.started_at,
      public.report_call_handle_seconds(c.started_at, c.ended_at, c.legacy_call_id) as handle_seconds
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where c.agent_id = any (v_agent_ids)
      and c.started_at >= v_day_start
      and c.ended_at is not null
      and c.legacy_call_id is null
      and c.discarded_reason is null
      and (p_campaign_id is null or l.campaign_id = p_campaign_id)
  ),
  intentos as (
    select
      da.status,
      da.bridged_at,
      da.answered_at,
      da.ended_at,
      da.created_at,
      public.dialer_attempt_result_class(da.status, da.attempt_kind, da.originated_at, da.hangup_cause) as clase
    from public.dial_attempts da
    where da.campaign_id = any (v_campaign_ids)
      and da.attempt_kind = 'pool'
      and da.created_at >= v_day_start
  ),
  hoy as (
    select jsonb_build_object(
      'gestiones', (select count(*) from gestiones),
      'contactos', (select count(*) from gestiones where status = 'connected'),
      'contactabilidad', (
        select round(100.0 * count(*) filter (where status = 'connected') / nullif(count(*), 0), 1) from gestiones
      ),
      'tmo_segundos', (select round(avg(handle_seconds)) from gestiones where handle_seconds is not null),
      'tmo_contacto_segundos', (
        select round(avg(handle_seconds)) from gestiones where handle_seconds is not null and status = 'connected'
      ),
      'ventas', (
        select count(*) from gestiones
        where outcome = 'sale' or public.normalize_management_text(reason) = 'VENTA EN VALIDACION'
      ),
      'cotizaciones', (select count(*) from gestiones where public.report_call_is_quote(reason)),
      'agendas', (select count(*) from gestiones where next_action_at is not null),
      'discador_intentos', (select count(*) from intentos),
      'discador_conectadas', (select count(*) from intentos where bridged_at is not null),
      'discador_abandonadas', (select count(*) from intentos where status = 'abandoned'),
      'abandono', (
        select round(100.0 * count(*) filter (where status = 'abandoned')
          / nullif(count(*) filter (where bridged_at is not null or status = 'abandoned'), 0), 1)
        from intentos
      ),
      'fallas_tecnicas', (
        select round(100.0 * count(*) filter (where clase = 'tecnico') / nullif(count(*) filter (where clase is not null), 0), 1)
        from intentos
      ),
      'tmc_segundos', (
        select round(avg(extract(epoch from (ended_at - bridged_at))))
        from intentos
        where bridged_at is not null and ended_at is not null and ended_at - bridged_at < interval '2 hours'
      ),
      'en_curso', (
        select count(*) from public.dial_attempts da
        where da.campaign_id = any (v_campaign_ids)
          and da.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
          and da.created_at >= v_now - interval '2 hours'
      )
    ) as data
  ),
  -- Llamadas y contactos por hora de hoy (hora Chile), para el gráfico.
  por_hora as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'hora', hora, 'gestiones', gestiones, 'contactos', contactos, 'intentos', intentos_hora
    ) order by hora), '[]'::jsonb) as data
    from (
      select h.hora,
        (select count(*) from gestiones g where extract(hour from g.started_at at time zone 'America/Santiago') = h.hora) as gestiones,
        (select count(*) from gestiones g where g.status = 'connected' and extract(hour from g.started_at at time zone 'America/Santiago') = h.hora) as contactos,
        (select count(*) from intentos i where extract(hour from i.created_at at time zone 'America/Santiago') = h.hora) as intentos_hora
      from generate_series(8, 20) as h(hora)
      where h.hora <= extract(hour from v_now at time zone 'America/Santiago')
    ) t
  ),
  -- Tramos de estado de hoy: el historial cerrado más el tramo abierto.
  tramos as (
    select h.profile_id, h.reason_id,
           greatest(h.since, v_day_start) as desde,
           least(coalesce(h.until, v_now), v_now) as hasta
    from public.agent_current_status_history h
    where h.profile_id = any (v_agent_ids)
      and coalesce(h.until, v_now) > v_day_start
    union all
    select s.profile_id, s.reason_id, greatest(s.since, v_day_start), v_now
    from public.agent_current_status s
    where s.profile_id = any (v_agent_ids)
  ),
  pausas as (
    select t.profile_id, coalesce(r.label, r.code) as motivo,
           sum(extract(epoch from (t.hasta - t.desde)))::bigint as segundos
    from tramos t
    join public.agent_status_reasons r on r.id = t.reason_id
    where r.is_pause and r.code <> 'desconectado' and t.hasta > t.desde
    group by 1, 2
  ),
  por_ejecutivo as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'profile_id', a.profile_id,
      'gestiones', coalesce(g.gestiones, 0),
      'contactos', coalesce(g.contactos, 0),
      'ventas', coalesce(g.ventas, 0),
      'tmo_segundos', g.tmo,
      'pausa_segundos', coalesce(p.total, 0),
      'pausa_por_motivo', coalesce(p.detalle, '[]'::jsonb)
    )), '[]'::jsonb) as data
    from (select distinct profile_id from _wallboard_agents) a
    left join (
      select agent_id,
             count(*) as gestiones,
             count(*) filter (where status = 'connected') as contactos,
             count(*) filter (where outcome = 'sale' or public.normalize_management_text(reason) = 'VENTA EN VALIDACION') as ventas,
             round(avg(handle_seconds)) as tmo
      from gestiones group by agent_id
    ) g on g.agent_id = a.profile_id
    left join (
      select profile_id, sum(segundos) as total,
             jsonb_agg(jsonb_build_object('motivo', motivo, 'segundos', segundos) order by segundos desc) as detalle
      from pausas group by profile_id
    ) p on p.profile_id = a.profile_id
  ),
  pausa_equipo as (
    select coalesce(jsonb_agg(jsonb_build_object('motivo', motivo, 'segundos', segundos) order by segundos desc), '[]'::jsonb) as data
    from (select motivo, sum(segundos)::bigint as segundos from pausas group by motivo) x
  )
  select jsonb_build_object(
    'generado', v_now,
    'desde', v_day_start,
    'estado', estado.data,
    'hoy', hoy.data,
    'por_hora', por_hora.data,
    'por_ejecutivo', por_ejecutivo.data,
    'pausa_equipo', pausa_equipo.data
  )
  into v_result
  from estado, hoy, por_hora, por_ejecutivo, pausa_equipo;

  return v_result;
end;
$function$;

revoke all on function public.get_live_wallboard(uuid) from public, anon;
grant execute on function public.get_live_wallboard(uuid) to authenticated;
