-- Administration monitors queue metadata; it is not a customer-attention role.
create or replace function public.set_my_agent_current_status(p_reason_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is null or public.current_role_name() is distinct from 'agente'::public.app_role
     or not coalesce(public.is_current_app_session_valid(), false) then
    raise exception 'Solo un ejecutivo con sesión activa puede cambiar su disponibilidad.';
  end if;
  if not exists (
    select 1 from public.agent_status_reasons reason
    where reason.id = p_reason_id and reason.is_active and not reason.is_system
  ) then
    raise exception 'El motivo seleccionado no esta disponible.';
  end if;
  if exists (
    select 1
    from public.agent_current_status current_status
    join public.agent_status_reasons reason on reason.id = current_status.reason_id
    where current_status.profile_id = v_actor_id and reason.code = 'llamada_manual'
  ) then
    raise exception 'Finaliza o cancela el modo de llamada manual desde el telefono Atlas.';
  end if;

  insert into public.agent_current_status (profile_id, reason_id, since, last_heartbeat_at)
  values (v_actor_id, p_reason_id, now(), now())
  on conflict (profile_id) do update
    set reason_id = excluded.reason_id,
        since = case
          when public.agent_current_status.reason_id = excluded.reason_id
            then public.agent_current_status.since
          else excluded.since
        end,
        last_heartbeat_at = excluded.last_heartbeat_at,
        updated_at = now();
end;
$function$;

create or replace function public.mark_my_agent_logged_out()
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_reason_id uuid;
begin
  if v_actor_id is null or public.current_role_name() is distinct from 'agente'::public.app_role
     or not coalesce(public.is_current_app_session_valid(), false) then return; end if;
  select id into v_reason_id from public.agent_status_reasons
  where code = 'desconectado' and is_active;
  if v_reason_id is null then return; end if;

  insert into public.agent_current_status (profile_id, reason_id, since, last_heartbeat_at)
  values (v_actor_id, v_reason_id, now(), now())
  on conflict (profile_id) do update
    set reason_id = excluded.reason_id,
        since = excluded.since,
        last_heartbeat_at = excluded.last_heartbeat_at,
        updated_at = now();
end;
$function$;


-- Restrictive policies intersect existing campaign/team scope instead of widening it.
revoke all on function public.set_my_agent_current_status(uuid) from public, anon;
revoke all on function public.mark_my_agent_logged_out() from public, anon;
grant execute on function public.set_my_agent_current_status(uuid) to authenticated;
grant execute on function public.mark_my_agent_logged_out() to authenticated;
-- Service-role webhook/Mercury ingestion and aggregate queue metrics remain intact.
create table public.whatsapp_automation_changes (
  id uuid primary key default gen_random_uuid(),
  change_id uuid not null,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  actor_role public.app_role not null,
  scope text not null check (scope in ('all_campaigns', 'supervised_campaigns')),
  previous_enabled boolean not null,
  enabled boolean not null,
  created_at timestamptz not null default now()
);
create index whatsapp_automation_changes_campaign_created_idx
  on public.whatsapp_automation_changes(campaign_id, created_at desc);
create index whatsapp_automation_changes_actor_idx on public.whatsapp_automation_changes(actor_id);
alter table public.whatsapp_automation_changes enable row level security;
revoke all on public.whatsapp_automation_changes from public, anon, authenticated;
grant select on public.whatsapp_automation_changes to authenticated;
grant all on public.whatsapp_automation_changes to service_role;
create policy whatsapp_automation_changes_select
on public.whatsapp_automation_changes for select to authenticated
using (
  (select public.current_role_name()) in ('admin'::public.app_role, 'supervisor'::public.app_role)
  and public.can_access_whatsapp_campaign(campaign_id, null)
);

-- The elevated transaction is private, checks the live session/role itself,
-- and accepts only a boolean. No caller-supplied scope or actor is trusted.
create schema if not exists private;
grant usage on schema private to authenticated;
create or replace function private.set_whatsapp_automation_enabled(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role := public.current_role_name();
  v_change_id uuid := gen_random_uuid();
  v_config record;
  v_count integer := 0;
begin
  if v_actor is null or v_role is null or not coalesce(public.is_current_app_session_valid(), false)
     or v_role not in ('admin'::public.app_role, 'supervisor'::public.app_role) then
    raise exception 'whatsapp_automation_access_denied';
  end if;
  if p_enabled is null then raise exception 'whatsapp_automation_mode_required'; end if;

  -- Visibility of a shared campaign is not authority to change automation for
  -- another supervisor's agents. Reject the entire general change, not a
  -- silent partial subset that would contradict the scope preview.
  if v_role = 'supervisor'::public.app_role and exists (
    select 1 from public.whatsapp_ai_configs config
    where public.can_access_whatsapp_campaign(config.campaign_id, null)
      and (
        exists (
          select 1 from public.campaign_agents membership
          join public.profiles agent on agent.id = membership.profile_id
          where membership.campaign_id = config.campaign_id and agent.active
            and agent.role = 'agente'::public.app_role
            and (agent.team_id is null or agent.team_id <> all(public.supervised_team_ids()))
        ) or exists (
          select 1 from public.contact_center_queue_sources source
          join public.contact_center_queue_members member on member.queue_id = source.queue_id
          join public.profiles agent on agent.id = member.profile_id
          where source.campaign_id = config.campaign_id and source.is_active
            and member.is_active and agent.active and agent.role = 'agente'::public.app_role
            and (agent.team_id is null or agent.team_id <> all(public.supervised_team_ids()))
        )
      )
  ) then
    raise exception 'Hay campañas compartidas con equipos fuera de tu alcance. Solicita el cambio general a un administrador.';
  end if;

  for v_config in
    select config.id, config.campaign_id, config.enabled
    from public.whatsapp_ai_configs config
    where public.can_access_whatsapp_campaign(config.campaign_id, null)
    order by config.id
    for update
  loop
    update public.whatsapp_ai_configs set enabled = p_enabled where id = v_config.id;
    insert into public.whatsapp_automation_changes (
      change_id, campaign_id, actor_id, actor_role, scope, previous_enabled, enabled
    ) values (
      v_change_id, v_config.campaign_id, v_actor, v_role,
      case when v_role = 'admin'::public.app_role then 'all_campaigns' else 'supervised_campaigns' end,
      v_config.enabled, p_enabled
    );
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception 'No hay campañas WhatsApp configuradas en tu alcance.'; end if;
  return jsonb_build_object('change_id', v_change_id, 'campaign_count', v_count, 'enabled', p_enabled);
end;
$$;
revoke all on function private.set_whatsapp_automation_enabled(boolean) from public, anon;
grant execute on function private.set_whatsapp_automation_enabled(boolean) to authenticated;

create or replace function public.set_whatsapp_automation_enabled(p_enabled boolean)
returns jsonb
language sql
security invoker
set search_path = pg_catalog
as $$ select private.set_whatsapp_automation_enabled(p_enabled); $$;
revoke all on function public.set_whatsapp_automation_enabled(boolean) from public, anon;
grant execute on function public.set_whatsapp_automation_enabled(boolean) to authenticated;

-- Queue lookup is private and elevated only to avoid recursive queue-member
-- policies. Its result is always derived from the current live session.
create or replace function private.can_view_contact_center_queue(p_queue_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and coalesce(public.is_current_app_session_valid(), false)
    and case public.current_role_name()
      when 'admin'::public.app_role then true
      when 'agente'::public.app_role then exists (
        select 1 from public.contact_center_queue_members member
        where member.queue_id = p_queue_id and member.profile_id = auth.uid() and member.is_active
      )
      when 'supervisor'::public.app_role then (
        exists (
          select 1 from public.contact_center_queue_members member
          join public.profiles profile on profile.id = member.profile_id
          where member.queue_id = p_queue_id and member.is_active and profile.active
            and profile.team_id = any(public.supervised_team_ids())
        ) or exists (
          select 1 from public.contact_center_queue_sources source
          where source.queue_id = p_queue_id and source.is_active
            and public.can_access_whatsapp_campaign(source.campaign_id, null)
        )
      )
      else false
    end;
$$;
revoke all on function private.can_view_contact_center_queue(uuid) from public, anon;
grant execute on function private.can_view_contact_center_queue(uuid) to authenticated;

create policy contact_center_queues_workspace_scope
on public.contact_center_queues as restrictive for select to authenticated
using (private.can_view_contact_center_queue(id));
create policy contact_center_sources_workspace_scope
on public.contact_center_queue_sources as restrictive for select to authenticated
using (private.can_view_contact_center_queue(queue_id));
create policy contact_center_members_workspace_scope
on public.contact_center_queue_members as restrictive for select to authenticated
using (
  private.can_view_contact_center_queue(queue_id)
  and (
    (select public.current_role_name()) = 'admin'::public.app_role
    or profile_id = (select auth.uid())
    or (
      (select public.current_role_name()) = 'supervisor'::public.app_role
      and exists (
        select 1 from public.profiles agent where agent.id = profile_id
          and agent.team_id = any(public.supervised_team_ids())
      )
    )
  )
);
-- Existing permissive policies admitted admin/supervisor only. The executive
-- may read their own queue metadata without inheriting the member directory.
create policy contact_center_queues_agent_select on public.contact_center_queues for select to authenticated
using ((select public.current_role_name()) = 'agente'::public.app_role);
create policy contact_center_sources_agent_select on public.contact_center_queue_sources for select to authenticated
using ((select public.current_role_name()) = 'agente'::public.app_role);
create policy contact_center_members_agent_select on public.contact_center_queue_members for select to authenticated
using ((select public.current_role_name()) = 'agente'::public.app_role and profile_id = (select auth.uid()));

create policy whatsapp_messages_workspace_content
on public.whatsapp_messages as restrictive for select to authenticated
using (
  (select public.current_role_name()) in ('agente'::public.app_role, 'supervisor'::public.app_role)
  and exists (
    select 1 from public.whatsapp_conversations conversation
    where conversation.id = whatsapp_messages.conversation_id
      and (
        (select public.current_role_name()) = 'supervisor'::public.app_role
        or conversation.assigned_to = (select auth.uid())
      )
  )
);

create policy whatsapp_events_workspace_content
on public.whatsapp_conversation_events as restrictive for select to authenticated
using (
  (select public.current_role_name()) in ('agente'::public.app_role, 'supervisor'::public.app_role)
  and exists (
    select 1 from public.whatsapp_conversations conversation
    where conversation.id = whatsapp_conversation_events.conversation_id
      and (
        (select public.current_role_name()) = 'supervisor'::public.app_role
        or conversation.assigned_to = (select auth.uid())
      )
  )
);

-- Clients may never write customer content or attention state directly. Mutations
-- are authorized by server actions (assigned, active agent) before service-role use.
revoke insert, update, delete on public.whatsapp_messages from anon, authenticated;
revoke insert, update, delete on public.whatsapp_conversation_events from anon, authenticated;
revoke insert, update, delete on public.whatsapp_conversations from anon, authenticated;
revoke all on public.whatsapp_media_uploads from anon, authenticated;

create policy interactions_attention_insert
on public.interactions as restrictive for insert to authenticated
with check (
  (select public.current_role_name()) = 'agente'::public.app_role
  and agent_id = (select auth.uid())
  and exists (
    select 1 from public.leads lead
    where lead.id = interactions.lead_id
      and (lead.assigned_to = (select auth.uid()) or lead.managed_by = (select auth.uid()))
  )
);

create policy agent_status_attention_insert
on public.agent_current_status as restrictive for insert to authenticated
with check (
  (select public.current_role_name()) = 'agente'::public.app_role
  and profile_id = (select auth.uid())
);

create policy agent_status_attention_update
on public.agent_current_status as restrictive for update to authenticated
using (
  (select public.current_role_name()) = 'agente'::public.app_role
  and profile_id = (select auth.uid())
)
with check (
  (select public.current_role_name()) = 'agente'::public.app_role
  and profile_id = (select auth.uid())
);

create policy agent_sip_attention_select
on public.agent_sip_credentials as restrictive for select to authenticated
using (
  (select public.current_role_name()) = 'agente'::public.app_role
  and profile_id = (select auth.uid())
);

comment on policy whatsapp_messages_workspace_content on public.whatsapp_messages is
  'Content: assigned agent or campaign-scoped supervisor. Admin sees operational metadata only.';
comment on policy whatsapp_events_workspace_content on public.whatsapp_conversation_events is
  'Events can contain customer notes; administration does not inherit content access.';

create or replace function public.get_contact_center_queue_control(
  p_queue_id uuid,
  p_from timestamptz default now() - interval '30 days'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.app_role := public.current_role_name();
  v_result jsonb;
begin
  if v_role is null
     or v_role not in ('admin'::public.app_role, 'supervisor'::public.app_role) then
    raise exception 'queue_control_access_denied';
  end if;

  -- Supervisors must oversee an active queue member or source campaign.
  if v_role = 'supervisor'::public.app_role and not (
    exists (
      select 1
      from public.contact_center_queue_members member
      join public.profiles profile on profile.id = member.profile_id
      where member.queue_id = p_queue_id
        and member.is_active and profile.active
        and profile.team_id = any(public.supervised_team_ids())
    ) or exists (
      select 1 from public.contact_center_queue_sources source
      where source.queue_id = p_queue_id and source.is_active
        and public.can_access_whatsapp_campaign(source.campaign_id, null)
    )
  ) then
    raise exception 'queue_control_access_denied';
  end if;

  with
  queue_metrics as (
    select
      count(*) filter (where status in ('open', 'pending'))::integer as active,
      count(*) filter (where status = 'open')::integer as open,
      count(*) filter (where status = 'pending')::integer as pending,
      count(*) filter (where status = 'closed')::integer as closed,
      count(*) filter (where status in ('open', 'pending') and assigned_to is null)::integer as unassigned,
      count(*) filter (where status in ('open', 'pending') and unread_count > 0)::integer as unread,
      count(*) filter (where status in ('open', 'pending') and ai_state = 'handoff')::integer as handoff
    from public.whatsapp_conversations where queue_id = p_queue_id
  ),
  period_conversations as (
    select
      count(*) filter (where created_at >= p_from)::integer as offered,
      count(*) filter (where closed_at >= p_from)::integer as closed,
      avg(extract(epoch from (closed_at - created_at)))
        filter (where closed_at >= p_from and closed_at >= created_at) as avg_handle_seconds
    from public.whatsapp_conversations where queue_id = p_queue_id
  ),
  period_messages as (
    select
      count(*) filter (where message.direction = 'inbound')::integer as inbound_messages,
      count(*) filter (where message.direction = 'outbound')::integer as outbound_messages
    from public.whatsapp_messages message
    join public.whatsapp_conversations conversation on conversation.id = message.conversation_id
    where conversation.queue_id = p_queue_id and message.created_at >= p_from
  ),
  first_inbound as (
    select conversation.id, min(coalesce(message.provider_timestamp, message.created_at)) as at
    from public.whatsapp_conversations conversation
    join public.whatsapp_messages message on message.conversation_id = conversation.id
    where conversation.queue_id = p_queue_id
      and message.direction = 'inbound'
      and message.created_at >= p_from
    group by conversation.id
  ),
  first_response as (
    select inbound.id, inbound.at,
      min(coalesce(message.provider_timestamp, message.created_at)) as response_at
    from first_inbound inbound
    join public.whatsapp_messages message
      on message.conversation_id = inbound.id
     and message.direction = 'outbound'
     and coalesce(message.provider_timestamp, message.created_at) >= inbound.at
    group by inbound.id, inbound.at
  ),
  response_metric as (
    select avg(extract(epoch from (response_at - at))) as avg_answer_seconds from first_response
  ),
  member_rows as (
    select member.profile_id, profile.full_name, profile.active,
      count(conversation.id) filter (where conversation.status in ('open', 'pending'))::integer as active_interactions,
      count(conversation.id) filter (where conversation.status in ('open', 'pending') and conversation.unread_count > 0)::integer as unread,
      count(conversation.id) filter (where conversation.status in ('open', 'pending') and conversation.ai_state = 'handoff')::integer as handoffs,
      count(conversation.id) filter (where conversation.closed_at >= p_from)::integer as closed_in_period,
      max(conversation.last_message_at) filter (where conversation.status in ('open', 'pending')) as last_activity_at
    from public.contact_center_queue_members member
    join public.profiles profile on profile.id = member.profile_id
    left join public.whatsapp_conversations conversation
      on conversation.queue_id = member.queue_id and conversation.assigned_to = member.profile_id
    where member.queue_id = p_queue_id and member.is_active
    group by member.profile_id, profile.full_name, profile.active, member.joined_at
    order by count(conversation.id) filter (where conversation.status in ('open', 'pending')),
      member.joined_at, profile.full_name
  ),
  members as (select coalesce(jsonb_agg(to_jsonb(member_rows)), '[]'::jsonb) value from member_rows),
  closure_rows as (
    select reason.id, reason.label, count(conversation.id)::integer as total
    from public.whatsapp_closure_reasons reason
    join public.contact_center_queue_sources source on source.campaign_id = reason.campaign_id
    left join public.whatsapp_conversations conversation
      on conversation.queue_id = source.queue_id
     and conversation.close_reason_id = reason.id
     and conversation.closed_at >= p_from
    where source.queue_id = p_queue_id and reason.is_active
    group by reason.id, reason.label, reason.sort_order
    order by count(conversation.id) desc, reason.sort_order, reason.label
  ),
  closures as (select coalesce(jsonb_agg(to_jsonb(closure_rows)), '[]'::jsonb) value from closure_rows)
  select jsonb_build_object(
    'queue', to_jsonb(queue_metrics),
    'period', to_jsonb(period_conversations) || to_jsonb(period_messages) || to_jsonb(response_metric),
    'members', members.value,
    'closures', closures.value
  ) into v_result
  from queue_metrics, period_conversations, period_messages, response_metric, members, closures;

  return v_result;
end;
$$;
