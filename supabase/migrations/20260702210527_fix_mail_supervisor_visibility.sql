-- Supervisors must operate the Equifax mail container even before those leads
-- are assigned to a team. The mail imports land with leads.team_id = null, so
-- team-based RLS makes the dashboard look empty unless the mail RPCs own the
-- access contract explicitly.

drop policy if exists mail_campaigns_select on public.mail_campaigns;
create policy mail_campaigns_select
on public.mail_campaigns
for select
to authenticated
using (
  public.request_is_service_role()
  or (select public.current_role_name()) = 'admin'::public.app_role
  or (
    (select public.current_role_name()) = 'supervisor'::public.app_role
    and umbrella_key = 'equifax'
  )
  or public.can_manage_campaign(campaign_id)
);

create or replace function public.get_mail_engagement_queue(
  p_mail_campaign_id uuid default null,
  p_campaign_id uuid default null,
  p_limit integer default 1000,
  p_offset integer default 0
)
returns table (
  mail_campaign_id uuid,
  mail_campaign_name text,
  campaign_id uuid,
  campaign_name text,
  lead_id uuid,
  full_name text,
  rut text,
  phone text,
  email text,
  assigned_to uuid,
  assigned_to_name text,
  team_id uuid,
  opened boolean,
  clicked boolean,
  last_event_at timestamptz,
  priority_rank integer,
  priority_reason text
)
language sql
security definer
set search_path = public
as $$
  with access_check as (
    select
      public.request_is_service_role() as is_service,
      coalesce((select public.current_role_name())::text, '') as actor_role
  ),
  engagement as (
    select
      b.mail_campaign_id,
      b.campaign_id,
      r.lead_id,
      bool_or(r.opened) as opened,
      bool_or(r.clicked) as clicked,
      max(r.created_at) as last_event_at,
      min(case when r.clicked then 10 when r.opened then 20 else 70 end) as priority_rank
    from public.mail_result_contacts r
    join public.mail_result_batches b on b.id = r.batch_id
    left join public.mail_campaigns mc on mc.id = b.mail_campaign_id
    cross join access_check ac
    where r.lead_id is not null
      and (r.opened or r.clicked)
      and (ac.is_service or ac.actor_role in ('admin', 'supervisor'))
      and (ac.is_service or ac.actor_role <> 'supervisor' or mc.umbrella_key = 'equifax')
      and (p_mail_campaign_id is null or b.mail_campaign_id = p_mail_campaign_id)
      and (p_campaign_id is null or b.campaign_id = p_campaign_id)
    group by b.mail_campaign_id, b.campaign_id, r.lead_id
  )
  select
    e.mail_campaign_id,
    coalesce(mc.name, c.name) as mail_campaign_name,
    e.campaign_id,
    c.name as campaign_name,
    l.id as lead_id,
    l.full_name,
    l.rut,
    l.phone,
    l.email,
    l.assigned_to,
    p.full_name as assigned_to_name,
    l.team_id,
    e.opened,
    e.clicked,
    e.last_event_at,
    e.priority_rank,
    case
      when e.clicked then 'Click detectado en campana mail'
      when e.opened then 'Apertura detectada en campana mail'
      else 'Senal mail'
    end as priority_reason
  from engagement e
  join public.leads l on l.id = e.lead_id
  join public.campaigns c on c.id = e.campaign_id
  left join public.mail_campaigns mc on mc.id = e.mail_campaign_id
  left join public.profiles p on p.id = l.assigned_to
  order by e.priority_rank asc, e.last_event_at desc, l.full_name
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.get_mail_engagement_queue(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.get_mail_engagement_queue(uuid, uuid, integer, integer) to authenticated, service_role;

create or replace function public.get_mail_engagement_report(
  p_mail_campaign_id uuid default null,
  p_campaign_id uuid default null
)
returns table (
  mail_campaign_id uuid,
  mail_campaign_name text,
  campaign_id uuid,
  campaign_name text,
  sent_leads integer,
  delivered_leads integer,
  opened_leads integer,
  clicked_leads integer,
  hot_leads integer,
  assigned_hot_leads integer,
  managed_hot_leads integer,
  last_event_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with access_check as (
    select
      public.request_is_service_role() as is_service,
      coalesce((select public.current_role_name())::text, '') as actor_role
  ),
  per_lead as (
    select
      b.mail_campaign_id,
      b.campaign_id,
      r.lead_id,
      bool_or(r.sent) as sent,
      bool_or(r.delivered) as delivered,
      bool_or(r.opened) as opened,
      bool_or(r.clicked) as clicked,
      max(r.created_at) as last_event_at
    from public.mail_result_contacts r
    join public.mail_result_batches b on b.id = r.batch_id
    left join public.mail_campaigns mc on mc.id = b.mail_campaign_id
    cross join access_check ac
    where r.lead_id is not null
      and (ac.is_service or ac.actor_role in ('admin', 'supervisor'))
      and (ac.is_service or ac.actor_role <> 'supervisor' or mc.umbrella_key = 'equifax')
      and (p_mail_campaign_id is null or b.mail_campaign_id = p_mail_campaign_id)
      and (p_campaign_id is null or b.campaign_id = p_campaign_id)
    group by b.mail_campaign_id, b.campaign_id, r.lead_id
  )
  select
    pl.mail_campaign_id,
    coalesce(mc.name, c.name) as mail_campaign_name,
    pl.campaign_id,
    c.name as campaign_name,
    count(*) filter (where pl.sent)::integer as sent_leads,
    count(*) filter (where pl.delivered)::integer as delivered_leads,
    count(*) filter (where pl.opened)::integer as opened_leads,
    count(*) filter (where pl.clicked)::integer as clicked_leads,
    count(*) filter (where pl.opened or pl.clicked)::integer as hot_leads,
    count(*) filter (where (pl.opened or pl.clicked) and l.assigned_to is not null)::integer as assigned_hot_leads,
    count(*) filter (
      where (pl.opened or pl.clicked)
        and (l.assignment_status = 'managed' or l.workflow_status = 'managed')
    )::integer as managed_hot_leads,
    max(pl.last_event_at) as last_event_at
  from per_lead pl
  join public.leads l on l.id = pl.lead_id
  join public.campaigns c on c.id = pl.campaign_id
  left join public.mail_campaigns mc on mc.id = pl.mail_campaign_id
  group by pl.mail_campaign_id, coalesce(mc.name, c.name), pl.campaign_id, c.name
  order by max(pl.last_event_at) desc nulls last, coalesce(mc.name, c.name);
$$;

revoke all on function public.get_mail_engagement_report(uuid, uuid) from public, anon;
grant execute on function public.get_mail_engagement_report(uuid, uuid) to authenticated, service_role;

create or replace function public.get_mail_agent_control_summary(
  p_mail_campaign_id uuid default null,
  p_campaign_id uuid default null
)
returns table (
  agent_id uuid,
  agent_name text,
  assigned_leads integer,
  clicked_leads integer,
  opened_only_leads integer,
  uncontacted_leads integer,
  clicked_uncontacted_leads integer,
  contacted_leads integer,
  interactions integer,
  agendas integer,
  pending_agendas integer,
  overdue_agendas integer,
  no_next_action_leads integer,
  next_agenda_at timestamptz,
  last_interaction_at timestamptz,
  last_event_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with access_check as (
    select
      public.request_is_service_role() as is_service,
      coalesce((select public.current_role_name())::text, '') as actor_role
  ),
  engagement as (
    select
      b.mail_campaign_id,
      b.campaign_id,
      r.lead_id,
      bool_or(r.opened) as opened,
      bool_or(r.clicked) as clicked,
      max(r.created_at) as last_event_at
    from public.mail_result_contacts r
    join public.mail_result_batches b on b.id = r.batch_id
    left join public.mail_campaigns mc on mc.id = b.mail_campaign_id
    cross join access_check ac
    where r.lead_id is not null
      and (r.opened or r.clicked)
      and (ac.is_service or ac.actor_role in ('admin', 'supervisor'))
      and (ac.is_service or ac.actor_role <> 'supervisor' or mc.umbrella_key = 'equifax')
      and (p_mail_campaign_id is null or b.mail_campaign_id = p_mail_campaign_id)
      and (p_campaign_id is null or b.campaign_id = p_campaign_id)
    group by b.mail_campaign_id, b.campaign_id, r.lead_id
  ),
  assigned as (
    select
      e.mail_campaign_id,
      e.campaign_id,
      e.lead_id,
      e.opened,
      e.clicked,
      e.last_event_at,
      l.assigned_to as agent_id,
      l.next_action_at,
      p.full_name as agent_name
    from engagement e
    join public.leads l on l.id = e.lead_id
    join public.profiles p on p.id = l.assigned_to
    where l.assigned_to is not null
  ),
  interaction_counts as (
    select
      a.agent_id,
      a.lead_id,
      count(i.id)::integer as interaction_count,
      max(i.created_at) as last_interaction_at
    from assigned a
    left join public.interactions i
      on i.lead_id = a.lead_id
     and i.agent_id = a.agent_id
    group by a.agent_id, a.lead_id
  )
  select
    a.agent_id,
    max(a.agent_name) as agent_name,
    count(*)::integer as assigned_leads,
    count(*) filter (where a.clicked)::integer as clicked_leads,
    count(*) filter (where a.opened and not a.clicked)::integer as opened_only_leads,
    count(*) filter (where coalesce(ic.interaction_count, 0) = 0)::integer as uncontacted_leads,
    count(*) filter (where a.clicked and coalesce(ic.interaction_count, 0) = 0)::integer as clicked_uncontacted_leads,
    count(*) filter (where coalesce(ic.interaction_count, 0) > 0)::integer as contacted_leads,
    coalesce(sum(ic.interaction_count), 0)::integer as interactions,
    count(*) filter (where a.next_action_at is not null)::integer as agendas,
    count(*) filter (where a.next_action_at is not null and a.next_action_at > now())::integer as pending_agendas,
    count(*) filter (where a.next_action_at is not null and a.next_action_at <= now())::integer as overdue_agendas,
    count(*) filter (where a.next_action_at is null)::integer as no_next_action_leads,
    min(a.next_action_at) filter (where a.next_action_at is not null) as next_agenda_at,
    max(ic.last_interaction_at) as last_interaction_at,
    max(a.last_event_at) as last_event_at
  from assigned a
  left join interaction_counts ic
    on ic.agent_id = a.agent_id
   and ic.lead_id = a.lead_id
  group by a.agent_id
  order by
    count(*) filter (where a.next_action_at is not null and a.next_action_at <= now()) desc,
    count(*) filter (where a.clicked) desc,
    count(*) desc,
    max(a.agent_name);
$$;

revoke all on function public.get_mail_agent_control_summary(uuid, uuid) from public, anon;
grant execute on function public.get_mail_agent_control_summary(uuid, uuid) to authenticated, service_role;

create or replace function public.assign_lead(
  p_lead_id uuid,
  p_agent_id uuid default null,
  p_reason text default null,
  p_source text default 'manual',
  p_set_managed_by boolean default false,
  p_next_action_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_role text := coalesce((select public.current_role_name())::text, '');
  v_actor_team_id uuid := (select public.current_team_id());
  v_now timestamptz := now();
  v_lead public.leads%rowtype;
  v_agent public.profiles%rowtype;
  v_old_assigned_to uuid;
  v_effective_team_id uuid;
  v_source text := coalesce(nullif(btrim(p_source), ''), 'manual');
  v_is_mail_engagement boolean := false;
begin
  if v_actor_id is null then
    raise exception 'No autenticado.';
  end if;

  if v_role not in ('admin', 'supervisor') then
    raise exception 'No tienes permisos para asignar registros.';
  end if;

  select *
  into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'El registro no existe o no está disponible para tu usuario.';
  end if;

  if v_source = 'mail_engagement' then
    select exists (
      select 1
      from public.mail_result_contacts r
      join public.mail_result_batches b on b.id = r.batch_id
      join public.mail_campaigns mc on mc.id = b.mail_campaign_id
      where r.lead_id = p_lead_id
        and (r.opened or r.clicked)
        and mc.umbrella_key = 'equifax'
    )
    into v_is_mail_engagement;
  end if;

  if v_role = 'supervisor'
    and (
      v_actor_team_id is null
      or (
        v_lead.team_id is distinct from v_actor_team_id
        and not (v_lead.team_id is null and v_is_mail_engagement)
      )
    )
  then
    raise exception 'No puedes asignar un registro fuera de tu equipo.';
  end if;

  v_old_assigned_to := v_lead.assigned_to;

  if p_agent_id is not null then
    select *
    into v_agent
    from public.profiles
    where id = p_agent_id
      and role = 'agente'
      and active
    limit 1;

    if not found then
      raise exception 'El ejecutivo destino no existe o no está activo.';
    end if;

    v_effective_team_id := coalesce(v_lead.team_id, v_agent.team_id);

    if v_effective_team_id is null or v_agent.team_id is distinct from v_effective_team_id then
      raise exception 'El ejecutivo destino no pertenece al equipo del registro.';
    end if;

    if v_role = 'supervisor' and v_agent.team_id is distinct from v_actor_team_id then
      raise exception 'El ejecutivo destino no pertenece a tu equipo.';
    end if;
  else
    v_effective_team_id := v_lead.team_id;
  end if;

  update public.lead_assignments
  set
    is_active = false,
    ends_at = v_now,
    updated_at = v_now
  where lead_id = p_lead_id
    and is_active;

  if p_agent_id is not null then
    insert into public.lead_assignments (
      lead_id,
      assigned_to,
      assigned_by,
      team_id,
      campaign_id,
      reason,
      source,
      is_active,
      starts_at
    )
    values (
      p_lead_id,
      p_agent_id,
      v_actor_id,
      v_effective_team_id,
      v_lead.campaign_id,
      nullif(btrim(coalesce(p_reason, '')), ''),
      v_source,
      true,
      v_now
    );
  end if;

  update public.leads
  set
    assigned_to = p_agent_id,
    managed_by = case when p_set_managed_by then p_agent_id else managed_by end,
    team_id = v_effective_team_id,
    next_action_at = coalesce(p_next_action_at, next_action_at),
    assignment_status = case when p_agent_id is null then 'unassigned' else 'assigned' end,
    updated_at = v_now
  where id = p_lead_id;

  insert into public.crm_audit_events (
    lead_id,
    crm_entity_id,
    actor_id,
    event_type,
    payload
  )
  values (
    p_lead_id,
    v_lead.crm_entity_id,
    v_actor_id,
    case when p_agent_id is null then 'lead.unassigned' else 'lead.assigned' end,
    jsonb_build_object(
      'old_assigned_to', v_old_assigned_to,
      'new_assigned_to', p_agent_id,
      'team_id', v_effective_team_id,
      'campaign_id', v_lead.campaign_id,
      'set_managed_by', p_set_managed_by,
      'next_action_at', p_next_action_at,
      'reason', nullif(btrim(coalesce(p_reason, '')), ''),
      'source', v_source
    )
  );

  return jsonb_build_object(
    'lead_id', p_lead_id,
    'old_assigned_to', v_old_assigned_to,
    'assigned_to', p_agent_id,
    'team_id', v_effective_team_id,
    'set_managed_by', p_set_managed_by,
    'next_action_at', p_next_action_at
  );
end;
$function$;

revoke all on function public.assign_lead(uuid, uuid, text, text, boolean, timestamptz) from public, anon;
grant execute on function public.assign_lead(uuid, uuid, text, text, boolean, timestamptz) to authenticated;
