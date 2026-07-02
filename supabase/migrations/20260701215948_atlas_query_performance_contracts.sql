-- Atlas query-performance contracts.
-- Keep the schema compact: optimize the actual hot paths instead of adding
-- operational tables that duplicate CRM state.

create extension if not exists pg_trgm with schema extensions;

-- Lead lookup and queue screens.
create index if not exists leads_updated_at_desc_idx
  on public.leads (updated_at desc);

create index if not exists leads_status_idx
  on public.leads (status);

create index if not exists leads_queue_campaign_state_idx
  on public.leads (campaign_id, assignment_status, workflow_status, updated_at desc);

create index if not exists leads_full_name_trgm_idx
  on public.leads using gin (full_name gin_trgm_ops);

-- Agenda screens: personal agenda and team agenda always filter scheduled rows.
create index if not exists leads_agenda_owner_due_idx
  on public.leads (managed_by, next_action_at)
  where next_action_at is not null;

create index if not exists leads_team_agenda_due_idx
  on public.leads (team_id, next_action_at)
  where next_action_at is not null;

-- Call lifecycle and lead history.
create index if not exists calls_lead_agent_open_idx
  on public.calls (lead_id, agent_id, started_at desc)
  where ended_at is null;

create index if not exists calls_lead_ended_idx
  on public.calls (lead_id, ended_at desc)
  where ended_at is not null;

create index if not exists calls_lead_next_action_closed_idx
  on public.calls (lead_id, next_action_at)
  where ended_at is not null and next_action_at is not null;

create index if not exists calls_started_at_idx
  on public.calls (started_at);

create index if not exists calls_agent_started_idx
  on public.calls (agent_id, started_at desc);

create index if not exists calls_callback_owner_due_idx
  on public.calls (callback_owner_user_id, next_action_at)
  where callback_owner_user_id is not null and next_action_at is not null;

-- Dashboard recent activity and per-lead interaction history.
create index if not exists interactions_created_at_desc_idx
  on public.interactions (created_at desc);

create index if not exists interactions_lead_created_idx
  on public.interactions (lead_id, created_at desc);

-- RLS update policies should validate the row after mutation, not only before.
alter policy leads_update on public.leads
  with check (
    (select current_role_name()) = 'admin'
    or (
      (select current_role_name()) = 'agente'
      and assigned_to = (select auth.uid())
    )
    or (
      (select current_role_name()) = 'supervisor'
      and team_id = (select current_team_id())
    )
  );

alter policy calls_update on public.calls
  with check (
    (select current_role_name()) = 'admin'
    or (
      (select current_role_name()) = 'agente'
      and agent_id = (select auth.uid())
    )
    or (
      (select current_role_name()) = 'supervisor'
      and lead_id in (
        select leads.id
        from public.leads
        where leads.team_id = (select current_team_id())
      )
    )
  );;
