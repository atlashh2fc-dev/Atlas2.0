select assert_test(not has_function_privilege('anon','public.claim_ai_loop_run(uuid,text)','execute'),'anon cannot claim');
select assert_test(not has_function_privilege('authenticated','public.complete_ai_loop_run(uuid,uuid,jsonb)','execute'),'users cannot manufacture analysis');
select assert_test(not has_table_privilege('authenticated','public.ai_loop_memory','update'),'users cannot directly confirm memory');
set role service_role;
select assert_test(reconcile_ai_loop_runs()=0,'default off enqueues nothing');
reset role;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000004';
select configure_ai_loop('00000000-0000-4000-8000-000000000101','shadow',20);
reset role;
set role service_role;
select assert_test(reconcile_ai_loop_runs()=1,'enables only the selected campaign');
select assert_test(reconcile_ai_loop_runs()=0,'reconcile is idempotent');
select id as run_a from ai_loop_runs limit 1 \gset
select claim_ai_loop_run(gen_random_uuid(),'callback-v1') as job_a \gset
select assert_test((:'job_a'::jsonb->>'id')::uuid=:'run_a'::uuid,'claims expected source');
select assert_test(claim_ai_loop_run(gen_random_uuid(),'callback-v1') is null,'second worker cannot claim leased work');
select assert_test(not complete_ai_loop_run(:'run_a',gen_random_uuid(),test_loop_result()),'wrong lease is fenced');

-- A subsequent management may finish before inference completes. It must not
-- disappear merely because the source run is still processing.
insert into calls(id,lead_id,agent_id,status,outcome,reason,started_at,ended_at) values
('00000000-0000-4000-8000-000000000503','00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000001','completed','sale','Gestión posterior',clock_timestamp(),clock_timestamp());
select assert_test(exists(select 1 from ai_loop_feedback where run_id=:'run_a' and kind='observed_outcome'),'captures outcomes during queue/inference');
select assert_test(complete_ai_loop_run(:'run_a',(:'job_a'::jsonb->>'lease_token')::uuid,test_loop_result()),'completes validated analysis');
select assert_test(not complete_ai_loop_run(:'run_a',(:'job_a'::jsonb->>'lease_token')::uuid,test_loop_result()),'completion replay cannot duplicate memory');
select assert_test((select count(*)=1 from ai_loop_memory where run_id=:'run_a'),'one fact written atomically');
select assert_test((select state='candidate' from ai_loop_memory where run_id=:'run_a'),'facts start unconfirmed');
select assert_test((select context_snapshot::text not like '%Por favor%' from ai_loop_runs where id=:'run_a'),'context snapshot never copies transcript or prior quotes');
reset role;

-- Human role/scope/optimistic review version are enforced inside the RPC too.
set role authenticated;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
select assert_test((select count(*)=0 from ai_loop_runs),'agents cannot access shadow analyses');
do $$ begin
  perform configure_ai_loop('00000000-0000-4000-8000-000000000101','shadow',20);
  raise exception 'agent configured loop';
exception when others then if sqlerrm<>'not_authorized' then raise; end if; end $$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';
select assert_test((select count(*)=1 from ai_loop_runs),'supervisor sees own source');
select review_ai_loop_decision(:'run_a',0,'accepted','confirmed','Solicitud comprobada contra la fuente');
select assert_test((select state='confirmed' from ai_loop_memory where run_id=:'run_a'),'review confirms reusable memory');
do $$ declare rid uuid; begin
  select id into rid from ai_loop_runs limit 1;
  perform review_ai_loop_decision(rid,0,'rejected','rejected','Revisión vieja');
  raise exception 'stale reviewer wrote';
exception when others then if sqlerrm<>'review_conflict' then raise; end if; end $$;
set request.test.session_valid='false';
select assert_test((select count(*)=0 from ai_loop_runs),'revoked session sees no analyses');
set request.test.session_valid='true';
reset role;

-- Opening another call must not invalidate factual memory from A.
set role service_role;
insert into calls(id,lead_id,agent_id,status,started_at) values
('00000000-0000-4000-8000-000000000504','00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000001','in_progress',clock_timestamp());
select assert_test(reconcile_ai_loop_runs()=0,'transient open call does not re-enqueue factual input');
select assert_test((select superseded_at is null from ai_loop_runs where id=:'run_a'),'confirmed source not superseded by transient context');
update calls set status='completed',outcome='callback',reason='Retomar',ended_at=clock_timestamp(),updated_at=clock_timestamp() where id='00000000-0000-4000-8000-000000000504';
insert into call_recordings values('00000000-0000-4000-8000-000000000604','00000000-0000-4000-8000-000000000504','00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000201','ready',now()+interval '30 days',now(),repeat('a',64));
insert into call_transcriptions values('00000000-0000-4000-8000-000000000704','00000000-0000-4000-8000-000000000604','completed',repeat('a',64),'Por favor llámeme el viernes.',clock_timestamp());
select assert_test(jsonb_array_length(atlas_loop_private.source('00000000-0000-4000-8000-000000000604')->'memory')=1,'later source consumes prior confirmed memory');
select assert_test((atlas_loop_private.source('00000000-0000-4000-8000-000000000604')->'memory')::text not like '%Por favor%','cross-source context does not copy quotes');
select id as run_b from ai_loop_runs where recording_id='00000000-0000-4000-8000-000000000604' \gset

-- A correction is a new observation and a new source version, without rewriting history.
update calls set outcome='not_interested',reason='Resultado corregido',updated_at=clock_timestamp() where id='00000000-0000-4000-8000-000000000503';
select assert_test((select count(*)=2 from ai_loop_feedback where run_id=:'run_a' and source_call_id='00000000-0000-4000-8000-000000000503'),'later outcome revisions preserved');
update calls set reason='Tipificación fuente corregida',updated_at=clock_timestamp() where id='00000000-0000-4000-8000-000000000501';
select assert_test((select count(*)=2 from ai_loop_runs where recording_id='00000000-0000-4000-8000-000000000601'),'source correction creates a new version');
select assert_test((select superseded_at is not null from ai_loop_runs where id=:'run_a'),'old decision superseded');
select assert_test(jsonb_array_length(atlas_loop_private.source('00000000-0000-4000-8000-000000000604')->'memory')=1,'management correction alone does not erase transcript facts');

-- Changing a transcript does invalidate the old confirmed facts.
update call_transcriptions set transcript_text='Fuente corregida sin solicitud.',updated_at=clock_timestamp() where recording_id='00000000-0000-4000-8000-000000000601';
select assert_test(jsonb_array_length(atlas_loop_private.source('00000000-0000-4000-8000-000000000604')->'memory')=0,'revised transcript removes previous facts from retrieval');

-- Lease recovery and pause on the final attempt.
update ai_loop_runs set status='superseded',superseded_at=now() where id<>:'run_b';
select claim_ai_loop_run(gen_random_uuid(),'callback-v1') as job_b \gset
update ai_loop_runs set lease_until=now()-interval '1 second' where id=:'run_b';
select claim_ai_loop_run(gen_random_uuid(),'callback-v1') as job_b2 \gset
select assert_test((:'job_b'::jsonb->>'lease_token')<>(:'job_b2'::jsonb->>'lease_token'),'retry rotates fencing token');
select assert_test(not complete_ai_loop_run(:'run_b',(:'job_b'::jsonb->>'lease_token')::uuid,test_loop_result()),'old worker cannot finish recovered job');
update ai_loop_runs set attempt_count=3 where id=:'run_b';
reset role;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000004';
select configure_ai_loop('00000000-0000-4000-8000-000000000101','off',20);
select assert_test((select status='failed' from ai_loop_runs where id=:'run_b'),'pause at final attempt is terminal, not stuck pending');
reset role;

-- Another supervisor must see neither private facts nor review data.
insert into profiles(id,role,team_id,full_name) values('00000000-0000-4000-8000-000000000005','supervisor','00000000-0000-4000-8000-000000000202','Supervisor B');
set role authenticated;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000005';
select assert_test((select count(*)=0 from ai_loop_runs),'cross-team run denied');
select assert_test((select count(*)=0 from ai_loop_memory),'cross-team derived facts denied');
select assert_test((select count(*)=0 from ai_loop_feedback),'cross-team feedback denied');
reset role;

set role service_role;
update call_recordings set status='deleted' where id='00000000-0000-4000-8000-000000000601';
select assert_test(not exists(select 1 from ai_loop_runs where recording_id='00000000-0000-4000-8000-000000000601'),'source withdrawal purges its derived data');
select assert_test(not exists(select 1 from ai_loop_memory where run_id=:'run_a'),'source memory purged');
select assert_test(not exists(select 1 from ai_loop_runs where context_snapshot::text like '%Por favor%'),'no withdrawn quote survives in dependent context');
reset role;
