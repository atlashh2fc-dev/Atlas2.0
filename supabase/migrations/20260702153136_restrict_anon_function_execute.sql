-- Restrict public RPC/function execution to authenticated users.
-- Trigger helpers do not need to be callable from API roles.

revoke all on function public.get_campaign_dashboard_summary(
  uuid,
  timestamp with time zone,
  timestamp with time zone,
  timestamp with time zone,
  timestamp with time zone
) from public, anon;

grant execute on function public.get_campaign_dashboard_summary(
  uuid,
  timestamp with time zone,
  timestamp with time zone,
  timestamp with time zone,
  timestamp with time zone
) to authenticated;

revoke all on function public.get_home_dashboard_summary() from public, anon;
grant execute on function public.get_home_dashboard_summary() to authenticated;

revoke all on function public.search_leads_quick(text) from public, anon;
grant execute on function public.search_leads_quick(text) to authenticated;

revoke all on function public.set_updated_at() from public, anon, authenticated;
