\set ON_ERROR_STOP on

begin transaction read only;

select
  current_database() as database_name,
  current_user as database_user,
  current_setting('server_version') as postgres_version,
  clock_timestamp() at time zone 'UTC' as checked_at_utc;

select version, name
from supabase_migrations.schema_migrations
order by version desc
limit 10;

select 'auth.users' as relation, count(*)::bigint as row_count from auth.users
union all select 'public.profiles', count(*) from public.profiles
union all select 'public.campaigns', count(*) from public.campaigns
union all select 'public.leads', count(*) from public.leads
union all select 'public.calls', count(*) from public.calls
union all select 'public.integration_inbox_items', count(*) from public.integration_inbox_items
union all select 'public.integration_outbox_events', count(*) from public.integration_outbox_events
union all select 'public.integration_dead_letters', count(*) from public.integration_dead_letters
order by relation;

select
  count(*) filter (where profile.id is null) as auth_users_without_profile,
  count(*) filter (where auth_user.id is null) as profiles_without_auth_user
from auth.users auth_user
full join public.profiles profile on profile.id = auth_user.id;

select
  routine.signature,
  has_function_privilege('authenticated', routine.signature, 'execute') as authenticated_execute,
  has_function_privilege('service_role', routine.signature, 'execute') as service_role_execute
from (values
  ('public.sync_atlas_lead_mail_campaign(text,text,text,text,text,uuid,jsonb)'),
  ('public.apply_atlas_lead_mail_result_batch(text,text,jsonb,text,date,text,text,text,text,text,jsonb)')
) as routine(signature);

select
  count(*) filter (where status in ('pending', 'retry')) as integration_pending,
  count(*) filter (where status = 'processing') as integration_processing,
  count(*) filter (where status = 'dead') as integration_dead
from public.integration_inbox_items;

commit;
