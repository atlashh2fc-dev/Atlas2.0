-- Lo que quedaba del historial de Atlas 1 distorsionando la supervisión.
--
-- 1. Detalle de ventas y cotizaciones del reporte del supervisor: la misma regla
--    que el resumen (20260924183100). Buscar «VENTA» en el motivo listaba las
--    «CLIENTE NO SUJETO A VENTA» de Atlas 1 como ventas.
--
-- 2. Salud de cola (panel en vivo del discador): gestiones, contactos efectivos y
--    ventas de hoy contaban toda llamada cerrada hoy en la campaña. El 24-09
--    Equifax tenía 191: 167 migradas de Atlas 1 y 24 descartadas «abiertas sin
--    tipificar», todas connected. Es el tablero de la jornada del discador de
--    Atlas 2.0, así que ahora cuenta solo lo hecho aquí: sin migradas y sin
--    descartadas. El resto de la función queda igual (mismo alcance del
--    supervisor, misma frontera de empresa, mismo corte de día en Chile).
--
-- 3. Tablas precalculadas de tipificaciones (supervisor_report_daily_*
--    tipifications): la misma regla que el resumen en vivo. La interacción de una
--    llamada descartada no cuenta, y la que acompaña a una llamada
--    (metadata.call_id) no es una segunda tipificación: era la que sumaba dos
--    veces cada gestión y aportaba la etiqueta técnica «connected». Ninguna
--    pantalla las lee hoy; se alinean para que nadie vuelva a leer cifras falsas.
--
-- Efecto en otras campañas: ventas y cotizaciones no cambian (sus ventas ya
-- tenían outcome 'sale' y sus cotizaciones el motivo exacto). En la salud de
-- cola dejan de contar sus llamadas descartadas del día, que son registros
-- anulados. Las tipificaciones precalculadas dejan de contar dos veces.

create or replace function public.get_supervisor_report_drilldown(
  p_from timestamptz,
  p_to timestamptz,
  p_profile_id uuid default null,
  p_historical_agent_id uuid default null,
  p_metric text default 'agendas',
  p_limit integer default 100,
  p_campaign_id uuid default null
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_role text := coalesce((select public.current_role_name())::text, '');
  v_team_ids uuid[];
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_result jsonb;
begin
  if v_role = 'supervisor' then
    v_team_ids := public.supervised_team_ids();
    if coalesce(cardinality(v_team_ids), 0) = 0 then
      raise exception 'Tu supervisor no tiene equipos asignados.';
    end if;
  elsif v_role <> 'admin' then
    raise exception 'No autorizado';
  end if;

  if p_metric not in ('agendas', 'cotizaciones', 'ventas') then
    raise exception 'Métrica no soportada: %', p_metric;
  end if;

  with linked_historical_agents as (
    select ha.id
    from public.historical_agents ha
    where p_profile_id is not null and ha.linked_profile_id = p_profile_id
  ), base_calls as (
    select c.*, coalesce(c.ended_at, c.updated_at, c.created_at) as activity_at,
      l.full_name, l.rut, l.phone, l.email, l.status as lead_status,
      l.tipificacion_actual, l.observacion_actual, l.next_action_at as lead_next_action_at,
      l.managed_at, camp.name as campaign_name,
      coalesce(p.full_name, ha.full_name, '—') as agent_name
    from public.calls c
    join public.leads l on l.id = c.lead_id
    left join public.campaigns camp on camp.id = l.campaign_id
    left join public.profiles p on p.id = c.agent_id
    left join public.historical_agents ha on ha.id = c.historical_agent_id
    where c.discarded_reason is null
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= p_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) <= p_to
      and (v_team_ids is null or l.team_id = any(v_team_ids))
      and (p_campaign_id is null or l.campaign_id = p_campaign_id)
      and (
        (p_profile_id is not null and (
          (c.agent_id = p_profile_id and c.historical_agent_id is null)
          or c.historical_agent_id in (select id from linked_historical_agents)
        ))
        or (p_historical_agent_id is not null and c.historical_agent_id = p_historical_agent_id)
      )
      and (
        (p_metric = 'agendas' and c.next_action_at is not null)
        or (p_metric = 'cotizaciones' and public.report_call_is_quote(c.reason))
        -- Misma regla que el resumen: venta es lo declarado como venta.
        or (p_metric = 'ventas' and c.outcome = 'sale')
      )
  ), limited_calls as (
    select * from base_calls order by activity_at desc limit v_limit
  )
  select jsonb_build_object(
    'metric', p_metric,
    'limit', v_limit,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'call_id', lc.id,
      'lead_id', lc.lead_id,
      'activity_at', lc.activity_at,
      'started_at', lc.started_at,
      'ended_at', lc.ended_at,
      'status', lc.status,
      'outcome', lc.outcome,
      'reason', lc.reason,
      'notes', lc.notes,
      'next_action_at', lc.next_action_at,
      'equifax_products', lc.equifax_products,
      'equifax_uf_amount', lc.equifax_uf_amount,
      'equifax_recipient_email', lc.equifax_recipient_email,
      'agent_name', lc.agent_name,
      'lead', jsonb_build_object(
        'id', lc.lead_id,
        'full_name', lc.full_name,
        'rut', lc.rut,
        'phone', lc.phone,
        'email', lc.email,
        'status', lc.lead_status,
        'tipificacion_actual', lc.tipificacion_actual,
        'observacion_actual', lc.observacion_actual,
        'next_action_at', lc.lead_next_action_at,
        'managed_at', lc.managed_at,
        'campaign_name', lc.campaign_name
      ),
      'contacts', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', ct.id, 'contact_type', ct.contact_type, 'value', ct.value,
          'label', ct.label, 'is_primary', ct.is_primary, 'is_valid', ct.is_valid
        ) order by ct.is_primary desc, ct.contact_type, ct.created_at), '[]'::jsonb)
        from public.lead_contacts ct
        where ct.lead_id = lc.lead_id
      )
    ) order by lc.activity_at desc), '[]'::jsonb)
  ) into v_result
  from limited_calls lc;

  return coalesce(v_result, jsonb_build_object('metric', p_metric, 'limit', v_limit, 'items', '[]'::jsonb));
end;
$function$;

create or replace function public.get_queue_health()
returns table(
  campaign_id uuid,
  campaign_name text,
  queue_name text,
  campaign_type text,
  in_flight integer,
  attempts_today integer,
  answered_today integer,
  abandoned_today integer,
  completed_today integer,
  no_answer_today integer,
  managements_today integer,
  effective_contacts_today integer,
  sales_today integer
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.app_role := public.current_role_name();
  v_team_ids uuid[] := '{}';
  v_campaign_ids uuid[] := '{}';
  v_day_start timestamptz :=
    date_trunc('day', now() at time zone 'America/Santiago') at time zone 'America/Santiago';
begin
  if auth.uid() is null
     or not coalesce(public.is_current_app_session_valid(), false)
     or coalesce(v_role::text, '') not in ('admin', 'supervisor')
     or not exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.active) then
    raise exception 'get_queue_health solo puede ser llamada por admin o supervisor con sesión activa.';
  end if;

  if v_role = 'supervisor'::public.app_role then
    v_team_ids := public.supervised_team_ids();
    select coalesce(array_agg(c.id), '{}'::uuid[]) into v_campaign_ids
    from public.campaigns c
    where c.is_active and (
      public.can_access_whatsapp_campaign(c.id, null)
      or exists (
        select 1 from public.leads scoped_lead
        where scoped_lead.campaign_id = c.id and scoped_lead.team_id = any(v_team_ids)
      )
      or exists (
        select 1
        from public.contact_center_queue_sources source
        join public.contact_center_queue_members member on member.queue_id = source.queue_id
        join public.profiles agent on agent.id = member.profile_id
        where source.campaign_id = c.id and source.is_active
          and member.is_active and agent.active and agent.team_id = any(v_team_ids)
      )
    );
  end if;

  -- Gestiones, contactos y ventas de hoy: solo lo gestionado en Atlas 2.0. Las
  -- llamadas migradas de Atlas 1 (legacy_call_id) no son de esta jornada del
  -- discador y las descartadas (discarded_reason) son registros anulados.
  return query
  select
    dc.campaign_id,
    camp.name as campaign_name,
    dc.queue_name,
    dc.campaign_type,
    (
      select count(*)::int from public.dial_attempts da
      where da.campaign_id = dc.campaign_id
        and da.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
    ) as in_flight,
    (
      select count(*)::int from public.dial_attempts da
      where da.campaign_id = dc.campaign_id
        and da.created_at >= v_day_start
    ) as attempts_today,
    (
      select count(*)::int from public.dial_attempts da
      where da.campaign_id = dc.campaign_id
        and da.status in ('bridged', 'completed')
        and da.created_at >= v_day_start
    ) as answered_today,
    (
      select count(*)::int from public.dial_attempts da
      where da.campaign_id = dc.campaign_id
        and da.status = 'abandoned'
        and da.created_at >= v_day_start
    ) as abandoned_today,
    (
      select count(*)::int from public.dial_attempts da
      where da.campaign_id = dc.campaign_id
        and da.status = 'completed'
        and da.created_at >= v_day_start
    ) as completed_today,
    (
      select count(*)::int from public.dial_attempts da
      where da.campaign_id = dc.campaign_id
        and da.status = 'no_answer'
        and da.created_at >= v_day_start
    ) as no_answer_today,
    (
      select count(*)::int
      from public.calls c
      join public.leads l on l.id = c.lead_id
      where l.campaign_id = dc.campaign_id
        and c.ended_at is not null
        and c.ended_at >= v_day_start
        and c.discarded_reason is null
        and c.legacy_call_id is null
    ) as managements_today,
    (
      select count(*)::int
      from public.calls c
      join public.leads l on l.id = c.lead_id
      where l.campaign_id = dc.campaign_id
        and c.ended_at is not null
        and c.ended_at >= v_day_start
        and c.discarded_reason is null
        and c.legacy_call_id is null
        and c.status = 'connected'
    ) as effective_contacts_today,
    (
      select count(*)::int
      from public.calls c
      join public.leads l on l.id = c.lead_id
      where l.campaign_id = dc.campaign_id
        and c.ended_at is not null
        and c.ended_at >= v_day_start
        and c.discarded_reason is null
        and c.legacy_call_id is null
        and c.outcome = 'sale'
    ) as sales_today
  from public.dialer_campaign_configs dc
  join public.campaigns camp on camp.id = dc.campaign_id
  where public.can_access_org(public.org_of_campaign(dc.campaign_id)) and dc.is_active = true
    and (v_role = 'admin'::public.app_role or dc.campaign_id = any(v_campaign_ids));
end;
$function$;

create or replace function public.refresh_supervisor_report_agent_tipification_rows(p_day date, p_team_id uuid, p_report_agent_key text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_profile_id uuid;
  v_historical_agent_id uuid;
begin
  if p_day is null or p_team_id is null or nullif(btrim(p_report_agent_key), '') is null then
    return;
  end if;

  select p.id
  into v_profile_id
  from public.profiles p
  where p.id::text = p_report_agent_key;

  select ha.id
  into v_historical_agent_id
  from public.historical_agents ha
  where ha.id::text = p_report_agent_key
    and ha.linked_profile_id is null;

  delete from public.supervisor_report_daily_agent_tipifications
  where metric_day = p_day
    and team_id = p_team_id
    and report_agent_key = p_report_agent_key;

  if v_profile_id is null and v_historical_agent_id is null then
    return;
  end if;

  v_from := p_day::timestamptz;
  v_to := (p_day + 1)::timestamptz;

  with
  linked_historical_agents as (
    select ha.id
    from public.historical_agents ha
    where ha.linked_profile_id = v_profile_id
  ),
  tipification_events as (
    select nullif(btrim(c.reason), '') as label
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where l.team_id = p_team_id
      and c.discarded_reason is null
      and c.reason is not null
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= v_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) < v_to
      and (
        (
          v_profile_id is not null
          and (
            (c.agent_id = v_profile_id and c.historical_agent_id is null)
            or c.historical_agent_id in (select id from linked_historical_agents)
          )
        )
        or (
          v_historical_agent_id is not null
          and c.historical_agent_id = v_historical_agent_id
        )
      )
    union all
    -- Solo la interacción sin llamada aporta su resultado: la que acompaña a
    -- una llamada ya está contada por el motivo de esa llamada (y si la llamada
    -- se descartó, no cuenta ninguna de las dos).
    select nullif(btrim(i.result), '') as label
    from public.interactions i
    join public.leads l on l.id = i.lead_id
    where l.team_id = p_team_id
      and i.created_at >= v_from
      and i.created_at < v_to
      and not (i.metadata ? 'call_id')
      and (
        (
          v_profile_id is not null
          and (
            (i.agent_id = v_profile_id and i.historical_agent_id is null)
            or i.historical_agent_id in (select id from linked_historical_agents)
          )
        )
        or (
          v_historical_agent_id is not null
          and i.historical_agent_id = v_historical_agent_id
        )
      )
  )
  insert into public.supervisor_report_daily_agent_tipifications (
    metric_day,
    team_id,
    report_agent_key,
    profile_id,
    historical_agent_id,
    label,
    count,
    refreshed_at
  )
  select
    p_day,
    p_team_id,
    p_report_agent_key,
    v_profile_id,
    v_historical_agent_id,
    label,
    count(*)::int,
    now()
  from tipification_events
  where label is not null
  group by label;
end;
$function$;

create or replace function public.refresh_supervisor_report_tipification_rows(p_day date, p_team_id uuid, p_agent_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_agent_exists boolean;
begin
  if p_day is null or p_team_id is null or p_agent_id is null then
    return;
  end if;

  delete from public.supervisor_report_daily_tipifications
  where metric_day = p_day
    and team_id = p_team_id
    and agent_id = p_agent_id;

  select exists (
    select 1
    from public.profiles p
    where p.id = p_agent_id
      and p.team_id = p_team_id
      and p.role = 'agente'
  )
  into v_agent_exists;

  if not v_agent_exists then
    return;
  end if;

  v_from := p_day::timestamptz;
  v_to := (p_day + 1)::timestamptz;

  with tipification_events as (
    select nullif(btrim(c.reason), '') as label
    from public.calls c
    join public.leads l on l.id = c.lead_id
    where c.agent_id = p_agent_id
      and l.team_id = p_team_id
      and c.discarded_reason is null
      and c.reason is not null
      and coalesce(c.ended_at, c.updated_at, c.created_at) >= v_from
      and coalesce(c.ended_at, c.updated_at, c.created_at) < v_to
    union all
    -- La interacción de una llamada ya está contada por el motivo de la llamada.
    select nullif(btrim(i.result), '') as label
    from public.interactions i
    join public.leads l on l.id = i.lead_id
    where i.agent_id = p_agent_id
      and l.team_id = p_team_id
      and i.created_at >= v_from
      and i.created_at < v_to
      and not (i.metadata ? 'call_id')
  )
  insert into public.supervisor_report_daily_tipifications (
    metric_day,
    team_id,
    agent_id,
    label,
    count,
    refreshed_at
  )
  select
    p_day,
    p_team_id,
    p_agent_id,
    label,
    count(*)::int,
    now()
  from tipification_events
  where label is not null
  group by label;
end;
$function$;
