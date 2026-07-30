-- Misma corrección de guarda NULL-insegura en el reporte de métricas de
-- llamadas (ver 20260730041934_harden_report_function_role_guard.sql).
create or replace function public.get_call_metrics_report(
  p_date_from date,
  p_date_to date,
  p_campaign_id uuid default null::uuid
)
returns table(
  report_date date,
  campaign_id uuid,
  campaign_name text,
  total_attempts integer,
  answered integer,
  completed integer,
  no_answer integer,
  busy integer,
  failed integer,
  abandoned integer,
  voicemail integer,
  avg_ring_seconds numeric,
  avg_talk_seconds numeric,
  abandonment_rate numeric,
  service_level_20s numeric
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(current_role_name()::text, '') not in ('admin', 'supervisor') then
    raise exception 'get_call_metrics_report solo puede ser llamada por admin o supervisor.';
  end if;

  return query
  select
    (da.originated_at at time zone 'utc')::date as report_date,
    da.campaign_id,
    camp.name as campaign_name,
    count(*)::int as total_attempts,
    count(*) filter (where da.status in ('answered', 'bridged', 'completed'))::int as answered,
    count(*) filter (where da.status = 'completed')::int as completed,
    count(*) filter (where da.status = 'no_answer')::int as no_answer,
    count(*) filter (where da.status = 'busy')::int as busy,
    count(*) filter (where da.status = 'failed')::int as failed,
    count(*) filter (where da.status = 'abandoned')::int as abandoned,
    count(*) filter (where da.status = 'voicemail')::int as voicemail,
    round(avg(extract(epoch from (da.answered_at - da.originated_at))) filter (where da.answered_at is not null), 1) as avg_ring_seconds,
    round(avg(extract(epoch from (da.ended_at - da.bridged_at))) filter (where da.bridged_at is not null and da.ended_at is not null), 1) as avg_talk_seconds,
    round(
      100.0 * count(*) filter (where da.status = 'abandoned')
      / nullif(count(*) filter (where da.answered_at is not null), 0),
      1
    ) as abandonment_rate,
    round(
      100.0 * count(*) filter (where da.answered_at is not null and da.answered_at - da.originated_at <= interval '20 seconds')
      / nullif(count(*) filter (where da.answered_at is not null), 0),
      1
    ) as service_level_20s
  from public.dial_attempts da
  join public.campaigns camp on camp.id = da.campaign_id
  where da.originated_at is not null
    and da.originated_at >= p_date_from
    and da.originated_at < (p_date_to + 1)
    and (p_campaign_id is null or da.campaign_id = p_campaign_id)
  group by report_date, da.campaign_id, camp.name
  order by report_date, campaign_name;
end;
$function$;

revoke execute on function public.get_call_metrics_report(date, date, uuid) from public, anon;
grant execute on function public.get_call_metrics_report(date, date, uuid) to authenticated, service_role;
