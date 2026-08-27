-- Extra tables/columns used by the status RPCs and queue metadata policies.
create table public.contact_center_queues (id uuid primary key, name text);
insert into contact_center_queues values
('00000000-0000-4000-8000-000000000401','Team A queue'),
('00000000-0000-4000-8000-000000000402','Team B queue');
alter table contact_center_queues enable row level security;
alter table contact_center_queue_members enable row level security;
alter table contact_center_queue_sources enable row level security;
create policy queue_select on contact_center_queues for select to authenticated using(current_role_name() in ('admin','supervisor'));
create policy queue_members_select on contact_center_queue_members for select to authenticated using(current_role_name() in ('admin','supervisor'));
create policy queue_sources_select on contact_center_queue_sources for select to authenticated using(current_role_name() in ('admin','supervisor'));
grant select on contact_center_queues to authenticated;
grant all on contact_center_queues to service_role;

alter table agent_current_status add column reason_id uuid, add column since timestamptz,
  add column last_heartbeat_at timestamptz, add column updated_at timestamptz;
create table public.agent_status_reasons (
  id uuid primary key, code text, is_active boolean default true, is_system boolean default false
);
insert into agent_status_reasons(id,code,is_system) values
('00000000-0000-4000-8000-000000000601','disponible',false),
('00000000-0000-4000-8000-000000000602','desconectado',true);
grant select on agent_status_reasons to authenticated;
