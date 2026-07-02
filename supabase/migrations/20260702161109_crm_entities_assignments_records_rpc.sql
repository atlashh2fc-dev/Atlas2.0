-- CRM operating model:
-- 1) crm_entities = master person/company by normalized RUT.
-- 2) lead_assignments = auditable assignment events.
-- 3) get_lead_records = role-aware records source for /dashboard/leads.

create or replace function public.normalize_lead_rut(value text)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select upper(regexp_replace(coalesce(value, ''), '[^0-9kK]', '', 'g'));
$$;

create table if not exists public.crm_entities (
  id uuid primary key default gen_random_uuid(),
  normalized_rut text,
  display_name text not null,
  primary_lead_id uuid references public.leads(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_entities_normalized_rut_not_blank check (normalized_rut is null or btrim(normalized_rut) <> '')
);

create unique index if not exists crm_entities_normalized_rut_uidx
  on public.crm_entities (normalized_rut);

create index if not exists crm_entities_primary_lead_id_idx
  on public.crm_entities (primary_lead_id);

drop trigger if exists crm_entities_set_updated_at on public.crm_entities;
create trigger crm_entities_set_updated_at
before update on public.crm_entities
for each row execute function public.set_updated_at();

alter table public.leads
  add column if not exists crm_entity_id uuid references public.crm_entities(id) on delete set null;

create index if not exists leads_crm_entity_id_idx
  on public.leads (crm_entity_id);

alter table public.crm_entities enable row level security;

drop policy if exists crm_entities_select on public.crm_entities;
create policy crm_entities_select
on public.crm_entities
for select
to authenticated
using (
  exists (
    select 1
    from public.leads l
    where l.crm_entity_id = id
  )
);

drop policy if exists crm_entities_write_admin on public.crm_entities;
create policy crm_entities_write_admin
on public.crm_entities
for all
to authenticated
using ((select public.current_role_name()) = 'admin')
with check ((select public.current_role_name()) = 'admin');

insert into public.crm_entities (normalized_rut, display_name, primary_lead_id, metadata)
select
  public.normalize_lead_rut(l.rut) as normalized_rut,
  (array_agg(l.full_name order by l.updated_at desc nulls last, l.created_at desc nulls last))[1] as display_name,
  (array_agg(l.id order by l.updated_at desc nulls last, l.created_at desc nulls last))[1] as primary_lead_id,
  jsonb_build_object('source', 'leads.rut.backfill', 'lead_count', count(*))
from public.leads l
where public.normalize_lead_rut(l.rut) <> ''
group by public.normalize_lead_rut(l.rut)
on conflict (normalized_rut) do update
set
  display_name = excluded.display_name,
  primary_lead_id = excluded.primary_lead_id,
  metadata = public.crm_entities.metadata || excluded.metadata,
  updated_at = now();

update public.leads l
set crm_entity_id = e.id
from public.crm_entities e
where l.crm_entity_id is null
  and e.normalized_rut = public.normalize_lead_rut(l.rut);

create table if not exists public.lead_assignments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  assigned_to uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  reason text,
  source text not null default 'manual',
  is_active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_assignments_active_has_no_end check ((is_active and ends_at is null) or (not is_active))
);

create unique index if not exists lead_assignments_one_active_per_lead_uidx
  on public.lead_assignments (lead_id)
  where is_active;

create index if not exists lead_assignments_assigned_to_active_idx
  on public.lead_assignments (assigned_to, is_active, starts_at desc);

create index if not exists lead_assignments_team_active_idx
  on public.lead_assignments (team_id, is_active, starts_at desc);

drop trigger if exists lead_assignments_set_updated_at on public.lead_assignments;
create trigger lead_assignments_set_updated_at
before update on public.lead_assignments
for each row execute function public.set_updated_at();

alter table public.lead_assignments enable row level security;

drop policy if exists lead_assignments_select on public.lead_assignments;
create policy lead_assignments_select
on public.lead_assignments
for select
to authenticated
using (
  exists (
    select 1
    from public.leads l
    where l.id = lead_id
  )
);

drop policy if exists lead_assignments_insert_ops on public.lead_assignments;
create policy lead_assignments_insert_ops
on public.lead_assignments
for insert
to authenticated
with check (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'supervisor'
    and team_id = (select public.current_team_id())
    and exists (
      select 1
      from public.leads l
      where l.id = lead_id
        and l.team_id = (select public.current_team_id())
    )
  )
);

drop policy if exists lead_assignments_update_ops on public.lead_assignments;
create policy lead_assignments_update_ops
on public.lead_assignments
for update
to authenticated
using (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'supervisor'
    and team_id = (select public.current_team_id())
  )
)
with check (
  (select public.current_role_name()) = 'admin'
  or (
    (select public.current_role_name()) = 'supervisor'
    and team_id = (select public.current_team_id())
  )
);

drop policy if exists lead_assignments_delete_admin on public.lead_assignments;
create policy lead_assignments_delete_admin
on public.lead_assignments
for delete
to authenticated
using ((select public.current_role_name()) = 'admin');

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
select
  l.id,
  l.assigned_to,
  l.created_by,
  l.team_id,
  l.campaign_id,
  'Asignacion migrada desde leads.assigned_to',
  'leads.assigned_to.backfill',
  true,
  coalesce(l.created_at, now())
from public.leads l
where l.assigned_to is not null
  and not exists (
    select 1
    from public.lead_assignments a
    where a.lead_id = l.id
      and a.is_active
  );

create or replace function public.get_lead_records(
  p_agent uuid default null,
  p_campaign uuid default null,
  p_status text default null,
  p_limit integer default 300
)
returns table (
  id uuid,
  full_name text,
  rut text,
  phone text,
  status text,
  assigned_to uuid,
  managed_by uuid,
  team_id uuid,
  campaign_id uuid,
  updated_at timestamptz,
  next_action_at timestamptz,
  tipificacion_actual text,
  assignment_status text,
  workflow_status text,
  managed_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    l.id,
    l.full_name,
    l.rut,
    l.phone,
    l.status,
    l.assigned_to,
    l.managed_by,
    l.team_id,
    l.campaign_id,
    l.updated_at,
    l.next_action_at,
    l.tipificacion_actual,
    l.assignment_status,
    l.workflow_status,
    l.managed_at
  from public.leads l
  where (
      (select public.current_role_name()) = 'admin'
      or (
        (select public.current_role_name()) = 'supervisor'
        and l.team_id = (select public.current_team_id())
      )
      or (
        (select public.current_role_name()) = 'agente'
        and (
          l.assigned_to = (select auth.uid())
          or l.managed_by = (select auth.uid())
        )
      )
    )
    and (
      p_agent is null
      or (select public.current_role_name()) not in ('admin', 'supervisor')
      or l.assigned_to = p_agent
      or l.managed_by = p_agent
    )
    and (p_campaign is null or l.campaign_id = p_campaign)
    and (p_status is null or l.status = p_status)
  order by l.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 300), 500));
$$;

revoke all on function public.normalize_lead_rut(text) from public, anon;
grant execute on function public.normalize_lead_rut(text) to authenticated;

revoke all on function public.get_lead_records(uuid, uuid, text, integer) from public, anon;
grant execute on function public.get_lead_records(uuid, uuid, text, integer) to authenticated;
