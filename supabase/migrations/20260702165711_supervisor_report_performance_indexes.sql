-- Performance contract for supervisor report.
-- Keep report reads index-backed as calls/interactions grow.

create index if not exists calls_report_activity_range_idx
  on public.calls (
    (coalesce(ended_at, updated_at, created_at)),
    lead_id,
    agent_id
  )
  where discarded_reason is null;

create index if not exists calls_report_connected_range_idx
  on public.calls (
    (coalesce(ended_at, updated_at, created_at)),
    lead_id,
    agent_id
  )
  where discarded_reason is null
    and status = 'connected';

create index if not exists calls_report_agenda_range_idx
  on public.calls (
    (coalesce(ended_at, updated_at, created_at)),
    lead_id,
    agent_id
  )
  where discarded_reason is null
    and next_action_at is not null;

create index if not exists interactions_report_created_lead_agent_idx
  on public.interactions (
    created_at,
    lead_id,
    agent_id
  );

create index if not exists profiles_active_agents_team_name_idx
  on public.profiles (
    team_id,
    full_name,
    id
  )
  where role = 'agente'
    and active;

create index if not exists leads_team_assignment_report_idx
  on public.leads (
    team_id,
    assigned_to
  );
