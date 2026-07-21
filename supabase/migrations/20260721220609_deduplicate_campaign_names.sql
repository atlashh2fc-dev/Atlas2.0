-- Las campañas se identifican por nombre ignorando mayúsculas y espacios
-- accidentales. Eliminar las campañas duplicadas vacías de Secretaria virtual
-- solicitadas antes de establecer la restricción.
delete from public.campaigns
where lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = 'secretaria virtual';

create unique index campaigns_normalized_name_key
  on public.campaigns ((lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))));
