create or replace function public.get_home_dashboard_summary()
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with
  bounds as (
    select date_trunc('day', now()) + interval '1 day' - interval '1 millisecond' as end_of_today
  ),
  stats as (
    select
      count(*)::int as total,
      count(*) filter (where status = 'en_gestion')::int as en_gestion,
      count(*) filter (where status = 'convertido')::int as convertidos
    from public.leads
  ),
  recent as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'result', r.result,
          'created_at', r.created_at,
          'lead_name', coalesce(l.full_name, 'Lead')
        )
        order by r.created_at desc
      ),
      '[]'::jsonb
    ) as data
    from (
      select id, lead_id, result, created_at
      from public.interactions
      order by created_at desc
      limit 5
    ) r
    left join public.leads l on l.id = r.lead_id
  ),
  agenda as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'full_name', a.full_name,
          'rut', a.rut,
          'phone', a.phone,
          'next_action_at', a.next_action_at
        )
        order by a.next_action_at
      ),
      '[]'::jsonb
    ) as data
    from (
      select l.id, l.full_name, l.rut, l.phone, l.next_action_at
      from public.leads l, bounds b
      where l.managed_by = (select auth.uid())
        and l.next_action_at is not null
        and l.next_action_at <= b.end_of_today
      order by l.next_action_at
      limit 20
    ) a
  )
  select jsonb_build_object(
    'stats', jsonb_build_object(
      'total', stats.total,
      'enGestion', stats.en_gestion,
      'convertidos', stats.convertidos
    ),
    'recent', recent.data,
    'agenda', agenda.data
  )
  from stats
  cross join recent
  cross join agenda;
$function$;

grant execute on function public.get_home_dashboard_summary()
  to authenticated;;
