create or replace function public.integration_v2_health_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'captured_at', now(),
    'inbox', (select jsonb_build_object(
      'pending', count(*) filter (where status = 'pending'),
      'processing', count(*) filter (where status = 'processing'),
      'dead_letter', count(*) filter (where status = 'dead_letter'),
      'oldest_queue_age_seconds', extract(epoch from now() - (min(created_at) filter (where status in ('pending','processing')))),
      'p95_e2e_seconds', percentile_cont(0.95) within group (
        order by extract(epoch from processed_at - created_at)
      ) filter (where status = 'succeeded' and processed_at is not null and created_at >= now() - interval '24 hours')
    ) from public.integration_inbox_items),
    'outbox', (select jsonb_build_object(
      'pending', count(*) filter (where status = 'pending'),
      'processing', count(*) filter (where status = 'processing'),
      'dead_letter', count(*) filter (where status = 'dead_letter'),
      'oldest_queue_age_seconds', extract(epoch from now() - (min(created_at) filter (where status in ('pending','processing')))),
      'p95_e2e_seconds', percentile_cont(0.95) within group (
        order by extract(epoch from delivered_at - created_at)
      ) filter (where status = 'delivered' and delivered_at is not null and created_at >= now() - interval '24 hours')
    ) from public.integration_outbox_events),
    'dlq', (select jsonb_build_object(
      'total', count(*), 'last_24h', count(*) filter (where failed_at >= now() - interval '24 hours')
    ) from public.integration_dead_letters),
    'customer360', (select jsonb_build_object(
      'external_refs', count(*),
      'observed_last_24h', count(*) filter (where last_seen_at >= now() - interval '24 hours'),
      'historical_over_24h', count(*) filter (where last_seen_at < now() - interval '24 hours')
    ) from public.lead_external_refs),
    'circuits', (select coalesce(jsonb_agg(jsonb_build_object(
      'destination', s.code, 'state', c.state, 'consecutive_failures', c.consecutive_failures,
      'opened_until', c.opened_until, 'last_success_at', c.last_success_at,
      'last_failure_at', c.last_failure_at
    ) order by s.code), '[]'::jsonb)
      from public.integration_circuit_states c
      join public.integration_sources s on s.id = c.destination_source_id),
    'canary', (select coalesce(to_jsonb(c), '{}'::jsonb) from (
      select status, latency_ms, created_at from public.integration_canary_runs
      order by created_at desc limit 1
    ) c)
  );
$$;

revoke all on function public.integration_v2_health_snapshot() from public, anon, authenticated;
grant execute on function public.integration_v2_health_snapshot() to service_role;
