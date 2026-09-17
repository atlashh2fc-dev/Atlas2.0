-- Últimos cuatro informes que agregaban sin mirar la empresa.

do $$
declare
  v_def text;
  v_ocurrencias integer;
  v_objetivos text[][] := array[
    [
      'get_agent_activity_report',
      'where p.role = ''agente''',
      'where public.can_access_org(p.organization_id) and p.role = ''agente'''
    ],
    [
      'get_management_integrity_report',
      'where c.ended_at is not null',
      'where public.can_access_org(l.organization_id) and c.ended_at is not null'
    ],
    [
      'get_supervisor_report_summary',
      'where (v_team_ids is null or l.team_id = any(v_team_ids))',
      'where public.can_access_org(l.organization_id) and (v_team_ids is null or l.team_id = any(v_team_ids))'
    ],
    [
      'get_secretaria_virtual_channel_funnel',
      'where name = ''Secretaria Virtual''',
      'where public.can_access_org(organization_id) and name = ''Secretaria Virtual'''
    ]
  ];
begin
  for i in 1 .. array_length(v_objetivos, 1) loop
    select pg_get_functiondef(p.oid)
      into v_def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_objetivos[i][1]
     limit 1;

    if v_def is null then
      raise exception 'No existe la función %', v_objetivos[i][1];
    end if;

    v_ocurrencias := (length(v_def) - length(replace(v_def, v_objetivos[i][2], ''))) / length(v_objetivos[i][2]);
    if v_ocurrencias <> 1 then
      raise exception 'El anclaje de % aparece % veces; se esperaba exactamente una', v_objetivos[i][1], v_ocurrencias;
    end if;

    execute replace(v_def, v_objetivos[i][2], v_objetivos[i][3]);
  end loop;
end
$$;

-- El embudo de Secretaría Virtual busca una segunda campaña por nombre.
do $$
declare
  v_def text;
  v_anclaje text := 'where name = ''Meta Ads · WhatsApp · Secretaria Virtual Geimser''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_secretaria_virtual_channel_funnel';

  if position(v_anclaje in v_def) = 0 then
    raise exception 'No se encontró la campaña de WhatsApp en el embudo de Secretaría Virtual';
  end if;

  execute replace(
    v_def,
    v_anclaje,
    'where public.can_access_org(organization_id) and name = ''Meta Ads · WhatsApp · Secretaria Virtual Geimser'''
  );
end
$$;

do $$
declare
  v_faltan text;
begin
  select string_agg(p.proname, ', ')
    into v_faltan
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'get_agent_activity_report', 'get_management_integrity_report',
       'get_supervisor_report_summary', 'get_secretaria_virtual_channel_funnel',
       'get_call_metrics_report', 'get_agent_live_status', 'get_queue_health',
       'get_contactability_by_hour', 'get_workflow_compliance'
     )
     and pg_get_functiondef(p.oid) !~ 'can_access_org';

  if v_faltan is not null then
    raise exception 'Informes sin filtro de empresa: %', v_faltan;
  end if;
end
$$;
