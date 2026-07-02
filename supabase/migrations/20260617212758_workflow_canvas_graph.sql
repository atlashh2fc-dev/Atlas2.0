
-- 1. Nuevas columnas en workflow_steps para soportar canvas + tipos de campo
alter table public.workflow_steps
  add column if not exists field_type text not null default 'single_choice',
  add column if not exists options jsonb not null default '[]'::jsonb,
  add column if not exists pos_x double precision not null default 0,
  add column if not exists pos_y double precision not null default 0,
  add column if not exists is_start boolean not null default false;

alter table public.workflow_steps
  drop constraint if exists workflow_steps_field_type_check;
alter table public.workflow_steps
  add constraint workflow_steps_field_type_check
  check (field_type in ('single_choice','multi_select','combobox','text'));

-- 2. Backfill: opciones desde allowed_results existentes
update public.workflow_steps
set options = to_jsonb(allowed_results)
where allowed_results is not null and options = '[]'::jsonb;

-- 3. Backfill: posiciones en una columna vertical para flujos existentes
update public.workflow_steps
set pos_y = (step_order - 1) * 160, pos_x = 80
where pos_x = 0 and pos_y = 0;

-- 4. Backfill: marcar el primer paso de cada flujo como nodo de inicio
update public.workflow_steps ws
set is_start = true
from (
  select id, row_number() over (partition by workflow_id order by step_order) as rn
  from public.workflow_steps
) s
where s.id = ws.id and s.rn = 1;

-- 5. Tabla de ramas (edges del canvas)
create table if not exists public.workflow_step_branches (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  from_step_id uuid not null references public.workflow_steps(id) on delete cascade,
  from_option text null,
  to_step_id uuid references public.workflow_steps(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (from_step_id, from_option)
);

alter table public.workflow_step_branches enable row level security;

drop policy if exists workflow_step_branches_select on public.workflow_step_branches;
create policy workflow_step_branches_select on public.workflow_step_branches
  for select using (true);

drop policy if exists workflow_step_branches_admin_insert on public.workflow_step_branches;
create policy workflow_step_branches_admin_insert on public.workflow_step_branches
  for insert with check (current_role_name() = 'admin'::app_role);

drop policy if exists workflow_step_branches_admin_update on public.workflow_step_branches;
create policy workflow_step_branches_admin_update on public.workflow_step_branches
  for update using (current_role_name() = 'admin'::app_role) with check (current_role_name() = 'admin'::app_role);

drop policy if exists workflow_step_branches_admin_delete on public.workflow_step_branches;
create policy workflow_step_branches_admin_delete on public.workflow_step_branches
  for delete using (current_role_name() = 'admin'::app_role);

-- 6. Backfill de ramas por defecto para flujos lineales existentes (mantiene compatibilidad)
insert into public.workflow_step_branches (workflow_id, from_step_id, from_option, to_step_id)
select ws.workflow_id, ws.id, null, nxt.id
from public.workflow_steps ws
join lateral (
  select id from public.workflow_steps ws2
  where ws2.workflow_id = ws.workflow_id and ws2.step_order > ws.step_order
  order by ws2.step_order limit 1
) nxt on true
where not exists (
  select 1 from public.workflow_step_branches b where b.from_step_id = ws.id and b.from_option is null
);

-- 7. Reescribir vistas dependientes (cascade) y recrearlas
drop view if exists public.workflow_compliance cascade;
drop view if exists public.lead_workflow_progress cascade;

create view public.lead_workflow_progress as
select
  l.id as lead_id,
  l.workflow_id,
  coalesce(ws_total.total_steps, 0) as total_mandatory_steps,
  coalesce(visited.completed_count, 0) as completed_mandatory_steps,
  ns.id as next_step_id,
  ns.name as next_step_name,
  ns.step_order as next_step_order,
  ns.field_type as next_step_field_type,
  ns.options as next_step_options,
  ns.is_mandatory as next_step_mandatory,
  ns.allowed_results as next_step_allowed_results,
  (l.workflow_id is not null and ns.id is null) as is_compliant
from public.leads l
left join (
  select workflow_id, count(*) as total_steps from public.workflow_steps group by workflow_id
) ws_total on ws_total.workflow_id = l.workflow_id
left join (
  select lead_id, count(distinct workflow_step_id) as completed_count
  from public.interactions where workflow_step_id is not null group by lead_id
) visited on visited.lead_id = l.id
left join lateral (
  select i.workflow_step_id as last_step_id, i.result as last_result
  from public.interactions i
  where i.lead_id = l.id and i.workflow_step_id is not null
  order by i.created_at desc
  limit 1
) li on true
left join lateral (
  select ws.id from public.workflow_steps ws
  where ws.workflow_id = l.workflow_id and ws.is_start = true
  limit 1
) start_step on li.last_step_id is null
left join lateral (
  select b.to_step_id from public.workflow_step_branches b
  where b.from_step_id = li.last_step_id and b.from_option = li.last_result
  limit 1
) branch_match on li.last_step_id is not null
left join lateral (
  select b.to_step_id from public.workflow_step_branches b
  where b.from_step_id = li.last_step_id and b.from_option is null
  limit 1
) branch_default on li.last_step_id is not null and branch_match.to_step_id is null
left join lateral (
  select ws.id, ws.name, ws.step_order, ws.field_type, ws.options, ws.is_mandatory, ws.allowed_results
  from public.workflow_steps ws
  where ws.id = coalesce(start_step.id, branch_match.to_step_id, branch_default.to_step_id)
) ns on true;

create view public.workflow_compliance as
select
  w.id as workflow_id,
  w.name as workflow_name,
  count(l.id) as total_leads,
  count(l.id) filter (where lwp.is_compliant) as compliant_leads,
  case
    when count(l.id) > 0 then round(100.0 * count(l.id) filter (where lwp.is_compliant)::numeric / count(l.id)::numeric, 1)
    else null::numeric
  end as compliance_rate
from public.workflows w
left join public.leads l on l.workflow_id = w.id
left join public.lead_workflow_progress lwp on lwp.lead_id = l.id
group by w.id, w.name;
;
