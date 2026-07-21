-- Los flujos se identifican por nombre aunque varíen las mayúsculas o los
-- espacios accidentales. Se eliminan los flujos repetidos de Secretaria virtual.
delete from public.workflows
where lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = 'secretaria virtual';

create unique index workflows_normalized_name_key
  on public.workflows ((lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))));
