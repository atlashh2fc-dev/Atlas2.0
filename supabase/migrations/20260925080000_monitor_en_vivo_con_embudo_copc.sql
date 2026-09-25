-- Monitor en vivo: los KPI de contacto se miden como COPC outbound, por registro.
--
-- Operación pidió (25-09-2026) que la contactabilidad sea «todos los aló ÷ el
-- recorrido». El monitor la calculaba como contactos ÷ gestiones cerradas: el
-- denominador eran solo las llamadas que llegaron a un ejecutivo, y los no
-- contesta, ocupados y números inexistentes del discador (que no crean gestión)
-- no restaban. Equifax marcaba 54 % con ~210 gestiones cuando el discador había
-- recorrido cerca de 900 registros: la contactabilidad real era ~12 %.
--
-- Embudo del día (hora Chile), contado por registro (lead) y no por llamada:
--   * Recorridos: registros con al menos una marcación que llegó a la red
--     (clase 'real' o 'invalido' de dialer_attempt_result_class) o con una
--     gestión cerrada hoy. Las fallas técnicas no cuentan: la troncal no llegó
--     al cliente y eso ya se ve en «Fallas de troncal».
--   * Contactados (aló): registros donde alguien contestó y habló con un
--     ejecutivo: gestión con status 'connected'. Incluye tercero y número
--     erróneo, porque la línea conectó con una persona. El abandono no es aló:
--     el cliente contestó pero nadie le habló, y se mide aparte.
--   * Contacto titular: aló con la persona buscada, es decir, sin tercero ni
--     número erróneo / no corresponde (public.call_reason_is_not_holder).
--   * Ventas: la regla del tablero (outcome 'sale' o VENTA EN VALIDACION).
-- Tasas: contactabilidad = aló ÷ recorridos; contactabilidad titular = titular
-- ÷ recorridos; titularidad = titular ÷ aló; conversión = ventas ÷ titular;
-- intensidad = marcaciones ÷ recorridos; intentos por contacto = marcaciones ÷
-- aló.
--
-- Alcance: las campañas de los ejecutivos visibles más las que muestra
-- get_queue_health, para que cada tarjeta de campaña tenga su embudo aunque
-- nadie esté conectado. El filtro de empresa y supervisor lo ponen esas dos
-- funciones; las filas de calls y dial_attempts siguen bajo su RLS (SECURITY
-- INVOKER). Se deja de devolver hoy.contactabilidad: su significado cambió y
-- ahora vive en embudo.contactabilidad.

create or replace function public.call_reason_is_not_holder(p_reason text)
returns boolean
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $$
  -- Contestó alguien que no es la persona buscada. Mismo criterio que
  -- inferStatus en src/lib/call-typification.ts: la línea conectó.
  select public.normalize_management_text(p_reason) ~ '(TERCERO|NUMERO ERRONEO|NUMERO EQUIVOCADO|NO CORRESPONDE)';
$$;

grant execute on function public.call_reason_is_not_holder(text) to authenticated;

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
  else
    -- Las campañas del discador que ve quien consulta, aunque no tengan a
    -- nadie conectado: las tarjetas de campaña necesitan su embudo.
    select coalesce(array_agg(distinct id), '{}'::uuid[]) into v_campaign_ids
    from (
      select unnest(v_campaign_ids) as id
      union
      select q.campaign_id from public.get_queue_health() q
    ) campaigns;
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
  -- Embudo COPC: un evento por marcación que llegó a la red y por gestión
  -- cerrada de las campañas en alcance, sea quien sea el ejecutivo.
  eventos_registro as materialized (
    select da.lead_id, da.campaign_id, da.created_at as at,
           1 as marcacion, false as alo, false as titular, false as venta
    from public.dial_attempts da
    where da.campaign_id = any (v_campaign_ids)
      and da.attempt_kind in ('pool', 'personal_callback')
      and da.created_at >= v_day_start
      and public.dialer_attempt_result_class(da.status, da.attempt_kind, da.originated_at, da.hangup_cause)
          in ('real', 'invalido')
    union all
    select c.lead_id, l.campaign_id, c.started_at,
           0,
           c.status = 'connected',
           c.status = 'connected' and not public.call_reason_is_not_holder(c.reason),
           c.outcome = 'sale' or public.normalize_management_text(c.reason) = 'VENTA EN VALIDACION'
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where l.campaign_id = any (v_campaign_ids)
      and c.started_at >= v_day_start
      and c.ended_at is not null
      and c.legacy_call_id is null
      and c.discarded_reason is null
  ),
  registros as (
    select lead_id, campaign_id,
           sum(marcacion) as marcaciones,
           bool_or(alo) as alo,
           bool_or(titular) as titular,
           bool_or(venta) as venta
    from eventos_registro
    group by lead_id, campaign_id
  ),
  embudo_campana as (
    select campaign_id,
           count(*) as recorridos,
           sum(marcaciones) as intentos,
           count(*) filter (where alo) as contactados,
           count(*) filter (where titular) as titulares,
           count(*) filter (where venta) as ventas
    from registros
    group by campaign_id
  ),
  embudo as (
    select jsonb_build_object(
      'recorridos', coalesce(sum(recorridos), 0),
      'intentos', coalesce(sum(intentos), 0),
      'contactados', coalesce(sum(contactados), 0),
      'titulares', coalesce(sum(titulares), 0),
      'ventas', coalesce(sum(ventas), 0),
      'contactabilidad', round(100.0 * sum(contactados) / nullif(sum(recorridos), 0), 1),
      'contactabilidad_titular', round(100.0 * sum(titulares) / nullif(sum(recorridos), 0), 1),
      'titularidad', round(100.0 * sum(titulares) / nullif(sum(contactados), 0), 1),
      'conversion', round(100.0 * sum(ventas) / nullif(sum(titulares), 0), 1),
      'intensidad', round(sum(intentos)::numeric / nullif(sum(recorridos), 0), 2),
      'intentos_por_contacto', round(sum(intentos)::numeric / nullif(sum(contactados), 0), 2)
    ) as data
    from embudo_campana
  ),
  por_campana as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'campaign_id', campaign_id,
      'recorridos', recorridos,
      'intentos', intentos,
      'contactados', contactados,
      'titulares', titulares,
      'ventas', ventas,
      'contactabilidad', round(100.0 * contactados / nullif(recorridos, 0), 1),
      'contactabilidad_titular', round(100.0 * titulares / nullif(recorridos, 0), 1),
      'conversion', round(100.0 * ventas / nullif(titulares, 0), 1)
    )), '[]'::jsonb) as data
    from embudo_campana
  ),
  hoy as (
    select jsonb_build_object(
      'gestiones', (select count(*) from gestiones),
      'contactos', (select count(*) from gestiones where status = 'connected'),
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
  -- Por hora (hora Chile): registros recorridos y con aló en esa hora. Un
  -- registro marcado en dos horas cuenta en ambas, como en cualquier curva
  -- horaria de contactabilidad.
  por_hora as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'hora', h.hora,
      'intentos', coalesce(r.intentos, 0),
      'recorridos', coalesce(r.recorridos, 0),
      'contactados', coalesce(r.contactados, 0),
      'titulares', coalesce(r.titulares, 0),
      'gestiones', coalesce(g.gestiones, 0),
      'contactos', coalesce(g.contactos, 0)
    ) order by h.hora), '[]'::jsonb) as data
    from generate_series(8, 20) as h(hora)
    left join (
      select extract(hour from at at time zone 'America/Santiago')::int as hora,
             sum(marcacion) as intentos,
             count(distinct lead_id) as recorridos,
             count(distinct lead_id) filter (where alo) as contactados,
             count(distinct lead_id) filter (where titular) as titulares
      from eventos_registro group by 1
    ) r on r.hora = h.hora
    left join (
      select extract(hour from started_at at time zone 'America/Santiago')::int as hora,
             count(*) as gestiones,
             count(*) filter (where status = 'connected') as contactos
      from gestiones group by 1
    ) g on g.hora = h.hora
    where h.hora <= extract(hour from v_now at time zone 'America/Santiago')
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
    'embudo', embudo.data,
    'por_campana', por_campana.data,
    'por_hora', por_hora.data,
    'por_ejecutivo', por_ejecutivo.data,
    'pausa_equipo', pausa_equipo.data
  )
  into v_result
  from estado, hoy, embudo, por_campana, por_hora, por_ejecutivo, pausa_equipo;

  return v_result;
end;
$function$;

revoke all on function public.get_live_wallboard(uuid) from public, anon;
grant execute on function public.get_live_wallboard(uuid) to authenticated;
