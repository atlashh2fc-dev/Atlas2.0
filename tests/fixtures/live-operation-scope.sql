-- Extends workspace-rls.sql in an isolated PostgreSQL cluster only.
alter table profiles add column email text;
alter table campaigns add column name text, add column is_active boolean default true;
alter table leads add column campaign_id uuid, add column team_id uuid;
alter table agent_sip_credentials add column extension text, add column is_active boolean default true;
alter table agent_current_status add column reason_id uuid, add column since timestamptz default now();
create or replace function public.is_current_app_session_valid() returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('request.test.session_valid', true), ''), 'true')::boolean;
$$;
create table dialer_campaign_configs (campaign_id uuid, queue_name text, campaign_type text, is_active boolean default true);
create table dial_attempts (campaign_id uuid, status text, created_at timestamptz default now());
create table calls (lead_id uuid, ended_at timestamptz, status text, outcome text);
create table dialer_agent_sessions (profile_id uuid, campaign_id uuid, status text, last_state_change_at timestamptz, updated_at timestamptz);
create table agent_status_reasons (id uuid primary key, code text, label text, is_pause boolean);
create table agent_control_commands (
  id uuid, target_profile_id uuid, status text, created_at timestamptz,
  browser_acknowledged_at timestamptz, pbx_completed_at timestamptz, last_error text
);
insert into campaigns(id) values
('00000000-0000-4000-8000-000000000103'),
('00000000-0000-4000-8000-000000000104'),
('00000000-0000-4000-8000-000000000105');
update campaigns set name='Campaign ' || right(id::text,3);
update profiles set email='fixture@example.test';
update agent_sip_credentials set extension=right(profile_id::text,3);
insert into profiles(id,role,active,full_name) values
('00000000-0000-4000-8000-000000000005','supervisor',true,'Supervisor without teams'),
('00000000-0000-4000-8000-000000000006','admin',false,'Inactive admin');
insert into leads(id,campaign_id,team_id) values
('00000000-0000-4000-8000-000000000503','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000201');
insert into contact_center_queue_sources(queue_id,campaign_id) values
('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000104');
insert into dialer_campaign_configs(campaign_id,queue_name,campaign_type)
select id,'queue-' || right(id::text,3),'outbound' from campaigns;
insert into dial_attempts(campaign_id,status) values
('00000000-0000-4000-8000-000000000101','ringing'),
('00000000-0000-4000-8000-000000000101','completed'),
('00000000-0000-4000-8000-000000000102','completed');
insert into calls(lead_id,ended_at,status,outcome) values
('00000000-0000-4000-8000-000000000503',now(),'connected','sale');
insert into dialer_agent_sessions values
('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','available',now()-interval '5 minutes',now()-interval '5 minutes'),
('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000102','on_call',now(),now()),
('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000102','available',now(),now());
