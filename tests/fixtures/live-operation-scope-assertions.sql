begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select assert_test((select count(*)=5 from get_queue_health()),'admin retains all Voice campaigns');
select assert_test((select in_flight=1 and attempts_today=2 and answered_today=1 and completed_today=1 from get_queue_health() where campaign_id='00000000-0000-4000-8000-000000000101'),'dial metrics preserved');
select assert_test((select managements_today=1 and effective_contacts_today=1 and sales_today=1 from get_queue_health() where campaign_id='00000000-0000-4000-8000-000000000103'),'outbound management metrics preserved');
select assert_test((select count(*)=2 from get_agent_live_status()),'admin retains every active agent');
select assert_test((select campaign_id='00000000-0000-4000-8000-000000000102' and phone_status='on_call' from get_agent_live_status() where profile_id='00000000-0000-4000-8000-000000000001'),'admin retains actual latest phone session');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select assert_test((select count(*)=3 from get_queue_health()),'supervisor sees member, lead-team and queue-member campaigns only');
select assert_test((select count(*)=0 from get_queue_health() where campaign_id in ('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000105')),'unrelated campaign metrics excluded inside definer');
select assert_test((select count(*)=1 from get_agent_live_status()),'supervisor sees only own-team agent');
select assert_test((select campaign_id is null and campaign_name is null and phone_status='on_call' from get_agent_live_status()),'cross-scope campaign masked without resurrecting stale phone status');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',true);
select assert_test((select count(*)=0 from get_queue_health()),'unassigned supervisor has no Voice campaign metrics');
select assert_test((select count(*)=0 from get_agent_live_status()),'unassigned supervisor has no agent directory');

-- Both RPCs must deny agents, inactive admins, absent users and invalid sessions.
do $$
declare subject text; rpc text;
begin
  foreach subject in array array[
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000006',
    ''
  ] loop
    perform set_config('request.jwt.claim.sub',subject,true);
    foreach rpc in array array['get_queue_health','get_agent_live_status'] loop
      begin
        execute format('select * from public.%I()',rpc);
        raise exception 'UNEXPECTED access for % to %',subject,rpc;
      exception when raise_exception then
        if sqlerrm not like rpc || ' solo puede%' then raise; end if;
        raise notice 'PASS: % denied to inactive/non-monitor actor %',rpc,subject;
      end;
    end loop;
  end loop;
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
  perform set_config('request.test.session_valid','false',true);
  foreach rpc in array array['get_queue_health','get_agent_live_status'] loop
    begin
      execute format('select * from public.%I()',rpc);
      raise exception 'UNEXPECTED revoked session access to %',rpc;
    exception when raise_exception then
      if sqlerrm not like rpc || ' solo puede%' then raise; end if;
      raise notice 'PASS: % denied to revoked session',rpc;
    end;
  end loop;
end $$;

set local role anon;
do $$ begin
  begin perform * from get_queue_health(); raise exception 'UNEXPECTED anonymous queue access';
  exception when insufficient_privilege then raise notice 'PASS: anonymous queue RPC denied'; end;
  begin perform * from get_agent_live_status(); raise exception 'UNEXPECTED anonymous agent access';
  exception when insufficient_privilege then raise notice 'PASS: anonymous agent RPC denied'; end;
end $$;
rollback;
