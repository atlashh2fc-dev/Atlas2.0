-- The published Secretaria Virtual workflow had a choice start node with no
-- options and five NULL/default edges alternating between Conecta and No
-- Conecta. Reconstruct the two explicit choices from the intended target
-- nodes so UI and save_call_management use the same catalog.

do $migration$
declare
  v_workflow_id constant uuid := '67aed07a-8986-4407-93a1-49e621fdbccd';
  v_start_id constant uuid := 'cb69f0b3-3095-4b83-a3a3-f05be616c978';
  v_connected_id constant uuid := 'e8cbd49e-265a-4a9b-ae1e-c94b6bc32db3';
  v_not_connected_id constant uuid := '6ed91142-f9d1-4cbc-928d-3ea1f01725ed';
begin
  if exists (
    select 1
    from public.workflow_steps
    where id = v_start_id
      and workflow_id = v_workflow_id
  ) then
    update public.workflow_steps
    set
      field_type = 'single_choice',
      options = '["Conecta", "No Conecta"]'::jsonb,
      allowed_results = array['Conecta', 'No Conecta']::text[]
    where id = v_start_id
      and workflow_id = v_workflow_id;

    delete from public.workflow_step_branches
    where workflow_id = v_workflow_id
      and from_step_id = v_start_id;

    insert into public.workflow_step_branches (
      workflow_id, from_step_id, from_option, to_step_id
    )
    values
      (v_workflow_id, v_start_id, 'Conecta', v_connected_id),
      (v_workflow_id, v_start_id, 'No Conecta', v_not_connected_id);
  end if;
end
$migration$;
