-- Minimal PostgreSQL fixture for the real production migration. Never run on a
-- shared DB: scripts/test-workspace-rls.sh supplies an isolated local cluster.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create type public.app_role as enum ('admin', 'supervisor', 'agente');
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create table profiles (id uuid primary key, role app_role, active boolean default true, team_id uuid, full_name text);
create table campaigns (id uuid primary key);
create table campaign_agents (campaign_id uuid, profile_id uuid);
create function public.is_current_app_session_valid() returns boolean language sql stable as $$
  select coalesce(current_setting('request.test.session_valid', true), 'true') <> 'false';
$$;
create function public.current_role_name() returns app_role language sql stable security definer set search_path=public as $$
  select role from profiles where id=auth.uid() and active and public.is_current_app_session_valid();
$$;
create function public.supervised_team_ids() returns uuid[] language sql stable security definer set search_path=public as $$
  select array_agg(team_id) from profiles where id=auth.uid() and role='supervisor' and active;
$$;
create function public.can_access_whatsapp_campaign(p_campaign_id uuid, p_assigned_to uuid default null)
returns boolean language sql stable security invoker set search_path=public as $$
  select case current_role_name()
    when 'admin'::app_role then true
    when 'agente'::app_role then (p_assigned_to=auth.uid() or (p_assigned_to is null and exists (
      select 1 from campaign_agents where campaign_id=p_campaign_id and profile_id=auth.uid())))
    when 'supervisor'::app_role then exists (
      select 1 from campaign_agents membership join profiles agent on agent.id=membership.profile_id
      where membership.campaign_id=p_campaign_id and agent.active and agent.team_id=any(supervised_team_ids()))
    else false end;
$$;
create table whatsapp_conversations (
  id uuid primary key, campaign_id uuid, assigned_to uuid, queue_id uuid,
  status text default 'open', ai_state text default 'auto', unread_count integer default 1,
  created_at timestamptz default now(), closed_at timestamptz, last_message_at timestamptz default now(), close_reason_id uuid
);
create table whatsapp_messages (
  id uuid primary key default gen_random_uuid(), conversation_id uuid,
  text_body text, direction text default 'inbound', provider_timestamp timestamptz default now(), created_at timestamptz default now()
);
create table whatsapp_conversation_events (id uuid primary key default gen_random_uuid(), conversation_id uuid, note text);
create table whatsapp_media_uploads (id uuid primary key default gen_random_uuid());
create table whatsapp_ai_configs (id uuid primary key default gen_random_uuid(), campaign_id uuid unique, enabled boolean default true);
create table contact_center_queue_members (queue_id uuid, profile_id uuid, is_active boolean default true, joined_at timestamptz default now());
create table contact_center_queue_sources (queue_id uuid, campaign_id uuid, is_active boolean default true);
create table whatsapp_closure_reasons (id uuid primary key, campaign_id uuid, label text, sort_order integer, is_active boolean default true);
create table leads (id uuid primary key, assigned_to uuid, managed_by uuid);
create table interactions (id uuid default gen_random_uuid(), lead_id uuid, agent_id uuid);
create table agent_current_status (profile_id uuid primary key, status text);
create table agent_sip_credentials (profile_id uuid primary key, password text);

alter table whatsapp_conversations enable row level security;
alter table whatsapp_messages enable row level security;
alter table whatsapp_conversation_events enable row level security;
alter table whatsapp_media_uploads enable row level security;
alter table interactions enable row level security;
alter table agent_current_status enable row level security;
alter table agent_sip_credentials enable row level security;
create policy whatsapp_conversations_select on whatsapp_conversations for select to authenticated
using (can_access_whatsapp_campaign(campaign_id, assigned_to));
create policy whatsapp_messages_select on whatsapp_messages for select to authenticated using (exists (
  select 1 from whatsapp_conversations c where c.id=conversation_id and can_access_whatsapp_campaign(c.campaign_id,c.assigned_to)));
create policy whatsapp_events_select on whatsapp_conversation_events for select to authenticated using (exists (
  select 1 from whatsapp_conversations c where c.id=conversation_id and can_access_whatsapp_campaign(c.campaign_id,c.assigned_to)));
-- Deliberately broad legacy policies: the new restrictive policies must safely
-- intersect these, including a direct Data API client with table privileges.
create policy interactions_legacy_insert on interactions for insert to authenticated with check (true);
create policy interactions_select on interactions for select to authenticated using (true);
create policy agent_status_select on agent_current_status for select to authenticated using (true);
create policy agent_status_self_insert on agent_current_status for insert to authenticated with check(profile_id=auth.uid());
create policy agent_status_self_update on agent_current_status for update to authenticated using(profile_id=auth.uid()) with check(profile_id=auth.uid());
create policy sip_self_select on agent_sip_credentials for select to authenticated using(profile_id=auth.uid());
grant usage on schema auth, public to authenticated, anon, service_role;
grant select on all tables in schema public to authenticated;
grant insert on interactions to authenticated;
grant insert, update on agent_current_status to authenticated;
grant all on all tables in schema public to service_role;

insert into campaigns values ('00000000-0000-4000-8000-000000000101'), ('00000000-0000-4000-8000-000000000102');
insert into profiles(id,role,team_id,full_name) values
('00000000-0000-4000-8000-000000000001','agente','00000000-0000-4000-8000-000000000201','Agent A'),
('00000000-0000-4000-8000-000000000002','agente','00000000-0000-4000-8000-000000000202','Agent B'),
('00000000-0000-4000-8000-000000000003','supervisor','00000000-0000-4000-8000-000000000201','Supervisor A'),
('00000000-0000-4000-8000-000000000004','admin',null,'Admin');
insert into campaign_agents values
('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000002');
insert into whatsapp_conversations(id,campaign_id,assigned_to,queue_id) values
('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000401'),
('00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000402'),
('00000000-0000-4000-8000-000000000303','00000000-0000-4000-8000-000000000101',null,'00000000-0000-4000-8000-000000000401');
insert into whatsapp_messages(conversation_id,text_body) select id,'Private customer text' from whatsapp_conversations;
insert into whatsapp_conversation_events(conversation_id,note) select id,'Private note' from whatsapp_conversations;
insert into whatsapp_ai_configs(campaign_id) select id from campaigns;
insert into contact_center_queue_members(queue_id,profile_id) values
('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000002');
insert into contact_center_queue_sources(queue_id,campaign_id) values
('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000101'),
('00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000102');
insert into leads(id,assigned_to) select id,assigned_to from whatsapp_conversations;
insert into agent_current_status select id,'offline' from profiles;
insert into agent_sip_credentials select id,'fixture-password' from profiles;
create function public.assert_test(p_ok boolean,p_name text) returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FAILED: %',p_name; end if; raise notice 'PASS: %',p_name; end;
$$;
