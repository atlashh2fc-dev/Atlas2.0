
-- Workflows: configurable, admin-managed management flows
create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  step_order integer not null,
  name text not null,
  description text,
  is_mandatory boolean not null default true,
  allowed_results text[],
  created_at timestamptz not null default now(),
  unique (workflow_id, step_order)
);

-- Leads: optionally bound to a workflow
alter table public.leads
  add column workflow_id uuid references public.workflows(id);

-- Interactions: optionally tied to the workflow step they complete
alter table public.interactions
  add column workflow_step_id uuid references public.workflow_steps(id);

create trigger workflows_set_updated_at
  before update on public.workflows
  for each row execute function public.set_updated_at();

alter table public.workflows enable row level security;
alter table public.workflow_steps enable row level security;

-- All authenticated users can read active workflows/steps (needed to render the form);
-- only admins manage them.
create policy workflows_select on public.workflows
  for select to authenticated
  using (true);

create policy workflows_admin_write on public.workflows
  for all to authenticated
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

create policy workflow_steps_select on public.workflow_steps
  for select to authenticated
  using (true);

create policy workflow_steps_admin_write on public.workflow_steps
  for all to authenticated
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');
;
