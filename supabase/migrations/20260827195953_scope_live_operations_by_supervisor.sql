-- Live operations is not a global directory for supervisors. Preserve the
-- existing return shapes and calculations, but enforce scope inside these
-- SECURITY DEFINER RPCs (an invoker helper relying only on RLS is not enough).

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
set search_path = public
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
    ) as managements_today,
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
  where dc.is_active = true
    and (v_role = 'admin'::public.app_role or dc.campaign_id = any(v_campaign_ids));
end;
$function$;

revoke all on function public.get_queue_health() from public, anon;
grant execute on function public.get_queue_health() to authenticated;

create or replace function public.get_agent_live_status()
returns table (
  profile_id uuid,
  full_name text,
  email text,
  extension text,
  campaign_id uuid,
  campaign_name text,
  phone_status text,
  phone_status_since timestamptz,
  reason_id uuid,
  reason_code text,
  reason_label text,
  is_pause boolean,
  reason_since timestamptz,
  control_command_id uuid,
  control_status text,
  control_requested_at timestamptz,
  control_browser_acknowledged_at timestamptz,
  control_pbx_completed_at timestamptz,
  control_last_error text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_role public.app_role := public.current_role_name();
  v_team_ids uuid[] := '{}';
  v_campaign_ids uuid[] := '{}';
begin
  if auth.uid() is null
     or not coalesce(public.is_current_app_session_valid(), false)
     or coalesce(v_role::text, '') not in ('admin', 'supervisor')
     or not exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.active) then
    raise exception 'get_agent_live_status solo puede ser llamada por admin o supervisor con sesión activa.';
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

  return query
  select p.id, p.full_name, p.email, cred.extension,
         case when v_role = 'admin'::public.app_role or phone.campaign_id = any(v_campaign_ids)
           then phone.campaign_id else null end,
         camp.name, coalesce(phone.status, 'offline'),
         phone.last_state_change_at, reason.id, reason.code, reason.label,
         coalesce(reason.is_pause, false), current_status.since,
         command.id, command.status, command.created_at,
         command.browser_acknowledged_at, command.pbx_completed_at, command.last_error
  from public.profiles p
  join public.agent_sip_credentials cred
    on cred.profile_id = p.id and cred.is_active
  left join lateral (
    -- Keep the actual latest phone status. Filtering this lateral by campaign
    -- would resurrect an older session and present a stale status as current.
    select session.*
    from public.dialer_agent_sessions session
    join public.campaigns active_campaign
      on active_campaign.id = session.campaign_id and active_campaign.is_active
    where session.profile_id = p.id
    order by session.updated_at desc
    limit 1
  ) phone on true
  left join public.campaigns camp on camp.id = phone.campaign_id
    and (v_role = 'admin'::public.app_role or camp.id = any(v_campaign_ids))
  left join public.agent_current_status current_status on current_status.profile_id = p.id
  left join public.agent_status_reasons reason on reason.id = current_status.reason_id
  left join lateral (
    select control.*
    from public.agent_control_commands control
    where control.target_profile_id = p.id
    order by control.created_at desc
    limit 1
  ) command on true
  where p.role = 'agente' and p.active
    and (v_role = 'admin'::public.app_role or p.team_id = any(v_team_ids))
  order by p.full_name;
end;
$function$;

revoke all on function public.get_agent_live_status() from public, anon;
grant execute on function public.get_agent_live_status() to authenticated;
