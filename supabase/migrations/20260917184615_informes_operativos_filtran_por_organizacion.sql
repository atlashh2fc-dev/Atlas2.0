-- Informes que agregan por campaña o por ejecutivo. Se inserta la condición de
-- empresa en su filtro final, sin tocar el resto del cuerpo: cada anclaje se
-- comprueba y la migración falla si aparece más de una vez o ninguna.

do $$
declare
  v_def text;
  v_ocurrencias integer;
  v_objetivos text[][] := array[
    [
      'get_call_metrics_report',
      'where da.originated_at is not null',
      'where public.can_access_org(public.org_of_campaign(da.campaign_id)) and da.originated_at is not null'
    ],
    [
      'get_agent_live_status',
      'where p.role = ''agente'' and p.active',
      'where public.can_access_org(p.organization_id) and p.role = ''agente'' and p.active'
    ],
    [
      'get_queue_health',
      'where dc.is_active = true',
      'where public.can_access_org(public.org_of_campaign(dc.campaign_id)) and dc.is_active = true'
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

do $$
declare
  v_faltan text;
begin
  select string_agg(p.proname, ', ')
    into v_faltan
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('get_call_metrics_report', 'get_agent_live_status', 'get_queue_health')
     and pg_get_functiondef(p.oid) !~ 'can_access_org';

  if v_faltan is not null then
    raise exception 'Estos informes quedaron sin filtro de empresa: %', v_faltan;
  end if;
end
$$;
