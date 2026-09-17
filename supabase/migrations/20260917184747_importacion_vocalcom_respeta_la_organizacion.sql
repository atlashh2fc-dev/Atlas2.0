-- La importación de Vocalcom cruza eventos con leads por RUT y teléfono. Sin
-- frontera, una carga hecha desde una empresa podía enganchar con leads de otra
-- que compartieran teléfono. Se cambia la tabla por una subconsulta ya filtrada,
-- conservando el alias para no tocar el resto de la consulta.

do $$
declare
  v_def text;
  v_ocurrencias integer;
  v_anclaje text := 'from public.leads l';
  v_reemplazo text := 'from (select * from public.leads where public.can_access_org(organization_id)) l';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'import_vocalcom_events';

  if v_def is null then
    raise exception 'No existe import_vocalcom_events';
  end if;

  v_ocurrencias := (length(v_def) - length(replace(v_def, v_anclaje, ''))) / length(v_anclaje);
  if v_ocurrencias = 0 then
    raise exception 'La importación ya no lee public.leads con el alias esperado';
  end if;

  execute replace(v_def, v_anclaje, v_reemplazo);
  raise notice 'Se filtraron % lecturas de leads', v_ocurrencias;
end
$$;

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'import_vocalcom_events'
      and pg_get_functiondef(p.oid) !~ 'can_access_org'
  ) then
    raise exception 'import_vocalcom_events quedó sin frontera de empresa';
  end if;
end
$$;
