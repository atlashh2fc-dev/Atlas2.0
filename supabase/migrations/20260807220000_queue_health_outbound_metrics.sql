-- Métricas outbound en el monitor en vivo.
--
-- El monitor solo veía el discado (intentos, contestadas, abandono) y no lo que
-- pasa después: cuántas gestiones se cerraron, en cuántas se habló de verdad y
-- cuántas terminaron en venta. Sin eso no se puede leer contactabilidad ni
-- intentos por contacto durante el turno, que es cuando sirven para corregir.
--
-- Además se corrige el corte del día: `current_date` se evalúa en la zona de la
-- sesión (UTC en Supabase), así que "hoy" empezaba a las 20:00 hora de Chile del
-- día anterior y el turno arrancaba con cifras de la tarde previa.
drop function if exists public.get_queue_health();

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
  v_day_start timestamptz :=
    date_trunc('day', now() at time zone 'America/Santiago') at time zone 'America/Santiago';
begin
  if coalesce(current_role_name()::text, '') not in ('admin', 'supervisor') then
    raise exception 'get_queue_health solo puede ser llamada por admin o supervisor.';
  end if;

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
    -- Gestiones cerradas: es el trabajo del ejecutivo, no del marcador.
    (
      select count(*)::int
      from public.calls c
      join public.leads l on l.id = c.lead_id
      where l.campaign_id = dc.campaign_id
        and c.ended_at is not null
        and c.ended_at >= v_day_start
    ) as managements_today,
    -- Contacto efectivo: se habló con la persona, que es el denominador real
    -- de la conversión en outbound.
    (
      select count(*)::int
      from public.calls c
      join public.leads l on l.id = c.lead_id
      where l.campaign_id = dc.campaign_id
        and c.ended_at is not null
        and c.ended_at >= v_day_start
        and c.status = 'connected'
    ) as effective_contacts_today,
    (
      select count(*)::int
      from public.calls c
      join public.leads l on l.id = c.lead_id
      where l.campaign_id = dc.campaign_id
        and c.ended_at is not null
        and c.ended_at >= v_day_start
        and c.outcome = 'sale'
    ) as sales_today
  from public.dialer_campaign_configs dc
  join public.campaigns camp on camp.id = dc.campaign_id
  where dc.is_active = true;
end;
$function$;

revoke all on function public.get_queue_health() from public;
revoke all on function public.get_queue_health() from anon;
grant execute on function public.get_queue_health() to authenticated;
