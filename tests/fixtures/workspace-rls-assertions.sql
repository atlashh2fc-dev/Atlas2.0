begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select assert_test((select count(*)=0 from whatsapp_messages),'admin cannot read messages');
select assert_test((select count(*)=0 from whatsapp_conversation_events),'admin cannot read private events');
select assert_test((select count(*)=3 from whatsapp_conversations),'admin retains operational metadata');
select assert_test((select count(*)=0 from agent_sip_credentials),'admin cannot register own SIP');
select assert_test((select count(*)=2 from contact_center_queues),'admin sees queue catalog');
select assert_test((select count(*)=2 from contact_center_queue_members),'admin sees operational membership');
select assert_test((get_contact_center_queue_control('00000000-0000-4000-8000-000000000401')->'queue'->>'active')::int=2,'admin aggregate metrics survive content RLS');
do $$ begin
  begin perform set_my_agent_current_status('00000000-0000-4000-8000-000000000601');
    raise exception 'admin direct status RPC unexpectedly allowed'; exception when raise_exception then
    if sqlerrm not like 'Solo un ejecutivo%' then raise; end if; raise notice 'PASS: admin direct status RPC denied'; end;
  perform mark_my_agent_logged_out();
  if exists(select 1 from agent_current_status where profile_id=auth.uid() and reason_id is not null) then
    raise exception 'admin logout RPC mutated status'; end if;
  begin insert into interactions(lead_id,agent_id) values('00000000-0000-4000-8000-000000000301',auth.uid());
    raise exception 'admin insert unexpectedly succeeded'; exception when insufficient_privilege then raise notice 'PASS: admin interaction insert denied'; end;
  update agent_current_status set status='available' where profile_id=auth.uid();
  if found then raise exception 'admin status mutation unexpectedly succeeded'; end if;
end $$;
select set_whatsapp_automation_enabled(false);
select assert_test((select count(*)=2 from whatsapp_ai_configs where not enabled),'admin toggle covers every configured campaign');
select assert_test((select count(*)=2 from whatsapp_automation_changes where previous_enabled and not enabled and actor_id=auth.uid()),'global toggle records actor and before/after');
select assert_test((select count(*)=3 from whatsapp_conversations where ai_state='auto'),'toggle does not take over conversations');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select assert_test((select count(*)=2 from whatsapp_messages),'supervisor reads only supervised campaign');
select assert_test((select count(*)=1 from contact_center_queues),'supervisor queue catalog scoped');
select assert_test((select count(*)=1 from contact_center_queue_sources),'supervisor sources scoped');
select assert_test((select count(*)=1 from contact_center_queue_members),'supervisor memberships scoped');
select assert_test((select count(*)=2 from whatsapp_conversation_events),'supervisor notes stay campaign scoped');
select assert_test((get_contact_center_queue_control('00000000-0000-4000-8000-000000000401')->'queue'->>'active')::int=2,'supervisor own queue allowed');
do $$ begin
  begin perform get_contact_center_queue_control('00000000-0000-4000-8000-000000000402');
    raise exception 'unrelated queue unexpectedly allowed'; exception when raise_exception then
    if sqlerrm<>'queue_control_access_denied' then raise; end if; raise notice 'PASS: unrelated queue denied'; end;
end $$;
select set_whatsapp_automation_enabled(true);
select assert_test((select enabled from whatsapp_ai_configs where campaign_id='00000000-0000-4000-8000-000000000101'),'supervisor toggles own campaign');
select assert_test((select not enabled from whatsapp_ai_configs where campaign_id='00000000-0000-4000-8000-000000000102'),'supervisor cannot change unrelated campaign');
select assert_test((select count(*)=2 from whatsapp_automation_changes),'supervisor audit visibility stays scoped');
select set_config('request.test.session_valid','false',true);
do $$ begin
  begin perform set_whatsapp_automation_enabled(false);
    raise exception 'invalid session unexpectedly allowed'; exception when raise_exception then
    if sqlerrm<>'whatsapp_automation_access_denied' then raise; end if; raise notice 'PASS: invalid session direct RPC denied'; end;
end $$;
select set_config('request.test.session_valid','true',true);
reset role;
insert into campaign_agents values('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000002');
set local role authenticated;
do $$ begin
  begin perform set_whatsapp_automation_enabled(false);
    raise exception 'shared campaign control unexpectedly allowed'; exception when raise_exception then
    if sqlerrm not like 'Hay campañas compartidas%' then raise; end if; raise notice 'PASS: shared campaign general control denied atomically'; end;
end $$;
select assert_test((select enabled from whatsapp_ai_configs where campaign_id='00000000-0000-4000-8000-000000000101'),'rejected shared change leaves configuration unchanged');
select assert_test((select count(*)=2 from whatsapp_automation_changes),'rejected shared change leaves audit unchanged');
reset role;
delete from campaign_agents where campaign_id='00000000-0000-4000-8000-000000000101' and profile_id='00000000-0000-4000-8000-000000000002';
insert into contact_center_queue_members(queue_id,profile_id) values('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000002');
set local role authenticated;
do $$ begin
  begin perform set_whatsapp_automation_enabled(false);
    raise exception 'shared queue control unexpectedly allowed'; exception when raise_exception then
    if sqlerrm not like 'Hay campañas compartidas%' then raise; end if; raise notice 'PASS: shared queue general control denied atomically'; end;
end $$;
reset role;
delete from contact_center_queue_members where queue_id='00000000-0000-4000-8000-000000000401' and profile_id='00000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$ begin
  begin insert into interactions(lead_id,agent_id) values('00000000-0000-4000-8000-000000000301',auth.uid());
    raise exception 'supervisor insert unexpectedly succeeded'; exception when insufficient_privilege then raise notice 'PASS: supervisor interaction insert denied'; end;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select assert_test((select count(*)=1 from whatsapp_messages),'agent sees assigned content only, not unassigned pool');
select assert_test((select count(*)=1 from whatsapp_conversation_events),'agent sees assigned events only');
select assert_test((select count(*)=1 from agent_sip_credentials),'agent own SIP remains available');
select assert_test((select count(*)=1 from contact_center_queues),'agent sees own queue metadata');
select assert_test((select count(*)=1 from contact_center_queue_sources),'agent sees own source metadata');
select assert_test((select count(*)=1 from contact_center_queue_members),'agent sees own membership only');
select set_my_agent_current_status('00000000-0000-4000-8000-000000000601');
select assert_test((select reason_id='00000000-0000-4000-8000-000000000601' from agent_current_status where profile_id=auth.uid()),'agent status RPC preserved');
select mark_my_agent_logged_out();
select assert_test((select reason_id='00000000-0000-4000-8000-000000000602' from agent_current_status where profile_id=auth.uid()),'agent logout RPC preserved');
select assert_test((select count(*)=0 from whatsapp_automation_changes),'agent cannot read automation admin audit');
update agent_current_status set status='available' where profile_id=auth.uid();
select assert_test((select status='available' from agent_current_status where profile_id=auth.uid()),'agent status workflow preserved');
insert into interactions(lead_id,agent_id) values('00000000-0000-4000-8000-000000000301',auth.uid());
do $$ begin
  begin insert into interactions(lead_id,agent_id) values('00000000-0000-4000-8000-000000000303',auth.uid());
    raise exception 'unassigned interaction unexpectedly allowed'; exception when insufficient_privilege then raise notice 'PASS: unassigned interaction denied'; end;
  begin insert into interactions(lead_id,agent_id) values('00000000-0000-4000-8000-000000000302',auth.uid());
    raise exception 'other interaction unexpectedly allowed'; exception when insufficient_privilege then raise notice 'PASS: other agent interaction denied'; end;
  begin perform set_whatsapp_automation_enabled(false);
    raise exception 'agent toggle unexpectedly allowed'; exception when raise_exception then
    if sqlerrm<>'whatsapp_automation_access_denied' then raise; end if; raise notice 'PASS: agent global automation denied'; end;
  begin insert into whatsapp_messages(conversation_id,text_body) values('00000000-0000-4000-8000-000000000301','Bypass');
    raise exception 'direct message write unexpectedly allowed'; exception when insufficient_privilege then raise notice 'PASS: direct message write denied'; end;
  begin perform * from whatsapp_media_uploads;
    raise exception 'private upload unexpectedly exposed'; exception when insufficient_privilege then raise notice 'PASS: direct uploads denied'; end;
end $$;

reset role;
update profiles set active=false where id='00000000-0000-4000-8000-000000000001';
set local role authenticated;
select assert_test((select count(*)=0 from whatsapp_messages),'inactive agent content access denied');
select assert_test((select count(*)=0 from agent_sip_credentials),'inactive agent SIP access denied');

set local role service_role;
select assert_test((select count(*)=3 from whatsapp_messages),'service-role ingestion visibility preserved');
insert into whatsapp_messages(conversation_id,text_body) values('00000000-0000-4000-8000-000000000301','Service role fixture');
select assert_test((select count(*)=4 from whatsapp_messages),'service-role writes preserved');

set local role anon;
do $$ begin
  begin perform * from whatsapp_messages;
    raise exception 'anonymous messages unexpectedly exposed'; exception when insufficient_privilege then raise notice 'PASS: anonymous content denied'; end;
  begin perform set_whatsapp_automation_enabled(true);
    raise exception 'anonymous automation unexpectedly allowed'; exception when insufficient_privilege then raise notice 'PASS: anonymous automation denied'; end;
end $$;
rollback;
