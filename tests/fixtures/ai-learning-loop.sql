-- Extends the existing local-only role/session fixture with the actual columns
-- read by the loop. No external connection or customer data is used.
alter table campaigns add column name text, add column is_active boolean default true;
alter table leads add column campaign_id uuid, add column next_action_at timestamptz,
  add column workflow_status text, add column crm_entity_id uuid;
create table calls (
  id uuid primary key,lead_id uuid,agent_id uuid,status text,outcome text,reason text,notes text,
  next_action_at timestamptz,started_at timestamptz,ended_at timestamptz,updated_at timestamptz default now()
);
create table call_recordings (
  id uuid primary key,call_id uuid,lead_id uuid,campaign_id uuid,team_id uuid,status text default 'ready',
  retention_until timestamptz default now()+interval '30 days',started_at timestamptz,sha256 text
);
create table call_transcriptions (
  id uuid primary key,recording_id uuid unique,status text,source_sha256 text,transcript_text text,updated_at timestamptz default now()
);
alter table call_recordings enable row level security;
alter table calls enable row level security;
create policy recordings_scope on call_recordings for select to authenticated using (
  current_role_name()='admin' or (current_role_name()='supervisor' and team_id=any(supervised_team_ids()))
);
create policy calls_scope on calls for select to authenticated using (
  current_role_name()='admin' or (current_role_name()='supervisor' and exists(select 1 from profiles p where p.id=agent_id and p.team_id=any(supervised_team_ids())))
);
grant select on call_recordings,call_transcriptions,calls to authenticated;
grant all on call_recordings,call_transcriptions,calls to service_role;
update leads set campaign_id='00000000-0000-4000-8000-000000000101',workflow_status='managed' where id='00000000-0000-4000-8000-000000000301';
update leads set campaign_id='00000000-0000-4000-8000-000000000102',workflow_status='managed' where id='00000000-0000-4000-8000-000000000302';
insert into calls(id,lead_id,agent_id,status,outcome,reason,started_at,ended_at) values
('00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000001','completed','callback','Retomar contacto',now()-interval '2 hours',now()-interval '110 minutes'),
('00000000-0000-4000-8000-000000000502','00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000002','completed','sale','Venta',now()-interval '2 hours',now()-interval '110 minutes');
insert into call_recordings(id,call_id,lead_id,campaign_id,team_id,started_at,sha256)
select replace(c.id::text,'00000000050','00000000060')::uuid,c.id,c.lead_id,l.campaign_id,p.team_id,c.started_at,repeat('a',64)
from calls c join leads l on l.id=c.lead_id join profiles p on p.id=c.agent_id;
insert into call_transcriptions(id,recording_id,status,source_sha256,transcript_text)
select replace(id::text,'00000000060','00000000070')::uuid,id,'completed',sha256,'Por favor llámeme el viernes.' from call_recordings;

create function test_loop_result() returns jsonb language sql as $$
select '{"analysis":{"uncertain":false,"facts":[{"kind":"callback_request","quote":"Por favor llámeme el viernes.","speaker":"customer","requested_time_text":"el viernes"}]},"decision":{"action":"callback_candidate","reason":"Solicitud explícita","reason_code":"explicit_callback","policy_version":"callback-v1","memory_ids":[],"execution":"not_executed_shadow"},"model":"fixture","extractor_version":"conversation-facts-v1","usage":{}}'::jsonb;
$$;
