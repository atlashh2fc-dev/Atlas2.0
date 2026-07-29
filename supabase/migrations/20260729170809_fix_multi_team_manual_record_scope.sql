do $migration$
declare definition text;
begin
  select pg_get_functiondef('public.create_manual_lead_record(text,text,text,text,uuid,uuid,uuid,text)'::regprocedure) into definition;
  definition := replace(definition, 'v_actor_team_id is null', 'coalesce(array_length(v_supervised_team_ids, 1), 0) = 0');
  definition := replace(definition, 'v_effective_team_id := v_actor_team_id;', E'v_effective_team_id := coalesce(p_team_id, v_supervised_team_ids[1]);\n    if not (v_effective_team_id = any(v_supervised_team_ids)) then\n      raise exception ''No puedes crear un registro fuera de tus equipos.'';\n    end if;');
  definition := replace(definition, 'v_agent.team_id is distinct from v_actor_team_id', 'not (v_agent.team_id = any(v_supervised_team_ids))');
  definition := replace(definition, 'v_existing_team_id is distinct from v_actor_team_id', 'not (v_existing_team_id = any(v_supervised_team_ids))');
  execute definition;
end;
$migration$;
